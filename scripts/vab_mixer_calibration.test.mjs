// SPDX-License-Identifier: BSD-3-Clause
// New complete measurements must match every current script and served source.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {assertMixerCalibrationSourceFreshness} from './mixer_calibration_sources.mjs';
import {validatePs1MixerCalibration,validatePs1MixerCalibrationSources} from './ps1_mixer_calibration.mjs';
import {validateWonderSwanMixerCalibrationSources} from './wonderswan_mixer_calibration.mjs';
import {validatePokeyMixerCalibrationSources} from './pokey_mixer_calibration.mjs';

const root=new URL('../',import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const [kind,parameter,validate,current,prior]of [
  ['ps1','ps1Report',validatePs1MixerCalibrationSources,'ps1_state_restore_chip_levels_01','ps1_loop_fm_chip_levels_01'],
  ['wonderswan','wsReport',validateWonderSwanMixerCalibrationSources,'wonderswan_state_restore_chip_levels_01','wonderswan_scsp_fm_chip_levels_01'],
  ['pokey','pokeyReport',validatePokeyMixerCalibrationSources,'pokey_state_restore_chip_levels_01','pokey_scsp_fm_chip_levels_01'],
])test(`${kind} latest complete measurement matches current scripts and served sources`,async()=>{
  const path=`docs/issues/${current}.json`,bytes=await readFile(new URL(path,root)),report=JSON.parse(bytes);
  const old=await readFile(new URL(`docs/issues/${prior}.json`,root));assert.notEqual(sha(bytes),sha(old));
  await validate({reportPath:new URL('docs/issues/playground_chip_levels_01.json',root),[parameter]:report});
  for(const [path,expected]of Object.entries(report.scripts))assert.equal(sha(await readFile(new URL(path,root))),expected,path);
  for(const [path,record]of Object.entries(report.sources)) {
    const actual=await readFile(new URL('docs/'+path,root));
    assert.equal(assertMixerCalibrationSourceFreshness({path,bytes:actual,record}),'raw',path);
  }
  assert.equal(sha(await readFile(new URL(path,root))),sha(bytes),'Validation must not edit a measurement');
  assert.equal(sha(await readFile(new URL(`docs/issues/${prior}.json`,root))),sha(old),'Prior measurements remain untouched');
  await assert.rejects(validate({reportPath:new URL('docs/issues/playground_chip_levels_01.json',root),[parameter]:JSON.parse(old)}),
    /served DSP\/WASM source changed; remeasure: docs\/js\/scspsynth\.js/,
    'A semantic SCSP state fix requires new measurement provenance');
});

test('prior PS1 SCSP measurement remains valid immutable history and rejects the newer loop SDK as stale',async()=>{
  const path='docs/issues/ps1_scsp_fm_chip_levels_01.json',bytes=await readFile(new URL(path,root)),report=JSON.parse(bytes);
  const originalHash='b44242f9042ac30bd9ec14ae6126daca3eb67b3d5807d2b5c5b2f880f09badc4';
  assert.equal(sha(bytes),originalHash);
  const sources=structuredClone(report.sources),baseline=new URL('docs/issues/playground_chip_levels_01.json',root);
  const result=validatePs1MixerCalibration(JSON.parse(await readFile(baseline)),report);
  assert.equal(report.rows.length,48);assert.equal(report.anchors.length,8);
  assert(result.primaryVolume>0);
  await assert.rejects(validatePs1MixerCalibrationSources({reportPath:baseline,ps1Report:report}),
    /served DSP\/WASM source changed; remeasure: docs\/generated\/ps1_spu_wasm\.(?:js|wasm)/);
  assert.deepEqual(report.sources,sources,'Freshness validation must retain all historical source fingerprints');
  assert.equal(sha(await readFile(new URL(path,root))),originalHash,'Historical capture bytes remain untouched');
});
