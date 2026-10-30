/** Deferred-release measurements remain immutable history after Gaussian/VAB
 * revisions; fresh current-source checks live in vab_mixer_calibration.test.mjs.
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
const originalHashes={ps1:'f3523ee30b5d78a1c03a3c2cfe355adf128f70e7ec0d6e1fd42fa89159c3cf7b',wonderswan:'545d9a00e01f2545dcc9c0e12dd45489a68d85b9f5b5b62b31e9b7b435d25fd9',pokey:'e9f1d2b15e840285fbbe9dc9159d56dd681336d6a9db4ca545cb2b36f4996107'};
for(const [kind,parameter,derive,validate]of [
  ['ps1','ps1Report',validatePs1MixerCalibration,validatePs1MixerCalibrationSources],
  ['wonderswan','wsReport',validateWonderSwanMixerCalibration,validateWonderSwanMixerCalibrationSources],
  ['pokey','pokeyReport',validatePokeyMixerCalibration,validatePokeyMixerCalibrationSources],
])test(`${kind} deferred release measurement retains original bytes and is stale for the later Gaussian/VAB sources`,async t=>{
  const path=`docs/issues/${kind}_chip_levels_deferred_release_01.json`,bytes=await readFile(new URL(path,root)),report=JSON.parse(bytes);
  for(const suffix of ['01','live_controls_01','live_api_01','live_release_01'])assert.notEqual(sha(bytes),sha(await readFile(new URL(`docs/issues/${kind}_chip_levels_${suffix}.json`,root))));
  assert.equal(sha(bytes),originalHashes[kind]);
  const result=derive(JSON.parse(await readFile(new URL(baseline,root))),report);
  await assert.rejects(validate({reportPath:new URL(baseline,root),[parameter]:report}),/served DSP\/WASM source changed|source receipt/);
  t.diagnostic(JSON.stringify({kind,captures:report.rows.length,anchors:report.anchors.length,historicalSources:Object.keys(report.sources).length,primaryVolume:result.primaryVolume}));
});
