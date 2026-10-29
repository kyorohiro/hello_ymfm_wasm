/** Prior complete measurements remain immutable history after the public live
 * API revision. Their measured values remain valid evidence, but their source
 * fingerprints must not be relabelled as current without fresh measurements.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {validatePs1MixerCalibration,validatePs1MixerCalibrationSources} from './ps1_mixer_calibration.mjs';
import {validateWonderSwanMixerCalibration,validateWonderSwanMixerCalibrationSources} from './wonderswan_mixer_calibration.mjs';
import {validatePokeyMixerCalibration,validatePokeyMixerCalibrationSources} from './pokey_mixer_calibration.mjs';

const root=new URL('../',import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const baseline='docs/issues/playground_chip_levels_01.json';
const historical=Object.freeze({
  [baseline]:'9c5129ad176aa4895ff14da345dc0f3ac49588f5255062fa76329b21f28ea234',
  'docs/issues/ps1_chip_levels_01.json':'0bc38fd52a6f9de0658e085c016f8e8214e28960355b25a754da659bbab10d1c',
  'docs/issues/wonderswan_chip_levels_01.json':'71d86d014e359c01f4158beefa06301036c5c9eda39215e5b907d569381fdcd0',
  'docs/issues/pokey_chip_levels_01.json':'5920ffb3ceb407b7db68cfdbf70bb1632fc6d2af54e9b66f35d92184fc4dee4b',
  'docs/issues/ps1_chip_levels_live_controls_01.json':'df388a0b83adc627d4f26d12d390669c4838b7df9c31feb4a409a972bdb54d33',
  'docs/issues/wonderswan_chip_levels_live_controls_01.json':'c225338f76e8d0a00a96dc94927d9da14e21ffda8b120b212d9c5f6313da6e0a',
  'docs/issues/pokey_chip_levels_live_controls_01.json':'2659fe56ac9026c80dab3783d92ae83ebdf09650fe03d219b7d254f198219ab0',
});
test('every prior complete calibration record retains its exact original raw bytes',async()=>{
  for(const [path,hash]of Object.entries(historical))assert.equal(sha(await readFile(new URL(path,root))),hash,path);
});
for(const [kind,parameter,derive,validate]of [
  ['ps1','ps1Report',validatePs1MixerCalibration,validatePs1MixerCalibrationSources],
  ['wonderswan','wsReport',validateWonderSwanMixerCalibration,validateWonderSwanMixerCalibrationSources],
  ['pokey','pokeyReport',validatePokeyMixerCalibration,validatePokeyMixerCalibrationSources],
])test(`${kind} live-controls measurement retains its original data and is stale for the later public live API`,async t=>{
  const path=`docs/issues/${kind}_chip_levels_live_controls_01.json`,bytes=await readFile(new URL(path,root)),report=JSON.parse(bytes);
  const result=derive(JSON.parse(await readFile(new URL(baseline,root))),report);
  await assert.rejects(validate({reportPath:new URL(baseline,root),[parameter]:report}),/served DSP\/WASM source changed|source receipt/);
  assert.equal(sha(bytes),historical[path]);
  t.diagnostic(JSON.stringify({kind,captures:report.rows.length,anchors:report.anchors.length,historicalSources:Object.keys(report.sources).length,primaryVolume:result.primaryVolume}));
});
