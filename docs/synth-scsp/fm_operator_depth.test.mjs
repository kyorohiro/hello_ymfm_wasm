// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../js/scsp.js';
import {SynthInstrument} from './instrument.js';
import {readPatch,settings} from './patch.js';
import {operatorDepth,operatorDepths} from './routing.js';

let module;
async function create(t){
  module??=factory({wasmBinary:await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url))});
  const core=await Scsp.create({moduleFactory:()=>module}),owner=new SynthInstrument(core);
  t.after(()=>owner.dispose());return owner;
}
const depths=[2,4,6,8,10,12],ratios=[1.25,2.5,.5,1.75,3,.75];
function waves(owner){
  for(let index=0;index<6;index++){
    owner.invoke('applyPCM',[index,Int16Array.from({length:64},(_,i)=>Math.round(4000*Math.sin((i+index*3)*Math.PI/32)+1000*Math.sin((index+2)*i*Math.PI/32))),{baseFrequencyHz:44100/64,loopStartSamples:0}]);
    owner.invoke('setMix',[index,{totalLevel:12+index,directLevel:7,pan:0}]);
  }
}
const graph=(inputs,outputs=[0])=>({inputs,outputs});
function configure(owner,mode,algorithm,custom){owner.setConfig({mode,fm:{algorithm,...(custom?{custom}:{}),depth:9,ratios,depths}});}
// Independent raw physical-slot reference. Graphs and source-first orders are
// explicit fixtures rather than a call to routing/voiceCommands/operatorDepth.
function reference(owner,custom,order,values,note=69){
  const state=owner.synth.getState(),slots=[];order.forEach((operator,index)=>{slots[operator]=6+index;});
  for(let operator=0;operator<order.length;operator++){
    const slot=slots[operator],voice=state.slots[operator],inputs=custom.inputs[operator],offsets=inputs.map(source=>(slots[source]-slot+64)%64);
    owner.synth.setPreset(slot,{sample:voice.sample,envelope:voice.envelope,lfo:voice.lfo,totalLevel:voice.totalLevel,directLevel:custom.outputs.includes(operator)?voice.directLevel:0,pan:voice.pan,frequencyHz:440*2**((note-69)/12)*ratios[operator],modulation:{depth:inputs.length?values[operator]:0,xOffset:offsets[0]??0,yOffset:offsets[1]??offsets[0]??0,writeInhibit:false}});
  }
  for(let index=0;index<order.length;index++)owner.synth.keyOn(6+index);
  return slots;
}

test('per-OP hardware MDL matches independent real-WASM 2/4/6-op fixed and Custom references',async t=>{
  const fixtures=[
    ['fm2','chain',graph([[1],[]]),[1,0]],
    ['fm2','custom',graph([[],[0]],[1]),[0,1]],
    ['fm4','pairs',graph([[1],[],[3],[]],[0,2]),[3,2,1,0]],
    ['fm4','custom',graph([[1,2],[3],[3],[]]),[3,2,1,0]],
    ['fm6','branch',graph([[1,2],[3,4],[5],[],[],[]]),[5,4,3,2,1,0]],
    ['fm6','custom',graph([[3,4],[0],[],[5],[2],[]],[0,1,4]),[5,3,2,4,0,1]],
  ];
  for(const [mode,algorithm,custom,order]of fixtures){
    const owner=await create(t),manual=await create(t);for(const value of [owner,manual])waves(value);
    configure(owner,mode,algorithm,algorithm==='custom'?custom:null);owner.noteOn('held',67);
    const slots=reference(manual,custom,order,depths,67),state=owner.read();
    for(let operator=0;operator<order.length;operator++)assert.equal(state.slots[slots[operator]].modulation.depth,custom.inputs[operator].length?depths[operator]:0);
    assert.deepEqual(owner.synth.generateStereo(8192),manual.synth.generateStereo(8192),`${mode}/${algorithm}`);
  }
});

test('X/Y keep separate offsets but share one receiving-operator MDL',async t=>{
  const owner=await create(t);configure(owner,'fm4','custom',graph([[1,2],[3],[3],[]]));owner.noteOn('held',69);
  let voice=owner.read().slots[9];assert.deepEqual(voice.modulation,{depth:2,xOffset:63,yOffset:62,writeInhibit:false});
  const snapshot=owner.read();owner.setConfig({fm:{depths:[11,4,6,8,10,12]}});voice=owner.read().slots[9];
  assert.deepEqual(voice.modulation,{depth:11,xOffset:63,yOffset:62,writeInhibit:false});
  assert.deepEqual(owner.read().voiceGroups[0].slots,snapshot.voiceGroups[0].slots);assert(owner.read().slots[9].gate);
});

