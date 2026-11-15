import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {SCSP_EMPTY_DRAFT_REVISION_PATH as path,SCSP_EMPTY_DRAFT_REVISION_RECEIPT_PATH as receiptPath,
  SCSP_EMPTY_DRAFT_REVISION_RECEIPT_OBJECT_SHA256 as pin,
  restoreMixerCalibrationScspEmptyDraftRevision as restore} from './mixer_calibration_scsp_empty_draft_revision.mjs';
import {restoreMixerCalibrationScspDraftRevision} from './mixer_calibration_scsp_draft_revision.mjs';
import {assertMixerCalibrationSourceFreshness as fresh} from './mixer_calibration_sources.mjs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(read(receiptPath));
test('empty-slot UI restoration chains through the exact prior checkpoint source and original measurements',()=>{
  assert.equal(sha(JSON.stringify(receipt)),pin);
  assert.equal(read(receiptPath).toString(),JSON.stringify(receipt,null,2)+'\n');
  const current=read('docs/'+path),before=restore(path,current),measured=restoreMixerCalibrationScspDraftRevision(path,before);
  assert.equal(before.length,22876);assert.equal(sha(before),receipt.before.sha256);
  assert.equal(measured.length,21600);
  assert.equal(fresh({path,bytes:current,record:receipt.before}),'ui-scsp-empty-draft-checkpoint');
  for(const name of Object.keys(receipt.reports)){
    const bytes=read(name),report=JSON.parse(bytes);
    assert.equal(measured.length,report.sources[path].bytes);assert.equal(sha(measured),report.sources[path].sha256);
    assert.equal(fresh({path,bytes:current,record:report.sources[path],report}),'ui-scsp-empty-draft-checkpoint');
    assert.equal(sha(bytes),receipt.reports[name].sha256);assert.equal(bytes.length,receipt.reports[name].bytes);
  }
});
test('unrelated paths, future source edits and detached source records cannot use the empty-draft receipt',()=>{
  const current=read('docs/'+path),changed=Buffer.from(current);changed[Math.floor(changed.length/2)]^=1;
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
test('changing any historical measurement rejects the new passive empty-slot UI layer',()=>{
  const current=read('docs/'+path);
  for(const target of Object.keys(receipt.reports))assert.throws(()=>restore(path,current,{readSource(url){
    const bytes=readFileSync(url);return url.pathname.endsWith('/'+target)?Buffer.concat([bytes,Buffer.from([0])]):bytes;
  }}),/original measurement changed/);
});
