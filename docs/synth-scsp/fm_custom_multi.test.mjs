// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../js/scsp.js';
import {SynthInstrument} from './instrument.js';
import {settings,readPatch} from './patch.js';
import {customRouting,resizeCustomRouting,operatorSlot} from './routing.js';

let module;
async function create(t){
  module??=factory({wasmBinary:await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url))});
  const core=await Scsp.create({moduleFactory:()=>module}),owner=new SynthInstrument(core);
  t.after(()=>owner.dispose());return owner;
}
const graph=(inputs,outputs=[0])=>({inputs,outputs});
const ratios=[1.25,2.5,.5,1.75,3,.75];
const setup=(owner,custom)=>owner.setConfig({mode:`fm${custom.inputs.length}`,fm:{algorithm:'custom',custom,depth:8,ratios}});
function waves(owner){
  for(let index=0;index<6;index++){
    const pcm=Int16Array.from({length:64},(_,i)=>Math.round(4000*Math.sin((i+index*3)*Math.PI/32)+1000*Math.sin((index+2)*i*Math.PI/32)));
    owner.invoke('applyPCM',[index,pcm,{baseFrequencyHz:44100/64,loopStartSamples:0}]);
    owner.invoke('setMix',[index,{totalLevel:index+12,directLevel:7,pan:0}]);
  }
}
// Independent physical-slot reference: every test supplies an explicit known
// dependency order. No production routing, topology or command helper is used.
function manualReference(owner,custom,order,note=69){
  const state=owner.synth.getState(),frequency=440*2**((note-69)/12),slots=[];
  order.forEach((operator,position)=>{slots[operator]=6+position;});
  for(let index=0;index<custom.inputs.length;index++){
    const voice=state.slots[index],slot=slots[index],sources=custom.inputs[index];
    const offsets=sources.map(source=>(slots[source]-slot+64)%64);
    owner.synth.setPreset(slot,{sample:voice.sample,envelope:voice.envelope,lfo:voice.lfo,totalLevel:voice.totalLevel,
      directLevel:custom.outputs.includes(index)?voice.directLevel:0,pan:voice.pan,frequencyHz:frequency*ratios[index],
      modulation:{depth:sources.length?8:0,xOffset:offsets[0]??0,yOffset:offsets[1]??offsets[0]??0,writeInhibit:false}});
  }
  for(let position=0;position<order.length;position++)owner.synth.keyOn(6+position);
  return slots;
}

test('4/6-op branches, merges, backwards-ID dependencies and multiple outputs match independent real-WASM references',async t=>{
  const cases=[
    [graph([[1,2],[3],[3],[]]),[3,2,1,0]],
    [graph([[],[0],[0,1],[2]],[1,3]),[0,1,2,3]],
    [graph([[3,4],[0],[],[5],[2],[]],[0,1,4]),[5,3,2,4,0,1]],
    [graph([[1,2],[3,4],[4,5],[],[],[]],[0,2]),[5,4,3,2,1,0]],
  ];
  for(const [custom,order]of cases){
    const owner=await create(t),reference=await create(t);
    for(const value of [owner,reference])waves(value);
    setup(owner,custom);owner.noteOn('voice',67);
    const slots=manualReference(reference,custom,order,67);
    assert.deepEqual(owner.read().voiceGroups[0].operatorSlots,slots);
    assert.deepEqual(owner.synth.generateStereo(8192),reference.synth.generateStereo(8192),JSON.stringify(custom));
    const state=owner.read();custom.inputs.forEach((sources,index)=>{
      const modulation=state.slots[slots[index]].modulation,offsets=sources.map(source=>(slots[source]-slots[index]+64)%64);
      assert.equal(modulation.xOffset,offsets[0]??0);assert.equal(modulation.yOffset,offsets[1]??offsets[0]??0);
    });
  }
});

test('native two-input averaging preserves duplicate-source level and differs from a single full-level input',async t=>{
  const one=await create(t),two=await create(t),half=await create(t),reference=await create(t);
  const single=graph([[1],[],[],[]]),dual=graph([[1,2],[],[],[]]);
  for(const owner of [one,two,half,reference]){
    waves(owner);
    const source=owner.invoke('getPCM',[1]);
    owner.invoke('applyPCM',[2,source.pcm,{baseFrequencyHz:44100/64,loopStartSamples:0}]);
    owner.invoke('setMix',[2,{totalLevel:13}]);
  }
  for(const owner of [half,reference])owner.invoke('applyPCM',[2,new Int16Array(64),{baseFrequencyHz:44100/64,loopStartSamples:0}]);
  // B and C have identical sample, envelope, pitch and level in the first pair.
  for(const [owner,custom]of [[one,single],[two,dual],[half,dual]]){
    setup(owner,custom);owner.setConfig({fm:{ratios:[1.25,2.5,2.5,1.75,3,.75]}});owner.noteOn('held',69);
  }
  // Manual reference uses B/C at the same frequency, with C silent.
  manualReference(reference,dual,[3,2,1,0]);reference.synth.setFrequency(7,440*2.5);
  const baseline=one.synth.generateStereo(4096),equal=two.synth.generateStereo(4096),averaged=half.synth.generateStereo(4096);
  assert.deepEqual(equal,baseline,'(B+B)/2 must retain the one-input level');
  assert.notDeepEqual(averaged,baseline,'(B+0)/2 must not behave as duplicated B');
  assert.deepEqual(averaged,reference.synth.generateStereo(4096));
});

