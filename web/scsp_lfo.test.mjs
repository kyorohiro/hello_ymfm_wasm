// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import factory from '../docs/generated/scsp_wasm.js';import {Scsp} from './scsp.js';
import {ScspSynth,createScspInitSample,SCSP_LFO_FREQUENCIES_HZ} from './scspsynth.js';
const wasmBinary=await readFile(new URL('../docs/generated/scsp_wasm.wasm',import.meta.url));let module;
async function create(t,constant=false){const core=await Scsp.create({moduleFactory:async()=>module??=await factory({wasmBinary})}),synth=new ScspSynth(core);t.after(()=>synth.dispose());const source=constant?{pcm:new Int16Array([8192,8192]),options:{rootNote:69,loopStartSamples:0}}:createScspInitSample();const sample=synth.loadPCM(source.pcm,source.options);synth.setPreset(0,{sample,frequencyHz:constant?440:44100/64});return {core,synth,sample};}
const span=a=>{let lo=1,hi=-1;for(const x of a){lo=Math.min(lo,x);hi=Math.max(hi,x);}return hi-lo;};
test('all 32 LFO rates move at the nominal frequency, including the formerly stalled slow range',async t=>{
 const {synth}=await create(t,true);
 for(const [frequencyCode,hz]of SCSP_LFO_FREQUENCIES_HZ.entries()){
  synth.stopVoices();synth.setLfo(0,{frequencyCode,amplitudeDepth:7,amplitudeWave:0,reset:true});synth.keyOn(0);synth.setLfo(0,{reset:false});synth.generateStereo(128);
  const out=synth.generateStereo(Math.ceil(44100*3.2/hz)).left,wraps=[];
  for(let i=1;i<out.length;i++)if(out[i-1]-out[i]>.1)wraps.push(i);
  assert(wraps.length>=3,`code ${frequencyCode}: ${wraps.length} wraps`);
  const measured=44100/(wraps[2]-wraps[1]);assert(Math.abs(measured/hz-1)<.015,`${frequencyCode}: ${measured} vs ${hz}`);
 }
});
test('LFORE freezes both oscillators, clear resumes without retrigger, partial writes preserve phase settings',async t=>{
 const {core,synth}=await create(t,true);synth.setLfo(0,{frequencyCode:16,amplitudeDepth:7,pitchDepth:4,pitchWave:2,amplitudeWave:0});synth.keyOn(0);synth.generateStereo(1000);
 synth.setLfo(0,{reset:true});assert.equal(core.read(18)&0x8000,0x8000);const frozen=synth.generateStereo(44100).left;assert.equal(span(frozen),0);
 synth.setLfo(0,{reset:false});assert(span(synth.generateStereo(44100).left)>.2);assert.equal(synth.getState().slots[0].lfo.pitchWave,2);assert.equal(synth.getState().slots[0].gate,true);
});
test('all pitch/amplitude waveforms are deterministic, partition-invariant, audible and depth-zero preserves legacy PCM',async t=>{
 const a=await create(t),b=await create(t);
 for(let wave=0;wave<4;wave++)for(const mode of ['pitchDepth','amplitudeDepth']){
  for(const {synth}of [a,b]){synth.stopVoices();synth.setLfo(0,{frequencyCode:20,pitchWave:wave,amplitudeWave:wave,pitchDepth:0,amplitudeDepth:0,[mode]:7});synth.keyOn(0);}
  const whole=a.synth.generateStereo(20000).left,parts=new Float32Array(20000),right=new Float32Array(20000);for(let i=0;i<20000;i+=37)b.synth.renderInto(parts,right,Math.min(37,20000-i),i);
  assert.deepEqual(whole,parts);assert(span(whole)>.01);
 }
 for(const {synth}of [a,b]){synth.stopVoices();synth.setLfo(0,{pitchDepth:0,amplitudeDepth:0});synth.keyOn(0);}
 const base=a.synth.generateStereo(4096);b.synth.setLfo(0,{frequencyCode:31,pitchWave:3,amplitudeWave:3});assert.deepEqual(base,b.synth.generateStereo(4096));
});
test('invalid settings and LFO loop overrun fail atomically; pending settings do not replace live settings',async t=>{
 const {core,synth,sample}=await create(t);synth.keyOn(0);const before=synth.getState();
 for(const bad of [{frequencyCode:32},{pitchWave:4},{pitchDepth:-1},{amplitudeDepth:8},{reset:1},{unknown:0}]){assert.throws(()=>synth.setLfo(0,bad));assert.deepEqual(synth.getState(),before);}
 synth.setPreset(0,{lfo:{pitchWave:2,frequencyCode:20}});assert.equal(core.read(18),0);synth.setLfo(0,{amplitudeDepth:3});assert.equal(core.read(18),3);assert.equal(synth.getState().slots[0].lfo.pitchWave,2);
 const snapshot=synth.getState();snapshot.slots[0].lfo.pitchDepth=7;assert.equal(synth.getState().slots[0].lfo.pitchDepth,0);
 const tiny=synth.loadPCM(new Int16Array([1,2]),{rootNote:69,loopStartSamples:0});synth.setPreset(1,{sample:tiny,frequencyHz:880});synth.keyOn(1);const saved=core.read(50);assert.throws(()=>synth.setLfo(1,{pitchDepth:7}),/loop/);assert.equal(core.read(50),saved);
 synth.setPreset(1,{sample,frequencyHz:440});assert.throws(()=>synth.setLfo(1,{pitchDepth:7}),/loop/); // held short loop remains protected
});
