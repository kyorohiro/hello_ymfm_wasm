// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SidCore,SID_PAL_CLOCK} from '../js/sid.js';
import {Sid8580Core} from '../js/sid8580.js';
import {SidInstrument} from './instrument.js';
import {selectChannelTarget,selectKeyboardMode,applyChannelPreset} from './channel_settings.js';

const binaries={
  '6581':await readFile(new URL('../generated/sid/sid.wasm',import.meta.url)),
  '8580':await readFile(new URL('../generated/sid8580-machine/sid8580-endpoint.wasm',import.meta.url)),
};
const hz=midi=>440*2**((midi-69)/12),frequency=value=>Math.round(value*16777216/SID_PAL_CLOCK);
const rms=pcm=>Math.sqrt(pcm.reduce((sum,value)=>sum+value*value,0)/pcm.length);
const render=(instrument,frames=4800)=>instrument.renderInto(new Float32Array(frames));
async function setup(t,model,channel=0,{mode='legato',paired=false}={}){
  const Core=model==='6581'?SidCore:Sid8580Core,core=await Core.create({sampleRate:48000,wasmBinary:binaries[model]});
  const instrument=new SidInstrument(core),writes=[];let resets=0;
  const write=core.writeRegister.bind(core),reset=core.reset.bind(core);
  core.writeRegister=(register,value)=>{writes.push([register,value]);write(register,value);};
  core.reset=()=>{resets++;reset();};
  let settings=selectKeyboardMode(selectChannelTarget(instrument.read().channelSettings,channel),mode);
  const preset=structuredClone(settings.channels[channel]);
  // Exact voice settings captured from 8Bit_Goblin_Preview.sid, represented as
  // scalar authoring parameters only. No tune data or recorded PCM is included.
  Object.assign(preset.voice,{waveform:'triangle',pulseWidth:2045,attack:2,decay:0,sustain:15,release:3});
  Object.assign(preset.filter,{enabled:false,mode:'off',cutoff:0,resonance:0,volume:15});
  if(paired)preset.modulation={sync:true,ring:true,ratio:1.25};
  settings=applyChannelPreset(settings,preset);instrument.loadChannelSettings(settings);
  t.after(()=>instrument.dispose());
  return {core,instrument,writes,get resets(){return resets;}};
}

test('fixed Legato keeps the Gate and maximum-sustain sound across overlapping notes and returns to held keys in both models',async t=>{
  for(const model of ['6581','8580'])for(const channel of [0,1,2]){
    const f=await setup(t,model,channel),{instrument,core,writes}=f,base=channel*7;
    instrument.noteOn('A',60);assert(rms(render(instrument))>.005);
    if(model==='6581')assert.equal(core.getState().voices[channel].envelope,255);
    const resets=f.resets;writes.length=0;
    assert.deepEqual(instrument.noteOn('B',64),{channel,stolenId:null});
    assert.deepEqual(instrument.read().voices.map(voice=>voice.id),['A','B']);
    assert.deepEqual(writes.map(([register])=>register),[base,base+1]);
    assert.equal(core.registers[base+4]&1,1);assert.equal(f.resets,resets);
    assert(rms(render(instrument))>.005,'an overlapping key must not trigger the maximum-envelope wrap/freeze');
    writes.length=0;assert.equal(instrument.noteOff('B'),true);
    assert.deepEqual(instrument.read().voices.map(voice=>voice.id),['A']);
    assert.deepEqual(writes.map(([register])=>register),[base,base+1]);
    assert.equal(core.registers[base]|core.registers[base+1]<<8,frequency(hz(60)));
    assert.equal(core.registers[base+4]&1,1);assert(rms(render(instrument))>.005);
    writes.length=0;assert.equal(instrument.noteOff('A'),true);assert.equal(core.registers[base+4]&1,0);
    assert.deepEqual(writes.map(([register])=>register),[base+4]);assert.deepEqual(instrument.read().voices,[]);
    render(instrument);writes.length=0;instrument.noteOn('C',67);
    assert.deepEqual(writes.map(([register])=>register),[base,base+1,base+4]);assert.equal(core.registers[base+4]&1,1);
    assert(rms(render(instrument))>.005);assert.equal(f.resets,resets);
  }
});