test('uniform arrays and scalar edits retain byte-exact legacy v4/v5/v6 exports and PCM',async t=>{
  for(const [mode,algorithm,custom,version]of [
    ['pcm','chain',null,4],['fm4','branch',null,4],
    ['fm2','custom',graph([[],[0]],[1]),5],['fm4','custom',graph([[1,2],[3],[3],[]]),6],
    ['fm6','custom',graph([[3,4],[0],[],[5],[2],[]],[0,1,4]),6],
  ]){
    const owner=await create(t),legacy=await create(t);
    for(const value of [owner,legacy]){waves(value);value.setConfig({mode,fm:{algorithm,...(custom?{custom}:{}),ratios,depth:7}});}
    owner.setConfig({fm:{depth:3,depths:[7,7,7,7,7,7]}});
    assert.equal(owner.read().config.fm.depth,7);assert(!Object.hasOwn(owner.read().config.fm,'depths'));
    assert.equal(owner.exportPatch().version,version);assert.deepEqual(owner.exportPatch(),legacy.exportPatch());
    for(const value of [owner,legacy])value.noteOn('held',69);
    assert.deepEqual(owner.synth.generateStereo(4096),legacy.synth.generateStereo(4096));
  }
});

test('mixed depths persist across 2/4/6/PCM mode changes and scalar-only edits reset all six',async t=>{
  const owner=await create(t);configure(owner,'fm6','custom',graph([[3,4],[0],[],[5],[2],[]],[0,1,4]));
  for(const mode of ['fm2','fm4','fm6','pcm']){
    owner.setConfig({mode,...(mode==='pcm'?{fm:{algorithm:'chain'}}:{})});assert.deepEqual(owner.read().config.fm.depths,depths);
  }
  owner.setConfig({mode:'fm6',fm:{algorithm:'custom'}});owner.noteOn('held',69);
  owner.setConfig({fm:{depth:5}});let state=owner.read();assert(!Object.hasOwn(state.config.fm,'depths'));assert.equal(state.config.fm.depth,5);
  for(const group of state.voiceGroups)assert(!Object.hasOwn(group.config.fm,'depths'));
  owner.setConfig({fm:{depth:1,depths}});state=owner.read();assert.deepEqual(state.config.fm.depths,depths);
  for(let index=0;index<6;index++)assert.equal(operatorDepth(state.config,index),depths[index]);
  owner.setConfig({fm:{depths:[0,0,0,0,0,0]}});assert.equal(owner.read().config.fm.depth,0);assert(!Object.hasOwn(owner.read().config.fm,'depths'));
});

test('live and releasing groups retain gate, allocation, Code/manual/DSP ownership while their depths change',async t=>{
  const owner=await create(t);waves(owner);configure(owner,'fm6','custom',graph([[3,4],[0],[],[5],[2],[]],[0,1,4]));
  for(let index=0;index<6;index++)owner.invoke('setEnvelope',[index,{releaseRate:2}]);
  const session=owner.beginCode().session;owner.code(session,'noteOn',[0,69]);owner.noteOn('keyboard',64);owner.noteOff('keyboard');owner.physicalNoteOn('manual',31,60);
  owner.setEffect({enabled:true});owner.setDspSourceSend(0,{input:1,level:4});owner.setDspReturn(1,{level:5,pan:12});
  owner.setPitchBend(.5);owner.synth.generateStereo(129);
  const before=owner.read(),ram=owner.core.readRam(),program=owner.readDspSetup(),writes=[],write=owner.core.write.bind(owner.core);
  owner.core.write=(...args)=>{writes.push(args);return write(...args);};
  const next=[12,10,8,6,4,2];owner.setConfig({fm:{depths:next}});owner.core.write=write;
  const after=owner.read();assert.equal(after.codeSession,session);assert(after.codeActive);assert.equal(after.pitchBend,.5);
  assert.deepEqual(after.manualVoices,before.manualVoices);assert.deepEqual(after.slots[31],before.slots[31]);
  assert.deepEqual(after.voiceGroups.map(({config,...group})=>group),before.voiceGroups.map(({config,...group})=>group));
  assert.deepEqual(after.playingSampleIds,before.playingSampleIds);assert.deepEqual(after.dspRouting,before.dspRouting);assert.deepEqual(owner.readDspSetup(),program);assert.deepEqual(owner.core.readRam(),ram);
  assert(writes.every(([address])=>address<0x400?address%32!==0:true),'no KON/KYONEX writes during depth changes');
  for(const group of after.voiceGroups){
    assert.deepEqual(group.config.fm.depths,next);
    group.operatorSlots.forEach((slot,index)=>assert.equal(after.slots[slot].modulation.depth,group.config.fm.custom.inputs[index].length?next[index]:0));
  }
  assert.equal(after.voiceGroups.find(group=>group.id==='keyboard').held,false);
});

