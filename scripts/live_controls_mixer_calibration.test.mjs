/** Current measurement evidence must match every actual source byte. Historical
 * measurements and reviewed UI receipts remain independently immutable history;
 * no receipt can stand in for remeasurement after this DSP revision.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {validatePs1MixerCalibrationSources} from './ps1_mixer_calibration.mjs';
import {validateWonderSwanMixerCalibrationSources} from './wonderswan_mixer_calibration.mjs';
import {validatePokeyMixerCalibrationSources} from './pokey_mixer_calibration.mjs';

const root=new URL('../',import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const baseline='docs/issues/playground_chip_levels_01.json';
const historical=Object.freeze({
  [baseline]:'9c5129ad176aa4895ff14da345dc0f3ac49588f5255062fa76329b21f28ea234',
  'docs/issues/ps1_chip_levels_01.json':'0bc38fd52a6f9de0658e085c016f8e8214e28960355b25a754da659bbab10d1c',
  'docs/issues/wonderswan_chip_levels_01.json':'71d86d014e359c01f4158beefa06301036c5c9eda39215e5b907d569381fdcd0',
  'docs/issues/pokey_chip_levels_01.json':'5920ffb3ceb407b7db68cfdbf70bb1632fc6d2af54e9b66f35d92184fc4dee4b',
});
test('every original complete calibration record retains its exact published raw bytes',async()=>{
  for(const [path,hash]of Object.entries(historical))assert.equal(sha(await readFile(new URL(path,root))),hash,path);
});
for(const [kind,parameter,validate]of [
  ['ps1','ps1Report',validatePs1MixerCalibrationSources],
  ['wonderswan','wsReport',validateWonderSwanMixerCalibrationSources],
  ['pokey','pokeyReport',validatePokeyMixerCalibrationSources],
])test(`${kind} live-controls calibration requires a fresh full report and exact current script/runtime/WASM bytes`,async t=>{
  const path=`docs/issues/${kind}_chip_levels_live_controls_01.json`,bytes=await readFile(new URL(path,root)),report=JSON.parse(bytes);
  assert.notEqual(sha(bytes),historical[`docs/issues/${kind}_chip_levels_01.json`]);
  const result=await validate({reportPath:new URL(baseline,root),[parameter]:report});
  // Deliberately stricter than the historical receipt-aware validator: every
  // record in this newly captured report must match current bytes directly.
  for(const [path,expected]of Object.entries(report.scripts))assert.equal(sha(await readFile(new URL(path,root))),expected,path);
  for(const [path,record]of Object.entries(report.sources)) {
    const actual=await readFile(new URL('docs/'+path,root));assert.equal(actual.length,record.bytes,path);
    assert.equal(sha(actual),record.sha256,path);
  }
  t.diagnostic(JSON.stringify({kind,captures:report.rows.length,anchors:report.anchors.length,exactSources:Object.keys(report.sources).length,primaryVolume:result.primaryVolume}));
});
