// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../js/scsp.js';
import {SynthInstrument} from './instrument.js';
import {assembleScspDsp} from './dsp_assembler.js';
import {delayProgram} from './dsp.js';

const binary=await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url));
let module;
async function create(t){module??=factory({wasmBinary:binary});const core=await Scsp.create({moduleFactory:()=>module}),owner=new SynthInstrument(core);t.after(()=>owner.dispose());return owner;}
const program=assembleScspDsp(`
000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0
001: EWT=1 EWA=0 ZERO=1
002: TRA=1 XSEL=0 YSEL=1 ZERO=1 COEF=1
003: XSEL=1 YSEL=1 IRA=33 BSEL=1 COEF=2
004: TWT=1 TWA=0 EWT=1 EWA=1 ZERO=1
`);
const mpro=core=>Array.from({length:512},(_,index)=>core.read(0x800+index*2));
function iir(pcm,state=0){const values=Float32Array.from(pcm,sample=>{state=Math.max(-8388608,Math.min(8388607,Math.floor(state*3072/4096)+sample*64));return Math.floor(state/256)/32768;});return {values,state};}
async function stereo(t){
  const owner=await create(t),a=Int16Array.from({length:1024},(_,i)=>i?((i*191)%8192)-4096:0),b=Int16Array.from({length:1024},(_,i)=>i?((i*317)%8192)-4096:0);
  owner.applyDspProgram(program,{coefficients:{0:2048,1:3072,2:1024}});
  owner.setEffect({enabled:true,returnLevel:7});
  for(const [slot,pcm]of [[0,a],[1,b]]){
    owner.invokePhysical('applyPCM',[slot,pcm,{baseFrequencyHz:44100/pcm.length,loopStartSamples:0}]);
    owner.invokePhysical('setMix',[slot,{totalLevel:0,directLevel:0}]);
    owner.setDspSend(slot,{input:slot,level:7});
    owner.physicalNoteOn('held-'+slot,slot,69);
    owner.invokePhysical('setFrequency',[slot,44100/pcm.length]);
    owner.core.write(slot*32+12,0x100,0x100); // SDIR: exact native integer stimulus.
  }
  owner.setDspReturn(0,{level:7,pan:31});owner.setDspReturn(1,{level:7,pan:15});
  return {owner,a,b};
}

test('legacy routing remains implicit and cannot accidentally start a second DSP owner',async t=>{
  const owner=await create(t),state=owner.read();
  assert.deepEqual(Object.keys(owner.readDspSetup()),['words','custom','revision','coefficients','effect']);
  assert.equal(state.dspRouting.sources.length,6);assert.equal(state.dspRouting.slots.length,32);
  assert(state.dspRouting.slots.every(value=>value.input===0&&value.level===7));
  assert.deepEqual(state.dspReturns,[{level:6,pan:0},{level:0,pan:0}]);
  for(const invoke of [()=>owner.invoke('setMix',[0,{dspSend:7}]),()=>owner.invokePhysical('setPreset',[0,{dspInput:1}])])assert.throws(invoke,/Use setDsp/);
  assert.deepEqual(owner.read(),state);assert.equal(owner.synth.getState().dsp,undefined);
});

test('two real hardware paths equal independent Gain and recursive IIR calculations',async t=>{
  const {owner,a,b}=await stereo(t),ram=owner.core.readRam(),state=owner.read();
  const actual=owner.synth.generateStereo(137),right=iir(b.slice(0,137));
  assert.deepEqual(actual.left,Float32Array.from(a.slice(0,137),value=>Math.floor(value/2)/32768));
  assert.deepEqual(actual.right,right.values);
  assert.deepEqual(owner.core.readRam(),ram);
  assert.equal(owner.synth.getState().dsp,undefined,'Synth keeps its own DSP owner');
  assert.equal(owner.core.read(0x402)&0x1bf,2<<7,'Existing protected ring layout remains');
  const frames=owner.core.nativeFrames,returns=[owner.core.read(22),owner.core.read(54)];
  owner.setDspSend(0,{input:1});
  assert.equal(owner.core.nativeFrames,frames);assert.deepEqual([owner.core.read(22),owner.core.read(54)],returns);
  const moved=owner.synth.generateStereo(256),mix=Int16Array.from(a.slice(137,393),(value,index)=>value+b[137+index]);
  assert(moved.left.every(value=>value===0));assert.deepEqual(moved.right,iir(mix,right.state).values);
  assert.deepEqual(owner.read().playingSampleIds,state.playingSampleIds);assert(owner.read().slots.slice(0,2).every(voice=>voice.gate));
});

