// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../js/scsp.js';
import {Pcm44100Resampler} from '../js/pcm_44100_resampler.js';
import {SynthInstrument} from './instrument.js';
import {customRouting,resizeCustomRouting,hasSelfFeedback} from './routing.js';
import {readPatch} from './patch.js';

let module;
async function create(t){
  module??=factory({wasmBinary:await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url))});
  const owner=new SynthInstrument(await Scsp.create({moduleFactory:()=>module}));t.after(()=>owner.dispose());return owner;
}
const graph=(inputs,outputs=[0])=>({inputs,outputs});
const families=[{inputs:[[0],[]],order:[1,0],self:0},{inputs:[[0],[0]],order:[0,1],self:0},
  {inputs:[[],[1]],order:[1,0],self:1},{inputs:[[1],[1]],order:[1,0],self:1}];
const ratios=[1.25,2.5,1,1,1,1];
function waves(owner){
  owner.invoke('applyPCM',[0,Int16Array.from({length:64},(_,i)=>Math.round(6000*Math.sin(i*Math.PI/32)+1200*Math.cos(3*i*Math.PI/32))),{baseFrequencyHz:44100/64,loopStartSamples:0}]);
  owner.invoke('applyPCM',[1,Int8Array.from({length:64},(_,i)=>Math.round(40*(2*i/64-1))),{baseFrequencyHz:44100/64,loopStartSamples:0}]);
  owner.invoke('setMix',[0,{totalLevel:12}]);owner.invoke('setMix',[1,{totalLevel:6}]);
}
const setup=(owner,custom)=>owner.setConfig({mode:'fm2',fm:{algorithm:'custom',custom,depth:9,ratios}});
const ring=core=>Array.from({length:64},(_,index)=>core.read(0x600+index*2));
const seed=(core,index,value)=>core.write(0x600+index*2,value&65535);
function output(core,rate,frames=8192){
  const resampler=new Pcm44100Resampler(core,rate),left=new Float32Array(frames),right=new Float32Array(frames);
  for(let offset=0;offset<frames;offset+=128)resampler.render(left,right,Math.min(128,frames-offset),offset);
  return {left,right,nativeFrames:core.nativeFrames};
}
// Explicit physical-slot fixture. No production graph, topology, voice-command
// or operator-depth helper computes this independent native reference.
function reference(owner,family,outputs,note=69,depth=9){
  const slots=[];family.order.forEach((operator,index)=>{slots[operator]=6+index;});
  const state=owner.synth.getState();
  for(let operator=0;operator<2;operator++){
    const voice=state.slots[operator],input=family.inputs[operator],slot=slots[operator],self=operator===family.self;
    const offset=input.length?(slots[input[0]]-slot+64)%64:0;
    owner.synth.setPreset(slot,{sample:voice.sample,envelope:voice.envelope,lfo:voice.lfo,totalLevel:voice.totalLevel,directLevel:outputs.includes(operator)?voice.directLevel:0,pan:voice.pan,
      frequencyHz:440*2**((note-69)/12)*ratios[operator],modulation:{depth:input.length?depth:0,xOffset:self?32:offset,yOffset:self?0:offset,writeInhibit:false}});
  }
  seed(owner.core,slots[family.self],0);seed(owner.core,slots[family.self]+32,0);
  owner.synth.keyOn(6);owner.synth.keyOn(7);return slots;
}

test('all16 bounded self graphs/output combinations match independent native references at44.1/48kHz',async t=>{
  for(const rate of [44100,48000])for(const family of families)for(const outputs of [[],[0],[1],[0,1]]){
    const owner=await create(t),manual=await create(t);for(const value of [owner,manual])waves(value);
    setup(owner,graph(family.inputs,outputs));owner.noteOn('held',67);const slots=reference(manual,family,outputs,67);
    assert.deepEqual(owner.read().voiceGroups[0].operatorSlots,slots);assert.deepEqual(owner.read().slots[slots[family.self]].modulation,{depth:9,xOffset:32,yOffset:0,writeInhibit:false});
    const actual=output(owner.core,rate),expected=output(manual.core,rate);assert.deepEqual(actual,expected,`${rate}/${JSON.stringify(family.inputs)}/${outputs}`);
    assert(actual.left.every(Number.isFinite));if(!outputs.length)assert(actual.left.every(value=>value===0));
  }
});

