// SPDX-License-Identifier: BSD-3-Clause
// Actual native APU, numerical arrays only; no AudioContext/audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/gameboy_apu_wasm.js';
import {GameboyApu} from '../js/gameboyapu.js';
import {GameboyInstrument} from './instrument.js';
import {createGameboyChannelBank,applyGameboyChannelEdit} from './channel_bank.js';
import {waveShape} from './preset.js';

const wasmBinary=await readFile(new URL('../generated/gameboy_apu_wasm.wasm',import.meta.url));
async function fixture(t){
  const core=await GameboyApu.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:48000}),writes=[],write=core.writeRegister.bind(core);
  core.writeRegister=(...args)=>{writes.push(args);return write(...args);};
  const instrument=new GameboyInstrument(core);t.after(()=>instrument.dispose());return{instrument,core,writes};
}
const duty=(state,channel)=>[.125,.25,.5,.75][state.voice[channel*5+1]>>6];
const volume=(state,channel)=>state.voice[channel===3?17:channel*5+2]>>4;
const pcm=instrument=>{const value=instrument.generateStereo(2048);assert(value.left.every(Number.isFinite));assert(value.left.some(sample=>Math.abs(sample)>.0001));return value;};

test('idle fixed CH editing and later round-robin keys retain different physical Pulse settings without selecting/resetting the APU',async t=>{
  const {instrument,core,writes}=await fixture(t),handle=core.handle;
  instrument.applyChannelEdit({channel:0,changes:{'pulse.duty':.125,'pulse.volume':5,'pan.left':false}});
  instrument.applyChannelEdit({channel:1,changes:{'pulse.duty':.75,'pulse.volume':12}});
  const before=instrument.read(),count=writes.length,state=instrument.observeEditor();
  assert.equal(writes.length,count);assert.equal(duty(state,0),.125);assert.equal(duty(state,1),.75);
  state.channelPresets[0].pulse.duty=.5;state.voice[1]=0;assert.deepEqual(instrument.read(),before);
  instrument.noteOn('fixed-one',60,{channel:0});instrument.noteOn('fixed-two',64,{channel:1});pcm(instrument);
  assert.deepEqual(instrument.read().voices.map(value=>value.channel),[0,1]);
  instrument.releaseKeyboard();
  assert.equal(instrument.noteOn('round-one',60).channel,0);assert.equal(instrument.noteOn('round-two',64).channel,1);
  const actual=instrument.observeEditor();assert.equal(duty(actual,0),.125);assert.equal(duty(actual,1),.75);
  assert.equal(volume(actual,0),5);assert.equal(volume(actual,1),12);assert.equal(core.handle,handle);pcm(instrument);
  assert.equal(instrument.noteOff('round-one'),true);assert.equal(instrument.noteOff('round-two'),true);
});

test('a common round-robin parameter edit broadcasts that field while preserving other mixed values',async t=>{
  const {instrument,writes}=await fixture(t);
  instrument.applyChannelEdit({channel:0,changes:{'pulse.duty':.125,'pulse.volume':5,'pan.left':false}});
  instrument.applyChannelEdit({channel:1,changes:{'pulse.duty':.75,'pulse.volume':12}});
  const preset=instrument.read().preset;preset.pulse.volume=8;writes.length=0;instrument.setPreset(preset);
  assert.deepEqual(writes.map(([register])=>register),[2,7]);
  const state=instrument.observeEditor();assert.equal(duty(state,0),.125);assert.equal(duty(state,1),.75);
  assert.equal(volume(state,0),8);assert.equal(volume(state,1),8);assert(!state.channelPresets[0].pan.left);assert(state.channelPresets[1].pan.left);
  const name=instrument.read().preset;name.name='Bank label';writes.length=0;instrument.setPreset(name);assert.deepEqual(writes,[]);
});

test('held initial envelope edits are desired per-channel values until the next trigger and preserve current PCM exactly',async t=>{
  const {instrument,core,writes}=await fixture(t);
  instrument.noteOn('held',60,{channel:1});pcm(instrument);
  const native=core.saveState(),expected=core.generateStereo(2048);core.loadState(native);
  const before=instrument.observeEditor();writes.length=0;
  instrument.applyChannelEdit({channel:1,changes:{'pulse.volume':6,'pulse.envelope.period':3}});
  assert.deepEqual(writes,[]);assert.equal(instrument.read().channelPresets[1].pulse.volume,6);
  assert.equal(volume(instrument.observeEditor(),1),volume(before,1));assert.deepEqual(instrument.generateStereo(2048),expected);
  instrument.noteOff('held');instrument.noteOn('next',64,{channel:1});
  assert.equal(instrument.observeEditor().voice[7],(6<<4)|3);assert.equal(volume(instrument.observeEditor(),0),10);
});

