// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {Huc6280Synth, Huc6280DirectTransport, HUC6280_CLOCK} from '../js/huc6280synth.js';
import {Huc6280Instrument} from './instrument.js';
import {waveShape, presetToCode} from './preset.js';

const wasmBinary=await readFile(new URL('../generated/huc6280_wasm.wasm',import.meta.url));
async function setup(t,rate=48000) {
  const core=await Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:HUC6280_CLOCK,outputSampleRate:rate});
  const writes=[],original=core.writeHuc6280.bind(core);
  core.writeHuc6280=(register,value)=>{writes.push([register,value]);return original(register,value);};
  const instrument=new Huc6280Instrument(core);t.after(()=>instrument.dispose());
  return {instrument,core,writes};
}
const peak=data=>data.reduce((value,sample)=>Math.max(value,Math.abs(sample)),0);
const audible=pcm=>{assert(pcm.left.every(Number.isFinite));assert(peak(pcm.left)>.001);};
const period=(state,channel)=>(state.registers[channel][2]|state.registers[channel][3]<<8)||4096;
function noEnvelope(instrument) {const preset=instrument.read().preset;preset.envelope.enabled=false;instrument.loadPreset(preset);return preset;}
function recordedPreset(instrument,{reset=false,mainVolume=24}={}) {
  const preset=instrument.read().preset;preset.envelope.enabled=false;preset.volume=mainVolume;
  Object.assign(preset.lfo,{enabled:true,mode:'recorded',carrierPeriod:700,modulatorPeriod:913,frequency:7,depth:2,reset,
    output:{enabled:true,volume:19,pan:{left:13,right:15}}});
  return preset;
}

test('real WASM six-voice round robin steals oldest owner and ignores late releases',async t=>{
  const {instrument}=await setup(t);noEnvelope(instrument);
  assert.equal(peak(instrument.generateStereo(128).left),0);assert.equal(instrument.read().capacity,6);
  for(let ch=0;ch<6;ch++)assert.deepEqual(instrument.noteOn(`note${ch}`,60+ch),{channel:ch,stolenId:null});
  audible(instrument.generateStereo(4096));
  assert.deepEqual(instrument.noteOn('new',72),{channel:0,stolenId:'note0'});
  const before=instrument.read();assert.equal(instrument.noteOff('note0'),false);assert.deepEqual(instrument.read(),before);
  instrument.noteOff('note2');assert.deepEqual(instrument.noteOn('replacement',66),{channel:2,stolenId:null});
  assert.throws(()=>instrument.noteOn('new',70),/already active/);
  instrument.stop();assert.deepEqual(instrument.read().voices,[]);assert.equal(peak(instrument.generateStereo(128).left),0);
});

test('all edits validate before touching hardware, while extreme notes reach hardware endpoints',async t=>{
  const {instrument,writes}=await setup(t);noEnvelope(instrument);instrument.noteOn('held',60);
  const before=instrument.read(),count=writes.length;
  const invalid=structuredClone(before.preset);invalid.wave[31]=32;
  assert.throws(()=>instrument.setPreset(invalid));assert.throws(()=>instrument.loadPreset(invalid));
  assert.throws(()=>instrument.noteOn('',60));assert.throws(()=>instrument.noteOn('bad',128));assert.throws(()=>instrument.setPitch(Infinity));
  assert.equal(writes.length,count);assert.deepEqual(instrument.read(),before);
  instrument.stop();instrument.noteOn('lowest',0);instrument.setPitch(-24);
  assert.equal(instrument.read().registers[0][2],0);assert.equal(instrument.read().registers[0][3],0,'period0 encodes4096');
  instrument.stop();instrument.noteOn('highest',127);instrument.setPitch(24);audible(instrument.generateStereo(1024));
});