test('global and per-OP edits reach old Code groups through their saved mapping after another preset is loaded',async t=>{
  const owner=await create(t),source=await create(t);waves(owner);waves(source);
  configure(owner,'fm6','custom',graph([[3,4],[0],[],[5],[2],[]],[0,1,4]));
  const session=owner.beginCode().session;owner.code(session,'noteOn',[0,69]);const old=owner.read().voiceGroups[0];
  source.setConfig({mode:'fm2',fm:{algorithm:'chain',depth:9}});owner.loadPatch(source.exportPatch());
  assert.deepEqual(owner.read().voiceGroups[0],old);owner.setConfig({fm:{depths:[1,3,5,7,9,11]}});
  let state=owner.read();assert.deepEqual(state.voiceGroups[0].operatorSlots,[10,11,8,7,9,6]);
  assert.equal(state.slots[10].modulation.depth,1);assert.equal(state.slots[11].modulation.depth,3);assert.equal(state.slots[7].modulation.depth,7);assert.equal(state.slots[9].modulation.depth,9);
  owner.setConfig({fm:{depth:6}});state=owner.read();assert(!Object.hasOwn(state.voiceGroups[0].config.fm,'depths'));
  for(const slot of [10,11,7,9])assert.equal(state.slots[slot].modulation.depth,6);
  owner.code(session,'noteOn',[0,69]);state=owner.read();assert.equal(state.voiceGroups[0].slots.length,2);assert.equal(state.slots[7].modulation.depth,6);
});

test('invalid depth requests leave exact owners, metadata, PCM, RAM and audio writes untouched',async t=>{
  const owner=await create(t),referenceOwner=await create(t);
  for(const value of [owner,referenceOwner]){waves(value);configure(value,'fm4','custom',graph([[1,2],[3],[3],[]]));value.noteOn('held',69);value.synth.generateStereo(137);}
  const before=owner.read(),ram=owner.core.readRam(),write=owner.core.write.bind(owner.core);let writes=0;
  owner.core.write=(...args)=>{writes++;return write(...args);};
  const sparse=[1,2,3,4,5,6];delete sparse[3];const extra=[...depths];extra.extra=0;const symbol=[...depths];symbol[Symbol('unknown')]=1;
  for(const value of [undefined,null,{},new Uint8Array(depths),[],[1,2,3,4,5],[1,2,3,4,5,6,7],sparse,extra,symbol,[0,1,2,3,4,13],[0,1,2,3,4,-1],[0,1,2,3,4,NaN],[0,1,2,3,4,undefined],[0,1,2,3,4,1.5]]){
    assert.throws(()=>owner.setConfig({fm:{depths:value}}));assert.deepEqual(owner.read(),before);
  }
  assert.throws(()=>owner.setConfig({fm:{depth:99,depths}}));assert.equal(writes,0);owner.core.write=write;
  assert.deepEqual(owner.core.readRam(),ram);assert.deepEqual(owner.synth.generateStereo(4096),referenceOwner.synth.generateStereo(4096));
});

