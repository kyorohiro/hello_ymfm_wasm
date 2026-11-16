// SPDX-License-Identifier: BSD-3-Clause
// Current output evidence is remeasured; original reports remain immutable.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readHistoricalAyTimedFile as readFile} from '../test/helpers/historical_ay_timed_source_fixture.mjs';
import {createHash} from 'node:crypto';
import {restoreMixerCalibrationAySingleOutputUiCacheRevision} from './mixer_calibration_ay_single_output_ui_cache_revision.mjs';
import {validatePs1MixerCalibrationSources} from './ps1_mixer_calibration.mjs';
import {validateWonderSwanMixerCalibrationSources} from './wonderswan_mixer_calibration.mjs';
import {validatePokeyMixerCalibrationSources} from './pokey_mixer_calibration.mjs';
import {validateScspMixerCalibrationSources} from './scsp_mixer_calibration.mjs';
const root=new URL('../',import.meta.url),read=path=>readFile(new URL(path,root)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await read(path));
const baselinePath=new URL('docs/issues/playground_chip_levels_01.json',root);
const previous={
 'playground_chip_levels_01':'9c5129ad176aa4895ff14da345dc0f3ac49588f5255062fa76329b21f28ea234',
 'soundchip_psg_levels_05':'67abbf42ba6e29c3d684969bc8ee7c0a09cf100c2dd8aa680dd29c47716031ad',
 'ps1_spc_voice_edit_chip_levels_01':'ed3afd1abfc55643b3cebae066e2094330e55bb159f328f5e7ba90a581a63db0',
 'wonderswan_spc_voice_edit_chip_levels_01':'277520705d6fae62db743efcbf42b27008729b6c4e1a798254d318186ad2f6a1',
 'pokey_spc_voice_edit_chip_levels_01':'0b3202fda25c5caa204bb85ea829f325268910d61038db99f03b08a7e7972448',
 'scsp_spc_voice_edit_chip_levels_01':'5f04b635bd9f40e37caf240a2072523879a5c93ed4a857d0d7dde9acebad1426',
};
test('AY Single Output keeps every original measurement report byte unchanged',async()=>{
 for(const [name,expected]of Object.entries(previous))assert.equal(sha(await read(`docs/issues/${name}.json`)),expected,name);
});
test('remeasured public PSG profiles retain all 18 original PCM statistics and gains with current source hashes',async()=>{
 const old=await json('docs/issues/soundchip_psg_levels_05.json'),current=await json('docs/issues/soundchip_psg_levels_06.json');
 assert.equal(current.passed,true);assert.equal(current.rows.length,18);
 assert.deepEqual(current.rows,old.rows);assert.deepEqual(current.defaults,old.defaults);
 for(const [path,expected]of Object.entries(current.sources))assert.equal(sha(await read(path)),expected,path);
 for(const path of ['tetorica_src/runtime/ay8910.js','docs/generated/ay8910_wasm.wasm'])assert.notEqual(current.sources[path],old.sources[path],path+': additive output support requires fresh provenance');
});
for(const [kind,key,validate]of [
 ['ps1','ps1Report',validatePs1MixerCalibrationSources],
 ['wonderswan','wsReport',validateWonderSwanMixerCalibrationSources],
 ['pokey','pokeyReport',validatePokeyMixerCalibrationSources],
 ['scsp','scspReport',validateScspMixerCalibrationSources],
])test(`${kind} full post-AY measurement uses exact current provenance and retains the established output scale`,async()=>{
 const old=await json(`docs/issues/${kind}_spc_voice_edit_chip_levels_01.json`),current=await json(`docs/issues/${kind}_ay_single_output_chip_levels_01.json`);
 assert.equal(current.passed,true);assert.equal(current.verify,false);assert.equal(current.completeCoverage,true);
 assert.equal(current.physicalOutputMuted,true);assert.equal(current.listeningPerformed,false);assert.equal(current.pcmContinuous,true);
 await validate({reportPath:baselinePath,[key]:current});
 for(const [path,expected]of Object.entries(current.scripts))assert.equal(sha(await read(path)),expected,path);
 for(const [path,record]of Object.entries(current.sources)){const actual=await read('docs/'+path),bytes=restoreMixerCalibrationAySingleOutputUiCacheRevision(path,actual,{report:current,record});assert.equal(bytes.length,record.bytes,path);assert.equal(sha(bytes),record.sha256,path);}
 for(const route of current.calibration.routes){const previous=old.calibration.routes.find(row=>row.role===route.role);assert(previous);assert(Math.abs(route.volume/previous.volume-1)<.0001,'Newly derived gains stay within 0.01% of the original output scale without forcing old rounded values');}
 await assert.rejects(validate({reportPath:baselinePath,[key]:old}),/source changed; remeasure:/,'Earlier complete measurements remain history, not current-source approval');
});
