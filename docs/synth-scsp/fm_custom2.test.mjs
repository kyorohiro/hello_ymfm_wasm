// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../js/scsp.js';
import {SynthInstrument} from './instrument.js';
import {settings,readPatch} from './patch.js';
import {customRouting,operatorSlot} from './routing.js';

let module;
async function create(t){
  module??=factory({wasmBinary:await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url))});
  const core=await Scsp.create({moduleFactory:()=>module}),owner=new SynthInstrument(core);
  t.after(()=>owner.dispose());return owner;
}
const graph=(inputs=[[1],[]],outputs=[0])=>({inputs,outputs});
const setup=(owner,custom)=>owner.setConfig({mode:'fm2',fm:{algorithm:'custom',custom,depth:9,ratios:[1.25,2.5,1,1,1,1]}});
const peak=pcm=>pcm.reduce((value,sample)=>Math.max(value,Math.abs(sample)),0);
function waves(owner){
  owner.invoke('applyPCM',[0,Int16Array.from({length:64},(_,i)=>Math.round(6000*Math.sin(i*Math.PI/32))),{baseFrequencyHz:44100/64,loopStartSamples:0}]);
  owner.invoke('applyPCM',[1,Int8Array.from({length:64},(_,i)=>Math.round(40*(2*i/64-1))),{baseFrequencyHz:44100/64,loopStartSamples:0}]);
  owner.invoke('setMix',[0,{totalLevel:12}]);owner.invoke('setMix',[1,{totalLevel:6}]);
}
// An independent physical two-slot reference, with explicit mappings/offsets.
// It does not call routing(), voiceCommands() or operatorSlot().
function manualReference(owner,custom,note=69){
  const sourceFirst=custom.inputs[1].length>0?[0,1]:[1,0],state=owner.synth.getState(),frequency=440*2**((note-69)/12);
  for(let position=0;position<2;position++){
    const operator=sourceFirst[position],voice=state.slots[operator],input=custom.inputs[operator];
    owner.synth.setPreset(6+position,{sample:voice.sample,envelope:voice.envelope,lfo:voice.lfo,totalLevel:voice.totalLevel,
      directLevel:custom.outputs.includes(operator)?voice.directLevel:0,pan:voice.pan,frequencyHz:frequency*(operator===0?1.25:2.5),
      modulation:{depth:input.length?9:0,xOffset:input.length?63:0,yOffset:input.length?63:0,writeInhibit:false}});
  }
  owner.synth.keyOn(6);owner.synth.keyOn(7);
}

test('entering Custom defaults to the legacy B-to-A pair and preserves exact old shape until opt-in',async t=>{
  const custom=await create(t),legacy=await create(t);
  const original=custom.read();assert(!Object.hasOwn(original.config.fm,'custom'));
  assert.equal(custom.exportPatch().version,4);
  for(const owner of [custom,legacy]){waves(owner);owner.setConfig({mode:'fm2',fm:{ratios:[1.25,2.5,1,1,1,1]}});}
  custom.setConfig({fm:{algorithm:'custom'}});
  assert.deepEqual(custom.read().config.fm.custom,graph());
  for(const owner of [custom,legacy])owner.noteOn('held',69);
  assert.deepEqual(custom.read().voiceGroups[0].operatorSlots,[7,6]);
  assert(!Object.hasOwn(legacy.read().voiceGroups[0],'operatorSlots'));
  assert.deepEqual(custom.synth.generateStereo(8192),legacy.synth.generateStereo(8192));
});

test('A-to-B, B-to-A and independent direct outputs match explicit real-WASM physical references',async t=>{
  for(const inputs of [[[],[0]],[[1],[]],[[],[]]])for(const outputs of [[],[0],[1],[0,1]]){
    const custom=graph(inputs,outputs);
    const owner=await create(t),reference=await create(t);
    for(const value of [owner,reference])waves(value);
    setup(owner,custom);owner.noteOn('voice',69);manualReference(reference,custom);
    const actual=owner.synth.generateStereo(8192),expected=reference.synth.generateStereo(8192);
    assert.deepEqual(actual,expected,JSON.stringify(custom));
    if(custom.outputs.length)assert(peak(actual.left)>.001);else assert.equal(peak(actual.left),0);
    const group=owner.read().voiceGroups[0];
    assert.deepEqual(group.operatorSlots,custom.inputs[1].length?[6,7]:[7,6]);
  }
});

