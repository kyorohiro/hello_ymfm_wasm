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
const ratios=[1.25,2.5,.5,1.75,3,.75],graph=(inputs,outputs=[0])=>({inputs,outputs});
function waves(owner){
  for(let index=0;index<6;index++){
    const pcm=index%2?Int8Array.from({length:64},(_,i)=>Math.round(24*(2*i/64-1))):Int16Array.from({length:64},(_,i)=>Math.round(3000*Math.sin((i+index*3)*Math.PI/32)+700*Math.cos((index+2)*i*Math.PI/32)));
    owner.invoke('applyPCM',[index,pcm,{baseFrequencyHz:44100/64,loopStartSamples:0}]);owner.invoke('setMix',[index,{totalLevel:12+index,directLevel:7,pan:0}]);
  }
}
function fixture(count,self,merge=true){
  const rest=Array.from({length:count},(_,i)=>i).filter(i=>i!==self).reverse();
  const order=merge?[self,...rest]:Array.from({length:count},(_,i)=>count-1-i),inputs=Array.from({length:count},()=>[]);inputs[self]=[self];
  if(merge)for(let position=1;position<count;position++)inputs[order[position]]=position===1?[order[0]]:[order[position-1],order[position-2]];
  return {count,self,order,custom:graph(inputs,merge?[order[count-1],order[1]]:[self])};
}
const setup=(owner,f,depth=9)=>owner.setConfig({mode:`fm${f.count}`,fm:{algorithm:'custom',custom:f.custom,depth,ratios}});
const stack=core=>Array.from({length:64},(_,index)=>core.read(0x600+index*2));
const seed=(core,index,value)=>core.write(0x600+index*2,value&65535);
function output(core,rate,frames=2048){
  const render=new Pcm44100Resampler(core,rate),left=new Float32Array(frames),right=new Float32Array(frames);
  for(let offset=0;offset<frames;offset+=128)render.render(left,right,Math.min(128,frames-offset),offset);
  return {left,right,nativeFrames:core.nativeFrames};
}
// Independent explicit physical fixtures: fixture order is predetermined, with
// a unique dependency chain for merge/fanout and descending IDs for disconnected
// operators. This reference never calls the production routing/slot/command API.
function reference(owner,f,depths,midi=69){
  const slots=[];f.order.forEach((operator,index)=>{slots[operator]=6+index;});const state=owner.synth.getState();
  for(let operator=0;operator<f.count;operator++){
    const voice=state.slots[operator],sources=f.custom.inputs[operator],slot=slots[operator],self=operator===f.self;
    const offsets=sources.map(source=>(slots[source]-slot+64)%64);
    owner.synth.setPreset(slot,{sample:voice.sample,envelope:voice.envelope,lfo:voice.lfo,totalLevel:voice.totalLevel,directLevel:f.custom.outputs.includes(operator)?voice.directLevel:0,pan:voice.pan,
      frequencyHz:440*2**((midi-69)/12)*ratios[operator],modulation:{depth:sources.length?depths[operator]:0,xOffset:self?32:offsets[0]??0,yOffset:self?0:offsets[1]??offsets[0]??0,writeInhibit:false}});
  }
  seed(owner.core,slots[f.self],0);seed(owner.core,slots[f.self]+32,0);
  for(let position=0;position<f.count;position++)owner.synth.keyOn(6+position);return slots;
}

