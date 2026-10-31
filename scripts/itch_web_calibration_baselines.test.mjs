// CI must verify the policy it ships, rather than an old measurement with a
// coincidentally similar gain. Preserve all historical reports as evidence.
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {createPlaygroundSoundChipMixer} from '../docs/playground/playground_mixer_defaults.js';
import {validatePs1MixerCalibrationSources} from './ps1_mixer_calibration.mjs';
import {validateWonderSwanMixerCalibrationSources} from './wonderswan_mixer_calibration.mjs';
import {validatePokeyMixerCalibrationSources} from './pokey_mixer_calibration.mjs';
const root=new URL('../',import.meta.url),reportPath=new URL('docs/issues/playground_chip_levels_01.json',root);
const workflow=await readFile(new URL('.github/workflows/itch-web.yml',root),'utf8');
for(const [kind,parameter,validate]of [['ps1','ps1Report',validatePs1MixerCalibrationSources],['wonderswan','wsReport',validateWonderSwanMixerCalibrationSources],['pokey','pokeyReport',validatePokeyMixerCalibrationSources]]){
 test(`itch workflow ${kind} verification baseline matches current sources and primary/extra policy`,async()=>{
  const commands=[...workflow.matchAll(new RegExp(`node scripts/calibrate_${kind}_levels\\.cjs --verify --baseline ([^\\s]+)`,'g'))];assert.equal(commands.length,1,`one ${kind} browser verification command`);
  const report=JSON.parse(await readFile(new URL(commands[0][1],root),'utf8'));
  await validate({reportPath,[parameter]:report});
  const mixer=createPlaygroundSoundChipMixer(kind);mixer.register(kind,kind,()=>{});mixer.register('calibration-source',kind,()=>{});
  for(const role of ['primary','extra']){const route=report.calibration.routes.find(row=>row.kind===kind&&row.role===role);assert(route);assert.equal(mixer.get(role==='primary'?kind:'calibration-source').volume,route.volume);}
 });
}