test('operator identity follows reverse wiring through live controls, DSP sends, bend and release',async t=>{
  const owner=await create(t);setup(owner,graph([[],[0]],[1]));owner.noteOn('held',69);
  let state=owner.read(),group=state.voiceGroups[0];assert.equal(operatorSlot(group,0),6);assert.equal(operatorSlot(group,1),7);
  owner.invoke('setMix',[0,{totalLevel:46}]);owner.invoke('setLfo',[1,{frequencyCode:17,pitchDepth:2}]);
  owner.setConfig({fm:{ratios:[.5,3,1,1,1,1],depth:7},transpose:2});owner.setPitchBend(.5);
  state=owner.read();assert.equal(state.slots[6].totalLevel,46);assert.equal(state.slots[7].lfo.frequencyCode,17);
  assert.equal(state.slots[6].modulation.depth,0);assert.equal(state.slots[7].modulation.depth,7);
  assert(Math.abs(state.slots[6].frequencyHz-440*2**(2.5/12)*.5)<1e-8);
  assert(Math.abs(state.slots[7].frequencyHz-440*2**(2.5/12)*3)<1e-8);
  owner.setEffect({enabled:true});owner.setDspSourceSend(0,{input:1,level:4});owner.setDspSourceSend(1,{input:0,level:5});
  assert.equal(owner.core.read(6*32+20)&127,12);assert.equal(owner.core.read(7*32+20)&127,5);
  assert(owner.noteOff('held'));assert(owner.read().slots.slice(6,8).every(slot=>!slot.gate));
  owner.stopVoices();assert.equal(peak(owner.synth.generateStereo(256).left),0);
});

test('invalid graphs and loop-incompatible PCM leave metadata, owners, RAM and effective audio unchanged',async t=>{
  const owner=await create(t),reference=await create(t);
  for(const value of [owner,reference]){setup(value,graph([[],[0]],[1]));value.noteOn('held',69);value.synth.generateStereo(127);}
  const before=owner.read(),ram=owner.core.readRam();let writes=0;const write=owner.core.write.bind(owner.core);
  owner.core.write=(...args)=>{writes++;return write(...args);};
  const sparse=Array(2);sparse[0]=[];
  for(const custom of [null,undefined,{},graph([[0],[]],[0]),graph([[1],[0]],[0]),graph([[1,1],[]],[0]),graph([[],[2]],[1]),graph([[],[]],[0,0]),graph(sparse,[0]),graph([[],[]],Array(1)),{...graph(),unknown:true},{...graph(),[Symbol('hidden')]:0}]){
    assert.throws(()=>owner.setConfig({fm:{custom}}));assert.deepEqual(owner.read(),before);
  }
  assert.throws(()=>owner.setConfig({mode:'fm4',fm:{custom:graph()}}),/input count/);assert.equal(writes,0);owner.core.write=write;
  assert.deepEqual(owner.core.readRam(),ram);assert.deepEqual(owner.synth.generateStereo(4096),reference.synth.generateStereo(4096));
  const shot=await create(t);shot.invoke('applyPCM',[1,new Int16Array(64).fill(1000),{rootNote:69}]);shot.noteOn('pcm',69);
  const saved=shot.read();assert.throws(()=>setup(shot,graph([[],[0]],[1])),/full forward loop/);assert.deepEqual(shot.read(),saved);
});

test('graph changes preserve the Code session and unrelated manual owner, while stolen pair leases stay safe',async t=>{
  const owner=await create(t);setup(owner,graph([[],[0]],[1]));const session=owner.beginCode().session;
  owner.code(session,'noteOn',[0,69]);owner.physicalNoteOn('manual',31,60);
  const manual=owner.read().manualVoices;
  owner.setConfig({fm:{custom:graph([[1],[]],[0,1])}});
  assert.equal(owner.read().codeSession,session);assert(owner.read().codeActive);assert.deepEqual(owner.read().manualVoices,manual);
  assert(owner.read().slots[31].gate);assert.equal(owner.read().voiceGroups.length,0);assert.equal(owner.code(session,'noteOff',[0]),false);
  owner.code(session,'noteOn',[0,72]);assert.deepEqual(owner.read().voiceGroups[0].operatorSlots,[7,6]);
  owner.stopVoices();for(let n=0;n<13;n++)owner.noteOn('key'+n,60+n%12);owner.noteOff('key7');
  const replacement=owner.noteOn('new',69);assert.equal(replacement.stolenId,'key7');assert.deepEqual(replacement.slots,[20,21]);
  assert.equal(owner.noteOff('key7'),false);assert(owner.read().slots[21].gate);
});

