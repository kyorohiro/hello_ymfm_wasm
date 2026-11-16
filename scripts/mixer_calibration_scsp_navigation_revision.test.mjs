import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readHistoricalAyTimedFile, readHistoricalAyTimedFileSync as readFileSync} from '../test/helpers/historical_ay_timed_source_fixture.mjs';
import {SCSP_NAVIGATION_REVISION_PATH as path,SCSP_NAVIGATION_REVISION_RECEIPT_PATH as receiptPath,
  SCSP_NAVIGATION_REVISION_RECEIPT_OBJECT_SHA256 as pin,
  restoreMixerCalibrationScspNavigationRevision as restore} from './mixer_calibration_scsp_navigation_revision.mjs';
import {createScspSharedClientNavigationUiReceipt} from './record_scsp_shared_client_navigation_ui_revision.mjs';
import {restoreMixerCalibrationFm2608NavigationRevision} from './mixer_calibration_fm2608_navigation_revision.mjs';
import {assertMixerCalibrationSourceFreshness as fresh} from './mixer_calibration_sources.mjs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(read(receiptPath));
test('the exact passive SCSP insertion reconstructs its pinned predecessor and preserves all eight reports',async()=>{
  assert.equal(sha(JSON.stringify(receipt)),pin);
  assert.equal(read(receiptPath).toString(),JSON.stringify(receipt,null,2)+'\n');
  assert.deepEqual(await createScspSharedClientNavigationUiReceipt({readSource:readHistoricalAyTimedFile}),receipt);
  const current=read('docs/'+path),before=restore(path,current);
  assert.equal(before.length,receipt.before.bytes);assert.equal(sha(before),receipt.before.sha256);
  assert.equal(restore(path,before),before);
  assert.equal(fresh({path,bytes:current,record:receipt.before}),'ui-scsp-shared-client-source-navigation');
  const measured=restoreMixerCalibrationFm2608NavigationRevision(path,current);
  for(const name of Object.keys(receipt.reports)){
    const bytes=read(name),report=JSON.parse(bytes);
    assert.equal(measured.length,report.sources[path].bytes);assert.equal(sha(measured),report.sources[path].sha256);
    assert.equal(fresh({path,bytes:current,record:report.sources[path],report}),'ui-fm2608-hardware-source-navigation');
    assert.deepEqual(read(name),bytes);
  }
});
test('future source edits, unrelated paths and detached measurement hashes remain stale',()=>{
  const current=read('docs/'+path),changed=Buffer.from(current);changed[Math.floor(changed.length/2)]^=1;
  for(const bytes of [changed,Buffer.concat([current,Buffer.from('\n')]),Buffer.from("import './future-audio.js';\n"+current)]){
    assert.equal(restore(path,bytes),bytes);
    assert.throws(()=>fresh({path,bytes,record:receipt.before}),/remeasure/);
  }
  for(const other of ['docs/'+path,'__proto__','playground/another-viewer.js','js/scspsynth.js','generated/scsp_wasm.wasm']){
    assert.equal(restore(other,current),current);
    assert.throws(()=>fresh({path:other,bytes:current,record:receipt.before}));
  }
  for(const record of [undefined,{}, {...receipt.before,bytes:1},{...receipt.before,sha256:'0'.repeat(64)}])
    assert.throws(()=>fresh({path,bytes:current,record}));
});
test('edited historical measurement bytes cannot authorize SCSP navigation',()=>{
  const current=read('docs/'+path);
  for(const target of Object.keys(receipt.reports))assert.throws(()=>restore(path,current,{readSource(url){
    const bytes=readFileSync(url);return url.pathname.endsWith('/'+target)?Buffer.concat([bytes,Buffer.from([0])]):bytes;
  }}),/original measurement changed/);
});