test('fixed Chain, Pairs and Branch become exactly equivalent Custom templates at 2/4/6 operators',async t=>{
  for(const count of [2,4,6])for(const algorithm of ['chain','pairs','branch']){
    const custom=await create(t),legacy=await create(t);
    for(const owner of [custom,legacy]){waves(owner);owner.setConfig({mode:`fm${count}`,fm:{algorithm,depth:8,ratios}});}
    const template=custom.read().routing;custom.setConfig({fm:{algorithm:'custom'}});
    assert.deepEqual(custom.read().config.fm.custom,{inputs:template.inputs,outputs:template.outputs});
    for(const owner of [custom,legacy])owner.noteOn('held',69);
    assert.deepEqual(custom.read().voiceGroups[0].operatorSlots,Array.from({length:count},(_,index)=>5+count-index));
    assert.deepEqual(custom.synth.generateStereo(4096),legacy.synth.generateStereo(4096),`${count} ${algorithm}`);
  }
});

test('implicit resize preserves surviving routes, adds disconnected OPs and never invents outputs',async t=>{
  const owner=await create(t),original=graph([[5,2],[4],[],[],[],[]],[5]);setup(owner,original);
  owner.setConfig({mode:'fm4'});assert.deepEqual(owner.read().config.fm.custom,graph([[2],[],[],[]],[]));
  owner.setConfig({mode:'fm2'});assert.deepEqual(owner.read().config.fm.custom,graph([[],[]],[]));
  owner.setConfig({mode:'fm6'});assert.deepEqual(owner.read().config.fm.custom,graph([[],[],[],[],[],[]],[]));
  assert.deepEqual(original,graph([[5,2],[4],[],[],[],[]],[5]));
  const resized=resizeCustomRouting(original,4);resized.inputs[0].length=0;
  assert.deepEqual(original.inputs[0],[5,2]);assert.throws(()=>resizeCustomRouting(original,3));
});

test('dormant Custom can differ from fixed mode count and is resized only on re-entry',async t=>{
  const owner=await create(t),stored=graph([[],[0],[1],[]],[2]);
  owner.setConfig({mode:'fm2',fm:{algorithm:'pairs',custom:stored}});
  assert.deepEqual(owner.read().config.fm.custom,stored);
  const exported=owner.exportPatch();assert.equal(exported.version,4);assert(!Object.hasOwn(exported.fm,'custom'));
  owner.setConfig({mode:'fm6',fm:{algorithm:'custom'}});
  assert.deepEqual(owner.read().config.fm.custom,graph([[],[0],[1],[],[],[]],[2]));
  owner.setConfig({mode:'pcm',fm:{algorithm:'chain'}});
  assert.equal(owner.read().config.fm.custom.inputs.length,6);
  owner.setConfig({mode:'fm4',fm:{algorithm:'custom'}});
  assert.deepEqual(owner.read().config.fm.custom,stored);
});

test('invalid, cyclic, sparse, duplicate, unknown and count-mismatched requests are completely atomic',async t=>{
  const owner=await create(t),reference=await create(t),valid=graph([[1,2],[3],[],[]]);
  for(const value of [owner,reference]){waves(value);setup(value,valid);value.noteOn('held',69);value.synth.generateStereo(127);}
  const before=owner.read(),ram=owner.core.readRam();let writes=0;const write=owner.core.write.bind(owner.core);
  owner.core.write=(...args)=>{writes++;return write(...args);};
  const sparse=Array(4);sparse[0]=[];sparse[1]=[];sparse[3]=[];
  const badInner=Array(1);
  for(const custom of [
    graph([[1],[2],[0],[]]),graph([[1],[2],[3],[0]]),graph([[0],[],[],[]]),
    graph([[1,1],[],[],[]]),graph([[1,2,3],[],[],[]]),graph([[4],[],[],[]]),
    graph(sparse),graph([badInner,[],[],[]]),graph([[],[],[],[]],[0,0]),graph([[],[],[],[]],Array(1)),
    {...valid,unknown:true},{...valid,[Symbol('unknown')]:true},graph([[],[]]),graph([[],[],[],[],[],[]]),
  ])assert.throws(()=>owner.setConfig({fm:{custom}}));
  for(const patch of [{mode:'pcm'},{mode:'fm6',fm:{custom:valid}},{fm:{algorithm:'unknown'}},{fm:{depth:13}},{fm:{custom:{...valid,outputs:[4]}}}])assert.throws(()=>owner.setConfig(patch));
  assert.equal(writes,0);owner.core.write=write;assert.deepEqual(owner.read(),before);assert.deepEqual(owner.core.readRam(),ram);
  assert.deepEqual(owner.synth.generateStereo(4096),reference.synth.generateStereo(4096));
});

