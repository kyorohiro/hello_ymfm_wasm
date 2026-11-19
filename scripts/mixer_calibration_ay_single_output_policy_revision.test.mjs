import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from '../test/helpers/historical_huc_timed_calibration_inputs.mjs';
import {createHash} from 'node:crypto';
import {renderSoundChipMixerPresets} from './generate_soundchip_mixer_presets.mjs';
const {createYm2608SourceMixPolicyReader}=await historicalCalibrationModule('mixer_calibration_ym2608_source_mix_policy_revision.mjs');
const {AY_SINGLE_OUTPUT_POLICY_RECEIPT_PATH:receiptPath,AY_SINGLE_OUTPUT_POLICY_RECEIPT_OBJECT_SHA256:pin,
 AY_SINGLE_OUTPUT_POLICY_SOURCE_PATH:path,AY_SINGLE_OUTPUT_POLICY_REPORT_PATHS:paths,
 restoreMixerCalibrationAySingleOutputPolicyRevision:restore}=await historicalCalibrationModule('mixer_calibration_ay_single_output_policy_revision.mjs');
const policyHistory=createYm2608SourceMixPolicyReader();
const read=path=>policyHistory(new URL('../'+path,import.meta.url)),json=path=>JSON.parse(read(path)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('new exact gain-policy transition is pinned to fresh raw captures and affected applied-gain verification',()=>{
 const receipt=json(receiptPath);assert.equal(sha(JSON.stringify(receipt)),pin);
 const latest=read(path),previous=restore(path,latest),prior=json('docs/issues/spc_voice_edit_mixer_policy_revision_01.json');
 assert.equal(sha(previous),prior.after.sha256);assert.equal(previous.length,prior.after.bytes);assert.equal(previous.toString(),receipt.beforeText);
 const measured=paths.filter(name=>/_(?:ay_single_output)_chip_levels_01\.json$/.test(name)).map(json);
 assert.equal(measured.length,4);
 assert.equal(latest.toString(),renderSoundChipMixerPresets(json('docs/issues/playground_chip_levels_01.json'),json('docs/issues/soundchip_psg_levels_06.json'),...measured));
 const expected=receipt.beforeText.replace('"name": "pokey",\n          "volume": 0.413034','"name": "pokey",\n          "volume": 0.413052')
  .replace('"name": "scsp",\n          "volume": 0.128826','"name": "scsp",\n          "volume": 0.128825');
 assert.notEqual(expected,receipt.beforeText);assert.equal(latest.toString(),expected,'Only the two actually remeasured rounded gains change in the public policy');
 const servedBytes=read('docs/js/soundchip_mixer_presets.js');assert.equal(restore('docs/js/soundchip_mixer_presets.js',servedBytes).toString(),receipt.served.beforeText);
 const served=servedBytes.toString().replace("import('./soundchip_mixer.js?v=y8950-adpcm-ui-1')","import('./soundchip_mixer.js')");assert.equal(served,latest.toString());
 for(const kind of ['pokey','scsp']){
  const raw=json(`docs/issues/${kind}_ay_single_output_chip_levels_01.json`),verified=json(`docs/issues/${kind}_ay_single_output_chip_levels_verify_01.json`);
  assert(verified.passed&&verified.verify&&verified.completeCoverage&&verified.pcmContinuous&&verified.physicalOutputMuted&&!verified.listeningPerformed);
  assert.deepEqual(verified.sources,raw.sources);assert.deepEqual(verified.scripts,raw.scripts);assert.deepEqual(verified.calibration,raw.calibration);
  for(const row of verified.rows){const route=raw.calibration.routes.find(route=>route.role===row.role);assert(route);assert.equal(row.mixer.settings.volume,route.volume);assert(row.stopped.channels.every(ch=>ch.nonzero===0));}
 }
});
test('policy mapping rejects every changed measurement and never normalizes DSP, unrelated paths or future policy edits',()=>{
 const current=read(path);
 for(const target of paths)assert.throws(()=>restore(path,current,{readSource(url){const bytes=readFileSync(url);return url.pathname.endsWith('/'+target)?Buffer.concat([bytes,Buffer.from('\n')]):bytes;}}),/complete measurement changed/);
 for(const other of ['docs/playground/playground_mixer_defaults.js','js/ay8910.js','generated/ay8910_wasm.wasm','__proto__'])assert.equal(restore(other,current),current);
 const changed=Buffer.from(current);changed[changed.length-2]^=1;
 for(const bytes of [changed,Buffer.concat([current,Buffer.from('\n')])])assert.equal(restore(path,bytes),bytes);
});
