// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../../docs/generated/scsp_wasm.js';
import {Scsp} from '../../tetorica_src/runtime/scsp.js';
import {ScspSynth,createScspInitSample} from '../../tetorica_src/runtime/scspsynth.js';
import {assembleScspDsp} from '../../tetorica_src/runtime/scsp_dsp_assembler.js';

let module;
const create=async t=>{
  module??=factory({wasmBinary:await readFile(new URL('../../docs/generated/scsp_wasm.wasm',import.meta.url))});
  const core=await Scsp.create({moduleFactory:()=>module}),synth=new ScspSynth(core);
  t.after(()=>synth.dispose());return{core,synth};
};
const iir=assembleScspDsp(`
000: TRA=1 YSEL=1 ZERO=1 COEF=1
001: XSEL=1 YSEL=1 IRA=32 BSEL=1 COEF=2
002: TWT=1 EWT=1 ZERO=1
`);
const gain=assembleScspDsp(`
000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0
001: EWT=1 ZERO=1
`);
const coefficients={0:0,1:3840,2:256};
function sample(synth,pcm,slot=0){
  const handle=synth.loadPCM(pcm,{baseFrequencyHz:44100/pcm.length,loopStartSamples:0});
  synth.setPreset(slot,{sample:handle,frequencyHz:handle.rootFrequencyHz,directLevel:0,dspSend:7});return handle;
}
const reference=(pcm,a,b,state=0)=>{
  const result=Float32Array.from(pcm,value=>{
    state=Math.max(-0x800000,Math.min(0x7fffff,Math.floor(state*a/4096)+Math.floor(value*256*b/4096)));
    return Math.floor(state/256)/32768;
  });return{result,state};
};

test('public DSP IIR processes an existing address-zero PCM without allocating or changing RAM',async t=>{
  const {core,synth}=await create(t),pcm=new Int16Array(2048);pcm[1]=16384;
  const handle=sample(synth,pcm),ram=core.readRam(),used=synth.getState().ramUsedBytes;
  assert.equal(handle.address,0);assert.equal(synth.getState().dsp,undefined);
  synth.applyDspProgram(iir,{coefficients});synth.setDspReturn({level:7});synth.keyOn(0);
  // Unit advance and direct source delivery make this an integer stimulus.
  core.write(12,0x100,0x100);
  const output=synth.generateStereo(512),expected=reference(pcm.subarray(0,512),3840,256).result;
  assert.deepEqual(output.left,expected);assert.deepEqual(output.right,expected);
  assert.deepEqual(core.readRam(),ram);assert.equal(synth.getState().ramUsedBytes,used);
  assert.equal(core.read(0x402),0,'no reserved DSP ring');
});

test('live coefficients retain the IIR state and gate without restarting the sample',async t=>{
  const {core,synth}=await create(t),pcm=new Int16Array(2048);pcm[1]=16384;sample(synth,pcm);
  synth.applyDspProgram(iir,{coefficients});synth.setDspReturn({level:7});synth.keyOn(0);core.write(12,0x100,0x100);
  const before=reference(pcm.subarray(0,16),3840,256);
  assert.deepEqual(synth.generateStereo(16).left,before.result);
  const revision=synth.getDspProgram().revision;
  synth.setDspCoefficients({1:3072,2:1024});
  const after=reference(pcm.subarray(16,80),3072,1024,before.state);
  assert.deepEqual(synth.generateStereo(64).left,after.result);
  assert.equal(synth.getDspProgram().revision,revision);assert(synth.getState().slots[0].gate);
});

test('keyOn and live direct mix preserve the shared EFREG0 return and next-note DSP send',async t=>{
  const {core,synth}=await create(t),{pcm}=createScspInitSample();sample(synth,pcm);
  synth.applyDspProgram(gain,{coefficients:{0:4095,1:0,2:0}});synth.setDspReturn({level:7,pan:31});
  const low=(7<<5)|31;
  synth.keyOn(0);assert.equal(core.read(22)&255,low);assert.equal(core.read(20),7);
  let output=synth.generateStereo(64);assert(output.left.some(v=>v!==0));assert(output.right.every(v=>v===0));
  synth.setMix(0,{pan:15,totalLevel:12});assert.equal(core.read(22)&255,low);
  synth.keyOn(0);assert.equal(core.read(22)&255,low);assert.equal(core.read(20),7);
  synth.setMix(0,{dspSend:0});assert.equal(core.read(20),0);assert.equal(synth.getState().slots[0].dspSend,0);
});

test('Stop retains DSP setup and clears history; reset clears setup while keeping the sample bank',async t=>{
  const {core,synth}=await create(t),pcm=new Int16Array(512);pcm[1]=16384;const handle=sample(synth,pcm);
  synth.applyDspProgram(iir,{coefficients});synth.setDspReturn({level:7});synth.keyOn(0);core.write(12,0x100,0x100);
  const first=synth.generateStereo(32).left,setup=synth.getDspProgram();
  synth.stopVoices();assert.deepEqual(synth.getDspProgram(),setup);assert(synth.generateStereo(32).left.every(v=>v===0));
  synth.keyOn(0);core.write(12,0x100,0x100);assert.deepEqual(synth.generateStereo(32).left,first);
  synth.reset();assert.equal(synth.getState().dsp,undefined);assert.equal(synth.getState().samples[0],handle);
  assert.equal(core.read(22)&255,0);assert(synth.getDspProgram().words.every(v=>v===0));
});

test('invalid DSP and send settings leave the entire untouched instrument state and PCM unchanged',async t=>{
  const {core,synth}=await create(t),{pcm,options}=createScspInitSample(),handle=synth.loadPCM(pcm,options);
  synth.setPreset(0,{sample:handle});const state=synth.getState(),ram=core.readRam();
  const invalid=assembleScspDsp('001: MRD=1');
  for(const invoke of [()=>synth.applyDspProgram(invalid),()=>synth.applyDspProgram(iir,{coefficients:{1:3840}}),
    ()=>synth.setDspCoefficients({2:4096}),()=>synth.setDspReturn({level:8}),
    ()=>synth.setMix(0,{dspSend:7,totalLevel:256}),()=>synth.setPreset(0,{dspSend:-1})])assert.throws(invoke);
  assert.deepEqual(synth.getState(),state);assert.deepEqual(core.readRam(),ram);assert.equal(core.read(22)&255,0);
});

test('transport snapshots copy DSP configuration without writing a receiving core',async t=>{
  const {synth}=await create(t),{pcm}=createScspInitSample();sample(synth,pcm);synth.applyDspProgram(iir,{coefficients});synth.setDspReturn({level:6,pan:15});
  const writes=[];const shadow=new ScspSynth({sampleRate:44100,reset(){},write(...args){writes.push(args)},loadRam(){},renderInto(){},dispose(){}});
  t.after(()=>shadow.dispose());writes.length=0;shadow._adoptState(synth.getState());
  assert.equal(writes.length,0);assert.deepEqual(shadow.getDspProgram(),synth.getDspProgram());
  const copy=shadow.getDspProgram();copy.words.fill(65535);copy.coefficients.codes.fill(-1);copy.return.level=0;
  assert.deepEqual(shadow.getDspProgram(),synth.getDspProgram());
});