test('every A–F Self target in4/6OP matches explicit merge/fanout and disconnected real-WASM references at44.1/48kHz',async t=>{
  for(const count of [4,6])for(let self=0;self<count;self++)for(const merge of [false,true])for(const depth of [0,1,12])for(const rate of [44100,48000]){
    const f=fixture(count,self,merge),owner=await create(t),manual=await create(t);for(const value of [owner,manual])waves(value);
    setup(owner,f);const depths=Array(6).fill(7);depths[self]=depth;owner.setConfig({fm:{depths}});owner.noteOn('held',67);const slots=reference(manual,f,depths,67),state=owner.read();
    assert.deepEqual(state.voiceGroups[0].operatorSlots,slots);assert.deepEqual(state.slots[slots[self]].modulation,{depth,xOffset:32,yOffset:0,writeInhibit:false});
    const actual=output(owner.core,rate),expected=output(manual.core,rate);assert.deepEqual(actual,expected,`${count}/${self}/${merge}/${depth}/${rate}`);assert(actual.left.every(Number.isFinite)&&actual.right.every(Number.isFinite));
  }
});

test('each Self source clears only its own two physical stack cells after validation, beforekeyOn',async t=>{
  for(const count of [4,6])for(let self=0;self<count;self++){
    const owner=await create(t),f=fixture(count,self,false);setup(owner,f);for(let index=0;index<64;index++)seed(owner.core,index,2000+index);
    const calls=[],write=owner.core.write.bind(owner.core);owner.core.write=(...args)=>{calls.push(args);return write(...args);};owner.noteOn('held',69);owner.core.write=write;
    const group=owner.read().voiceGroups[0],slot=group.operatorSlots[self],clears=calls.filter(([address])=>address>=0x600&&address<0x700);
    assert.deepEqual(clears,[[0x600+slot*2,0],[0x600+(slot+32)*2,0]]);assert(stack(owner.core).every((value,index)=>value===(index===slot||index===slot+32?0:2000+index)));
    const keyOn=calls.findIndex(([address,value])=>address<0x400&&address%32===0&&(value&0x1800)===0x1800);assert(Math.max(...clears.map(call=>calls.indexOf(call)))<keyOn);
  }
});

test('mapped live MDL Off/On, pitch, source/DSP edits and releasing groups retain history and owners',async t=>{
  const owner=await create(t),f=fixture(6,4,true);waves(owner);setup(owner,f);for(let index=0;index<6;index++)owner.invoke('setEnvelope',[index,{releaseRate:2}]);
  const session=owner.beginCode().session;owner.code(session,'noteOn',[0,69]);owner.noteOn('keyboard',64);owner.noteOff('keyboard');owner.physicalNoteOn('manual',31,60);
  owner.setEffect({enabled:true});owner.setDspSourceSend(4,{input:1,level:4});owner.setDspReturn(1,{level:5,pan:12});owner.synth.generateStereo(137);
  const before=owner.read(),ring=stack(owner.core),ram=owner.core.readRam(),dsp=owner.readDspSetup(),writes=[],write=owner.core.write.bind(owner.core);owner.core.write=(...args)=>{writes.push(args);return write(...args);};
  const depths=[2,3,4,5,0,7];owner.setConfig({fm:{depths}});owner.setPitchBend(.5);
  for(const group of owner.read().voiceGroups)assert.equal(owner.core.read(group.operatorSlots[4]*32+14),0);
  depths[4]=12;owner.setConfig({fm:{depths}});owner.core.write=write;
  const state=owner.read();for(const group of state.voiceGroups){assert.equal(state.slots[group.operatorSlots[4]].modulation.xOffset,32);assert.equal(state.slots[group.operatorSlots[4]].modulation.yOffset,0);assert.equal(owner.core.read(group.operatorSlots[4]*32+14),0xc800);}
  assert.deepEqual(stack(owner.core),ring);assert(!writes.some(([address])=>address>=0x600&&address<0x700));assert.deepEqual(owner.core.readRam(),ram);assert.deepEqual(owner.readDspSetup(),dsp);
  assert.equal(state.codeSession,session);assert(state.codeActive);assert.deepEqual(state.manualVoices,before.manualVoices);assert.equal(state.voiceGroups.find(group=>group.id==='keyboard').held,false);
  owner.invoke('setMix',[4,{totalLevel:42}]);owner.invoke('setLfo',[4,{frequencyCode:17,pitchDepth:2}]);
  for(const group of owner.read().voiceGroups){assert.equal(owner.read().slots[group.operatorSlots[4]].totalLevel,42);assert.equal(owner.read().slots[group.operatorSlots[4]].lfo.frequencyCode,17);assert.equal(owner.read().dspRouting.slots[group.operatorSlots[4]].level,4);}
});