test('real hardware Noise is only CH5/CH6 and ignores chromatic key pitch',async t=>{
  const a=await setup(t),b=await setup(t);
  const preset=noEnvelope(a.instrument);preset.source='noise';a.instrument.loadPreset(preset);b.instrument.loadPreset(preset);
  assert.equal(a.instrument.read().capacity,2);
  assert.deepEqual(a.instrument.noteOn('low',12),{channel:4,stolenId:null});
  b.instrument.noteOn('high',100);a.instrument.setPitch(2);
  const first=a.instrument.generateStereo(4096),second=b.instrument.generateStereo(4096);audible(first);assert.deepEqual(first,second);
  assert.deepEqual(a.instrument.noteOn('two',64),{channel:5,stolenId:null});
  assert.deepEqual(a.instrument.noteOn('three',67),{channel:4,stolenId:'low'});assert.equal(a.instrument.noteOff('low'),false);
  const owners=a.instrument.read().voices;preset.noise.frequency=29;a.writes.length=0;a.instrument.setPreset(preset);
  assert.deepEqual(a.instrument.read().voices,owners);assert(a.writes.every(([register])=>register===0||register===7));
  audible(a.instrument.generateStereo(4096));
});

test('hardware LFO is CH2 to CH1 with muted modulator, pitch tracking and real PCM difference',async t=>{
  const plain=await setup(t),modulated=await setup(t);
  noEnvelope(plain.instrument);const preset=noEnvelope(modulated.instrument);preset.lfo.enabled=true;preset.lfo.depth=2;preset.lfo.frequency=32;
  modulated.instrument.loadPreset(preset);assert.equal(modulated.instrument.read().capacity,1);
  plain.instrument.noteOn('carrier',60);assert.deepEqual(modulated.instrument.noteOn('carrier',60),{channel:0,stolenId:null});
  const before=modulated.instrument.read();assert.equal(before.registers[1][4]&31,0);assert.equal(before.registers[1][4]&128,0);
  assert.deepEqual(before.registers[1].slice(2,4),before.registers[0].slice(2,4));
  const straight=plain.instrument.generateStereo(10000),vibrato=modulated.instrument.generateStereo(10000);audible(vibrato);assert.notDeepEqual(straight.left,vibrato.left);
  modulated.instrument.setPitch(2);const pitched=modulated.instrument.read();assert.deepEqual(pitched.voices,before.voices);
  assert.deepEqual(pitched.registers[1].slice(2,4),pitched.registers[0].slice(2,4));
  preset.lfo.frequency=8;preset.lfo.depth=3;modulated.instrument.setPreset(preset);assert.equal(modulated.instrument.read().voices.length,1);
  assert.deepEqual(modulated.instrument.noteOn('new',64),{channel:0,stolenId:'carrier'});assert.equal(modulated.instrument.noteOff('carrier'),false);
  modulated.instrument.stop();assert.equal(peak(modulated.instrument.generateStereo(128).left),0);
  preset.source='noise';modulated.instrument.loadPreset(preset);assert.equal(modulated.instrument.read().globals[9],0,'inactive LFO retained in preset but disabled for Noise');
});

test('live volume/pan/pitch preserve held channels, and wave changes stop them',async t=>{
  const {instrument}=await setup(t);const preset=noEnvelope(instrument);instrument.noteOn('held',60);
  const owners=instrument.read().voices;preset.pan={left:15,right:0};preset.volume=18;instrument.setPreset(preset);instrument.setPitch(2);
  assert.deepEqual(instrument.read().voices,owners);const pcm=instrument.generateStereo(2048);audible(pcm);assert.equal(peak(pcm.right),0);
  preset.volume=0;instrument.setPreset(preset);assert.equal(peak(instrument.generateStereo(1024).left),0);
  preset.volume=24;preset.wave=waveShape('square');instrument.setPreset(preset);assert.deepEqual(instrument.read().voices,[]);
  assert.equal(instrument.noteOff('held'),false);instrument.noteOn('square',60);audible(instrument.generateStereo(1024));
});

test('software ADSR releases held owners with an audible tail, then reaches exact silence',async t=>{
  const {instrument}=await setup(t);const preset=instrument.read().preset;
  preset.envelope={enabled:true,attack:.02,decay:.03,sustain:.25,release:.1};instrument.loadPreset(preset);instrument.noteOn('soft',60);
  const attack=instrument.generateStereo(960).left;assert(peak(attack.slice(0,100))<peak(attack.slice(800))*.7);
  instrument.generateStereo(1600);const sustain=instrument.generateStereo(1024).left;assert(peak(sustain)<peak(attack)*.5);
  instrument.noteOff('soft');assert.equal(instrument.read().voices.length,0);assert.equal(instrument.read().tails.length,1);
  audible(instrument.generateStereo(1024));instrument.generateStereo(5000);assert.equal(instrument.read().tails.length,0);
  assert.equal(peak(instrument.generateStereo(128).left),0);
});

