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
function init(synth,slot=0){const {pcm,options}=createScspInitSample(),sample=synth.loadPCM(pcm,options);synth.setPreset(slot,{sample,frequencyHz:sample.rootFrequencyHz});return sample;}
const outside=(core,ram)=>[core.readRam(0,ram.address),core.readRam(ram.address+ram.byteLength)];
const gain=assembleScspDsp('000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0\n001: EWT=1 ZERO=1');

test('Delay reserves aligned RAM on demand without moving PCM or interrupting held dry voices',async t=>{
  const a=await create(t),b=await create(t),sample=init(a.synth),reference=init(b.synth);
  assert.equal(sample.address,0);assert.equal(a.synth.getState().ramUsedBytes,130);
  assert(!Object.hasOwn(a.synth.getState(),'dspRam'));assert(!Object.hasOwn(a.synth.getState(),'dsp'));
  a.synth.keyOn(0);b.synth.keyOn(0);assert.deepEqual(a.synth.generateStereo(19),b.synth.generateStereo(19));
  const ram={address:8192,byteLength:65536},before=outside(a.core,ram),frames=a.core.nativeFrames;
  const program=a.synth.setDspDelay({enabled:true,timeMs:20,feedback:.5});
  assert.equal(program.profile,'delay-ring');assert.deepEqual(program.ram,ram);
  assert.equal(a.core.nativeFrames,frames);assert.deepEqual(outside(a.core,ram),before);
  const state=a.synth.getState();assert.equal(state.samples.length,1);assert.equal(state.samples[0],sample);
  assert.equal(state.slots[0].sample,sample);assert(state.slots[0].gate);assert.deepEqual(state.dspRam,ram);
  assert.equal(state.ramUsedBytes,73728);assert.equal(state.ramFreeBytes,524288-73728);
  assert.deepEqual(a.synth.generateStereo(311),b.synth.generateStereo(311));
  assert.equal(reference.address,0);
  program.ram.address=0;state.dspRam.address=0;assert.equal(a.synth.getState().dspRam.address,8192);
});

test('ordinary and reusable editor PCM allocations cannot overwrite the reserved ring',async t=>{
  const {core,synth}=await create(t);init(synth);
  const oldEditor=synth._editPCM(3,new Int16Array(64).fill(1234),{rootNote:69,loopStartSamples:0});
  synth.setDspDelay({enabled:true});const {dspRam}=synth.getState(),ring=core.readRam(dspRam.address,dspRam.byteLength);
  const pcm=synth.loadPCM(new Int8Array(257).fill(15),{rootNote:69});
  assert(pcm.address>=dspRam.address+dspRam.byteLength);
  const reused=synth._editPCM(3,new Int16Array(64).fill(-1234),{rootNote:69,loopStartSamples:0});
  assert.equal(reused.address,oldEditor.address);assert(reused.address<dspRam.address);
  const large=synth._editPCM(4,new Int16Array(1024).fill(2345),{rootNote:69,loopStartSamples:0});
  assert(large.address>=dspRam.address+dspRam.byteLength);
  assert.deepEqual(core.readRam(dspRam.address,dspRam.byteLength),ring);
  assert.throws(()=>synth.setPreset(3,{sample:oldEditor}),/another bank|cleared/);
});

test('Stop retains Delay and reservation; reset keeps reservation until explicit clearRam',async t=>{
  const {core,synth}=await create(t),sample=init(synth);
  synth.setDspDelay({enabled:true,timeMs:20,feedback:.5});synth.setMix(0,{dspSend:7});synth.setDspReturn({level:7});
  synth.keyOn(0);synth.generateStereo(2048);const state=synth.getState(),used=state.ramUsedBytes;
  synth.stopVoices();assert.deepEqual(synth.getDspProgram(),state.dsp);assert.equal(synth.getState().ramUsedBytes,used);
  assert(synth.generateStereo(2048).left.every(v=>v===0));
  synth.reset();assert.equal(synth.getState().dsp,undefined);assert.deepEqual(synth.getState().dspRam,state.dspRam);
  assert.equal(synth.getState().ramUsedBytes,used);synth.setPreset(0,{sample});
  synth.setDspDelay({enabled:true,timeMs:30});assert.equal(synth.getState().ramUsedBytes,used);
  assert.deepEqual(synth.getState().dspRam,state.dspRam);
  synth.applyDspProgram(gain,{coefficients:{0:2048,1:0,2:0}});
  assert.equal(synth.getDspProgram().profile,'ram-free');assert.deepEqual(synth.getState().dspRam,state.dspRam);
  synth.setDspDelay({enabled:true});assert.equal(synth.getState().ramUsedBytes,used);
  synth.reset({clearRam:true});assert.equal(synth.getState().ramUsedBytes,0);assert.equal(synth.getState().dspRam,undefined);
  assert.throws(()=>synth.setPreset(0,{sample}),/another bank|cleared/);
  const next=init(synth);assert.equal(next.address,0);assert(next.id>sample.id);assert.equal(core.read(0x402),0);
});

