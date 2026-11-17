// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../../docs/generated/scsp_wasm.js';
import {Scsp} from '../../tetorica_src/runtime/scsp.js';
import {ScspSynth,createScspInitSample} from '../../tetorica_src/runtime/scspsynth.js';
import {assembleScspDsp} from '../../tetorica_src/runtime/scsp_dsp_assembler.js';

const binary=await readFile(new URL('../../docs/generated/scsp_wasm.wasm',import.meta.url));
let module;
async function create(t){module??=factory({wasmBinary:binary});const core=await Scsp.create({moduleFactory:()=>module}),synth=new ScspSynth(core);t.after(()=>synth.dispose());return {core,synth};}
const routing=assembleScspDsp(`000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0
001: EWT=1 EWA=0 ZERO=1
002: TRA=1 XSEL=0 YSEL=1 ZERO=1 COEF=1
003: XSEL=1 YSEL=1 IRA=33 BSEL=1 COEF=2
004: TWT=1 TWA=0 EWT=1 EWA=1 ZERO=1`);
const peak=values=>values.reduce((max,value)=>Math.max(max,Math.abs(value)),0);
function load(synth,pcm,slot,input=0){const sample=synth.loadPCM(pcm,{baseFrequencyHz:44100/pcm.length,loopStartSamples:0});synth.setPreset(slot,{sample,frequencyHz:sample.rootFrequencyHz,directLevel:0,dspSend:7,dspInput:input});return sample;}
function iir(pcm,a=3072,b=1024,initial=0){let state=initial;const out=Float32Array.from(pcm,value=>{state=Math.max(-0x800000,Math.min(0x7fffff,Math.floor(state*a/4096)+Math.floor(value*256*b/4096)));return Math.floor(state/256)/32768;});return {out,state};}

test('legacy defaults stay field-compatible and input selection is next-keyOn or explicitly live',async t=>{
  const {core,synth}=await create(t),{pcm,options}=createScspInitSample();
  assert(synth.getState().slots.every(slot=>!Object.hasOwn(slot,'dspInput')));
  const sample=synth.loadPCM(pcm,options);synth.setPreset(2,{sample,dspSend:6,dspInput:1});
  assert.equal(core.read(2*32+20),0);
  core.write(2*32+20,0xab80);synth.keyOn(2);assert.equal(core.read(2*32+20),0xab8e);
  const state=synth.getState(),frames=core.nativeFrames,pitch=core.read(2*32+16),gate=core.read(2*32);
  synth.setMix(2,{dspInput:0});assert.equal(core.read(2*32+20),0xab86);
  assert.equal(core.nativeFrames,frames);assert.equal(core.read(2*32),gate);assert.equal(core.read(2*32+16),pitch);
  assert(synth.getState().slots[2].gate);assert.equal(synth.getState().slots[2].sample,state.slots[2].sample);
  synth.setMix(2,{dspSend:2});assert.equal(core.read(2*32+20),0xab82);
  synth.setPreset(2,{dspInput:1});assert.equal(core.read(2*32+20),0xab82);
  synth.keyOn(2);assert.equal(core.read(2*32+20),0xab8a);
});

test('two inputs and stereo returns produce independent Gain / IIR and preserve held routing edits',async t=>{
  const {core,synth}=await create(t);
  const pcmA=Int16Array.from({length:1024},(_,i)=>i?((i*191)%8192)-4096:0);
  const pcmB=Int16Array.from({length:1024},(_,i)=>i?((i*317)%8192)-4096:0);
  const left=load(synth,pcmA,0,0),right=load(synth,pcmB,1,1);
  synth.applyDspProgram(routing,{coefficients:{0:2048,1:3072,2:1024}});
  synth.setDspReturn(0,{level:7,pan:31});synth.setDspReturn(1,{level:7,pan:15});
  synth.keyOn(0);synth.keyOn(1);core.write(12,0x100,0x100);core.write(44,0x100,0x100);
  const ram=core.readRam(),first=synth.generateStereo(137),reference=iir(pcmB.slice(0,137));
  assert.deepEqual(first.left,Float32Array.from(pcmA.slice(0,137),v=>Math.floor(v/2)/32768));
  assert.deepEqual(first.right,reference.out);
  const frames=core.nativeFrames,returnWords=[core.read(22),core.read(54)];
  synth.setMix(0,{dspInput:1});assert.equal(core.nativeFrames,frames);
  assert.deepEqual([core.read(22),core.read(54)],returnWords);
  assert.equal(synth.getState().slots[0].sample,left);assert.equal(synth.getState().slots[1].sample,right);
  assert(synth.getState().slots[0].gate&&synth.getState().slots[1].gate);
  const mixed=Int16Array.from(pcmA.slice(137,393),(value,index)=>value+pcmB[137+index]);
  const second=synth.generateStereo(256);assert(second.left.every(value=>value===0));
  assert.deepEqual(second.right,iir(mixed,3072,1024,reference.state).out);
  assert.deepEqual(core.readRam(),ram);
});