test('software envelope uses a fixed render timeline across arbitrary chunk sizes and reused IDs',async t=>{
  const a=await setup(t),b=await setup(t);const preset=a.instrument.read().preset;
  preset.envelope={enabled:true,attack:.015,decay:.025,sustain:.4,release:.05};a.instrument.loadPreset(preset);b.instrument.loadPreset(preset);
  a.instrument.noteOn('id',60);b.instrument.noteOn('id',60);
  const all=a.instrument.generateStereo(4096).left,part=new Float32Array(4096);
  let offset=0;while(offset<part.length){const n=Math.min(7,part.length-offset);part.set(b.instrument.generateStereo(n).left,offset);offset+=n;}
  assert.deepEqual(part,all);
  a.instrument.noteOff('id');a.instrument.noteOn('id',64);a.instrument.generateStereo(4096);
  assert.equal(a.instrument.read().voices[0].id,'id','retiring an earlier tail cannot remove new ID ownership');
  const exported=a.instrument.read().preset;exported.wave[0]=31;assert.notEqual(a.instrument.read().preset.wave[0],31);
  a.instrument.dispose();assert.throws(()=>a.instrument.read(),/disposed/);assert.equal(a.core.handle,0);
});

test('recorded LFO pairs render exact raw-register PCM at C4, including held reset and independent CH2 output',async t=>{
  for(const reset of [false,true]) for(const mainVolume of [24,0]) {
    const {instrument}=await setup(t),preset=recordedPreset(instrument,{reset,mainVolume});
    const raw=await Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:HUC6280_CLOCK,outputSampleRate:48000});
    t.after(()=>raw.dispose());
    const write=(register,value)=>raw.writeHuc6280(register,value);
    write(1,255);
    for(const [channel,wave,level,pan,step] of [[0,preset.wave,preset.volume,preset.pan,700],
      [1,preset.lfo.wave,19,preset.lfo.output.pan,913]]) {
      write(0,channel);write(4,64);write(4,0);
      for(const sample of wave)write(6,sample);
      write(5,pan.left<<4|pan.right);write(2,step&255);write(3,step>>8);write(4,level);
    }
    write(8,7);write(9,2|(reset?128:0));
    write(0,1);write(4,147);write(0,0);write(4,128|mainVolume);
    instrument.loadPreset(preset);instrument.noteOn('recorded',60);
    const actual=instrument.generateStereo(4096),expected=raw.processFrames(4096);
    assert.deepEqual(actual,expected);
    if (reset && mainVolume === 0) assert.equal(peak(actual.left),0,'reset holds the centered first modulator sample');
    else audible(actual);
    const state=instrument.read();assert.equal(period(state,0),700);assert.equal(period(state,1),913);
    assert.equal(state.registers[1][4],147);assert.equal(state.globals[9],2|(reset?128:0));
    instrument.noteOff('recorded');assert.equal(peak(instrument.generateStereo(128).left),0);
    assert.equal(instrument.read().registers[1][4]&128,0);
  }
});

test('recorded periods transpose only the carrier, update live and encode 4096 as register zero',async t=>{
  const {instrument}=await setup(t),preset=recordedPreset(instrument);
  instrument.loadPreset(preset);instrument.noteOn('owner',60);
  const owner=instrument.read().voices;
  instrument.setPitch(12);let state=instrument.read();assert.equal(period(state,0),350);assert.equal(period(state,1),913);
  instrument.setPitch(0);preset.lfo.carrierPeriod=800;preset.lfo.modulatorPeriod=4096;
  preset.lfo.frequency=9;preset.lfo.depth=3;preset.lfo.reset=true;
  preset.lfo.output.volume=14;preset.lfo.output.pan={left:0,right:15};instrument.setPreset(preset);
  state=instrument.read();assert.deepEqual(state.voices,owner);
  assert.equal(period(state,0),800);assert.deepEqual(state.registers[1].slice(2,4),[0,0]);
  assert.equal(state.globals[8],9);assert.equal(state.globals[9],131);
  assert.equal(state.registers[1][4],142);assert.equal(state.registers[1][5],15);
  preset.lfo.carrierPeriod=4096;instrument.setPreset(preset);
  assert.deepEqual(instrument.read().registers[0].slice(2,4),[0,0]);
  instrument.setPitch(-24);assert.equal(period(instrument.read(),0),4096);
  instrument.stop();instrument.noteOn('octave',72);
  assert.equal(period(instrument.read(),0),4096,'negative two-octave bend is retained');
  instrument.setPitch(0);assert.equal(period(instrument.read(),0),2048);assert.equal(period(instrument.read(),1),4096);
});

