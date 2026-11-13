// SPDX-License-Identifier: BSD-3-Clause
// Real native APU only; no AudioContext or audio device is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/gameboy_apu_wasm.js';
import {GameboyApu} from '../js/gameboyapu.js';
import {GameboyInstrument} from './instrument.js';
import {waveShape} from './preset.js';
const wasmBinary=await readFile(new URL('../generated/gameboy_apu_wasm.wasm',import.meta.url));
async function fixture(t){
  const core=await GameboyApu.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:48000}),writes=[],write=core.writeRegister.bind(core);
  core.writeRegister=(...args)=>{writes.push(args);return write(...args);};const instrument=new GameboyInstrument(core);t.after(()=>instrument.dispose());
  const preset=instrument.read().preset;preset.pulse.duty=.125;preset.pulse.volume=7;instrument.loadPreset(preset);
  const token=instrument.beginCode();return{core,instrument,writes,token,code:(method,...args)=>instrument.code(token.session,method,args)};
}
const active=(instrument,ch)=>Boolean(instrument.observeCode().registers[ch===2?10:[2,7,0,17][ch]]&(ch===2?128:0xf8));
const pitch=(state,ch)=>state.voice[ch===2?13:ch*5+3]|(state.voice[ch===2?14:ch*5+4]&7)<<8;
const sounding=instrument=>{const pcm=instrument.generateStereo(2048);assert(pcm.left.every(Number.isFinite));assert(pcm.left.some(value=>Math.abs(value)>.0001));};

test('parameter Code and keyboard share one APU while keyboard uses the live physical settings and preserves the author checkpoint',async t=>{
  const {instrument,core,code,writes}=await fixture(t),author=instrument.read().preset,handle=core.handle;
  code('pulse.setVoice',0,{duty:.75,volume:11,envelope:{direction:'down',period:0}});code('setPan',0,true,true);
  instrument.noteOn('key',60,{channel:0});let state=instrument.observeCode();assert.equal(state.voice[1]>>6,3);assert.equal(state.voice[2]>>4,11);
  assert.deepEqual(instrument.read().preset,author);assert.equal(instrument.read().voices[0].id,'key');sounding(instrument);
  const before=writes.length,frequency=pitch(state,0);code('pulse.setDuty',0,.25);state=instrument.observeCode();assert.equal(state.voice[1]>>6,1);assert.equal(pitch(state,0),frequency);
  assert.deepEqual(writes.slice(before).map(([register])=>register),[1]);sounding(instrument);
  const session=instrument.codeEpoch;instrument.releaseKeyboard();assert.equal(instrument.codeEpoch,session);assert(instrument.codeActive);assert.deepEqual(instrument.read().voices,[]);
  code('pulse.setDuty',0,.5);instrument.noteOn('next',64,{channel:0});assert.equal(instrument.observeCode().voice[1]>>6,2);assert.equal(core.handle,handle);
});

test('last KON owns each physical channel: old keyboard and old typed Code releases cannot cut the newer owner',async t=>{
  const {instrument,code,writes}=await fixture(t);code('pulse.noteOn',0,'C4');instrument.noteOn('keyboard',64,{channel:0});
  let count=writes.length;assert.equal(code('pulse.keyOff',0),false);assert.equal(writes.length,count);assert(active(instrument,0));
  instrument.setPitch(1);assert(active(instrument,0));code('pulse.noteOn',0,'G4');assert.deepEqual(instrument.read().voices,[]);
  count=writes.length;assert.equal(instrument.noteOff('keyboard'),false);assert.equal(writes.length,count);assert(active(instrument,0));
  instrument.noteOn('replacement',67,{channel:0});instrument.releaseKeyboard();code('pulse.noteOn',1,'E4');
  count=writes.length;instrument.releaseKeyboard();assert.equal(writes.length,count);assert(active(instrument,1),'blur/keyboard cleanup leaves Code gates sounding');
  instrument.noteOn('raw',60,{channel:0});code('writeRegister',4,instrument.observeCode().voice[4]|128);assert.equal(instrument.noteOff('raw'),false);
  instrument.noteOn('explicit-all',60,{channel:0});code('allNotesOff');assert.deepEqual(instrument.read().voices,[]);assert(!active(instrument,0)&&!active(instrument,1));
});