test('depth getters materialize once before the live merge and returned configurations never alias',async t=>{
  const owner=await create(t);owner.setConfig({mode:'fm4',fm:{algorithm:'branch'}});owner.noteOn('held',69);
  let outer=0,inner=0;const request=[2,4,6,8,10,12];
  Object.defineProperty(request,0,{enumerable:true,configurable:true,get(){inner++;owner.setConfig({transpose:2});return 2;}});
  const accepted=owner.setConfig({fm:{get depths(){outer++;return request;}}});
  assert.equal(outer,1);assert.equal(inner,1);assert.equal(owner.read().config.transpose,2);assert.deepEqual(owner.read().config.fm.depths,depths);
  accepted.fm.depths.fill(0);const state=owner.read();state.config.fm.depths.fill(0);state.voiceGroups[0].config.fm.depths.fill(0);
  assert.deepEqual(owner.read().config.fm.depths,depths);assert.deepEqual(owner.read().voiceGroups[0].config.fm.depths,depths);
  const copied=operatorDepths(depths);copied[0]=12;assert.equal(depths[0],2);
  const normalized=settings({...owner.read().config,fm:{...owner.read().config.fm,depths:[4,4,4,4,4,4]}});assert.equal(normalized.fm.depth,4);assert(!Object.hasOwn(normalized.fm,'depths'));
});

test('v7 fixed/Custom 2/4/6 and PCM presets plus idle snapshots preserve mixed depths and exact native PCM',async t=>{
  for(const [mode,algorithm,custom]of [
    ['pcm','chain',null],['fm4','branch',null],['fm2','custom',graph([[],[0]],[1])],
    ['fm4','custom',graph([[1,2],[3],[3],[]])],['fm6','custom',graph([[3,4],[0],[],[5],[2],[]],[0,1,4])],
  ]){
    const owner=await create(t),copy=await create(t),idle=await create(t);waves(owner);configure(owner,mode,algorithm,custom);
    const patch=JSON.parse(JSON.stringify(owner.exportPatch()));assert.equal(patch.version,7);assert.deepEqual(patch.fm.depths,depths);assert.deepEqual(readPatch(patch).fm.depths,depths);
    copy.loadPatch(patch);idle.loadIdleState(owner.exportIdleState());assert.deepEqual(idle.read().config,owner.read().config);
    for(const value of [owner,copy,idle])value.noteOn('held',67);
    const pcm=owner.synth.generateStereo(4096);assert.deepEqual(copy.synth.generateStereo(4096),pcm);assert.deepEqual(idle.synth.generateStereo(4096),pcm);
    const before=copy.read(),missing=structuredClone(patch);delete missing.fm.depths;
    assert.throws(()=>copy.loadPatch(missing),/version 7/);assert.deepEqual(copy.read(),before);
    if(custom){const invalid=structuredClone(patch);delete invalid.fm.custom;assert.throws(()=>copy.loadPatch(invalid),/version 7/);assert.deepEqual(copy.read(),before);}
  }
});

test('v1–v6 never accept explicit depths, v7 uniform imports downgrade canonically and fixed exports omit dormant Custom',async t=>{
  const owner=await create(t);configure(owner,'fm4','custom',graph([[1,2],[3],[3],[]]));const patch=owner.exportPatch();
  for(let version=1;version<=6;version++)for(const value of [depths,[3,3,3,3,3,3],undefined]){
    const invalid=structuredClone(patch);invalid.version=version;invalid.fm.depths=value;assert.throws(()=>readPatch(invalid),/version 7/);
  }
  const uniform=structuredClone(patch);uniform.fm.depths.fill(5);owner.loadPatch(uniform);
  assert.equal(owner.read().config.fm.depth,5);assert(!Object.hasOwn(owner.read().config.fm,'depths'));assert.equal(owner.exportPatch().version,6);
  owner.setConfig({fm:{algorithm:'chain',depths}});const fixed=owner.exportPatch();assert.equal(fixed.version,7);assert(!Object.hasOwn(fixed.fm,'custom'));
  assert(Object.hasOwn(owner.read().config.fm,'custom'));assert.deepEqual(fixed.fm.depths,depths);
});

test('mixed depths are dormant in PCM and never alter the native PCM waveform or unrelated physical modulation',async t=>{
  const owner=await create(t),referenceOwner=await create(t);
  for(const value of [owner,referenceOwner]){waves(value);value.noteOn('held',69);value.synth.generateStereo(137);}
  owner.setConfig({fm:{depths}});assert.deepEqual(owner.synth.generateStereo(4096),referenceOwner.synth.generateStereo(4096));
  owner.invokePhysical('setModulation',[31,{depth:11,xOffset:3,yOffset:4}]);const manual=owner.read().slots[31].modulation;
  owner.setConfig({fm:{depth:3}});assert.deepEqual(owner.read().slots[31].modulation,manual);
});