test('return edits and retriggers preserve direct mix, the other return and legacy alias',async t=>{
  const {core,synth}=await create(t),pcm=new Int16Array(64).fill(4096);
  load(synth,pcm,0);load(synth,pcm,1,1);synth.applyDspProgram(routing,{coefficients:{0:2048,1:0,2:4095}});
  synth.setMix(0,{directLevel:5,pan:3});synth.setMix(1,{directLevel:6,pan:18});
  synth.setDspReturn(0,{level:7,pan:31});synth.setDspReturn(1,{level:6,pan:15});
  const direct=[core.read(22)&0xff00,core.read(54)&0xff00];
  synth.keyOn(0);synth.keyOn(1);assert.equal(core.read(22)&255,(7<<5)|31);assert.equal(core.read(54)&255,(6<<5)|15);
  synth.setDspReturn(1,{pan:0});assert.deepEqual([core.read(22)&0xff00,core.read(54)&0xff00],direct);
  assert.deepEqual(synth.getDspProgram().return,{level:7,pan:31});
  synth.setDspReturn({pan:15});const snapshot=synth.getDspProgram();
  assert.deepEqual(snapshot.returns,[{level:7,pan:15},{level:6,pan:0}]);assert.deepEqual(snapshot.return,snapshot.returns[0]);
  snapshot.returns[1].level=0;snapshot.return.pan=0;assert.equal(synth.getDspProgram().returns[1].level,6);
  assert.equal(synth.getDspProgram().return.pan,15);
});

test('invalid routes and indexed returns leave complete DSP state, registers and PCM intact',async t=>{
  const {core,synth}=await create(t);load(synth,new Int16Array(64).fill(4096),0);synth.applyDspProgram(routing);
  synth.setDspReturn(1,{level:7});const before=synth.getState(),ram=core.readRam(),registers=[core.read(20),core.read(22),core.read(54)];
  for(const dspInput of [-1,2,.5,null,undefined,true]){
    assert.throws(()=>synth.setPreset(0,{dspInput}));assert.throws(()=>synth.setMix(0,{dspInput}));
  }
  for(const fn of [()=>synth.setDspReturn(2,{level:7}),()=>synth.setDspReturn(-1,{level:7}),()=>synth.setDspReturn(1,{level:8}),()=>synth.setDspReturn(1,{pan:32}),()=>synth.setDspReturn(1,{bad:0}),()=>synth.setDspReturn(0)])assert.throws(fn);
  assert.deepEqual(synth.getState(),before);assert.deepEqual(core.readRam(),ram);assert.deepEqual([core.read(20),core.read(22),core.read(54)],registers);
});

test('Stop restores both returns, reset clears routes, and trusted snapshots adopt without core writes',async t=>{
  const {core,synth}=await create(t),pcm=new Int16Array(64).fill(4096),sample=load(synth,pcm,0,1);
  synth.applyDspProgram(routing,{coefficients:{0:2048,1:3072,2:1024}});
  synth.setDspReturn(0,{level:7,pan:31});synth.setDspReturn(1,{level:6,pan:15});synth.keyOn(0);
  assert(peak(synth.generateStereo(128).right)>0);const setup=synth.getDspProgram();
  synth.stopVoices();assert.deepEqual(synth.getDspProgram(),setup);assert.equal(core.read(54)&255,(6<<5)|15);
  assert(synth.generateStereo(128).left.every(value=>value===0));assert(synth.generateStereo(128).right.every(value=>value===0));
  const writes=[],shadow=new ScspSynth({sampleRate:44100,reset(){},write(...args){writes.push(args);},loadRam(){},renderInto(){},dispose(){}});t.after(()=>shadow.dispose());writes.length=0;
  shadow._adoptState(synth.getState());assert.deepEqual(shadow.getState(),synth.getState());assert.deepEqual(writes,[]);
  synth.reset();assert.equal(synth.getState().dsp,undefined);assert(!Object.hasOwn(synth.getState().slots[0],'dspInput'));
  assert.equal(core.read(54),0);synth.setPreset(0,{sample});assert(!Object.hasOwn(synth.getDspProgram(),'returns'));
});

test('live routing patches do not commit another field waiting for the next keyOn',async t=>{
  const {core,synth}=await create(t),{pcm,options}=createScspInitSample(),sample=synth.loadPCM(pcm,options);
  synth.setPreset(0,{sample,dspSend:2});synth.keyOn(0);
  synth.setPreset(0,{dspInput:1});synth.setMix(0,{dspSend:5});
  assert.equal(core.read(20)&0x7f,5,'Send-only edit keeps actual input0');
  assert.equal(synth.getState().slots[0].dspInput,1,'Input1 remains authored for next keyOn');
  synth.keyOn(0);assert.equal(core.read(20)&0x7f,13);
  synth.setPreset(0,{dspSend:7});synth.setMix(0,{dspInput:0});
  assert.equal(core.read(20)&0x7f,5,'Input-only edit keeps actual send5');
  synth.keyOn(0);assert.equal(core.read(20)&0x7f,7);
  synth.reset();synth.setPreset(0,{sample,dspSend:7});synth.setMix(0,{dspInput:1});
  assert.equal(core.read(20)&0x7f,8);assert.equal(synth.getState().dsp,undefined,'Input-only edit cannot start a pending send');
});
