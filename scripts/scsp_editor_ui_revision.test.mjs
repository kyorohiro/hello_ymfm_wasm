import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {assertMixerCalibrationSourceFreshness} from './mixer_calibration_sources.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('SCSP manual editor receipt permits exact reviewed UI revisions and rejects other bytes',async()=>{
 const receipt=JSON.parse(await readFile(new URL('../docs/issues/scsp_editor_ui_revision_01.json',import.meta.url)));
 for(const [path,{before,after}]of Object.entries(receipt.sources)){
  const bytes=await readFile(new URL('../docs/'+path,import.meta.url));assert.equal(bytes.length,after.bytes);assert.equal(sha(bytes),after.sha256);
  if(!path.endsWith('playground_scsp_voice_panel.js')) {
    const prior=bytes.toString().replaceAll('scsp-editor-1','scsp-playground-1')
      .replace(path==='playground/index.html'?'playground.js?v=scsp-playground-1':'__no_match__','playground.js?v=scsp-layout-1');
    assert.equal(Buffer.byteLength(prior),before.bytes,'Only SCSP cache tokens changed outside the editor body');
    assert.equal(sha(prior),before.sha256);
  }
  assert.equal(assertMixerCalibrationSourceFreshness({path,bytes,record:before}),'ui-scsp-editor');
  const changed=Buffer.from(bytes);changed[0]^=1;
  assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes:changed,record:before}),/changed/);
  assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes,record:{...before,sha256:'0'.repeat(64)}}),/changed/);
 }
});