test('multi-op identity follows live controls, bends, DSP source routing and release',async t=>{
  const owner=await create(t),custom=graph([[3,4],[0],[],[5],[2],[]],[0,1,4]);setup(owner,custom);owner.noteOn('held',69);
  const group=owner.read().voiceGroups[0],slots=[10,11,8,7,9,6];assert.deepEqual(group.operatorSlots,slots);
  for(let index=0;index<6;index++){
    owner.invoke('setMix',[index,{totalLevel:20+index}]);owner.invoke('setLfo',[index,{frequencyCode:index+10,pitchDepth:2}]);
    owner.setDspSourceSend(index,{input:index%2,level:3+index%3});
  }
  owner.setConfig({fm:{depth:7,ratios:[1,2,3,4,5,6]},transpose:2});owner.setPitchBend(.5);
  const state=owner.read();for(let index=0;index<6;index++){
    const slot=slots[index],voice=state.slots[slot];assert.equal(operatorSlot(group,index),slot);
    assert.equal(voice.totalLevel,20+index);assert.equal(voice.lfo.frequencyCode,index+10);
    assert.equal(voice.modulation.depth,custom.inputs[index].length?7:0);
    assert.equal(voice.directLevel,custom.outputs.includes(index)?7:0);
    assert(Math.abs(voice.frequencyHz-440*2**(2.5/12)*(index+1))<1e-8);
    assert.equal(state.dspRouting.slots[slot].input,index%2);assert.equal(state.dspRouting.slots[slot].level,3+index%3);
  }
  assert(owner.noteOff('held'));assert(slots.every(slot=>!owner.read().slots[slot].gate));
  owner.stopVoices();assert(owner.synth.generateStereo(256).left.every(value=>value===0));
});

test('Code session, physical owners, six-slot allocation and stale stolen identities remain safe',async t=>{
  const owner=await create(t);setup(owner,graph([[1,2],[3,4],[4,5],[],[],[]]));
  const session=owner.beginCode().session;owner.code(session,'noteOn',[0,69]);owner.physicalNoteOn('manual',31,60);
  const manual=owner.read().manualVoices;owner.setConfig({mode:'fm4'});
  assert(owner.read().codeActive);assert.equal(owner.read().codeSession,session);assert.deepEqual(owner.read().manualVoices,manual);assert(owner.read().slots[31].gate);
  assert.equal(owner.code(session,'noteOff',[0]),false);owner.stopVoices();owner.setConfig({mode:'fm6'});
  for(let index=0;index<4;index++)owner.noteOn(`old${index}`,60+index);
  assert.equal(owner.read().voiceCapacity,4);owner.noteOff('old2');const next=owner.noteOn('new',69);
  assert.equal(next.stolenId,'old2');assert.deepEqual(next.slots,[18,19,20,21,22,23]);assert.equal(owner.noteOff('old2'),false);
  assert(next.slots.every(slot=>owner.read().slots[slot].gate));
});

test('v6 4/6-op presets and idle state round-trip, while raw v5 stays strictly Custom2',async t=>{
  for(const custom of [graph([[1,2],[3],[],[]],[0,2]),graph([[3,4],[0],[],[5],[2],[]],[0,1,4])]){
    const owner=await create(t),copy=await create(t),idle=await create(t);waves(owner);setup(owner,custom);
    const patch=JSON.parse(JSON.stringify(owner.exportPatch()));assert.equal(patch.version,6);assert.deepEqual(readPatch(patch).fm.custom,custom);
    copy.loadPatch(patch);idle.loadIdleState(owner.exportIdleState());assert.deepEqual(idle.read().config,owner.read().config);
    for(const value of [owner,copy,idle])value.noteOn('voice',67);
    const pcm=owner.synth.generateStereo(4096);assert.deepEqual(copy.synth.generateStereo(4096),pcm);assert.deepEqual(idle.synth.generateStereo(4096),pcm);
    const before=copy.read();for(const version of [1,2,3,4,5]){
      const bad=structuredClone(patch);bad.version=version;assert.throws(()=>copy.loadPatch(bad));assert.deepEqual(copy.read(),before);
    }
    const bad=structuredClone(patch);bad.mode='fm2';assert.throws(()=>copy.loadPatch(bad),/version 6/);
    bad.mode='fm4';bad.fm.algorithm='chain';assert.throws(()=>copy.loadPatch(bad),/version 6/);
  }
  const two=await create(t);setup(two,graph([[],[0]],[1]));const v5=two.exportPatch();assert.equal(v5.version,5);
  const bad=structuredClone(v5);bad.fm.custom=graph([[],[],[],[]]);assert.throws(()=>readPatch(bad),/count/);
});