test('feedback MDL0 cleanly disables modulation and live On restores the requested generation pair without clearing history',async t=>{
  const owner=await create(t),manual=await create(t),family=families[1];for(const value of [owner,manual])waves(value);
  setup(owner,graph(family.inputs,[1]));owner.noteOn('held',69);const slots=reference(manual,family,[1]);
  owner.synth.generateStereo(137);manual.synth.generateStereo(137);
  const before=owner.read().voiceGroups[0],writes=[],write=owner.core.write.bind(owner.core);owner.core.write=(...args)=>{writes.push(args);return write(...args);};
  for(const depth of [0,12,1,8]){
    const stack=ring(owner.core);owner.setConfig({fm:{depth}});manual.synth.setModulation(slots[0],{depth});manual.synth.setModulation(slots[1],{depth});
    assert.deepEqual(ring(owner.core),stack);assert.equal(owner.core.read(slots[0]*32+14),depth?(depth<<12)|0x800:0);
    assert.deepEqual(owner.synth.generateStereo(1024),manual.synth.generateStereo(1024));
    assert.equal(owner.read().slots[slots[0]].modulation.xOffset,32);assert.equal(owner.read().slots[slots[0]].modulation.yOffset,0);
    assert(owner.read().slots[slots[0]].gate);
  }
  assert(!writes.some(([address])=>address>=0x600&&address<0x700));owner.core.write=write;
  assert.deepEqual(owner.read().voiceGroups[0].operatorSlots,before.operatorSlots);
});

test('every supported feedback MDL0..12 is finite and matches the independent physical reference',async t=>{
  for(let depth=0;depth<=12;depth++){
    const owner=await create(t),manual=await create(t),family=families[1];for(const value of [owner,manual])waves(value);
    setup(owner,graph(family.inputs,[1]));owner.setConfig({fm:{depth}});owner.noteOn('held',69);reference(manual,family,[1],69,depth);
    const actual=owner.synth.generateStereo(2048);assert.deepEqual(actual,manual.synth.generateStereo(2048),`MDL ${depth}`);
    assert(actual.left.every(Number.isFinite)&&actual.right.every(Number.isFinite));
  }
});

test('new owned self attacks clear exactly its two stack cells after validation and before keyOn',async t=>{
  for(const family of families){
    const owner=await create(t);setup(owner,graph(family.inputs,[0,1]));const calls=[],write=owner.core.write.bind(owner.core);
    for(let index=0;index<64;index++)seed(owner.core,index,1234+index);
    owner.core.write=(...args)=>{calls.push(args);return write(...args);};owner.noteOn('held',69);owner.core.write=write;
    const group=owner.read().voiceGroups[0],slot=group.operatorSlots[family.self],stack=ring(owner.core),clears=calls.filter(([address])=>address>=0x600&&address<0x700);
    assert.deepEqual(clears,[[0x600+slot*2,0],[0x600+(slot+32)*2,0]]);
    assert(stack.every((value,index)=>value===(index===slot||index===slot+32?0:1234+index)));
    const lastClear=Math.max(...clears.map(call=>calls.indexOf(call))),keyOn=calls.findIndex(([address,value])=>address<0x400&&address%32===0&&(value&0x1800)===0x1800);
    assert(lastClear<keyOn);
  }
});