test('Code edits retain the independent author bank through Stop while only the selected live CH changes',async t=>{
  const {instrument}=await fixture(t);
  instrument.applyChannelEdit({channel:0,changes:{'pulse.duty':.125,'pulse.volume':5,'pan.left':false}});
  instrument.applyChannelEdit({channel:1,changes:{'pulse.duty':.75,'pulse.volume':12}});
  const token=instrument.beginCode(),call=(method,...args)=>instrument.code(token.session,method,args);
  call('pulse.setVoice',0,{duty:.5,volume:11});call('pulse.setVoice',1,{duty:.25,volume:9});
  call('pulse.noteOn',0,'C4');call('pulse.noteOn',1,'G4');pcm(instrument);
  const before=instrument.observeCode();instrument.applyCodeEdit(token.session,{channel:0,changes:{'pulse.duty':.25}});
  const live=instrument.observeCode();assert.equal(duty(live,0),.25);assert.equal(duty(live,1),.25);
  for(const register of [2,3,4,6,7,8,9,21])assert.equal(live.registers[register],before.registers[register]);
  const author=instrument.observeEditor();assert.equal(duty(author,0),.25);assert.equal(duty(author,1),.75);
  assert.equal(volume(author,0),5);assert.equal(volume(author,1),12);assert.equal(instrument.codeEpoch,token.session);
  assert.throws(()=>instrument.applyChannelEdit({channel:0,changes:{'pulse.volume':2}}),/borrowed Code/);
  instrument.stop();assert.deepEqual(instrument.read().channelPresets,author.channelPresets);
  assert.equal(duty(instrument.observeEditor(),1),.75);assert.equal(volume(instrument.observeEditor(),0),5);
  instrument.noteOn('round-one',60);instrument.noteOn('round-two',64);pcm(instrument);
  assert.equal(duty(instrument.observeEditor(),0),.25);assert.equal(duty(instrument.observeEditor(),1),.75);
});

test('a running round-robin field edit matches direct physical writes sample-exactly without replacing mixed settings or keyboard owners',async t=>{
  const a=await fixture(t),b=await fixture(t),handles=[];
  for(const {instrument}of [a,b]){
    instrument.applyChannelEdit({channel:0,changes:{'pulse.duty':.125,'pulse.volume':5,'pan.left':false}});
    instrument.applyChannelEdit({channel:1,changes:{'pulse.duty':.75,'pulse.volume':12}});
    const token=instrument.beginCode();handles.push(token);
    instrument.code(token.session,'pulse.setVoice',[0,{duty:.5,volume:11}]);instrument.code(token.session,'pulse.setVoice',[1,{duty:.25,volume:9}]);
    instrument.code(token.session,'pulse.noteOn',[0,'C4']);instrument.code(token.session,'pulse.noteOn',[1,'G4']);
    instrument.noteOn('keyboard',64,{channel:0});instrument.generateStereo(1234);
  }
  const before=a.instrument.observeCode(),preset=a.instrument.read().preset;preset.pulse.volume=8;
  a.instrument.applyCodePreset(handles[0].session,preset,null,false);
  for(const channel of [0,1])b.instrument.code(handles[1].session,'pulse.setVoice',[channel,{volume:8}]);
  const after=a.instrument.observeCode();assert.equal(after.positionFrames,before.positionFrames);
  assert.equal(duty(after,0),.5);assert.equal(duty(after,1),.25);
  for(const register of [1,3,4,6,8,9,21])assert.equal(after.registers[register],before.registers[register]);
  assert.deepEqual(a.instrument.generateStereo(4096),b.instrument.generateStereo(4096),'no reset, trigger or cursor/envelope restart beyond the requested hardware writes');
  assert.equal(a.instrument.noteOff('keyboard'),true);assert.equal(b.instrument.noteOff('keyboard'),true);pcm(a.instrument);
  const bank=a.instrument.read().channelPresets;assert.equal(bank[0].pulse.duty,.125);assert.equal(bank[1].pulse.duty,.75);assert.equal(bank[0].pulse.volume,8);assert.equal(bank[1].pulse.volume,8);
  a.instrument.stop();assert.deepEqual(a.instrument.read().channelPresets,bank);assert.equal(duty(a.instrument.observeEditor(),1),.75);
});

