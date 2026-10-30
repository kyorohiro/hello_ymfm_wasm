// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../docs/generated/scsp_wasm.js';
import {Scsp} from './scsp.js';
import {ScspSynth,scspPitch,createScspInitSample} from './scspsynth.js';
let module;
const moduleFactory=async()=>module??=await factory({wasmBinary:await readFile(new URL('../docs/generated/scsp_wasm.wasm',import.meta.url))});
async function create(t){const core=await Scsp.create({moduleFactory}),synth=new ScspSynth(core);t.after(()=>synth.dispose());return {core,synth};}
function init(synth,slot=0,extra={}) {const {pcm,options}=createScspInitSample(),sample=synth.loadPCM(pcm,options);synth.setPreset(slot,{sample,frequencyHz:44100/64,...extra});return {sample,pcm};}
const peak=a=>a.reduce((p,v)=>Math.max(p,Math.abs(v)),0);

test('pitch quantization covers signed octaves, rounding carry and rejected limits',()=>{
  assert.deepEqual(scspPitch(1),{word:0,ratio:1});assert.equal(scspPitch(2).word,0x800);
  assert.equal(scspPitch(.5).word,0x7800);assert.equal(scspPitch(1/256).word,0x4000);
  assert.equal(scspPitch(2047/8).word,0x3bff);assert.equal(scspPitch(1.9999).ratio,2);
  for(const v of [0,-1,NaN,Infinity,1/257,256])assert.throws(()=>scspPitch(v));
});

test('musical PCM16 API reproduces sine exactly, octave and live tuning',async t=>{
  const {synth,core}=await create(t),{pcm}=init(synth);synth.keyOn(0);
  const out=synth.generateStereo(128);
  for(let i=0;i<128;i++)assert.equal(out.left[i],pcm[i%64]/32768);
  assert.deepEqual(out.left,out.right);synth.stopVoices();synth.setFrequency(0,44100/32);synth.keyOn(0);
  const octave=synth.generateStereo(64).left;
  for(let i=0;i<64;i++)assert.equal(octave[i],pcm[(i*2)%64]/32768);
  synth.setNote(0,'A4');assert.equal(core.read(16),scspPitch(440/(44100/64)).word);
  synth.keyOff(0);assert(synth.generateStereo(4410).left.subarray(-128).every(v=>v===0));
});

test('signed PCM8, source rate, big-endian upload and immutable bank ownership',async t=>{
  const {synth,core}=await create(t),other=await create(t);
  const pcm=new Int8Array([-128,0,127,0]);const sample=synth.loadPCM(pcm,{rootNote:'A4',sourceSampleRate:22050,loopStartSamples:0});
  pcm.fill(0);assert.deepEqual(core.readRam(sample.address,5),new Uint8Array([128,0,127,0,128]));
  synth.setPreset(31,{sample,frequencyHz:880,pan:31});synth.keyOn(31);
  const out=synth.generateStereo(16);assert.equal(out.left[0],-1023/1024);assert.equal(out.left[2],127/128);assert(out.right.every(v=>v===0));
  assert.throws(()=>other.synth.setPreset(0,{sample}));assert.throws(()=>synth.setPreset(0,{sample:{...sample}}));
  const p16=synth.loadPCM(new Int16Array([-32768,32767]),{rootNote:69});
  assert.deepEqual(core.readRam(p16.address,6),new Uint8Array([128,0,127,255,127,255]));
  synth.reset();synth.setPreset(0,{sample});synth.reset({clearRam:true});assert.throws(()=>synth.setPreset(0,{sample}));
  const fresh=synth.loadPCM(new Int8Array([1,2]),{rootNote:69});assert(fresh.id>p16.id);
});

test('32 independent gates, addition/clipping, pan, live mix and immediate stop',async t=>{
  const {synth}=await create(t),{sample}=init(synth);
  for(let i=0;i<32;i++){synth.setPreset(i,{sample,frequencyHz:44100/64});synth.keyOn(i);}
  const sum=synth.generateStereo(128).left;assert(peak(sum)>.99);assert(sum.every(v=>Number.isFinite(v)&&Math.abs(v)<=1));
  synth.stopVoices();assert(synth.generateStereo(128).left.every(v=>v===0));
  synth.keyOn(0);synth.generateStereo(9);synth.keyOn(31);
  assert.equal(synth.getState().slots[0].gate,true);synth.keyOff(31);
  synth.generateStereo(4410);assert(peak(synth.generateStereo(128).left)>.24);
  synth.setMix(0,{pan:15});const panned=synth.generateStereo(128);assert(panned.left.every(v=>v===0));assert(peak(panned.right)>.24);
  synth.setMix(0,{directLevel:0});assert(synth.generateStereo(128).right.every(v=>v===0));
  synth.setMix(0,{directLevel:7});synth.allNotesOff();assert(synth.generateStereo(4410).right.subarray(-128).every(v=>v===0));
});