test('Code retrigger and voice steal reset only newly owned self history, preserving unrelated manual/DSP state',async t=>{
  const owner=await create(t);waves(owner);setup(owner,graph([[0],[0]],[1]));const session=owner.beginCode().session;
  owner.code(session,'noteOn',[0,69]);owner.physicalNoteOn('manual',31,60);owner.setEffect({enabled:true});owner.setDspSourceSend(0,{input:1,level:4});owner.synth.generateStereo(257);
  const before=owner.read(),dsp=owner.readDspSetup(),ram=owner.core.readRam();seed(owner.core,6,5000);seed(owner.core,38,-3000);seed(owner.core,31,2222);seed(owner.core,63,3333);
  owner.code(session,'noteOn',[0,72]);assert.equal(ring(owner.core)[6],0);assert.equal(ring(owner.core)[38],0);assert.equal(ring(owner.core)[31],2222);assert.equal(ring(owner.core)[63],3333);
  let state=owner.read();assert.equal(state.codeSession,session);assert(state.codeActive);assert.deepEqual(state.manualVoices,before.manualVoices);assert.deepEqual(state.slots[31],before.slots[31]);assert.deepEqual(owner.readDspSetup(),dsp);assert.deepEqual(owner.core.readRam(),ram);
  owner.stopVoices();for(let index=0;index<13;index++)owner.noteOn('old'+index,60+index%12);owner.synth.generateStereo(257);seed(owner.core,6,8000);seed(owner.core,38,-4000);
  const result=owner.noteOn('replacement',69);assert.equal(result.stolenId,'old0');assert.deepEqual(result.slots,[6,7]);assert.equal(ring(owner.core)[6],0);assert.equal(ring(owner.core)[38],0);assert.equal(owner.noteOff('old0'),false);
});

test('live, releasing, pitch and raw physical actions preserve sound-stack history and their respective owners',async t=>{
  const owner=await create(t);setup(owner,graph([[0],[0]],[1]));owner.invoke('setEnvelope',[0,{releaseRate:2}]);owner.invoke('setEnvelope',[1,{releaseRate:2}]);
  owner.noteOn('released',69);owner.synth.generateStereo(137);const slots=owner.read().voiceGroups[0].operatorSlots;
  let before=ring(owner.core);owner.noteOff('released');assert.deepEqual(ring(owner.core),before);
  owner.setConfig({fm:{depths:[11,7,9,9,9,9]}});owner.setPitchBend(.5);assert.deepEqual(ring(owner.core),before);assert.equal(owner.read().voiceGroups[0].held,false);
  assert.equal(owner.read().slots[slots[0]].modulation.depth,11);assert.equal(owner.read().slots[slots[1]].modulation.depth,7);
  owner.physicalNoteOn('manual',31,60);owner.invokePhysical('setModulation',[31,{depth:8,xOffset:32,yOffset:0}]);seed(owner.core,31,2222);seed(owner.core,63,3333);
  owner.physicalNoteOff('manual');assert.equal(ring(owner.core)[31],2222);assert.equal(ring(owner.core)[63],3333);
  owner.physicalNoteOn('raw-retrigger',31,60);assert.equal(ring(owner.core)[31],2222);assert.equal(ring(owner.core)[63],3333);
});

test('fresh self attack after unrelated previous voices is exactly reproducible while nonself attacks never clear cells',async t=>{
  const used=await create(t),fresh=await create(t);for(const owner of [used,fresh]){waves(owner);setup(owner,graph([[0],[0]],[1]));}
  used.noteOn('previous',63);used.synth.generateStereo(155);used.noteOff('previous');
  // Reuse a physical pair through the actual allocator; no global Stop/reset.
  const session=used.beginCode().session;used.code(session,'noteOn',[0,69]);
  const allocated=used.read().voiceGroups.find(group=>group.owner.kind==='code');assert.deepEqual(allocated.slots,[8,9]);
  // A second owned self pair starts clean even after arbitrary stale stack data.
  for(const owner of [used,fresh]){seed(owner.core,6,6000);seed(owner.core,38,-5000);}
  used.code(session,'noteOn',[0,69]);fresh.noteOn('voice',69);
  assert.equal(ring(used.core)[8],0);assert.equal(ring(used.core)[40],0);
  // Independent pair mappings have the same relative inputs and native PCM;
  // mute the retired old group only for this reference comparison.
  used.synth.setMix(7,{directLevel:0});assert.deepEqual(used.synth.generateStereo(4096),fresh.synth.generateStereo(4096));
  const nonself=await create(t);nonself.setConfig({mode:'fm2'});for(let index=0;index<64;index++)seed(nonself.core,index,1000+index);
  const stack=ring(nonself.core);nonself.noteOn('voice',69);assert.deepEqual(ring(nonself.core),stack);
});

