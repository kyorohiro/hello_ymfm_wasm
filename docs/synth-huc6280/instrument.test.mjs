// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {HUC6280_CLOCK} from '../js/huc6280synth.js';
import {Huc6280Instrument} from './instrument.js';
import {waveShape} from './preset.js';

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
function noEnvelope(instrument) {const preset=instrument.read().preset;preset.envelope.enabled=false;instrument.loadPreset(preset);return preset;}

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