test('one shot ends, forward loop skips intro, infinite release is stopped without losing presets',async t=>{
  const {synth}=await create(t);
  const shot=synth.loadPCM(new Int16Array([1000,2000,3000,4000]),{rootNote:69});
  synth.setPreset(0,{sample:shot});synth.noteOn(0,'A4');assert(synth.generateStereo(128).left.subarray(10).every(v=>v===0));
  const loop=synth.loadPCM(new Int16Array([1000,2000,3000,4000]),{rootNote:69,loopStartSamples:2});
  synth.setPreset(0,{sample:loop});synth.setEnvelope(0,{releaseRate:0});synth.noteOn(0,69);
  const out=synth.generateStereo(8).left;assert.deepEqual([...out].map(v=>v*32768),[999,2000,3000,4000,3000,4000,3000,4000]);
  synth.noteOff(0);assert(peak(synth.generateStereo(4410).left)>0);synth.stopVoices();assert(synth.generateStereo(128).left.every(v=>v===0));
  assert.equal(synth.getState().slots[0].sample,loop);synth.keyOn(0);assert(peak(synth.generateStereo(128).left)>0);
});

test('bad options and RAM exhaustion are atomic; render partitioning and disposal',async t=>{
  const a=await create(t),b=await create(t);init(a.synth);init(b.synth);
  const state=a.synth.getState();
  for(const fn of [()=>a.synth.setPreset(0,{sample:state.samples[0],envelope:{attackRate:32}}),()=>a.synth.setPreset(32,{}),
    ()=>a.synth.loadPCM(new Float32Array(4),{rootNote:69}),()=>a.synth.loadPCM(new Int8Array(4),{rootNote:69,baseFrequencyHz:440}),
    ()=>a.synth.setPreset(0,{pan:32}),()=>a.synth.noteOn(0,'wat'),()=>a.synth.reset({clearRam:1}),()=>a.synth.setEnvelope(0,{oops:1})])assert.throws(fn);
  assert.deepEqual(a.synth.getState(),state);
  a.synth.keyOn(0);b.synth.keyOn(0);const expected=a.synth.generateStereo(1003),left=new Float32Array(1003),right=left.slice();
  b.synth.prepare(128);for(let at=0;at<1003;at+=7)b.synth.renderInto(left,right,Math.min(7,1003-at),at);
  assert.deepEqual(left,expected.left);assert.deepEqual(right,expected.right);
  const full=await create(t);for(let i=0;i<4;i++)full.synth.loadPCM(new Int16Array(65535),{rootNote:69});
  assert.equal(full.synth.getState().ramFreeBytes,0);assert.throws(()=>full.synth.loadPCM(new Int8Array([1,2]),{rootNote:69}));assert.equal(full.synth.getState().samples.length,4);
  a.synth.dispose();a.synth.dispose();assert.throws(()=>a.synth.keyOn(0),/disposed/);
});

test('triangle/drum fixtures and latched EG decay remain audible and then decay',async t=>{
  const {synth,core}=await create(t);
  const triangle=Int16Array.from({length:64},(_,i)=>Math.round(8192*(1-4*Math.abs(i/64-.5))));
  const sample=synth.loadPCM(triangle,{baseFrequencyHz:44100/64,loopStartSamples:0});
  synth.setPreset(0,{sample,frequencyHz:44100/64});synth.keyOn(0);
  const out=synth.generateStereo(128).left;
  for(let i=1;i<128;i++)assert.equal(out[i],triangle[i%64]/32768);
  synth.setEnvelope(0,{decay1Rate:31,decay2Rate:31,decayLevel:15});
  // Pending envelope edits do not alter the held voice.
  assert.equal(core.read(8),31);synth.keyOn(0);
  assert.equal(core.read(8),0xffff&((31<<11)|(31<<6)|31));assert.equal((core.read(10)>>5)&31,15);
  const decayed=synth.generateStereo(44100).left;assert(peak(decayed.subarray(0,64))>0);assert(peak(decayed.subarray(-128))<.001);
  const drum=Int16Array.from({length:4096},(_,i)=>Math.round(8192*Math.exp(-i/400)*Math.sin(2*Math.PI*i/64)));
  const shot=synth.loadPCM(drum,{baseFrequencyHz:44100/64});synth.setPreset(1,{sample:shot,frequencyHz:44100/64});synth.keyOn(1);
  const hit=synth.generateStereo(8192).left;assert(peak(hit.subarray(0,128))>.1);assert(hit.subarray(-128).every(v=>v===0));
});