test('Return controls preserve direct fields, requested levels, other outputs and legacy aliases',async t=>{
  const {owner}=await stereo(t),core=owner.core;
  owner.invokePhysical('setMix',[0,{directLevel:5,pan:3}]);owner.invokePhysical('setMix',[1,{directLevel:6,pan:18}]);
  const direct=[core.read(22)&0xff00,core.read(54)&0xff00];
  owner.setDspReturn(1,{level:5});owner.setEffect({returnLevel:4});
  assert.deepEqual(owner.read().dspReturns,[{level:4,pan:31},{level:5,pan:15}]);
  assert.equal(core.read(22)&255,(4<<5)|31);assert.equal(core.read(54)&255,(5<<5)|15);
  owner.setEffect({enabled:false});assert.equal(core.read(22)&255,0);assert.equal(core.read(54)&255,0);
  owner.setEffect({enabled:true});assert.equal(core.read(22)&255,(4<<5)|31);assert.equal(core.read(54)&255,(5<<5)|15);
  assert.deepEqual([core.read(22)&0xff00,core.read(54)&0xff00],direct);
  owner.stopVoices();const output=owner.synth.generateStereo(256);assert(output.left.every(value=>value===0));assert(output.right.every(value=>value===0));
  assert.deepEqual(owner.read().dspReturns,[{level:4,pan:31},{level:5,pan:15}]);assert.deepEqual(mpro(core),Array.from(program));
});

test('Auto source routing follows allocation and fanout while physical controls stay local',async t=>{
  const owner=await create(t);owner.setEffect({enabled:true});owner.setDspSourceSend(0,{input:1,level:6});
  owner.setDspSend(6,{input:0,level:2});
  owner.noteOn('auto',69);assert.equal(owner.core.read(6*32+20)&127,(1<<3)|6);
  assert.equal(owner.read().dspRoutingOverrides.slots[6],null,'Auto allocation replaces physical routing');
  owner.physicalNoteOn('manual',31,60);owner.setDspSend(31,{input:1,level:3});
  owner.setDspSourceSend(0,{level:4});assert.equal(owner.core.read(6*32+20)&127,12);assert.equal(owner.core.read(31*32+20)&127,11);
  owner.setDspSend(6,{input:0});assert.equal(owner.core.read(6*32+20)&127,4);
  owner.setDspSourceSend(0,{input:1});assert.equal(owner.read().dspRoutingOverrides.slots[6],null);assert.equal(owner.core.read(6*32+20)&127,12);
  owner.setDspSend(31,null);assert.equal(owner.core.read(31*32+20)&127,7);
  owner.setDspSourceSend(0,null);owner.setEffect({send:2});assert.equal(owner.core.read(6*32+20)&127,2);
  assert.equal(owner.read().voiceGroups.length,1);assert.equal(owner.read().manualVoices.length,1);
});

test('invalid routing requests make no writes and snapshots cannot mutate the owner',async t=>{
  const {owner}=await stereo(t),before=owner.read(),setup=owner.readDspSetup(),ram=owner.core.readRam();
  const write=owner.core.write.bind(owner.core);let writes=0;owner.core.write=(...args)=>{writes++;return write(...args);};
  for(const action of [()=>owner.setDspSend(32,{level:1}),()=>owner.setDspSourceSend(6,{input:0}),()=>owner.setDspSend(0,{input:2}),()=>owner.setDspSend(0,{level:8}),()=>owner.setDspSend(0,{level:undefined}),()=>owner.setDspSend(0,{other:1}),()=>owner.setDspReturn(2,{}),()=>owner.setDspReturn(1,null),()=>owner.setDspReturn(0,{pan:32}),()=>owner.setDspReturn(0,{[Symbol('hidden')]:0})])assert.throws(action);
  assert.equal(writes,0);assert.deepEqual(owner.read(),before);assert.deepEqual(owner.readDspSetup(),setup);assert.deepEqual(owner.core.readRam(),ram);
  setup.dspReturns[1].level=0;setup.dspRoutingOverrides.slots[0].input=1;before.dspRouting.sources[0].level=0;
  assert.equal(owner.read().dspReturns[1].level,7);assert.equal(owner.read().dspRoutingOverrides.slots[0].input,0);assert.equal(owner.read().dspRouting.sources[0].level,7);
});