test('custom v5 presets and idle migration restore graph, while v1-v4 cannot silently carry custom routing',async t=>{
  const owner=await create(t),copy=await create(t),idle=await create(t);waves(owner);setup(owner,graph([[],[0]],[0,1]));
  const patch=JSON.parse(JSON.stringify(owner.exportPatch()));assert.equal(patch.version,5);assert.deepEqual(readPatch(patch).fm.custom,graph([[],[0]],[0,1]));
  copy.loadPatch(patch);idle.loadIdleState(owner.exportIdleState());assert.deepEqual(idle.read().config,owner.read().config);
  for(const value of [owner,copy,idle])value.noteOn('voice',67);
  const expected=owner.synth.generateStereo(4096);assert.deepEqual(copy.synth.generateStereo(4096),expected);assert.deepEqual(idle.synth.generateStereo(4096),expected);
  const before=copy.read();for(const version of [1,2,3,4]){const invalid=structuredClone(patch);invalid.version=version;assert.throws(()=>copy.loadPatch(invalid));assert.deepEqual(copy.read(),before);}
  const legacy=structuredClone(patch);legacy.version=4;legacy.fm.algorithm='chain';delete legacy.fm.custom;
  const invalid=structuredClone(legacy);invalid.version=5;assert.throws(()=>copy.loadPatch(invalid));
  owner.setConfig({fm:{algorithm:'chain'}});const exported=owner.exportPatch();assert.equal(exported.version,4);assert(!Object.hasOwn(exported.fm,'custom'));
  assert(Object.hasOwn(owner.read().config.fm,'custom'),'inactive session graph is kept for switching back');
  owner.setConfig({fm:{algorithm:'custom'}});assert.deepEqual(owner.read().config.fm.custom,patch.fm.custom);
});

test('loading a custom patch during Code retains old grouped identities until their next attack',async t=>{
  const old=await create(t),source=await create(t);setup(old,graph([[],[0]],[1]));setup(source,graph([[1],[]],[0]));
  const session=old.beginCode().session;old.code(session,'noteOn',[0,69]);const group=old.read().voiceGroups[0],samples=old.read().playingSampleIds;
  old.loadPatch(source.exportPatch());assert.equal(old.read().codeSession,session);assert(old.read().codeActive);assert.deepEqual(old.read().voiceGroups[0].operatorSlots,group.operatorSlots);assert.deepEqual(old.read().playingSampleIds,samples);
  old.code(session,'setFrequency',[0,330]);let state=old.read();assert.equal(state.slots[6].frequencyHz,330*1.25);assert.equal(state.slots[7].frequencyHz,330*2.5);
  old.code(session,'noteOn',[0,69]);assert.deepEqual(old.read().voiceGroups[0].operatorSlots,[7,6]);
});

test('custom graph getters are materialized once, and graph snapshots are detached',()=>{
  let reads=0;const value={get inputs(){reads++;return [[],[0]];},get outputs(){reads++;return [1];}};
  const normalized=settings({mode:'fm2',fm:{depth:9,ratio:2,algorithm:'custom',custom:value},transpose:0});
  assert.equal(reads,2);assert.deepEqual(normalized.fm.custom,graph([[],[0]],[1]));
  normalized.fm.custom.inputs[1].push(1);assert.deepEqual(customRouting(),graph());
  assert.deepEqual(customRouting(graph([[],[]],[1,0])).outputs,[0,1]);
});

test('partial custom requests preserve a completed nested edit and equivalent output sets do not retire voices',async t=>{
  const owner=await create(t);setup(owner,graph([[],[0]],[0,1]));owner.noteOn('held',69);
  let calls=0;
  owner.setConfig({fm:{custom:{get inputs(){calls++;owner.setConfig({fm:{depth:7}});return [[],[0]];},outputs:[1,0]}}});
  assert.equal(calls,1);assert.equal(owner.read().config.fm.depth,7);assert.equal(owner.read().voiceGroups.length,1);assert(owner.read().slots[6].gate&&owner.read().slots[7].gate);
  const legacy=owner.exportPatch().operators.carrier;
  assert.throws(()=>readPatch({...legacy,format:'tetorica-scsp-voice',version:1,fm:{custom:graph()}}),/version 5/);
});