test('loading another count during Code preserves old group routes and mapped live/DSP edits until the next attack',async t=>{
  const owner=await create(t),next=await create(t);waves(owner);waves(next);
  setup(owner,graph([[3,4],[0],[],[5],[2],[]],[0,1,4]));setup(next,graph([[],[0],[0,1],[2]],[3]));
  const session=owner.beginCode().session;owner.code(session,'noteOn',[0,69]);const old=owner.read().voiceGroups[0],samples=owner.read().playingSampleIds;
  owner.loadPatch(next.exportPatch());assert.equal(owner.read().codeSession,session);assert(owner.read().codeActive);
  assert.deepEqual(owner.read().voiceGroups[0],old);assert.deepEqual(owner.read().playingSampleIds,samples);
  owner.invoke('setMix',[5,{totalLevel:51}]);owner.setDspSourceSend(5,{input:1,level:6});owner.setConfig({fm:{depth:6}});
  owner.code(session,'setFrequency',[0,330]);const state=owner.read();
  assert.equal(state.slots[6].totalLevel,51);assert.equal(state.dspRouting.slots[6].level,6);
  for(let index=0;index<6;index++)assert.equal(state.slots[old.operatorSlots[index]].frequencyHz,330*ratios[index]);
  assert.equal(state.slots[10].modulation.depth,6);assert.equal(state.slots[6].modulation.depth,0);
  owner.code(session,'noteOn',[0,69]);assert.equal(owner.read().voiceGroups[0].operatorSlots.length,4);
  assert.deepEqual(owner.read().voiceGroups[0].operatorSlots,[6,7,8,9]);
});

test('getters resolve once before merging, no-op routes retain voices, and caller/read graphs are detached',async t=>{
  const owner=await create(t),custom=graph([[3,4],[0],[],[5],[2],[]],[0,1,4]);setup(owner,custom);owner.noteOn('held',69);
  const before=owner.read().voiceGroups[0];let calls=0;
  owner.setConfig({fm:{custom:{get inputs(){calls++;owner.setConfig({fm:{depth:7}});return custom.inputs;},get outputs(){calls++;return [4,1,0];}}}});
  assert.equal(calls,2);assert.equal(owner.read().config.fm.depth,7);assert.deepEqual(owner.read().voiceGroups[0].operatorSlots,before.operatorSlots);assert.equal(owner.read().voiceGroups.length,1);
  custom.inputs[0].length=0;custom.outputs.length=0;assert.deepEqual(owner.read().config.fm.custom.inputs[0],[3,4]);
  const state=owner.read();state.config.fm.custom.inputs[0].length=0;state.voiceGroups[0].operatorSlots.fill(31);state.voiceGroups[0].config.fm.custom.outputs.length=0;
  assert.deepEqual(owner.read().config.fm.custom.inputs[0],[3,4]);assert.deepEqual(owner.read().voiceGroups[0].operatorSlots,before.operatorSlots);
  assert.deepEqual(owner.read().voiceGroups[0].config.fm.custom.outputs,[0,1,4]);
  const normalized=settings({...owner.read().config,fm:{...owner.read().config.fm,custom:graph([[],[],[],[],[],[]],[5,0])}});
  assert.deepEqual(normalized.fm.custom.outputs,[0,5]);assert.deepEqual(customRouting().inputs,[[1],[]]);
});

test('multi-op loop guards reject destructive PCM replacement and incompatible routes before mutation',async t=>{
  const owner=await create(t);setup(owner,graph([[1,2],[3],[],[]]));owner.noteOn('held',69);
  let before=owner.read(),ram=owner.core.readRam();
  for(const method of ['invoke','invokePhysical'])assert.throws(()=>owner[method]('applyPCM',[0,new Int16Array(64).fill(1000),{rootNote:69}]),/full forward loop/);
  assert.deepEqual(owner.read(),before);assert.deepEqual(owner.core.readRam(),ram);
  owner.setConfig({fm:{custom:graph([[],[],[],[]])}});owner.invoke('applyPCM',[2,new Int16Array(64).fill(1000),{rootNote:69}]);
  owner.noteOn('plain',69);before=owner.read();ram=owner.core.readRam();
  assert.throws(()=>owner.setConfig({fm:{custom:graph([[],[],[3],[]])}}),/full forward loop/);
  assert.deepEqual(owner.read(),before);assert.deepEqual(owner.core.readRam(),ram);
});