test('route getters are evaluated once and merge with the latest completed nested edit',async t=>{
  const owner=await create(t);let calls=0;
  owner.setDspSend(0,{get input(){calls++;owner.setDspSend(0,{level:3});return 1;}});
  assert.equal(calls,1);assert.deepEqual(owner.read().dspRouting.slots[0],{input:1,level:3});
  owner.setDspReturn(1,{get pan(){calls++;owner.setDspReturn(1,{level:4});return 15;}});
  assert.equal(calls,2);assert.deepEqual(owner.read().dspReturns[1],{level:4,pan:15});
});

test('idle migration preserves requested routing, while legacy voice presets restore implicit defaults',async t=>{
  const owner=await create(t),target=await create(t);owner.setEffect({enabled:true,send:5});owner.setDspSourceSend(2,{input:1,level:3});owner.setDspSend(31,{input:1,level:2});owner.setDspReturn(0,{level:4,pan:31});owner.setDspReturn(1,{level:6,pan:15});
  const snapshot=owner.exportIdleState();target.loadIdleState(snapshot);
  assert.deepEqual(target.read().dspRouting,owner.read().dspRouting);assert.deepEqual(target.read().dspRoutingOverrides,owner.read().dspRoutingOverrides);assert.deepEqual(target.read().dspReturns,owner.read().dspReturns);
  const before=target.read(),bad=structuredClone(snapshot);bad.dspRoutingState.overrides.slots[31].input=2;
  assert.throws(()=>target.loadIdleState(bad));assert.deepEqual(target.read(),before);
  target.loadPatch(owner.exportPatch());assert(target.read().dspRoutingOverrides.slots.every(value=>value===null));assert(target.read().dspRoutingOverrides.sources.every(value=>value===null));
  assert.deepEqual(target.read().dspReturns,[{level:4,pan:0},{level:0,pan:0}]);assert.equal(target.core.read(54)&255,0);assert(!Object.hasOwn(target.readDspSetup(),'dspRoutingOverrides'));
});

test('failed program or Return update restores both effect outputs and same-phase PCM',async t=>{
  const {owner}=await stereo(t),{owner:reference}=await stereo(t);
  for(const i of [owner,reference])i.synth.generateStereo(137);
  const before={state:owner.read(),setup:owner.readDspSetup(),ram:owner.core.readRam(),mpro:mpro(owner.core),returns:[owner.core.read(22),owner.core.read(54)]};
  for(const operation of ['program','return']){
    const write=owner.core.write.bind(owner.core);let injected=false;
    owner.core.write=(...args)=>{const result=write(...args);if(!injected&&args[0]===54&&(operation==='return'||args[1]===before.returns[1])){injected=true;throw Error('Injected second Return failure');}return result;};
    assert.throws(()=>operation==='program'?owner.applyDspProgram(delayProgram()):owner.setDspReturn(1,{pan:0}),/Injected/);assert(injected);
    owner.core.write=write;assert.deepEqual(owner.read(),before.state);assert.deepEqual(owner.readDspSetup(),before.setup);assert.deepEqual(owner.core.readRam(),before.ram);assert.deepEqual(mpro(owner.core),before.mpro);assert.deepEqual([owner.core.read(22),owner.core.read(54)],before.returns);
  }
  assert.deepEqual(owner.synth.generateStereo(256),reference.synth.generateStereo(256));
});

test('a partially written send update rolls back raw routing and authoring metadata',async t=>{
  const {owner}=await stereo(t),{owner:reference}=await stereo(t);
  for(const i of [owner,reference])i.synth.generateStereo(137);
  const addresses=Array.from({length:32},(_,slot)=>[0,12,16,20,22].map(offset=>slot*32+offset)).flat().concat([0x402,0x700,0x702,0x704,0x780,0x782]);
  const before=owner.read(),registers=addresses.map(address=>owner.core.read(address)),ram=owner.core.readRam();
  const write=owner.core.write.bind(owner.core);let failed=false;
  owner.core.write=(...args)=>{const result=write(...args);if(!failed&&args[0]===52){failed=true;throw Error('Injected partial route failure');}return result;};
  assert.throws(()=>owner.setDspSend(0,{input:1,level:4}),/Injected/);owner.core.write=write;
  assert(failed);assert.deepEqual(owner.read(),before);assert.deepEqual(addresses.map(address=>owner.core.read(address)),registers);assert.deepEqual(owner.core.readRam(),ram);
  assert.deepEqual(owner.synth.generateStereo(256),reference.synth.generateStereo(256));
});

