// SPDX-License-Identifier: BSD-3-Clause
// New complete measurements must match every current script and served source.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {validatePs1MixerCalibrationSources} from './ps1_mixer_calibration.mjs';
import {validateWonderSwanMixerCalibrationSources} from './wonderswan_mixer_calibration.mjs';
import {validatePokeyMixerCalibrationSources} from './pokey_mixer_calibration.mjs';

const root=new URL('../',import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const [kind,parameter,validate,prior]of [
  ['ps1','ps1Report',validatePs1MixerCalibrationSources,'ps1_cyclic_chip_levels_01'],
  ['wonderswan','wsReport',validateWonderSwanMixerCalibrationSources,'wonderswan_cyclic_chip_levels_02'],
  ['pokey','pokeyReport',validatePokeyMixerCalibrationSources,'pokey_cyclic_chip_levels_02'],
])test(`${kind} VAB-era measurement has complete captures and exact current sources without historical substitutions`,async()=>{
  const path=`docs/issues/${kind}_vab_chip_levels_01.json`,bytes=await readFile(new URL(path,root)),report=JSON.parse(bytes);
  const old=await readFile(new URL(`docs/issues/${prior}.json`,root));assert.notEqual(sha(bytes),sha(old));
  await validate({reportPath:new URL('docs/issues/playground_chip_levels_01.json',root),[parameter]:report});
  for(const [path,expected]of Object.entries(report.scripts))assert.equal(sha(await readFile(new URL(path,root))),expected,path);
  for(const [path,record]of Object.entries(report.sources)) {
    const actual=await readFile(new URL('docs/'+path,root));assert.equal(actual.length,record.bytes,path);assert.equal(sha(actual),record.sha256,path);
  }
  assert.equal(sha(await readFile(new URL(path,root))),sha(bytes),'Validation must not edit a measurement');
  assert.equal(sha(await readFile(new URL(`docs/issues/${prior}.json`,root))),sha(old),'Prior measurements remain untouched');
});