test('pending sample edits do not mistune the currently held sample; unsafe short-loop steps reject atomically',async t=>{
  const {synth,core}=await create(t),{sample}=init(synth);synth.keyOn(0);
  const other=synth.loadPCM(new Int16Array(128),{baseFrequencyHz:44100/128,loopStartSamples:0});
  synth.setPreset(0,{sample:other});synth.setFrequency(0,44100/64);
  assert.equal(core.read(16),0);synth.keyOn(0);assert.equal(core.read(16),0x800);
  synth.setPreset(1,{sample,frequencyHz:44100/64});
  const tiny=synth.loadPCM(new Int8Array([1,2]),{rootNote:69,loopStartSamples:0}),before=synth.getState();
  assert.throws(()=>synth.setPreset(1,{sample:tiny,frequencyHz:440*4}),/loop length/);assert.deepEqual(synth.getState(),before);
});

test('global key execution preserves the phase of another held slot',async t=>{
  const {synth}=await create(t),{sample,pcm}=init(synth);
  synth.setPreset(31,{sample,frequencyHz:44100/64,pan:31});
  synth.keyOn(0);synth.generateStereo(9);synth.keyOn(31);
  const together=synth.generateStereo(17).right;
  for(let i=0;i<together.length;i++)assert.equal(together[i],pcm[(9+i)%64]/32768);
  synth.keyOff(31);const after=synth.generateStereo(17).right;
  for(let i=0;i<after.length;i++)assert.equal(after[i],pcm[(26+i)%64]/32768);
});

test('editor pool reuses idle pages, pins shared and released voices, and never overwrites ordinary samples',async t=>{
 const {synth,core}=await create(t),{sample:ordinary,pcm}=init(synth);synth.setPreset(1,{sample:ordinary});
 const options={baseFrequencyHz:44100/64,loopStartSamples:0},a=synth._editPCM(0,pcm,options),used=synth.getState().ramUsedBytes;
 for(let i=0;i<100;i++){synth._editPCM(0,pcm.map(v=>v>>1),options);assert.equal(synth.getState().ramUsedBytes,used);}
 assert.throws(()=>synth._resolveSample(a),/another bank/);assert.deepEqual(core.readRam(ordinary.address,ordinary.byteLength),Uint8Array.from([...pcm,pcm[0]].flatMap(v=>[v>>8&255,v&255])));
 const current=synth.getState().slots[0].sample;synth.setPreset(1,{sample:current});
 const sharedBytes=core.readRam(current.address,current.byteLength);const next=synth._editPCM(0,pcm,options);assert.notEqual(next.address,current.address);assert.deepEqual(core.readRam(current.address,current.byteLength),sharedBytes);
 synth.keyOn(0);synth.keyOff(0);const releasing=core.readRam(next.address,next.byteLength);const later=synth._editPCM(0,pcm,options);assert.notEqual(later.address,next.address);assert.deepEqual(core.readRam(next.address,next.byteLength),releasing);
 synth.stopVoices();const before=synth.getState().ramUsedBytes;for(let i=0;i<100;i++)synth._editPCM(0,pcm,options);assert.equal(synth.getState().ramUsedBytes,before);
 const state=synth.getState();assert.throws(()=>synth._editPCM(0,pcm,{...options,baseFrequencyHz:0}));assert.deepEqual(synth.getState(),state);
 synth.reset({clearRam:true});assert.equal(synth.getState().ramUsedBytes,0);assert.equal(synth._editPCM(0,pcm,options).address,0);
});

test('protected full editor RAM fails atomically and Stop permits reuse without clearing the bank',async t=>{
 const {synth,core}=await create(t);init(synth);
 const pcm=new Int16Array(65535).fill(1000),options={rootNote:69};
 const a=synth._editPCM(0,pcm,options);synth.setPreset(1,{sample:a});
 const b=synth._editPCM(0,pcm,options);synth.setPreset(2,{sample:b});
 const c=synth._editPCM(0,pcm,options);synth.keyOn(0);
 const before=synth.getState(),bytes=core.readRam(0,524288);
 assert.throws(()=>synth._editPCM(0,pcm,options),/RAM is full or protected/);assert.deepEqual(synth.getState(),before);assert.deepEqual(core.readRam(0,524288),bytes);
 synth.stopVoices();const reused=synth._editPCM(0,pcm,options);assert.equal(reused.address,c.address);assert.equal(synth.getState().ramUsedBytes,before.ramUsedBytes);assert.equal(synth.getState().slots[1].sample.id,a.id);
});
