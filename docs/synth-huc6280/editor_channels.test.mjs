// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {Huc6280Instrument} from './instrument.js';
import {waveShape} from './preset.js';
import {encodeDdaData} from './dda_pcm.js';

const wasmBinary=await readFile(new URL('../generated/huc6280_wasm.wasm',import.meta.url));
async function setup(t){const core=await Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:48000});const i=new Huc6280Instrument(core);t.after(()=>i.dispose());return i;}
const period=(state,ch)=>(state.registers[ch][2]|(state.registers[ch][3]&15)<<8)||4096;
const edit=(i,channel,changes)=>i.applyEditorEdit({channel,changes});
const peak=pcm=>Math.max(...pcm.left.map(Math.abs),...pcm.right.map(Math.abs));

test('normal physical channels keep independent wave/level/pan and the common instrument across Stop',async t=>{
  const i=await setup(t),common=i.read().preset;
  edit(i,1,{wave:waveShape('square'),volume:13,'pan.left':3,'envelope.enabled':false});
  edit(i,3,{wave:waveShape('triangle'),volume:22,'pan.right':2,'envelope.enabled':false});
  const before=i.observeEditor();assert.equal(i.observeCode(),null);assert.deepEqual(i.read().preset,common);
  i.noteOn('one',60,1);i.noteOn('three',67,3);assert(peak(i.generateStereo(2048))>.001);
  assert.equal(i.observeEditor().registers[1][4]&31,13);assert.equal(i.observeEditor().registers[3][4]&31,22);
  i.stop();const after=i.observeEditor();
  for(const ch of [1,3]){assert.deepEqual(after.waveforms[ch],before.waveforms[ch]);assert.equal(after.registers[ch][5],before.registers[ch][5]);assert.equal(after.registers[ch][4]&31,before.registers[ch][4]&31);}
  i.noteOn('again',64,1);assert.equal(i.observeEditor().registers[1][4]&31,13);assert.deepEqual(i.read().preset,common);
});

test('common scalar edits broadcast only touched fields while explicit preset load resets the bank',async t=>{
  const i=await setup(t),common=i.read().preset;
  edit(i,2,{wave:waveShape('saw'),'pan.left':1,volume:9});edit(i,4,{wave:waveShape('square'),'pan.right':2,volume:19});
  common.volume=17;i.setPreset(common);const state=i.observeEditor();
  assert.equal(state.registers[2][4]&31,17);assert.equal(state.registers[4][4]&31,17);
  assert.deepEqual(state.waveforms[2],waveShape('saw'));assert.deepEqual(state.waveforms[4],waveShape('square'));
  assert.equal(state.registers[2][5]>>4,1);assert.equal(state.registers[4][5]&15,2);
  i.loadPreset(common);const reset=i.observeEditor();for(let ch=0;ch<6;ch++){assert.deepEqual(reset.waveforms[ch],common.wave);assert.equal(reset.registers[ch][5],255);}
});

test('per-channel software envelope applies to the next notes as well as an existing owner',async t=>{
  const i=await setup(t);edit(i,0,{'envelope.enabled':true,'envelope.attack':0,'envelope.release':.1});edit(i,2,{'envelope.enabled':false});
  assert.equal(i.observeEditor().envelopes[0].release,.1);assert.equal(i.observeEditor().envelopes[2].enabled,false);
  i.noteOn('tail',60,0);i.noteOn('gate',67,2);i.generateStereo(128);i.noteOff('tail');i.noteOff('gate');
  assert.equal(i.observeEditor().registers[0][4]&128,128);assert.equal(i.observeEditor().registers[2][4]&128,0);
  i.generateStereo(5000);assert.equal(i.observeEditor().registers[0][4]&128,0);
  i.noteOn('next',60,0);assert.equal(i.slots[0].envelope.release,.1);
});

test('shared sample bytes support independent normal DDA timing and mixed Wave rendering without Code',async t=>{
  const i=await setup(t),common=i.read().preset;
  common.dda={...common.dda,data:encodeDdaData(Uint8Array.from({length:128},(_,n)=>n%32)),sampleRate:12000,rootNote:60,loop:true};i.loadPreset(common);
  edit(i,1,{source:'dda','dda.sampleRate':6000,'dda.rootNote':60,'dda.speed':2,'dda.loop':true,'envelope.enabled':false,'pan.right':0});
  edit(i,2,{source:'wave',wave:waveShape('square'),'envelope.enabled':false,'pan.left':0});
  i.noteOn('pcm',60,1);i.noteOn('wave',69,2);i.generateStereo(111);const position=i.slots[1].position;
  assert(Math.abs(position-27.75)<1e-9);assert.equal(i.slots[1].ddaSettings.sampleRate,6000);
  edit(i,1,{'dda.speed':1});assert.equal(i.slots[1].position,position);assert.equal(i.slots[1].step,.125);
  const pcm=i.generateStereo(512);assert(pcm.left.every(Number.isFinite));assert(pcm.right.every(Number.isFinite));assert.notDeepEqual(pcm.left,pcm.right);
  i.stop();i.noteOn('next',60,1);assert.equal(i.slots[1].ddaSettings.sampleRate,6000);assert.equal(i.slots[1].ddaSettings.speed,1);
  const snapshot=i.observeEditor();assert.equal(snapshot.ddaVoices[1].sampleRate,6000);assert(!JSON.stringify(snapshot).includes(common.dda.data));assert.deepEqual(i.read().preset,common);
});

test('normal Noise and shared hardware LFO edits respect the physical channel constraints atomically',async t=>{
  const i=await setup(t),before=i.observeEditor();
  assert.throws(()=>edit(i,0,{source:'noise'}),/CH5 and CH6/);assert.deepEqual(i.observeEditor(),before);
  edit(i,0,{'lfo.wave':waveShape('triangle'),'lfo.enabled':true,'lfo.mode':'recorded','lfo.carrierPeriod':700,'lfo.modulatorPeriod':913});
  edit(i,4,{source:'noise','noise.frequency':23});assert.equal(i.observeEditor().globals[9]&3,1,'Noise CH5 does not switch off the shared CH1 LFO');
  assert.throws(()=>i.noteOn('reserved',60,1),/reserves CH2/);i.noteOn('carrier',60,0);
  assert.equal(period(i.observeEditor(),0),700);assert.equal(period(i.observeEditor(),1),913);assert.deepEqual(i.observeEditor().waveforms[1],waveShape('triangle'));
  const prior=i.observeEditor();assert.throws(()=>edit(i,1,{source:'dda'}),/modulator/);assert.deepEqual(i.observeEditor(),prior);
});

test('normal observation is bounded, has idle configuration, and Code intentionally starts/restores the common sound',async t=>{
  const i=await setup(t),common=i.read().preset;edit(i,2,{wave:waveShape('square'),volume:7,'envelope.release':.4});
  const state=i.observeEditor();assert.equal(state.observation.kind,'editor');assert.equal(state.envelopes.length,6);assert.equal(state.envelopes[2].release,.4);assert.equal(Object.hasOwn(state.dda,'data'),false);
  const {session}=i.beginCode();assert.equal(i.observeEditor(),null);assert.deepEqual(i.observeCode().waveforms[2],common.wave);
  assert.throws(()=>edit(i,2,{volume:8}),{name:'AbortError'});i.code(session,'noteOn',[2,'C4']);i.stop();
  assert.deepEqual(i.observeEditor().waveforms[2],common.wave);assert.equal(i.observeEditor().registers[2][4]&31,common.volume);assert.deepEqual(i.read().preset,common);
  assert.throws(()=>edit(i,2,{'dda.data':'EBES'}),/Synth view/);
});
