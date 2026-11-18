import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {restoreMixerCalibrationScspFmMultiRevision as restore,
  createScspFmMultiRevisionReader,createScspFmMultiRevisionReadContext,
  SCSP_FM_MULTI_REVISION_BASE_COMMIT as base,
  SCSP_FM_MULTI_REVISION_RECEIPT_PATH as receiptPath,
  SCSP_FM_MULTI_REVISION_RECEIPT_OBJECT_SHA256 as receiptPin,
  SCSP_FM_MULTI_REVISION_SOURCE_PATHS as sources,
  SCSP_FM_MULTI_REVISION_RELATED_PATHS as related,
  SCSP_FM_MULTI_REVISION_REPORT_PATHS as reports,
} from './mixer_calibration_scsp_fm_multi_revision.mjs';
import {createScspFmCustom2RevisionReader} from './mixer_calibration_scsp_fm_custom_revision.mjs';
import {createScspFmDepthRevisionReader} from './mixer_calibration_scsp_fm_depth_revision.mjs';
const url=name=>new URL('../'+name,import.meta.url),read=name=>createScspFmDepthRevisionReader()(url(name));
const sha=value=>createHash('sha256').update(value).digest('hex');
const receipt=JSON.parse(read(receiptPath));
const match=(bytes,expected)=>{assert.equal(bytes.length,expected.bytes);assert.equal(sha(bytes),expected.sha256);};

test('the custom multi-operator FM revision pins complete reviewed source and unchanged legacy audio evidence',()=>{
  assert.equal(receipt.baseCommit,base);assert.equal(sha(JSON.stringify(receipt)),receiptPin);
  assert.equal(read(receiptPath).toString(),JSON.stringify(receipt,null,2)+'\n');
  assert.deepEqual(Object.keys(receipt.sources),[...sources]);
  assert.deepEqual(Object.keys(receipt.relatedSources),[...related]);
  assert.deepEqual(Object.keys(receipt.reports),[...reports]);
  for(const name of sources){const current=read(name);match(current,receipt.sources[name].after);const previous=restore(name,current);match(previous,receipt.sources[name].before);assert.deepEqual(restore(name,previous),previous);}
  for(const name of [...related,...reports])match(read(name),receipt.relatedSources[name]??receipt.reports[name]);
});
test('the multi-operator reader supplies the exact earlier Synth and composes with the prior Custom2 proof',()=>{
  const reader=createScspFmMultiRevisionReader();
  for(const name of sources)match(reader(url(name)),receipt.sources[name].before);
  const previous=JSON.parse(read('docs/issues/scsp_fm_custom2_source_revision_01.json'));
  const earlier=createScspFmCustom2RevisionReader();
  match(earlier(url('docs/synth-scsp/index.html')),previous.sources['docs/synth-scsp/index.html'].before);
  match(earlier(url('docs/synth-scsp/routing.js')),previous.sources['docs/synth-scsp/routing.js'].before);
});
test('unknown, old or future source bodies receive no reconstruction exemption',()=>{
  for(const name of sources){
    const current=read(name),edited=Buffer.concat([current,Buffer.from('\n')]);
    assert.equal(restore(name,edited),edited);
    if(name.startsWith('docs/synth-scsp/'))
      assert.deepEqual(restore('synth-scsp/'+name.split('/').at(-1),current),restore(name,current));
  }
  const bytes=read(sources[0]);
  for(const name of ['../'+sources[0],'docs/synth-scsp/not-reviewed.js','docs/generated/scsp_wasm.wasm'])assert.equal(restore(name,bytes),bytes);
});
test('every application, codec, owner, test and historical report dependency must match',()=>{
  const target=sources[0],current=read(target);
  for(const name of [...sources,...related,...reports])
    assert.throws(()=>restore(target,current,{readSource(location){const bytes=readFileSync(location);return location.href===url(name).href?Buffer.concat([bytes,Buffer.from('\n')]):bytes;}}),/pinned source\/report dependency changed/,name);
  assert.throws(()=>restore(target,current,{readSource(location){
    if(location.href!==url(receiptPath).href)return readFileSync(location);
    const forged=structuredClone(receipt);forged.sources[target].before.sha256='0'.repeat(64);return Buffer.from(JSON.stringify(forged));
  }}),/independently pinned receipt/);
});
test('owned proof reads are immutable while ordinary readers and later proofs revalidate',()=>{
  let modified=false;const counts=new Map(),dependency=related[0],target=sources[0];
  const source=location=>{counts.set(location.href,(counts.get(location.href)??0)+1);const bytes=readFileSync(location);return modified&&location.href===url(dependency).href?Buffer.concat([bytes,Buffer.from('\n')]):bytes;};
  const proof=createScspFmMultiRevisionReadContext(source);
  for(const name of sources){match(proof.restore(name,read(name)),receipt.sources[name].before);match(proof.readSource(url(name)),receipt.sources[name].before);}
  assert([...counts.values()].every(value=>value===1));
  const reader=createScspFmMultiRevisionReader(source);match(reader(url(target)),receipt.sources[target].before);modified=true;
  assert.throws(()=>reader(url(target)),/pinned source\/report dependency changed/);
  assert.throws(()=>createScspFmMultiRevisionReadContext(source).restore(target,read(target)),/pinned source\/report dependency changed/);
  match(proof.readSource(url(target)),receipt.sources[target].before);
});
