import {readPreHucTimedInput} from '../test/helpers/historical_huc_timed_calibration_inputs.mjs';
import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoricalFm2612ApplicationReader} from '../test/helpers/historical_fm2612_application_source_fixture.mjs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {renderSoundChipMixerPresets} from './generate_soundchip_mixer_presets.mjs';
import {renderPlaygroundMixerDefaults} from './generate_playground_mixer_defaults.mjs';
const {restoreMixerCalibrationYm2608SourceMixPolicyRevision:productionRestore,createYm2608SourceMixPolicyReadContext:productionContext,
 YM2608_SOURCE_MIX_POLICY_RECEIPT:receiptPath,YM2608_SOURCE_MIX_POLICY_PIN:pin,
 YM2608_SOURCE_MIX_POLICY_SOURCES:sources,YM2608_SOURCE_MIX_POLICY_REPORTS:reports}=await historicalCalibrationModule('mixer_calibration_ym2608_source_mix_policy_revision.mjs');

// Historical policy tests retain their original dependency graph.
const readFileSync=createHistoricalFm2612ApplicationReader(readPreHucTimedInput);
const restore=(path,bytes,options={})=>productionRestore(path,bytes,{readSource:readFileSync,...options});
const createYm2608SourceMixPolicyReadContext=()=>productionContext(readFileSync);

const root=new URL('../',import.meta.url),url=name=>new URL(name,root),read=name=>readFileSync(url(name));
const json=name=>JSON.parse(read(name)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=json(receiptPath);
const graph=source=>JSON.parse(JSON.stringify(vm.runInNewContext(source.replace(/^import .*\n/m,'').replace(/^export /gm,'')+
 '\n({calibration:PLAYGROUND_MIXER_CALIBRATION,defaults:factoryDefaults,modes:factoryModes})')));

test('normal generators reproduce the freshly measured policy and preserve every unmeasured source coefficient',()=>{
 assert.equal(sha(JSON.stringify(receipt)),pin);assert.deepEqual(Object.keys(receipt.sources),sources);assert.deepEqual(Object.keys(receipt.reports),reports);
 const raw=['ps1','wonderswan','pokey','scsp'].map(kind=>json(`docs/issues/${kind}_ym2608_source_mix_chip_levels_01.json`));
 const baseline=json('docs/issues/playground_chip_levels_01.json'),psg=json('docs/issues/soundchip_psg_levels_06.json');
 assert.equal(read(sources[0]).toString(),renderSoundChipMixerPresets(baseline,psg,...raw));
 const playground=read(sources[2]).toString().replace(/^import \{SoundChipMixer\} from '[^']+';$/m,"import {SoundChipMixer} from '../js/soundchip_mixer.js';");
 assert.equal(playground,renderPlaygroundMixerDefaults(baseline,...raw));
 const before=graph(Buffer.from(receipt.sources[sources[2]].beforeBase64,'base64').toString()),after=graph(playground);
 assert.equal(before.calibration.targetAmplitude,after.calibration.targetAmplitude);
 assert.deepEqual(after.defaults.kinds.filter(row=>row.name!=='pokey'),before.defaults.kinds.filter(row=>row.name!=='pokey'));
 for(const name of Object.keys(before.modes))if(!['pokey','pokey-dual','scsp'].includes(name))assert.deepEqual(after.modes[name],before.modes[name],name);
 for(const [name,entry]of Object.entries(receipt.sources)){
  assert.equal(sha(read(name)),entry.after.sha256,name);
  const previous=restore(name,read(name));assert.equal(previous.length,entry.before.bytes);assert.equal(sha(previous),entry.before.sha256);
 }
});
test('complete fresh raw and verification reports are mandatory and unknown DSP or future edits receive no exemption',()=>{
 const target=sources[0],bytes=read(target);
 for(const path of [...sources,...reports])assert.throws(()=>restore(target,bytes,{readSource(location){
  const current=readFileSync(location);return location.href===url(path).href?Buffer.concat([current,Buffer.from('\n')]):current;
 }}),/changed/,path);
 const future=Buffer.concat([bytes,Buffer.from('\n')]);assert.equal(restore(target,future),future);
 for(const path of ['js/ym2608.js','docs/generated/ym2608_wasm.wasm','docs/js/scspsynth.js','unknown'])assert.equal(restore(path,bytes),bytes,path);
 assert.throws(()=>restore(target,bytes,{readSource(location){
  return location.href===url(receiptPath).href?Buffer.from(JSON.stringify({...receipt,scope:'future'})):readFileSync(location);
 }}),/independently pinned receipt/);
});
test('one historical read context returns fixed predecessors without changing the generated current files',()=>{
 const history=createYm2608SourceMixPolicyReadContext();
 for(const name of sources){
  const before=Buffer.from(receipt.sources[name].beforeBase64,'base64');
  assert.deepEqual(history.readSource(url(name)),before);assert.deepEqual(history.restore(name,read(name)),before);
  assert.equal(sha(read(name)),receipt.sources[name].after.sha256);
 }
});
