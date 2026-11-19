import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from '../test/helpers/historical_huc_timed_calibration_inputs.mjs';
const {restoreMixerCalibrationScspFmDepthRevision:restore,
  createScspFmDepthRevisionReader,createScspFmDepthRevisionReadContext,
  SCSP_FM_DEPTH_REVISION_BASE_COMMIT:base,
  SCSP_FM_DEPTH_REVISION_RECEIPT_PATH:receiptPath,
  SCSP_FM_DEPTH_REVISION_RECEIPT_OBJECT_SHA256:receiptPin,
  SCSP_FM_DEPTH_REVISION_SOURCE_PATHS:sources,
  SCSP_FM_DEPTH_REVISION_RELATED_PATHS:related,
  SCSP_FM_DEPTH_REVISION_REPORT_PATHS:reports,
}=await historicalCalibrationModule('mixer_calibration_scsp_fm_depth_revision.mjs');
const {createScspFmMultiRevisionReader}=await historicalCalibrationModule('mixer_calibration_scsp_fm_multi_revision.mjs');
const {createScspSsfDspRevisionReader}=await historicalCalibrationModule('mixer_calibration_scsp_ssf_dsp_revision.mjs');
const url=name=>new URL('../'+name,import.meta.url),read=name=>createScspSsfDspRevisionReader()(url(name));
const sha=value=>createHash('sha256').update(value).digest('hex');
const receipt=JSON.parse(read(receiptPath));
const match=(bytes,expected)=>{assert.equal(bytes.length,expected.bytes);assert.equal(sha(bytes),expected.sha256);};

test('the per-operator FM depth revision pins complete reviewed source and unchanged legacy audio evidence',()=>{
  assert.equal(receipt.baseCommit,base);assert.equal(sha(JSON.stringify(receipt)),receiptPin);
  assert.equal(read(receiptPath).toString(),JSON.stringify(receipt,null,2)+'\n');
  assert.deepEqual(Object.keys(receipt.sources),[...sources]);
  assert.deepEqual(Object.keys(receipt.relatedSources),[...related]);
  assert.deepEqual(Object.keys(receipt.reports),[...reports]);
  for(const name of sources){const current=read(name);match(current,receipt.sources[name].after);const previous=restore(name,current);match(previous,receipt.sources[name].before);assert.deepEqual(restore(name,previous),previous);}
  for(const name of [...related,...reports])match(read(name),receipt.relatedSources[name]??receipt.reports[name]);
});
test('the per-operator depth reader supplies the exact earlier Synth and composes with the prior Multi-operator proof',()=>{
  const reader=createScspFmDepthRevisionReader();
  for(const name of sources)match(reader(url(name)),receipt.sources[name].before);
  const previous=JSON.parse(read('docs/issues/scsp_fm_multi_source_revision_01.json'));
  const earlier=createScspFmMultiRevisionReader();
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
  const proof=createScspFmDepthRevisionReadContext(source);
  for(const name of sources){match(proof.restore(name,read(name)),receipt.sources[name].before);match(proof.readSource(url(name)),receipt.sources[name].before);}
  assert([...counts.values()].every(value=>value===1));
  const reader=createScspFmDepthRevisionReader(source);match(reader(url(target)),receipt.sources[target].before);modified=true;
  assert.throws(()=>reader(url(target)),/pinned source\/report dependency changed/);
  assert.throws(()=>createScspFmDepthRevisionReadContext(source).restore(target,read(target)),/pinned source\/report dependency changed/);
  match(proof.readSource(url(target)),receipt.sources[target].before);
});
