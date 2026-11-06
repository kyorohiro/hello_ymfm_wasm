// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/spc_wasm.js';
import {SnesDspCore} from '../js/spc.js';
import {SnesSynth} from '../js/snessynth.js';
import {encodeBrr} from '../js/snes_brr_encoder.js';
import {encodeBase64} from './sample.js';
import {SnesInstrument} from './instrument.js';
import {createDefaultPreset,envelopeRegisters,waveShape} from './preset.js';

const wasmBinary=await readFile(new URL('../generated/spc_wasm.wasm',import.meta.url));
const create=()=>SnesDspCore.create({moduleFactory:factory,moduleOptions:{wasmBinary}});
async function setup(t) {const core=await create(),instrument=new SnesInstrument(core);t.after(()=>instrument.dispose());return {core,instrument};}
function render(instrument,frames) {const left=new Float32Array(frames),right=new Float32Array(frames);instrument.renderInto(left,right);return {left,right};}
const peak=values=>values.reduce((result,value)=>Math.max(result,Math.abs(value)),0);

test('eight physical voices start together, retain finite headroom and release via hardware KOFF',async t=>{
  const {instrument}=await setup(t);
  for(let channel=0;channel<8;channel++)assert.deepEqual(instrument.noteOn(`note-${channel}`,60),{channel,stolenId:null});
  const output=render(instrument,4096);assert(output.left.every(Number.isFinite));assert(peak(output.left)>.2);assert(peak(output.left)<.95);
  const state=instrument.read();assert.equal(state.capacity,8);assert.equal(state.voices.length,8);
  assert.deepEqual(state.registers.map(row=>row[4]),Array(8).fill(0));assert(state.registers.every(row=>row[8]>0));
  for(let channel=0;channel<8;channel++)assert.equal(instrument.noteOff(`note-${channel}`),true);
  assert.equal(instrument.read().voices.length,0);render(instrument,1024);
  assert.equal(instrument.read().tails.length,0);assert.equal(peak(render(instrument,128).left),0);
});

test('ninth note steals safely and a replaced owner cannot stop its new channel',async t=>{
  const {instrument}=await setup(t);
  for(let i=0;i<8;i++)instrument.noteOn(`n${i}`,60+i);
  render(instrument,256);assert.deepEqual(instrument.noteOn('new',72),{channel:0,stolenId:'n0'});
  assert.equal(instrument.noteOff('n0'),false);assert.equal(instrument.read().voices.length,8);
  render(instrument,512);assert(peak(render(instrument,128).left)>.001);
  for(let i=1;i<8;i++)instrument.noteOff(`n${i}`);instrument.noteOff('new');render(instrument,1024);
  assert.equal(instrument.read().tails.length,0);
});

test('release slots are preferred over held notes and reused identities keep their new owner',async t=>{
  const {instrument}=await setup(t);for(let i=0;i<8;i++)instrument.noteOn(`n${i}`,60+i);
  render(instrument,512);instrument.noteOff('n4');
  assert.deepEqual(instrument.noteOn('again',64),{channel:4,stolenId:null});
  assert.equal(instrument.noteOff('n4'),false);assert.equal(instrument.read().voices.length,8);
  instrument.noteOff('again');instrument.noteOn('again',65);render(instrument,1024);
  assert(instrument.read().voices.some(v=>v.id==='again'));
});

test('live level, envelope, tuning and Pitch changes preserve owners and native execution',async t=>{
  const {instrument,core}=await setup(t);instrument.noteOn('held',60);render(instrument,333);
  const before=instrument.read(),p=before.preset;
  p.volume.left=-16;p.envelope.mode='gain';p.envelope.gainLevel=80;instrument.setPreset(p);instrument.setPitch(2);
  const edited=instrument.read();assert.deepEqual(edited.voices,before.voices);assert.equal(edited.generation,before.generation);assert.equal(core.nativeFrames,333);
  assert.equal(edited.registers[0][0],240);assert.equal(edited.registers[0][7],80);
  const expected=Math.round(4096*440*2**((62-69)/12)/250);
  assert.equal(edited.registers[0][2]|(edited.registers[0][3]<<8),expected);
  const pcm=render(instrument,512);assert(pcm.left.some((value,index)=>value!==pcm.right[index]));
});

test('sample replacement and Stop reclaim RAM, silence all voices and invalidate buffered output generations',async t=>{
  const {instrument,core}=await setup(t);instrument.noteOn('old',60);render(instrument,256);
  let generation=instrument.generation;
  for(let i=0;i<40;i++) {
    const p=instrument.read().preset;p.wave=waveShape(i%2?'triangle':'square');instrument.setPreset(p);
    assert(instrument.generation>generation);generation=instrument.generation;
    assert.equal(instrument.read().voices.length,0);assert.equal(instrument.synth.samples.length,1);
    assert.equal(instrument.synth.nextAddress,1024+72);assert.equal(core.nativeFrames,0);
  }
  instrument.noteOn('again',60);render(instrument,256);instrument.stop();
  assert(instrument.generation>generation);assert.equal(instrument.read().voices.length,0);assert.equal(peak(render(instrument,512).left),0);
});