test('Wave editing releases only Wave and failed or malformed bank edits preserve the exact native state and note owners',async t=>{
  const {instrument,core,writes}=await fixture(t);
  instrument.noteOn('pulse',60,{channel:0});instrument.noteOn('wave',60,{channel:2});instrument.noteOn('noise',0,{channel:3});pcm(instrument);
  instrument.applyChannelEdit({channel:2,changes:{'wave.samples':waveShape('square')}});
  assert.deepEqual(instrument.read().voices.map(value=>value.id),['pulse','noise']);assert.equal(instrument.noteOff('wave'),false);pcm(instrument);
  const before=instrument.read(),shadow=instrument.observeEditor(),count=writes.length,native=core.saveState(),expected=core.generateStereo(2048);core.loadState(native);
  assert.throws(()=>instrument.applyChannelEdit({channel:1,changes:{'pulse.sweep.enabled':true}}));
  assert.throws(()=>instrument.loadChannelBank(Array(4)));assert.equal(writes.length,count);assert.deepEqual(instrument.read(),before);
  const write=core.writeRegister;core.writeRegister=()=>{throw Error('Failed hardware edit');};
  try{assert.throws(()=>instrument.applyChannelEdit({channel:0,changes:{'pulse.duty':.75}}),/Failed hardware/);}finally{core.writeRegister=write;}
  assert.deepEqual(instrument.read(),before);assert.deepEqual(instrument.observeEditor(),shadow);assert.deepEqual(instrument.generateStereo(2048),expected);
});

test('cold bank adoption and explicit preset load preserve the old single-sound file contract without leaking a Code lease',async t=>{
  const {instrument}=await fixture(t),common=instrument.read().preset;
  let bank=createGameboyChannelBank(common);bank=applyGameboyChannelEdit(bank,{channel:1,changes:{'pulse.duty':.75,'pan.right':false}});
  bank=applyGameboyChannelEdit(bank,{channel:2,changes:{'wave.level':1}});bank=applyGameboyChannelEdit(bank,{channel:3,changes:{'noise.shift':7}});
  instrument.loadChannelBank(bank);assert.deepEqual(instrument.read().preset,common);assert.deepEqual(instrument.read().channelPresets,bank);
  assert.equal(instrument.noteOn('ch-two',60,{channel:1}).channel,1);assert.equal(instrument.observeEditor().voice[6]>>6,3);instrument.releaseKeyboard();
  instrument.noteOn('noise-low',0,{channel:3});const clock=instrument.observeEditor().voice[18];instrument.noteOff('noise-low');instrument.noteOn('noise-high',127,{channel:3});assert.equal(instrument.observeEditor().voice[18],clock);
  instrument.loadPreset(common);assert.deepEqual(instrument.read().channelPresets,createGameboyChannelBank(common));assert.deepEqual(instrument.read().voices,[]);
  const code=instrument.beginCode();assert.throws(()=>instrument.loadChannelBank(bank),/borrowed Code/);assert.equal(instrument.codeEpoch,code.session);
});

test('Code round-robin capacity follows actual NR10 instead of the saved author Sweep setting',async t=>{
  const {instrument}=await fixture(t);
  instrument.applyChannelEdit({channel:0,changes:{'pulse.sweep.enabled':true}});assert.equal(instrument.read().capacity,1);
  const token=instrument.beginCode(),code=(method,...args)=>instrument.code(token.session,method,args);
  code('pulse.setSweep',{direction:'up',period:0,shift:0});assert.equal(instrument.read().capacity,2);
  assert.equal(instrument.noteOn('first',60).channel,0);assert.equal(instrument.noteOn('second',64).channel,1);pcm(instrument);
  instrument.releaseKeyboard();code('pulse.setSweep',{direction:'down',period:4,shift:1});assert.equal(instrument.read().capacity,1);
  assert.equal(instrument.noteOn('sweep-first',60).channel,0);assert.equal(instrument.noteOn('sweep-second',64).channel,0);
  instrument.releaseKeyboard();code('writeRegister',0,0);assert.equal(instrument.read().capacity,2);
  instrument.stop();assert.equal(instrument.read().capacity,1);assert(instrument.read().channelPresets[0].pulse.sweep.enabled);
});
