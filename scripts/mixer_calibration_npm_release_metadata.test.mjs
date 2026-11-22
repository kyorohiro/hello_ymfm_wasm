import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createNpmReleaseMetadataReadContext,NPM_RELEASE_METADATA_RECEIPT,NPM_RELEASE_METADATA_PIN,NPM_RELEASE_METADATA_PATHS} from './mixer_calibration_npm_release_metadata.mjs';
import {createSidTimedRevisionReadContext} from './mixer_calibration_sid_timed_revision.mjs';
import {createGameboyPublicTimedRevisionReadContext} from './mixer_calibration_gameboy_public_timed_revision.mjs';
import {createCodeApiConsistencyRevisionReadContext} from './mixer_calibration_code_api_consistency_revision.mjs';

const root=new URL('../',import.meta.url),read=name=>readFileSync(new URL(name,root));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(read(NPM_RELEASE_METADATA_RECEIPT));
const key=url=>relative(fileURLToPath(root),fileURLToPath(url)).replaceAll('\\','/');
const source=changes=>url=>changes.get(key(url))??readFileSync(url);

test('only the pinned four-file non-renderer release is accepted and exact predecessors are restored',()=>{
  assert.equal(sha(JSON.stringify(receipt)),NPM_RELEASE_METADATA_PIN);
  assert.deepEqual(Object.keys(receipt.sources).sort(),[...NPM_RELEASE_METADATA_PATHS].sort());
  const context=createNpmReleaseMetadataReadContext();
  for(const name of NPM_RELEASE_METADATA_PATHS){
    const current=read(name),previous=context.restore(name,current),record=receipt.sources[name];
    assert.equal(current.length,record.after.bytes);assert.equal(sha(current),record.after.sha256);
    assert.equal(previous.length,record.before.bytes);assert.equal(sha(previous),record.before.sha256);
    assert.notDeepEqual(current,previous);assert.equal(context.restore(name,previous),previous,'already-restored bytes are not rewritten');
    assert.deepEqual(context.readSource(new URL(name,root)),previous);
    assert.deepEqual(read(name),current,'predecessor view never writes live metadata');
  }
  const previous=JSON.parse(context.readSource(new URL('packages/fm2612/package.json',root)));
  const current=JSON.parse(read('packages/fm2612/package.json'));
  assert.equal(previous.version,'0.2.45');assert.equal(current.version,'0.2.46');
  delete previous.version;delete current.version;assert.deepEqual(current,previous,'only package version changed');
});

test('future versions, arbitrary package fields and README edits receive no metadata hash exemption',()=>{
  const manifest=JSON.parse(read('packages/fm2612/package.json'));
  for(const changed of [{...manifest,version:'0.2.47'},{...manifest,description:'unreviewed description'},{...manifest,exports:{'.':'./other.js'}}]){
    const bytes=Buffer.from(JSON.stringify(changed,null,2)+'\n');
    assert.throws(()=>createNpmReleaseMetadataReadContext().restore('packages/fm2612/package.json',bytes),/Unreviewed npm release metadata/);
  }
  for(const name of NPM_RELEASE_METADATA_PATHS.filter(name=>name.endsWith('README.md'))){
    const before=createNpmReleaseMetadataReadContext().readSource(new URL(name,root));
    for(const bytes of [Buffer.concat([read(name),Buffer.from('\nunreviewed\n')]),Buffer.concat([before,Buffer.from('\nunreviewed\n')])])
      assert.throws(()=>createNpmReleaseMetadataReadContext().restore(name,bytes),/Unreviewed npm release metadata/);
  }
  assert.throws(()=>createNpmReleaseMetadataReadContext().restore('scripts/check_fm2612_package.mjs',Buffer.concat([read('scripts/check_fm2612_package.mjs'),Buffer.from('\n// unreviewed\n')])),/Unreviewed npm release metadata/);
});

test('modified evidence is rejected rather than used as a generic metadata normalizer',()=>{
  for(const mutate of [value=>{value.toVersion='0.2.47';},value=>{value.sources['tetorica_src/runtime/sidsynth.js']=value.sources['packages/fm2612/package.json'];},value=>{value.sources['packages/fm2612/README.md'].hunks[0].beforeBase64='';}]){
    const value=structuredClone(receipt);mutate(value);
    const changed=new Map([[NPM_RELEASE_METADATA_RECEIPT,Buffer.from(JSON.stringify(value))]]);
    const context=createNpmReleaseMetadataReadContext(source(changed));
    assert.throws(()=>context.restore('packages/fm2612/README.md',read('packages/fm2612/README.md')),/Unreviewed npm release metadata: receipt/);
  }
});

test('non-metadata bytes pass through untouched and the existing SID dependency guard still rejects runtime edits',()=>{
  const bytes=Buffer.from('unreviewed renderer');
  assert.equal(createNpmReleaseMetadataReadContext().restore('tetorica_src/runtime/sidsynth.js',bytes),bytes);
  const changes=new Map([['tetorica_src/runtime/sid_operations.js',Buffer.concat([read('tetorica_src/runtime/sid_operations.js'),Buffer.from('\n// unreviewed\n')])]]);
  const latest=createCodeApiConsistencyRevisionReadContext(source(changes)),metadata=createNpmReleaseMetadataReadContext(latest.readSource);
  const connection=createGameboyPublicTimedRevisionReadContext(metadata.readSource),sid=createSidTimedRevisionReadContext(connection.readSource);
  assert.throws(()=>sid.restore('docs/js/playground_runtime.js',connection.readSource(new URL('docs/js/playground_runtime.js',root))),/SID timed revision dependency tetorica_src\/runtime\/sid_operations.js/);
});

test('the exact release predecessor reader composes with the untouched SID revision',()=>{
  const latest=createCodeApiConsistencyRevisionReadContext(),metadata=createNpmReleaseMetadataReadContext(latest.readSource);
  const connection=createGameboyPublicTimedRevisionReadContext(metadata.readSource),sid=createSidTimedRevisionReadContext(connection.readSource);
  const current=connection.readSource(new URL('docs/js/playground_runtime.js',root)),previous=sid.restore('docs/js/playground_runtime.js',current);
  assert.notDeepEqual(current,previous);
  assert.equal(JSON.parse(sid.readSource(new URL('packages/fm2612/package.json',root))).version,'0.2.45');
});
