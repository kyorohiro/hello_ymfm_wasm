import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from '../test/helpers/historical_huc_timed_calibration_inputs.mjs';
const {SCSP_DRAFT_REVISION_PATH:path,SCSP_DRAFT_REVISION_RECEIPT_PATH:receiptPath,
  SCSP_DRAFT_REVISION_RECEIPT_OBJECT_SHA256:pin,
  restoreMixerCalibrationScspDraftRevision:restore}=await historicalCalibrationModule('mixer_calibration_scsp_draft_revision.mjs');
const {assertMixerCalibrationSourceFreshness:fresh}=await historicalCalibrationModule('mixer_calibration_sources.mjs');
const {restoreMixerCalibrationScspEmptyDraftRevision}=await historicalCalibrationModule('mixer_calibration_scsp_empty_draft_revision.mjs');

const read=name=>readFileSync(new URL('../'+name,import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(read(receiptPath));
// Inspect this historical layer's exact reviewed source. Current shipped bytes
// are separately covered by the chained empty-slot draft revision tests.
const currentSource=()=>restoreMixerCalibrationScspEmptyDraftRevision(path,read('docs/'+path));
test('passive draft checkpoints reconstruct the exact measured source and retain all eight reports',()=>{
  assert.equal(sha(JSON.stringify(receipt)),pin);
  assert.equal(read(receiptPath).toString(),JSON.stringify(receipt,null,2)+'\n');
  const current=currentSource(),before=restore(path,current);
  assert.equal(before.length,receipt.before.bytes);assert.equal(sha(before),receipt.before.sha256);
  assert.equal(restore(path,before),before);
  for(const name of Object.keys(receipt.reports)){
    const bytes=read(name),report=JSON.parse(bytes);
    assert.equal(fresh({path,bytes:current,record:report.sources[path],report}),'ui-scsp-draft-checkpoint');
    assert.equal(sha(bytes),receipt.reports[name].sha256);
    assert.equal(bytes.length,receipt.reports[name].bytes);
  }
});
test('unrelated paths, future panel edits and detached source records remain stale',()=>{
  const current=currentSource(),changed=Buffer.from(current);changed[Math.floor(changed.length/2)]^=1;
  for(const bytes of [changed,Buffer.concat([current,Buffer.from('\n')]),Buffer.from("import './future-audio.js';\n"+current)]){
    assert.equal(restore(path,bytes),bytes);
    assert.throws(()=>fresh({path,bytes,record:receipt.before}),/remeasure/);
  }
  for(const other of ['docs/'+path,'__proto__','playground/another-panel.js','js/scspsynth.js','generated/scsp_wasm.wasm']){
    assert.equal(restore(other,current),current);
    assert.throws(()=>fresh({path:other,bytes:current,record:receipt.before}));
  }
  for(const record of [undefined,{}, {...receipt.before,bytes:1},{...receipt.before,sha256:'0'.repeat(64)}])
    assert.throws(()=>fresh({path,bytes:current,record}));
});
test('changed historical measurement bytes cannot authorize the passive UI insertion',()=>{
  const current=currentSource();
  for(const target of Object.keys(receipt.reports))assert.throws(()=>restore(path,current,{readSource(url){
    const bytes=readFileSync(url);return url.pathname.endsWith('/'+target)?Buffer.concat([bytes,Buffer.from([0])]):bytes;
  }}),/original measurement changed/);
});
