import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {assertMixerCalibrationSourceFreshness} from './mixer_calibration_sources.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('SCSP layout audit permits only exact reviewed DOM/cache edits, without rewriting PCM reports',async()=>{
 const revision=JSON.parse(await readFile(new URL('../docs/issues/scsp_layout_ui_revision_01.json',import.meta.url)));
 for(const [path,{before,after}]of Object.entries(revision.sources)){
  const bytes=await readFile(new URL('../docs/'+path,import.meta.url));
  assert.equal(bytes.length,after.bytes);assert.equal(sha(bytes),after.sha256);
  let original=bytes.toString();
  if(path.endsWith('playground_workbench.js'))original=original
    .replace("'snesPanel','scspPanel','ps1Panel'","'snesPanel','ps1Panel'")
    .replace("'snes', 'scsp', 'ps1'","'snes', 'ps1'");
  else if(path.endsWith('playground.js'))original=original.replace('./playground_workbench.js?v=scsp-layout-1','./playground_workbench.js?v=ps1-deferred-release-1');
  else original=original.replace('./playground.js?v=scsp-layout-1','./playground.js?v=scsp-playground-1');
  assert.equal(Buffer.byteLength(original),before.bytes,'Only the reviewed DOM registrations/cache tokens changed');
  assert.equal(sha(original),before.sha256);
  assert.equal(assertMixerCalibrationSourceFreshness({path,bytes,record:before}),'ui-scsp-layout');
  const changed=Buffer.from(bytes);changed[0]^=1;
  assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes:changed,record:before}),/changed/);
  assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes,record:{...before,sha256:'0'.repeat(64)}}),/changed/);
 }
});
