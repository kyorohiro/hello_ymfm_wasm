/** Fresh complete public-live-API measurements require exact source identity.
 * No historical UI/starter receipt substitutes for any current source byte.
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
for(const [kind,parameter,validate]of [
  ['ps1','ps1Report',validatePs1MixerCalibrationSources],
  ['wonderswan','wsReport',validateWonderSwanMixerCalibrationSources],
  ['pokey','pokeyReport',validatePokeyMixerCalibrationSources],
])test(`${kind} live API calibration contains the complete real captures and exact current source bytes`,async t=>{
  const path=`docs/issues/${kind}_chip_levels_live_api_01.json`,bytes=await readFile(new URL(path,root)),report=JSON.parse(bytes);
  for(const suffix of ['01','live_controls_01'])assert.notEqual(sha(bytes),sha(await readFile(new URL(`docs/issues/${kind}_chip_levels_${suffix}.json`,root))));
  const result=await validate({reportPath:new URL(baseline,root),[parameter]:report});
  for(const [path,expected]of Object.entries(report.scripts))assert.equal(sha(await readFile(new URL(path,root))),expected,path);
  for(const [path,record]of Object.entries(report.sources)) {
    const actual=await readFile(new URL('docs/'+path,root));assert.equal(actual.length,record.bytes,path);
    assert.equal(sha(actual),record.sha256,path);
  }
  t.diagnostic(JSON.stringify({kind,captures:report.rows.length,anchors:report.anchors.length,exactSources:Object.keys(report.sources).length,primaryVolume:result.primaryVolume}));
});