test('Legato is last-note priority, releasing a noncurrent held key never changes hardware and stale releases are harmless',async t=>{
  for(const model of ['6581','8580']){
    const {instrument,core,writes}=await setup(t,model,1);
    instrument.noteOn('A',60);instrument.noteOn('B',64);instrument.noteOn('C',67);render(instrument);
    assert.deepEqual(instrument.read().voices.map(voice=>voice.id),['A','B','C']);
    assert.equal(instrument.noteOff('C'),true);assert.equal(core.registers[7]|core.registers[8]<<8,frequency(hz(64)));
    assert.deepEqual(instrument.read().voices.map(voice=>voice.id),['A','B']);
    instrument.noteOn('C-again',67);
    writes.length=0;const before=core.getState();assert.equal(instrument.noteOff('B'),true);
    assert.deepEqual(writes,[]);assert.deepEqual(core.getState(),before);assert.deepEqual(instrument.read().voices.map(voice=>voice.id),['A','C-again']);
    assert.equal(instrument.noteOff('B'),false);assert.equal(instrument.noteOff('missing'),false);assert.deepEqual(writes,[]);
    assert.equal(instrument.noteOff('C-again'),true);assert.equal(core.registers[7]|core.registers[8]<<8,frequency(hz(60)));
    assert.deepEqual(instrument.read().voices.map(voice=>voice.id),['A']);assert.equal(core.registers[11]&1,1);
    instrument.noteOn('D',69);writes.length=0;assert.equal(instrument.noteOff('A'),true);
    assert.deepEqual(writes,[]);assert.equal(core.registers[7]|core.registers[8]<<8,frequency(hz(69)));
    assert.deepEqual(instrument.read().voices.map(voice=>voice.id),['D']);assert.equal(instrument.noteOff('D'),true);assert.equal(core.registers[11]&1,0);
  }
});

test('Legato retunes the real Sync/Ring source on overlap, Pitch and fallback without Gate edges',async t=>{
  for(const model of ['6581','8580'])for(const channel of [0,1,2]){
    const {instrument,core,writes}=await setup(t,model,channel,{paired:true}),source=(channel+2)%3;
    instrument.noteOn('low',60);render(instrument);writes.length=0;instrument.noteOn('high',64);
    assert.deepEqual(writes.map(([register])=>register),[channel*7,channel*7+1,source*7,source*7+1]);
    assert.equal(core.registers[channel*7+4]&7,7);assert.equal(core.registers[source*7+4]&1,0);
    writes.length=0;instrument.setPitch(-2);
    assert.deepEqual(writes.map(([register])=>register),[channel*7,channel*7+1,source*7,source*7+1]);
    assert.equal(core.registers[channel*7]|core.registers[channel*7+1]<<8,frequency(hz(62)));
    assert.equal(core.registers[source*7]|core.registers[source*7+1]<<8,frequency(hz(62)*1.25));
    writes.length=0;assert.equal(instrument.noteOff('high'),true);
    assert.deepEqual(writes.map(([register])=>register),[channel*7,channel*7+1,source*7,source*7+1]);
    assert.equal(core.registers[channel*7]|core.registers[channel*7+1]<<8,frequency(hz(58)));
    assert.equal(core.registers[source*7]|core.registers[source*7+1]<<8,frequency(hz(58)*1.25));
    assert.deepEqual(instrument.read().voices.map(voice=>voice.id),['low']);assert.equal(instrument.noteOff('low'),true);
    assert.equal(core.registers[channel*7+4]&1,0);assert.equal(core.registers[source*7+4]&1,0);
  }
});