test('selected-CH edits change only explicit fields, retaining every frequency, other CH settings, gates, native history and Code token',async t=>{
  const {instrument,code,token,writes}=await fixture(t);
  code('pulse.setVoice',0,{duty:.75,volume:12});code('pulse.setVoice',1,{duty:.5,volume:9});
  code('pulse.noteOn',0,'C4');code('pulse.noteOn',1,'E4');code('wave.noteOn','G3');code('noise.keyOn');instrument.generateStereo(1234);
  const before=instrument.observeCode(),author=instrument.read().preset,count=writes.length;
  instrument.applyCodeEdit(token.session,{channel:1,changes:{'pulse.duty':.25,'pan.left':false}});
  const after=instrument.observeCode();assert.equal(instrument.codeEpoch,token.session);assert.equal(after.positionFrames,before.positionFrames);
  assert.equal(after.voice[1],before.voice[1]);assert.equal(after.voice[2],before.voice[2]);assert.equal(after.voice[7],before.voice[7]);
  assert.equal(after.voice[6]>>6,1);assert.equal(after.voice[21]&~(16<<1),before.voice[21]&~(16<<1));
  for(const register of [3,4,8,9,10,13,14,17,18,19])assert.equal(after.registers[register],before.registers[register]);
  // The native save/load preparation writes author registers to a temporary
  // checkpoint, then restores the live machine before exactly these two writes.
  assert.deepEqual(writes.slice(-2).map(([register])=>register),[6,21]);assert(writes.length>count);
  assert.equal(instrument.read().preset.pulse.volume,author.pulse.volume);assert.equal(instrument.read().preset.pulse.duty,.25);
  sounding(instrument);instrument.stop();assert.equal(instrument.read().preset.pulse.duty,.25);assert.equal(instrument.read().preset.pulse.volume,author.pulse.volume);
});

test('Noise ignores keyboard pitch and Sweep keeps default pulse allocation on CH1 while an explicit CH2 remains independent',async t=>{
  const {instrument,code}=await fixture(t);code('noise.setParameters',{divisor:5,shift:8,width:7});const noise=instrument.observeCode().voice[18];
  instrument.noteOn('low',0,{channel:3});instrument.setPitch(24);instrument.noteOff('low');instrument.noteOn('high',127,{channel:3});assert.equal(instrument.observeCode().voice[18],noise);
  instrument.releaseKeyboard();code('pulse.setSweep',{direction:'down',period:4,shift:1});
  const a=instrument.noteOn('first',60),b=instrument.noteOn('second',64);assert.equal(a.channel,0);assert.equal(b.channel,0);assert.equal(b.stolenId,'first');assert.equal(instrument.read().capacity,1);
  assert.equal(instrument.noteOff('first'),false);const sweep=instrument.observeCode().voice[0];instrument.noteOn('explicit-ch2',67,{channel:1});assert.equal(instrument.observeCode().voice[0],sweep);
});

test('Wave drawing retires only its necessary Wave gate; invalid or failed edits preserve the exact live machine, keyboard IDs and Stop bank',async t=>{
  const {instrument,core,code,token,writes}=await fixture(t);code('pulse.noteOn',0,'C4');instrument.noteOn('wave-key',60,{channel:2});sounding(instrument);
  const before=instrument.observeCode(),samples=waveShape('square');instrument.applyCodeEdit(token.session,{channel:2,changes:{'wave.samples':samples}});
  const after=instrument.observeCode();assert(!active(instrument,2));assert(active(instrument,0));assert.equal(pitch(after,2),pitch(before,2));assert.deepEqual(instrument.read().voices,[]);
  instrument.noteOn('held',64,{channel:0});const state=instrument.observeCode(),author=instrument.read().preset,keyboard=instrument.read().voices,native=core.saveState(),expected=core.generateStereo(2048);core.loadState(native);
  const count=writes.length;for(const edit of [{channel:1,changes:{'pulse.sweep.period':3}},{channel:0,changes:{'pulse.duty':.3}},{channel:2,changes:{'wave.samples':Array(31).fill(0)}}])assert.throws(()=>instrument.applyCodeEdit(token.session,edit));
  assert.equal(writes.length,count);assert.deepEqual(instrument.observeCode(),state);assert.deepEqual(instrument.read().voices,keyboard);
  const load=core.loadState,write=core.writeRegister;let loads=0;
  core.loadState=function(...args){loads++;return load.apply(this,args);};core.writeRegister=function(...args){if(loads===2)throw Error('Live edit failed');return write.apply(this,args);};
  try{assert.throws(()=>instrument.applyCodeEdit(token.session,{channel:0,changes:{'pulse.duty':.75}}),/Live edit failed/);}finally{core.loadState=load;core.writeRegister=write;}
  assert.deepEqual(instrument.observeCode(),state);assert.deepEqual(instrument.read().preset,author);assert.deepEqual(instrument.read().voices,keyboard);assert.deepEqual(instrument.generateStereo(2048),expected);
});