test('paired CH2 owner follows stealing and software release without a stuck modulator or obsolete release',async t=>{
  const {instrument}=await setup(t),preset=recordedPreset(instrument,{mainVolume:0});
  preset.envelope={enabled:true,attack:0,decay:0,sustain:1,release:.04};instrument.loadPreset(preset);
  instrument.noteOn('old',60);audible(instrument.generateStereo(1024));
  assert.deepEqual(instrument.noteOn('new',64),{channel:0,stolenId:'old'});
  assert.equal(instrument.noteOff('old'),false);assert.equal(instrument.read().registers[1][4]&128,128);
  instrument.noteOff('new');assert.equal(instrument.read().voices.length,0);assert.equal(instrument.read().tails.length,1);
  audible(instrument.generateStereo(256));instrument.generateStereo(2048);
  assert.equal(instrument.read().tails.length,0);assert.equal(instrument.read().registers[1][4]&128,0);
  assert.equal(peak(instrument.generateStereo(128).left),0);
  instrument.noteOn('stop',60);instrument.stop();assert.equal(instrument.read().registers[1][4]&128,0);
  assert.equal(peak(instrument.generateStereo(128).left),0);
});

test('LFO mode and CH2 output routing edits stop both voices while v1 playback keeps the old follow behavior',async t=>{
  const {instrument}=await setup(t),preset=recordedPreset(instrument);
  instrument.loadPreset(preset);instrument.noteOn('recorded',60);
  preset.lfo.mode='follow';instrument.setPreset(preset);assert.equal(instrument.read().voices.length,0);
  assert.equal(instrument.read().registers[1][4]&128,0);
  instrument.noteOn('follow',69);assert.equal(period(instrument.read(),0),period(instrument.read(),1));
  preset.lfo.output.enabled=false;instrument.setPreset(preset);assert.equal(instrument.read().voices.length,0);
  instrument.noteOn('muted',60);assert.equal(instrument.read().registers[1][4]&128,0);
  preset.lfo.enabled=false;instrument.setPreset(preset);instrument.noteOn('plain0',60);instrument.noteOn('plain1',64);
  assert.equal(instrument.read().voices.length,2);assert.equal(instrument.read().registers[1][4]&128,128);
  instrument.noteOff('plain0');assert.equal(instrument.read().registers[1][4]&128,128,'ordinary CH2 keeps its own owner');
  const old=instrument.read().preset;old.version=1;old.lfo={enabled:true,frequency:32,depth:1,wave:waveShape('sine')};
  instrument.loadPreset(old);instrument.noteOn('legacy',60);instrument.setPitch(2);
  assert.equal(period(instrument.read(),0),period(instrument.read(),1));assert.equal(instrument.read().registers[1][4]&128,0);
});

test('copied recorded LFO JavaScript reproduces the paired instrument PCM through the actual chip API',async t=>{
  for(const reset of [false,true]) {
    const {instrument}=await setup(t),preset=recordedPreset(instrument,{reset});
    preset.wave=waveShape('triangle');preset.lfo.wave=waveShape('square');preset.lfo.carrierPeriod=4096;
    instrument.loadPreset(preset);instrument.noteOn('copy-reference',60);
    const core=await Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:HUC6280_CLOCK,outputSampleRate:48000});
    const pce=new Huc6280Synth({transport:new Huc6280DirectTransport(core)});pce.initialize();
    t.after(()=>{pce.dispose();core.dispose();});
    const code=presetToCode(preset);vm.runInNewContext(code,{pce});
    assert.deepEqual(core.processFrames(4096),instrument.generateStereo(4096));
    pce.keyOff(0);pce.keyOff(1);assert.equal(peak(core.processFrames(128).left),0);
  }
});