test('unsupported self graphs and incompatible PCM fail before writes, history resets or owner mutation',async t=>{
  const owner=await create(t);setup(owner,graph([[0],[0]],[1]));owner.noteOn('held',69);owner.synth.generateStereo(137);
  const before=owner.read(),stack=ring(owner.core),ram=owner.core.readRam(),write=owner.core.write.bind(owner.core);let writes=0;owner.core.write=(...args)=>{writes++;return write(...args);};
  for(const patch of [
    {fm:{custom:graph([[0],[1]])}},{fm:{custom:graph([[0,1],[]])}},{fm:{custom:graph([[0],[0,1]])}},
    {fm:{custom:graph([[1],[0]])}},{mode:'fm4',fm:{custom:graph([[0],[],[],[]])}},
    {mode:'fm6',fm:{custom:graph([[],[],[],[],[],[5]])}},{mode:'pcm'},
    {fm:{custom:graph([[0],[]],[2])}},{fm:{depth:13}},
  ]){assert.throws(()=>owner.setConfig(patch));assert.deepEqual(owner.read(),before);assert.deepEqual(ring(owner.core),stack);}
  assert.throws(()=>owner.invoke('applyPCM',[0,new Int16Array(64),{rootNote:69}]),/full forward loop/);
  assert.equal(writes,0);owner.core.write=write;assert.deepEqual(owner.core.readRam(),ram);
});

test('implicit resize removes only unsupported self edges; dormant fixed graph survives until Custom projection',async t=>{
  const owner=await create(t),source=graph([[0],[0]],[0,1]);setup(owner,source);
  owner.setConfig({mode:'fm4'});assert.deepEqual(owner.read().config.fm.custom,graph([[],[0],[],[]],[0,1]));
  assert.deepEqual(resizeCustomRouting(source,6),graph([[],[0],[],[],[],[]],[0,1]));assert.deepEqual(source,graph([[0],[0]],[0,1]));
  setup(owner,source);owner.setConfig({mode:'fm6',fm:{algorithm:'chain'}});assert.deepEqual(owner.read().config.fm.custom,source);
  owner.setConfig({fm:{algorithm:'custom'}});assert.deepEqual(owner.read().config.fm.custom,graph([[],[0],[],[],[],[]],[0,1]));
  assert.throws(()=>owner.setConfig({mode:'fm4',fm:{custom:source}}),/input count/);
});

test('v8 scalar/mixed self presets and idle snapshots roundtrip while every previous version rejects self graphs',async t=>{
  for(const depths of [null,[3,11,9,9,9,9]])for(const family of families){
    const owner=await create(t),copy=await create(t),idle=await create(t);waves(owner);setup(owner,graph(family.inputs,[0,1]));if(depths)owner.setConfig({fm:{depths}});
    const patch=JSON.parse(JSON.stringify(owner.exportPatch()));assert.equal(patch.version,8);assert(hasSelfFeedback(readPatch(patch).fm.custom));
    copy.loadPatch(patch);idle.loadIdleState(owner.exportIdleState());for(const value of [owner,copy,idle])value.noteOn('held',67);
    const expected=owner.synth.generateStereo(4096);assert.deepEqual(copy.synth.generateStereo(4096),expected);assert.deepEqual(idle.synth.generateStereo(4096),expected);
    const before=copy.read();for(let version=1;version<=7;version++){const invalid=structuredClone(patch);invalid.version=version;if(version===7)invalid.fm.depths=[9,9,9,9,9,9];assert.throws(()=>copy.loadPatch(invalid));assert.deepEqual(copy.read(),before);}
    const missing=structuredClone(patch);delete missing.fm.custom;assert.throws(()=>copy.loadPatch(missing),/version 8/);
    const notSelf=structuredClone(patch);notSelf.fm.custom=graph([[1],[]]);assert.throws(()=>copy.loadPatch(notSelf),/self-feedback/);
    const fixed=structuredClone(patch);fixed.fm.algorithm='chain';assert.throws(()=>copy.loadPatch(fixed),/version 8/);
    const oldDormant=structuredClone(patch);oldDormant.version=7;oldDormant.fm.algorithm='chain';oldDormant.fm.depths=[9,9,9,9,9,9];assert.throws(()=>copy.loadPatch(oldDormant),/version 8/);
  }
});