test('invalid Legato attacks, Pitch and live ratio edits validate every held fallback before changing ownership or hardware',async t=>{
  for(const model of ['6581','8580']){
    const {instrument,core,writes}=await setup(t,model,0,{paired:true});
    const value=instrument.read().preset;value.modulation.ratio=1;instrument.setPreset(value);
    instrument.noteOn('held-high',100);render(instrument);instrument.noteOn('current-low',60);render(instrument);
    const snapshot=instrument.read(),hardware=core.getState();writes.length=0;
    const invalidRatio=instrument.read().preset;invalidRatio.modulation.ratio=2;
    for(const operation of [()=>instrument.noteOn('current-low',64),()=>instrument.noteOn('invalid',127),()=>instrument.noteOn('',60),()=>instrument.noteOn('fraction',60.5),()=>instrument.setPitch(24),()=>instrument.setPreset(invalidRatio)]){
      assert.throws(operation);assert.deepEqual(instrument.read(),snapshot);assert.deepEqual(core.getState(),hardware);assert.deepEqual(writes,[]);
    }
    instrument.setPitch(-12);assert.equal(core.registers[0]|core.registers[1]<<8,frequency(hz(48)));
    assert.equal(instrument.noteOff('current-low'),true);assert.equal(core.registers[0]|core.registers[1]<<8,frequency(hz(88)));
    assert.deepEqual(instrument.read().voices.map(voice=>voice.id),['held-high']);assert.equal(core.registers[4]&1,1);
  }
});

test('keyboard mode, topology, load and Stop clear Legato stacks and Pitch while retaining saved channel settings',async t=>{
  for(const model of ['6581','8580']){
    const {instrument}=await setup(t,model,1);
    const hold=()=>{instrument.noteOn('A',60);instrument.noteOn('B',64);instrument.setPitch(-2);};
    hold();const switched=selectKeyboardMode(instrument.read().channelSettings,'retrigger');instrument.setChannelSettings(switched);
    assert.deepEqual(instrument.read().voices,[]);assert.equal(instrument.read().pitch,0);assert.equal(instrument.noteOff('A'),false);assert.equal(instrument.noteOff('B'),false);
    instrument.setChannelSettings(selectKeyboardMode(instrument.read().channelSettings,'legato'));
    hold();const same=instrument.read().channelSettings;instrument.loadChannelSettings(same);
    assert.deepEqual(instrument.read().voices,[]);assert.equal(instrument.read().pitch,0);assert.deepEqual(instrument.read().channelSettings,same);
    hold();const topology=instrument.read().preset;topology.modulation.sync=true;instrument.setPreset(topology);
    assert.deepEqual(instrument.read().voices,[]);assert.equal(instrument.read().pitch,0);assert.equal(instrument.read().channelSettings.keyboardMode,'legato');
    hold();const keep=instrument.read().channelSettings;instrument.stop();
    assert.deepEqual(instrument.read().channelSettings,keep);assert.deepEqual(instrument.read().voices,[]);assert.equal(instrument.read().pitch,0);
    assert.equal(instrument.noteOff('A'),false);assert.equal(instrument.noteOff('B'),false);assert.equal(rms(render(instrument)),0);
  }
});

test('Retrigger retains maximum-envelope wrap behavior and Round robin ignores the stored Legato mode',async t=>{
  for(const model of ['6581','8580']){
    const {instrument,core,writes}=await setup(t,model,0,{mode:'retrigger'});
    instrument.noteOn('A',60);render(instrument);writes.length=0;
    assert.deepEqual(instrument.noteOn('B',64),{channel:0,stolenId:'A'});
    assert.deepEqual(writes.map(([register])=>register),[4,0,1,4]);assert.equal(core.registers[4]&1,1);
    render(instrument,48000);assert(rms(render(instrument,4096))<1e-6);assert.deepEqual(instrument.read().voices.map(voice=>voice.id),['B']);
    const settings=selectKeyboardMode(selectChannelTarget(instrument.read().channelSettings,'round-robin'),'legato');instrument.loadChannelSettings(settings);
    for(let channel=0;channel<3;channel++)assert.equal(instrument.noteOn(`rr-${channel}`,60+channel).channel,channel);
    assert.deepEqual(instrument.noteOn('rr-steal',67),{channel:0,stolenId:'rr-0'});assert.equal(instrument.read().capacity,3);
    assert.equal(instrument.read().voices.length,3);assert.equal(instrument.noteOff('rr-0'),false);
    const paired=instrument.read().preset;paired.modulation.sync=true;instrument.loadPreset(paired);
    instrument.noteOn('pair-A',60);assert.deepEqual(instrument.noteOn('pair-B',64),{channel:0,stolenId:'pair-A'});
    assert.equal(instrument.read().capacity,1);assert.deepEqual(instrument.read().voices.map(voice=>voice.id),['pair-B']);
  }
});