test('retrigger and steal initialize one new owned Self while raw physical history remains untouched',async t=>{
  const owner=await create(t),f=fixture(6,2,false);setup(owner,f);const session=owner.beginCode().session;owner.code(session,'noteOn',[0,69]);owner.physicalNoteOn('manual',31,60);owner.setEffect({enabled:true});
  const selfSlot=owner.read().voiceGroups[0].operatorSlots[2],before=owner.read().manualVoices,dsp=owner.readDspSetup();seed(owner.core,selfSlot,9000);seed(owner.core,selfSlot+32,-4000);seed(owner.core,31,2222);seed(owner.core,63,3333);
  owner.code(session,'noteOn',[0,72]);assert.equal(stack(owner.core)[selfSlot],0);assert.equal(stack(owner.core)[selfSlot+32],0);assert.equal(stack(owner.core)[31],2222);assert.equal(stack(owner.core)[63],3333);assert.deepEqual(owner.read().manualVoices,before);assert.deepEqual(owner.readDspSetup(),dsp);
  owner.physicalNoteOff('manual');owner.physicalNoteOn('raw',31,60);assert.equal(stack(owner.core)[31],2222);assert.equal(stack(owner.core)[63],3333);
  owner.stopVoices();for(let index=0;index<4;index++)owner.noteOn('old'+index,60+index);owner.noteOff('old1');const old=owner.read().voiceGroups.find(group=>group.id==='old1'),slot=old.operatorSlots[2];seed(owner.core,slot,10000);seed(owner.core,slot+32,-12000);
  const result=owner.noteOn('replacement',69);assert.equal(result.stolenId,'old1');assert.deepEqual(result.slots,[12,13,14,15,16,17]);assert.equal(stack(owner.core)[slot],0);assert.equal(stack(owner.core)[slot+32],0);assert.equal(owner.noteOff('old1'),false);
});

test('invalid mixed Self, cycles, malformed graphs and incompatible PCM reject before all mutation',async t=>{
  const owner=await create(t);setup(owner,fixture(6,5,true));owner.noteOn('held',69);owner.synth.generateStereo(137);const before=owner.read(),ring=stack(owner.core),ram=owner.core.readRam(),write=owner.core.write.bind(owner.core);let writes=0;owner.core.write=(...args)=>{writes++;return write(...args);};
  const sparse=Array(6);sparse[0]=[];
  for(const custom of [
    graph([[0],[1],[3],[2],[],[]]),graph([[],[],[],[],[],[5,0]]),graph([[],[],[],[],[],[0,5]]),graph([[1],[0],[],[],[],[5]]),
    graph([[1,2],[2],[0],[],[],[5]]),graph([[],[],[],[],[],[5,5]]),graph([[],[],[],[],[],[6]]),graph(sparse),
    graph([[],[],[],[],[],[5]],[6]),{...graph([[],[],[],[],[],[5]]),unknown:true},
  ])assert.throws(()=>owner.setConfig({fm:{custom}}));
  for(const patch of [{mode:'pcm'},{mode:'fm4',fm:{custom:fixture(6,5).custom}},{fm:{depth:13}}])assert.throws(()=>owner.setConfig(patch));
  assert.throws(()=>owner.invoke('applyPCM',[5,new Int8Array(64),{rootNote:69}]),/full forward loop/);assert.equal(writes,0);owner.core.write=write;
  assert.deepEqual(owner.read(),before);assert.deepEqual(stack(owner.core),ring);assert.deepEqual(owner.core.readRam(),ram);
});

