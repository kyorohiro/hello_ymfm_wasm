// SPDX-License-Identifier: BSD-3-Clause
// New complete measurements must match every current script and served source.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {assertMixerCalibrationSourceFreshness} from './mixer_calibration_sources.mjs';
import {validatePs1MixerCalibrationSources} from './ps1_mixer_calibration.mjs';
import {validateWonderSwanMixerCalibrationSources} from './wonderswan_mixer_calibration.mjs';
import {validatePokeyMixerCalibrationSources} from './pokey_mixer_calibration.mjs';

const root=new URL('../',import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const [kind,parameter,validate,prior]of [
  ['ps1','ps1Report',validatePs1MixerCalibrationSources,'ps1_vab_chip_levels_01'],
  ['wonderswan','wsReport',validateWonderSwanMixerCalibrationSources,'wonderswan_vab_chip_levels_01'],
  ['pokey','pokeyReport',validatePokeyMixerCalibrationSources,'pokey_vab_chip_levels_01'],
])test(`${kind} SCSP integration measurement has complete captures and current sources or the exact reviewed SCSP UI layout revision`,async()=>{
  const path=`docs/issues/${kind}_scsp_chip_levels_01.json`,bytes=await readFile(new URL(path,root)),report=JSON.parse(bytes);
  const old=await readFile(new URL(`docs/issues/${prior}.json`,root));assert.notEqual(sha(bytes),sha(old));
  await validate({reportPath:new URL('docs/issues/playground_chip_levels_01.json',root),[parameter]:report});
  for(const [path,expected]of Object.entries(report.scripts))assert.equal(sha(await readFile(new URL(path,root))),expected,path);
  for(const [path,record]of Object.entries(report.sources)) {
    const actual=await readFile(new URL('docs/'+path,root));
    assert(['raw','ui-scsp-layout'].includes(assertMixerCalibrationSourceFreshness({path,bytes:actual,record})),path);
  }
  assert.equal(sha(await readFile(new URL(path,root))),sha(bytes),'Validation must not edit a measurement');
  assert.equal(sha(await readFile(new URL(`docs/issues/${prior}.json`,root))),sha(old),'Prior measurements remain untouched');
});