test('insufficient aligned RAM and invalid settings keep the complete bank and current DSP',async t=>{
  const {core,synth}=await create(t);
  for(let i=0;i<4;i++)synth.loadPCM(new Int16Array(65535).fill(i+1),{rootNote:69});
  synth.applyDspProgram(gain,{coefficients:{0:2048,1:0,2:0}});synth.setDspReturn({level:7});
  const before=synth.getState(),ram=core.readRam();
  assert.throws(()=>synth.setDspDelay({enabled:true}),/64 KiB/);
  for(const patch of [{timeMs:19},{timeMs:700.5},{feedback:1},{enabled:1},{send:7},null])assert.throws(()=>synth.setDspDelay(patch));
  assert.deepEqual(synth.getState(),before);assert.deepEqual(core.readRam(),ram);
  assert.equal(core.read(0x402),0);
});

test('transport adoption retains a detached reservation and performs no RAM or register writes',async t=>{
  const {synth}=await create(t);init(synth);synth.setDspDelay({enabled:true,timeMs:31,feedback:.25});
  const calls=[],shadow=new ScspSynth({sampleRate:44100,reset(){},write(...args){calls.push(args);},loadRam(){calls.push('RAM');},readRam(_at,length){return new Uint8Array(length);},renderInto(){},dispose(){}});
  t.after(()=>shadow.dispose());calls.length=0;shadow._adoptState(synth.getState());
  assert.deepEqual(calls,[]);assert.deepEqual(shadow.getState(),synth.getState());
  const snapshot=shadow.getState();snapshot.dspRam.address=0;snapshot.dsp.ram.address=0;
  assert.equal(shadow.getState().dspRam.address,8192);assert.equal(shadow.getDspProgram().ram.address,8192);
  const bad=synth.getState();bad.dspRam.address+=8192;assert.throws(()=>shadow._adoptResources(bad),/reservation|allocated/);
  assert.deepEqual(shadow.getState(),synth.getState());
});

test('failed initial Delay installation does not consume or leak an allocator reservation',async t=>{
  const {core,synth}=await create(t);init(synth);const before=synth.getState(),ram=core.readRam();
  const write=core.write.bind(core);let armed=true;
  core.write=(address,...args)=>{write(address,...args);if(armed&&address===0x780){armed=false;throw new Error('Injected Delay address failure');}};
  assert.throws(()=>synth.setDspDelay({enabled:true}),/Injected Delay address failure/);
  assert.deepEqual(synth.getState(),before);assert.deepEqual(core.readRam(),ram);
  const sample=synth.loadPCM(new Int16Array([1,2]),{rootNote:69});assert.equal(sample.address,130);
  assert.equal(synth.setDspDelay({enabled:true}).ram.address,8192);
});

test('Delay reads user settings once before choosing RAM, preventing reentrant PCM overlap',async t=>{
  const {core,synth}=await create(t);init(synth);let calls=0,uploaded;
  const patch={get enabled(){calls++;uploaded=synth.loadPCM(new Int16Array(40000).fill(1234),{rootNote:69});return true;}};
  const program=synth.setDspDelay(patch);
  assert.equal(calls,1);assert.equal(uploaded.address,130);
  assert(program.ram.address>=uploaded.address+uploaded.byteLength);
  assert.equal(synth.getState().ramUsedBytes,program.ram.address+program.ram.byteLength);
  assert.deepEqual(core.readRam(uploaded.address,uploaded.byteLength).subarray(0,8),new Uint8Array([4,210,4,210,4,210,4,210]));
});