test('resize preserves surviving Self and external routes, dropping only removed operators and outputs',async t=>{
  const owner=await create(t),source=graph([[0],[0],[0,1],[1,2]],[0,3]);setup(owner,{count:4,custom:source});owner.setConfig({mode:'fm6'});
  assert.deepEqual(owner.read().config.fm.custom,graph([[0],[0],[0,1],[1,2],[],[]],[0,3]));owner.setConfig({mode:'fm2'});assert.deepEqual(owner.read().config.fm.custom,graph([[0],[0]],[0]));assert.equal(owner.exportPatch().version,8);
  const removed=graph([[5],[0],[],[],[],[5]],[1,5]);assert.deepEqual(resizeCustomRouting(removed,4),graph([[],[0],[],[]],[1]));assert.deepEqual(removed.inputs[5],[5]);
  setup(owner,{count:6,custom:removed});owner.setConfig({mode:'fm4'});assert(!hasSelfFeedback(owner.read().config.fm.custom));assert.equal(owner.exportPatch().version,6);
  setup(owner,{count:4,custom:source});owner.setConfig({mode:'fm6',fm:{algorithm:'chain'}});assert.deepEqual(owner.read().config.fm.custom,source);assert.equal(owner.exportPatch().version,4);
  owner.setConfig({fm:{algorithm:'custom'}});assert.deepEqual(owner.read().config.fm.custom,graph([[0],[0],[0,1],[1,2],[],[]],[0,3]));assert.equal(owner.exportPatch().version,9);
});

test('v9 scalar/mixed4/6 presets and idle snapshots preserve exact PCM; old versions stay strictly bounded',async t=>{
  for(const count of [4,6])for(const depths of [null,[2,4,6,8,10,12]]){
    const owner=await create(t),copy=await create(t),idle=await create(t);waves(owner);setup(owner,fixture(count,count-1,true));if(depths)owner.setConfig({fm:{depths}});
    const patch=JSON.parse(JSON.stringify(owner.exportPatch()));assert.equal(patch.version,9);assert(hasSelfFeedback(readPatch(patch).fm.custom));copy.loadPatch(patch);idle.loadIdleState(owner.exportIdleState());
    for(const value of [owner,copy,idle])value.noteOn('held',67);const pcm=owner.synth.generateStereo(4096);assert.deepEqual(copy.synth.generateStereo(4096),pcm);assert.deepEqual(idle.synth.generateStereo(4096),pcm);
    const before=copy.read();for(let version=1;version<=8;version++){const invalid=structuredClone(patch);invalid.version=version;if(version===7)invalid.fm.depths=[9,9,9,9,9,9];assert.throws(()=>copy.loadPatch(invalid));assert.deepEqual(copy.read(),before);}
    for(const edit of [value=>{value.mode='fm2';value.fm.custom=graph([[0],[]]);},value=>{value.fm.algorithm='chain';},value=>{value.fm.custom.inputs[count-1]=[];},value=>{delete value.fm.custom;}]){const invalid=structuredClone(patch);edit(invalid);assert.throws(()=>copy.loadPatch(invalid),/version 9/);assert.deepEqual(copy.read(),before);}
  }
});