test('older Code groups preserve self mapping after preset load; getters and public snapshots remain detached',async t=>{
  const owner=await create(t),source=await create(t);setup(owner,graph([[0],[0]],[1]));const session=owner.beginCode().session;owner.code(session,'noteOn',[0,69]);
  const prior=owner.read().voiceGroups[0];source.setConfig({mode:'fm4',fm:{algorithm:'branch'}});owner.loadPatch(source.exportPatch());assert.deepEqual(owner.read().voiceGroups[0],prior);
  owner.setConfig({fm:{depth:0}});assert.equal(owner.core.read(6*32+14),0);owner.setConfig({fm:{depth:11}});assert.equal(owner.core.read(6*32+14),0xb800);
  assert.deepEqual(owner.read().voiceGroups[0].operatorSlots,[6,7]);owner.code(session,'noteOn',[0,69]);assert.equal(owner.read().voiceGroups[0].slots.length,4);
  let count=0;const graphRequest={get inputs(){count++;owner.setConfig({fm:{depth:7}});return [[0],[]];},outputs:[0]};owner.setConfig({mode:'fm2',fm:{algorithm:'custom',custom:graphRequest}});
  assert.equal(count,1);assert.equal(owner.read().config.fm.depth,7);const state=owner.read();state.config.fm.custom.inputs[0].length=0;assert.deepEqual(owner.read().config.fm.custom.inputs[0],[0]);
  assert(hasSelfFeedback(customRouting(graph([[0],[]]))));
});

test('v8 revalidates normalized mode and connection when a direct preset getter changes during inspection',async t=>{
  const owner=await create(t),source=await create(t);waves(owner);waves(source);setup(owner,graph([[0],[0]],[1]));setup(source,graph([[0],[]],[0]));
  const session=owner.beginCode().session;owner.code(session,'noteOn',[0,69]);owner.physicalNoteOn('manual',31,60);owner.setEffect({enabled:true});owner.synth.generateStereo(137);
  const before=owner.read(),ram=owner.core.readRam(),stack=ring(owner.core),write=owner.core.write.bind(owner.core);let writes=0;owner.core.write=(...args)=>{writes++;return write(...args);};
  try{
    for(const changed of ['algorithm','mode']){
      const preset=source.exportPatch(),original=preset.fm;let reads=0;
      if(changed==='algorithm')Object.defineProperty(preset,'fm',{enumerable:true,configurable:true,get(){return ++reads<=2?original:{...original,algorithm:'chain'};}});
      else Object.defineProperty(preset,'mode',{enumerable:true,configurable:true,get(){return ++reads===1?'fm2':'pcm';}});
      assert.throws(()=>owner.loadPatch(preset),changed==='algorithm'?/version 8/:/FM mode/);assert(reads>=2);
      assert.equal(writes,0);assert.deepEqual(owner.read(),before);assert.deepEqual(owner.core.readRam(),ram);assert.deepEqual(ring(owner.core),stack);
    }
  }finally{owner.core.write=write;}
});
