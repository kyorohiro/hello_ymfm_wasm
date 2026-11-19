// Fresh complete measurements authorize the current served dependencies.
// Previous captures remain immutable history, not current-source approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validatePs1MixerCalibrationSources} from './ps1_mixer_calibration.mjs';
import {validateWonderSwanMixerCalibrationSources} from './wonderswan_mixer_calibration.mjs';
import {validatePokeyMixerCalibrationSources} from './pokey_mixer_calibration.mjs';
import {validateScspMixerCalibrationSources} from './scsp_mixer_calibration.mjs';

const root=new URL('../',import.meta.url),read=path=>readFile(new URL(path,root));
const json=async path=>JSON.parse(await read(path));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const historical={
 'docs/issues/playground_chip_levels_01.json':'9c5129ad176aa4895ff14da345dc0f3ac49588f5255062fa76329b21f28ea234',
 'docs/issues/ps1_ay_single_output_chip_levels_01.json':'be6c1a7fcc9e6a6081d7d1142001eb78046fac0d2214f5543ffa5cb92272963e',
 'docs/issues/wonderswan_ay_single_output_chip_levels_01.json':'afacfcc1da1dc9a5fa6afb8ca4f6e43d770a0e5d8d9ca2a5910a288756fa7e6d',
 'docs/issues/pokey_ay_single_output_chip_levels_01.json':'057b6f7d6f94ba609c6312fa9f2d570ad55b8741cd798a30fb12a082107b8be7',
 'docs/issues/pokey_ay_single_output_chip_levels_verify_01.json':'65aa112e06abcf6a7fc75bbbc718b85af66bb861636c52f79eeb86a16aee38b0',
 'docs/issues/scsp_ay_single_output_chip_levels_01.json':'6476bd4f36264958557197d1eb2dbc04dda5909fc8af2c282ca8d0bc1ae2c0bf',
 'docs/issues/scsp_ay_single_output_chip_levels_verify_01.json':'3b2d997465cf29f9e8cf73b45a277f3c3d3f0ca2a6d42b043a763bade8ab9e67',
};
test('source-mix remeasurement retains the historical baseline and every prior active capture byte',async()=>{
 for(const [path,hash]of Object.entries(historical))assert.equal(sha(await read(path)),hash,path);
});

for(const [kind,key,validate]of [
 ['ps1','ps1Report',validatePs1MixerCalibrationSources],
 ['wonderswan','wsReport',validateWonderSwanMixerCalibrationSources],
 ['pokey','pokeyReport',validatePokeyMixerCalibrationSources],
 ['scsp','scspReport',validateScspMixerCalibrationSources],
])test(`${kind} current SPU timed calibration and verification cover every route with exact current provenance`,async()=>{
 const base=`docs/issues/${kind}_spu_timed_chip_levels_`;
 const raw=await json(base+'01.json'),verified=await json(base+'verify_01.json');
 const previous=await json(`docs/issues/${kind}_ay_single_output_chip_levels_01.json`);
 const expectedRows=kind==='pokey'?96:48;
 for(const [report,verification]of [[raw,false],[verified,true]]){
  assert.equal(report.passed,true);assert.equal(report.verify,verification);
  assert.equal(report.completeCoverage,true);assert.equal(report.physicalOutputMuted,true);
  assert.equal(report.listeningPerformed,false);assert.equal(report.pcmContinuous,true);
  assert.equal(report.rows.length,expectedRows);assert.equal(report.anchors.length,8);
  if(kind==='pokey')assert.equal(report.dualChecks.length,8);
  for(const [path,hash]of Object.entries(report.scripts))assert.equal(sha(await read(path)),hash,path);
  for(const [path,record]of Object.entries(report.sources)){
   const bytes=await read('docs/'+path);assert.equal(bytes.length,record.bytes,path);assert.equal(sha(bytes),record.sha256,path);
  }
 }
 await validate({reportPath:new URL('docs/issues/playground_chip_levels_01.json',root),[key]:raw});
 assert.deepEqual(verified.calibration,raw.calibration,'Verification uses the freshly derived policy');
 for(const route of raw.calibration.routes){
  const old=previous.calibration.routes.find(item=>item.role===route.role);assert(old);
  assert(Math.abs(route.volume/old.volume-1)<.0001,'Independent measurement retains the established source scale within 0.01%');
 }
 await assert.rejects(validate({reportPath:new URL('docs/issues/playground_chip_levels_01.json',root),[key]:previous}),
  /source changed; remeasure:|pinned source\/report dependency changed:/,'Prior source hashes cannot authorize the new runtime');
});
