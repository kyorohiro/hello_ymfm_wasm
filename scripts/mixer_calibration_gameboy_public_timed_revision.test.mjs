import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGameboyPublicTimedRevisionReadContext,GAMEBOY_PUBLIC_TIMED_RECEIPT,GAMEBOY_PUBLIC_TIMED_PIN} from './mixer_calibration_gameboy_public_timed_revision.mjs';
import {createNpmReleaseMetadataReadContext} from './mixer_calibration_npm_release_metadata.mjs';
import {assertMixerCalibrationSourceFreshness as fresh} from './mixer_calibration_sources.mjs';
const root=new URL('../',import.meta.url),read=name=>readFileSync(new URL(name,root)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(read(GAMEBOY_PUBLIC_TIMED_RECEIPT));
const key=url=>relative(fileURLToPath(root),fileURLToPath(url)).replaceAll('\\','/');
function context(changes=new Map()){
  const metadata=createNpmReleaseMetadataReadContext(url=>changes.get(key(url))??readFileSync(url));
  return createGameboyPublicTimedRevisionReadContext(metadata.readSource);
}
test('public Game Boy review restores every exact predecessor without touching live source or calibration bytes',()=>{
  assert.equal(sha(JSON.stringify(receipt)),GAMEBOY_PUBLIC_TIMED_PIN);
  const ctx=context();assert.equal(Object.keys(receipt.sources).length,12);
  for(const [name,entry]of Object.entries(receipt.sources)){
    const current=read(name),before=ctx.restore(name,current);
    assert.equal(sha(current),entry.after.sha256);assert.equal(sha(before),entry.before.sha256);assert.equal(before.length,entry.before.bytes);
    assert.deepEqual(ctx.readSource(new URL(name,root)),before);assert.deepEqual(read(name),current);
    if(name.startsWith('docs/'))assert.deepEqual(ctx.restore(name.slice(5),current),before,'historical path aliases use the same exact source view');
  }
  const name='docs/js/playground_logic_worker.js',entry=receipt.sources[name];
  assert.equal(fresh({path:name.slice(5),bytes:read(name),record:entry.before}),'gameboy-public-timed-connection');
});
test('only four canonical connections and their mirrors are functional; all other browser edits are cache-only',()=>{
  const groups=Object.groupBy(Object.entries(receipt.sources),([,entry])=>entry.kind);
  assert.equal(groups['gameboy-public-timed-connection'].length,8);assert.equal(groups['public-api-cache-version-tool'].length,1);
  const normalize=bytes=>bytes.toString('utf8').replace(/\?v=[A-Za-z0-9._+-]+/g,'');const ctx=context();
  for(const[name]of groups['import-cache-only'])assert.equal(normalize(ctx.restore(name,read(name))),normalize(read(name)));
});
test('future edits to connections and version tools do not inherit the release exemption',()=>{
  for(const name of ['tetorica_src/runtime/playground_runtime.js','docs/js/playground_worker_chip.js','scripts/version_playground_runtime.mjs']){
    const changed=Buffer.concat([read(name),Buffer.from('\n// unreviewed\n')]);
    assert.equal(context().restore(name,changed),changed);
    const changes=new Map([[name,changed]]);
    assert.throws(()=>context(changes).restore('docs/js/playground_logic_worker.js',read('docs/js/playground_logic_worker.js')),/Unreviewed Game Boy public timed connection/);
  }
});
test('operation resolution, audio renderers, clocks, WASM and gains remain independently pinned',()=>{
  for(const name of ['tetorica_src/runtime/gameboy_timed_processor.js','tetorica_src/runtime/playground_gameboy_worklet.js','tetorica_src/runtime/playground_performance_processor.js','tetorica_src/runtime/generated/gameboy_apu_wasm.wasm','tetorica_src/runtime/soundchip_mixer_presets.js']){
    const changes=new Map([[name,Buffer.concat([read(name),Buffer.from('\n')])]]);
    assert.throws(()=>context(changes).restore('docs/js/playground_logic_worker.js',read('docs/js/playground_logic_worker.js')),/dependency/);
  }
});
test('forged receipts and additional renderer scope are rejected',()=>{
  for(const mutate of [value=>delete value.sources['docs/js/playground_runtime.js'],value=>{value.sources['tetorica_src/runtime/sidsynth.js']=value.sources['tetorica_src/runtime/playground_runtime.js'];}]){
    const value=structuredClone(receipt);mutate(value);
    const changes=new Map([[GAMEBOY_PUBLIC_TIMED_RECEIPT,Buffer.from(JSON.stringify(value))]]);
    assert.throws(()=>context(changes).restore('docs/js/playground_logic_worker.js',read('docs/js/playground_logic_worker.js')),/receipt/);
  }
});