test('v9 rejects changing preset getters atomically after normalization, and graph snapshots are detached',async t=>{
  const owner=await create(t),source=await create(t);setup(owner,fixture(4,1,true));setup(source,fixture(6,5,true));const session=owner.beginCode().session;owner.code(session,'noteOn',[0,69]);owner.physicalNoteOn('manual',31,60);owner.synth.generateStereo(137);
  const before=owner.read(),ring=stack(owner.core),ram=owner.core.readRam(),write=owner.core.write.bind(owner.core);let writes=0;
  owner.core.write=(...args)=>{writes++;return write(...args);};
  try{for(const changed of ['connection','mode']){
    const preset=source.exportPatch(),original=preset.fm;let reads=0,modes=0;
    if(changed==='connection')Object.defineProperty(preset,'fm',{enumerable:true,configurable:true,get(){return ++reads<=2?original:{...original,algorithm:'chain'};}});
    else{
      Object.defineProperty(preset,'mode',{enumerable:true,configurable:true,get(){return ++modes===1?'fm6':'fm2';}});
      Object.defineProperty(preset,'fm',{enumerable:true,configurable:true,get(){return ++reads<=2?original:{...original,custom:graph([[0],[]])};}});
    }
    assert.throws(()=>owner.loadPatch(preset),/version 9/);assert.equal(writes,0);assert.deepEqual(owner.read(),before);assert.deepEqual(stack(owner.core),ring);assert.deepEqual(owner.core.readRam(),ram);
  }}finally{owner.core.write=write;}
  const request=fixture(6,3,true).custom;let gets=0;owner.setConfig({mode:'fm6',fm:{custom:{get inputs(){gets++;owner.setConfig({fm:{depth:7}});return request.inputs;},outputs:request.outputs}}});
  assert.equal(gets,1);assert.equal(owner.read().config.fm.depth,7);request.inputs[3].length=0;assert.deepEqual(owner.read().config.fm.custom.inputs[3],[3]);const state=owner.read();state.config.fm.custom.inputs[3].length=0;assert.deepEqual(owner.read().config.fm.custom.inputs[3],[3]);
});

test('old Code4OP Self groups keep their own mapping and source controls while a6OP Self patch awaits its next attack',async t=>{
  const owner=await create(t),source=await create(t);waves(owner);waves(source);setup(owner,fixture(4,3,true));setup(source,fixture(6,5,true));const session=owner.beginCode().session;owner.code(session,'noteOn',[0,69]);const previous=owner.read().voiceGroups[0];
  owner.loadPatch(source.exportPatch());assert.deepEqual(owner.read().voiceGroups[0],previous);owner.setConfig({fm:{depths:[2,4,6,12,9,11]}});owner.code(session,'setFrequency',[0,330]);
  let state=owner.read();assert.equal(state.slots[previous.operatorSlots[3]].modulation.depth,12);assert.equal(state.slots[previous.operatorSlots[3]].modulation.xOffset,32);
  for(let index=0;index<4;index++)assert.equal(state.slots[previous.operatorSlots[index]].frequencyHz,330*ratios[index]);
  owner.invoke('setMix',[3,{totalLevel:43}]);owner.setDspSourceSend(3,{input:1,level:5});assert.equal(owner.read().slots[previous.operatorSlots[3]].totalLevel,43);assert.equal(owner.read().dspRouting.slots[previous.operatorSlots[3]].level,5);
  owner.code(session,'noteOn',[0,69]);state=owner.read();assert.equal(state.voiceGroups[0].slots.length,6);assert.deepEqual(state.voiceGroups[0].operatorSlots,[11,10,9,8,7,6]);assert.equal(state.slots[6].modulation.xOffset,32);
});

test('nonself export versions remain4–7,2OP Self remainsv8, and only4/6 Self emitsv9',async t=>{
  const owner=await create(t);assert.equal(owner.exportPatch().version,4);owner.setConfig({mode:'fm2',fm:{algorithm:'custom',custom:graph([[1],[]])}});assert.equal(owner.exportPatch().version,5);
  owner.setConfig({mode:'fm4'});assert.equal(owner.exportPatch().version,6);owner.setConfig({fm:{depths:[2,4,6,8,10,12]}});assert.equal(owner.exportPatch().version,7);
  owner.setConfig({mode:'fm2',fm:{custom:graph([[0],[0]])}});assert.equal(owner.exportPatch().version,8);owner.setConfig({mode:'fm4'});assert.equal(owner.exportPatch().version,9);owner.setConfig({mode:'fm6'});assert.equal(owner.exportPatch().version,9);
  assert.throws(()=>customRouting(graph([[0,1],[],[],[]])));assert.doesNotThrow(()=>customRouting(graph([[0],[1],[],[]])));
});