test('a supplied BRR sample uses declared root/base PITCH and renders a finite one-shot',async t=>{
  const {instrument}=await setup(t),p=createDefaultPreset();p.source='brr';
  const encoded=encodeBrr(Float32Array.from({length:64},(_,i)=>.6*Math.sin(i*Math.PI/8)));
  p.brr={name:'authored',data:encodeBase64(encoded.brr),rootNote:57,basePitch:2048,loopStartSamples:null};
  instrument.loadPreset(p);instrument.noteOn('brr',69);
  let state=instrument.read();assert.equal(state.registers[0][2]|state.registers[0][3]<<8,4096);
  assert(peak(render(instrument,128).left)>.001);render(instrument,1024);assert.equal(peak(render(instrument,128).left),0);
  assert.equal(instrument.read().voices.length,1,'held one-shot retains its keyboard owner');
  const before=instrument.generation;p.brr.rootNote=60;p.brr.basePitch=3072;instrument.setPreset(p);
  state=instrument.read();assert.equal(state.generation,before);assert.equal(state.voices[0].id,'brr');
  assert.equal(state.sample.rootNote,60);assert.equal(state.sample.basePitch,3072);
  assert.equal(state.registers[0][2]|state.registers[0][3]<<8,Math.round(3072*2**(9/12)));
});

test('invalid presets and notes preserve the existing sound before any reset or register edit',async t=>{
  const {instrument}=await setup(t);instrument.noteOn('held',60);render(instrument,256);const before=instrument.read();
  const invalid=structuredClone(before.preset);invalid.volume.left=128;
  assert.throws(()=>instrument.loadPreset(invalid));assert.deepEqual(instrument.read(),before);
  invalid.volume.left=16;invalid.wave[0]=NaN;assert.throws(()=>instrument.setPreset(invalid));assert.deepEqual(instrument.read(),before);
  assert.throws(()=>instrument.noteOn('held',61));assert.throws(()=>instrument.noteOn('new',128));assert.throws(()=>instrument.setPitch(Infinity));
  assert.deepEqual(instrument.read(),before);
  const empty=createDefaultPreset();empty.source='brr';instrument.loadPreset(empty);assert.throws(()=>instrument.noteOn('empty',60),/Load a BRR/);
});

test('native rendering matches raw SnesSynth register setup and remains chunk invariant',async t=>{
  const a=await setup(t),b=await setup(t),rawCore=await create(),raw=new SnesSynth({core:rawCore});t.after(()=>raw.dispose());
  const p=createDefaultPreset();p.envelope.mode='gain';p.envelope.gainLevel=100;p.volume={left:32,right:24};
  a.instrument.loadPreset(p);b.instrument.loadPreset(p);
  const encoded=encodeBrr(Float32Array.from(p.wave),{loopStartSamples:0});const sample=raw.loadBRR(encoded.brr,{baseFrequencyHz:250,loopStartSamples:0});
  const regs=envelopeRegisters(p);raw.setPreset(0,{sample,...regs,volumeLeft:32,volumeRight:24,pitch:Math.round(4096*440*2**((60-69)/12)/250)});
  raw.keyOn(0);a.instrument.noteOn('same',60);b.instrument.noteOn('same',60);
  const expected=render(a.instrument,4096),oracle=render(raw,4096),split={left:new Float32Array(4096),right:new Float32Array(4096)};
  assert.deepEqual(expected,oracle);
  for(let offset=0;offset<4096;offset+=17)b.instrument.renderInto(split.left,split.right,Math.min(17,4096-offset),offset);
  assert.deepEqual(split,expected);assert.deepEqual(b.instrument.read(),a.instrument.read());
});

test('decreasing GAIN acts on existing hardware envelope without synthetic key-on prefill',async t=>{
  const {instrument}=await setup(t),p=createDefaultPreset();p.envelope.mode='gain';p.envelope.gainMode='linear-decrease';p.envelope.gainRate=31;
  instrument.loadPreset(p);instrument.noteOn('fresh',60);assert.equal(peak(render(instrument,512).left),0);
  p.envelope.gainMode='direct';p.envelope.gainLevel=127;instrument.setPreset(p);assert(peak(render(instrument,512).left)>.001);
  p.envelope.gainMode='exponential-decrease';p.envelope.gainRate=31;instrument.setPreset(p);
  const envBefore=instrument.read().registers[0][8];render(instrument,512);const envAfter=instrument.read().registers[0][8];
  assert(envAfter<envBefore);assert.equal(instrument.read().voices[0].id,'fresh');
});