test('Code Stop mutes retired explicit sends, retains requested routes and leaves a manual wet owner unchanged',async t=>{
  const owner=await create(t),reference=await create(t);
  const configure=i=>{
    i.applyDspProgram(program,{coefficients:{0:4095,1:3072,2:1024}});i.setEffect({enabled:true,returnLevel:7});
    i.invoke('setMix',[0,{directLevel:0}]);i.invoke('setEnvelope',[0,{releaseRate:0}]);
    i.setDspReturn(0,{level:7,pan:31});i.setDspReturn(1,{level:7,pan:15});
    i.physicalNoteOn('manual',31,72);i.setDspSend(31,{input:1,level:7});
  };
  for(const i of [owner,reference])configure(i);
  const session=owner.beginCode().session;owner.code(session,'noteOn',[0,'A4']);owner.setDspSend(6,{input:0,level:7});
  const first=owner.synth.generateStereo(4096);reference.synth.generateStereo(4096);
  assert(first.left.some(value=>Math.abs(value)>.01));
  owner.code(session,'keyOff',[0]);const release=owner.synth.generateStereo(1024);reference.synth.generateStereo(1024);
  assert(release.left.some(value=>Math.abs(value)>.01),'A current owner retains its requested raw hardware release');
  const manual=owner.read().manualVoices;
  owner.endCode(session);
  assert.equal(owner.core.read(6*32+20)&127,0,'Retired Code voice no longer enters DSP');
  assert.deepEqual(owner.read().dspRoutingOverrides.slots[6],{input:0,level:7},'Stop preserves authoring');
  assert.deepEqual(owner.read().manualVoices,manual);assert.equal(owner.core.read(31*32+20)&127,15);
  const stopped=owner.synth.generateStereo(4096),other=reference.synth.generateStereo(4096);
  assert(stopped.left.every(value=>value===0));assert.deepEqual(stopped.right,other.right);assert(stopped.right.some(value=>value!==0));
});

test('retiring one Auto group mutes its explicit modulator send and preserves other Code / manual owners',async t=>{
  const owner=await create(t);
  owner.applyDspProgram(program,{coefficients:{0:4095,1:3072,2:1024}});owner.setEffect({enabled:true,returnLevel:7});
  owner.invoke('setMix',[0,{directLevel:0}]);owner.invoke('setEnvelope',[0,{releaseRate:0}]);owner.invoke('setEnvelope',[1,{releaseRate:0}]);
  owner.setConfig({mode:'fm2'});owner.setDspReturn(0,{level:7,pan:31});owner.setDspReturn(1,{level:7,pan:15});
  const session=owner.beginCode().session;owner.code(session,'noteOn',[0,'A4']);owner.code(session,'noteOn',[1,'C5']);
  owner.setDspSend(6,{input:0,level:7});owner.setDspSend(9,{input:1,level:5});
  assert.equal(owner.read().slots[6].directLevel,0);assert.equal(owner.core.read(6*32+20)&127,7,'Explicit send can expose an owned silent FM modulator');
  assert(owner.synth.generateStereo(4096).left.some(value=>Math.abs(value)>.01));
  const other=owner.read().voiceGroups.find(group=>group.owner.channel===1);
  owner.physicalNoteOn('replacement',7,60);owner.setDspSend(7,{input:1,level:2});
  assert.equal(owner.core.read(6*32+20)&127,0,'Retired modulator has no wet route');
  assert.deepEqual(owner.read().voiceGroups.find(group=>group.owner.channel===1),other);assert.equal(owner.core.read(9*32+20)&127,13);
  assert.equal(owner.code(session,'noteOff',[0]),false);assert(owner.read().slots[7].gate);
  const output=owner.synth.generateStereo(2048);assert(output.left.every(value=>value===0));assert(output.right.some(value=>value!==0));
});
