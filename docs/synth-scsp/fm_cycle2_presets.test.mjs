// SPDX-License-Identifier: BSD-3-Clause
// Portable Cycle data is compared through actual native rendering, not only
// through the serializer's normalized object shape. No audio device is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../js/scsp.js';
import {Pcm44100Resampler} from '../js/pcm_44100_resampler.js';
import {SynthInstrument} from './instrument.js';
import {readPatch} from './patch.js';

const names=['carrier','modulator','c','d','e','f'];
let module;
async function create(t){
  module??=factory({wasmBinary:await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url))});
  const owner=new SynthInstrument(await Scsp.create({moduleFactory:()=>module}));
  t.after(()=>owner.dispose());return owner;
}
function sources(owner,{shift=0}={}){
  for(let op=0;op<6;op++){
    const bytes=op%2?Int8Array:Int16Array,level=op%2?35:3500;
    const pcm=bytes.from({length:64},(_,i)=>Math.round(level*Math.sin((i+shift+op*3)*Math.PI/32)));
    owner.invoke('applyPCM',[op,pcm,{baseFrequencyHz:44100/64,sourceSampleRate:44100,loopStartSamples:0}]);
    owner.invoke('setMix',[op,{totalLevel:18+op*2,directLevel:5,pan:op%2?15:31}]);
    owner.invoke('setEnvelope',[op,{attackRate:31,decay1Rate:9+op,decay2Rate:op,
      decayLevel:7,releaseRate:4+op,keyRateScaling:15,loopLink:op%2===0}]);
    owner.invoke('setLfo',[op,{frequencyCode:12+op,pitchWave:2,pitchDepth:1,
      amplitudeWave:0,amplitudeDepth:1,reset:false}]);
  }
}
function configure(owner,{outputs=[1],mixed=false,effect=true}={}){
  owner.setConfig({mode:'fm2',transpose:2,fm:{algorithm:'cycle2',cycle2:{outputs},depth:8,
    ratio:1.5,ratios:[1.125,1.6875,2,2.5,3,3.5],...(mixed?{depths:[4,9,3,5,7,11]}:{})}});
  owner.setEffect({enabled:effect,timeMs:20,feedback:-.25,send:5,returnLevel:5});
}
const json=owner=>JSON.parse(JSON.stringify(owner.exportPatch()));
const stack=owner=>Array.from({length:64},(_,i)=>owner.core.read(0x600+i*2));
function registers(owner){
  // Sample addresses are intentionally relocatable in a portable preset.
  // Every other active-slot control word must remain exact after relocation.
  return [6,7].map(slot=>[owner.core.read(slot*32)&0xfff0,
    ...[4,6,8,10,12,14,16,18,20,22].map(offset=>owner.core.read(slot*32+offset))]);
}
function render(owner,rate){
  const converter=new Pcm44100Resampler(owner.core,rate),left=new Float32Array(4099),right=new Float32Array(4099);
  for(let at=0;at<left.length;at+=128)converter.render(left,right,Math.min(128,left.length-at),at);
  return {left,right};
}
function sourceSettings(owner){
  return names.map((_,index)=>{
    const {pcm,sample,voice}=owner.invoke('getPCM',[index]),{sample:ignored,gate,...requested}=voice;
    return {pcm,bits:sample.bits,length:sample.length,rootFrequencyHz:sample.rootFrequencyHz,
      sourceSampleRate:sample.sourceSampleRate,loopStartSamples:sample.loopStartSamples,requested};
  });
}

test('v11 JSON roundtrips all source data and exact fresh-attack PCM/control words/history at both rates',async t=>{
  let comparisons=0;
  for(const outputs of [[],[0],[1],[0,1]])for(const mixed of [false,true])for(const rate of [44100,48000]){
    const source=await create(t),copy=await create(t);sources(source);configure(source,{outputs,mixed});
    const patch=json(source);assert.equal(patch.version,11);assert.equal(patch.mode,'fm2');
    assert.equal(patch.fm.algorithm,'cycle2');assert.deepEqual(patch.fm.cycle2,{outputs});
    assert.deepEqual(Object.keys(patch.operators),names);assert.equal(Object.hasOwn(patch.fm,'custom'),false);
    assert.equal(Object.hasOwn(patch,'voiceGroups'),false);assert.equal(Object.hasOwn(patch,'synthState'),false);
    assert.equal(Object.hasOwn(patch,'ram'),false);assert.equal(Object.hasOwn(patch,'history'),false);
    assert.equal(Object.hasOwn(patch,'pitchBend'),false);assert.equal(Object.hasOwn(patch,'clickGuard'),false);
    assert.deepEqual(patch.fm.depths,mixed?[4,9,3,5,7,11]:undefined);
    assert(patch.operators.carrier.pcm.some(value=>value!==0));
    copy.loadPatch(patch);assert.deepEqual(copy.read().config,source.read().config);
    assert.deepEqual(sourceSettings(copy),sourceSettings(source));assert.deepEqual(json(copy),patch);
    source.noteOn('source',67);copy.noteOn('copy',67);
    assert.deepEqual(registers(copy),registers(source),`${rate}/${mixed}/${outputs} control words`);
    const actual=render(copy,rate),expected=render(source,rate);
    assert.deepEqual(actual,expected,`${rate}/${mixed}/${outputs} PCM`);
    assert.deepEqual(stack(copy),stack(source),`${rate}/${mixed}/${outputs} all 64 stack cells`);
    assert(actual.left.every(Number.isFinite)&&actual.right.every(Number.isFinite));comparisons++;
  }
  assert.equal(comparisons,16);
});

test('exported Cycle data is detached from live authoring and excludes dormant Custom and native history',async t=>{
  const owner=await create(t);sources(owner);
  owner.setConfig({mode:'fm2',fm:{algorithm:'custom',custom:{inputs:[[],[0]],outputs:[1]}}});
  configure(owner);owner.noteOn('held',69);owner.synth.generateStereo(257);
  const config=owner.read().config,wave=owner.invoke('getPCM',[0]).pcm,history=stack(owner),patch=owner.exportPatch();
  assert(!Object.hasOwn(patch.fm,'custom'));assert.equal(patch.version,11);
  patch.fm.cycle2.outputs.push(0);patch.fm.ratios[0]=8;patch.operators.carrier.pcm[0]=1234;
  patch.operators.carrier.voice.envelope.releaseRate=0;
  assert.deepEqual(owner.read().config,config);assert.deepEqual(owner.invoke('getPCM',[0]).pcm,wave);
  assert.deepEqual(stack(owner),history);assert.equal(owner.exportPatch().operators.carrier.voice.envelope.releaseRate,4);
});

test('invalid or legacy Cycle files reject before mutating current owners, RAM, registers or Code',async t=>{
  const source=await create(t),owner=await create(t);sources(source);configure(source,{mixed:true});
  const good=json(source);sources(owner);configure(owner);const session=owner.beginCode().session;
  owner.code(session,'noteOn',[0,67]);owner.physicalNoteOn('manual',31,60);owner.synth.generateStereo(137);
  const mutate=change=>{const value=structuredClone(good);change(value);return value;};
  const invalid=[
    mutate(p=>{p.mode='fm4';}),mutate(p=>{p.mode='pcm';}),
    mutate(p=>{p.fm.algorithm='chain';}),mutate(p=>{delete p.fm.cycle2;}),
    mutate(p=>{p.fm.cycle2=null;}),mutate(p=>{p.fm.cycle2={outputs:[2]};}),
    mutate(p=>{p.fm.cycle2={outputs:[1,1]};}),mutate(p=>{p.fm.cycle2={outputs:Array(1)};}),
    mutate(p=>{p.fm.cycle2={outputs:[1],order:[0,1]};}),
    mutate(p=>{p.fm.custom={inputs:[[],[0]],outputs:[1]};}),
    mutate(p=>{p.fm.custom=undefined;}),mutate(p=>{delete p.operators.f;}),
    mutate(p=>{delete p.operators.modulator;}),mutate(p=>{p.operators.carrier.options={baseFrequencyHz:440};}),
    mutate(p=>{p.operators.modulator.options.loopStartSamples=1;}),
    mutate(p=>{p.operators.carrier.pcm[0]=NaN;}),
    mutate(p=>{p.operators.carrier.voice.envelope.releaseRate=32;}),
    ...Array.from({length:10},(_,index)=>mutate(p=>{p.version=index+1;})),
  ];
  const before=owner.read(),ram=owner.core.readRam(),ring=stack(owner),write=owner.core.write.bind(owner.core),reset=owner.core.reset.bind(owner.core),load=owner.core.loadRam.bind(owner.core);
  let writes=0,resets=0,loads=0;
  owner.core.write=(...args)=>{writes++;return write(...args);};
  owner.core.reset=(...args)=>{resets++;return reset(...args);};
  owner.core.loadRam=(...args)=>{loads++;return load(...args);};
  try{
    for(const value of invalid){assert.throws(()=>owner.loadPatch(value));assert.deepEqual(owner.read(),before);}
    assert.equal(writes,0);assert.equal(resets,0);assert.equal(loads,0);
    assert.deepEqual(owner.core.readRam(),ram);assert.deepEqual(stack(owner),ring);
  }finally{owner.core.write=write;owner.core.reset=reset;owner.core.loadRam=load;}
});

test('v11 captures its explicit fm once and cannot normalize a different recipe into the version',async t=>{
  const source=await create(t);sources(source);configure(source);const good=json(source),fm=good.fm;
  let reads=0;
  const one={...good,get fm(){reads++;return reads===1?fm:{...fm,algorithm:'chain',cycle2:undefined};}};
  assert.equal(readPatch(one).fm.algorithm,'cycle2');assert.equal(reads,1);
  const mutable={...good,fm:{...fm}};let algorithms=0;
  Object.defineProperty(mutable.fm,'algorithm',{enumerable:true,get(){return ++algorithms===1?'cycle2':'chain';}});
  assert.throws(()=>readPatch(mutable),/version 11/);
});

test('loading v11 during Code keeps the session, existing held PCM and physical owners until new attacks',async t=>{
  const owner=await create(t),reference=await create(t),replacement=await create(t);
  for(const value of [owner,reference]){sources(value);configure(value,{effect:false});}
  const session=owner.beginCode().session,other=reference.beginCode().session;
  for(const [value,code]of [[owner,session],[reference,other]]){
    value.code(code,'noteOn',[0,67]);value.physicalNoteOn('manual',31,60);value.synth.generateStereo(137);
  }
  sources(replacement,{shift:13});configure(replacement,{outputs:[0,1],mixed:true,effect:false});
  const patch=json(replacement),before=owner.read(),groups=structuredClone(before.voiceGroups),playing=[...before.playingSampleIds];
  const old=before.voiceGroups[0].operatorSlots.map(slot=>before.slots[slot].sample);
  const bytes=old.map(sample=>owner.core.readRam(sample.address,sample.length*sample.bits/8));
  owner.code(session,'loadPatch',[patch]);const after=owner.read();
  assert.equal(after.codeSession,session);assert(after.codeActive);assert.deepEqual(after.voiceGroups,groups);
  assert.deepEqual(after.playingSampleIds,playing);assert.deepEqual(after.manualVoices,before.manualVoices);
  for(let index=0;index<old.length;index++)assert.deepEqual(owner.core.readRam(old[index].address,bytes[index].length),bytes[index]);
  assert.deepEqual(owner.synth.generateStereo(1024),reference.synth.generateStereo(1024),'new authoring does not rewrite held native PCM');
  assert.deepEqual(json(owner),patch);assert.deepEqual(owner.invoke('getPCM',[0]).pcm,Int16Array.from(patch.operators.carrier.pcm));
  owner.code(session,'noteOn',[0,72]);
  const current=owner.read().voiceGroups.find(group=>group.owner.kind==='code');
  assert.deepEqual(current.config.fm.cycle2,{outputs:[0,1]});assert.deepEqual(current.config.fm.depths,[4,9,3,5,7,11]);
  assert.deepEqual(current.operatorSlots,[6,7]);assert.notDeepEqual(owner.read().playingSampleIds,playing);
});

test('portable v11 and idle migration preserve edit data without auto-starting voices or Code',async t=>{
  const owner=await create(t),copy=await create(t),idle=await create(t);sources(owner);configure(owner,{mixed:true});
  const patch=json(owner);copy.loadPatch(patch);const snapshot=copy.exportIdleState();idle.loadIdleState(snapshot);
  for(const value of [copy,idle]){
    assert.equal(value.read().codeActive,false);assert.deepEqual(value.read().voiceGroups,[]);
    assert(value.read().slots.every(slot=>!slot.gate));assert.deepEqual(json(value),patch);
  }
  assert.deepEqual(idle.core.readRam(),copy.core.readRam());
  assert.deepEqual(idle.read().config,copy.read().config);
  copy.noteOn('copy',69);idle.noteOn('idle',69);
  assert.deepEqual(idle.synth.generateStereo(4096),copy.synth.generateStereo(4096));
});

test('dormant Cycle metadata never changes the existing legacy export version or document',async t=>{
  const cases=[
    [{mode:'pcm',fm:{algorithm:'chain'}},4],
    [{mode:'fm2',fm:{algorithm:'custom',custom:{inputs:[[1],[]],outputs:[0]}}},5],
    [{mode:'fm4',fm:{algorithm:'custom',custom:{inputs:[[1],[],[],[]],outputs:[0]}}},6],
    [{mode:'fm4',fm:{algorithm:'custom',custom:{inputs:[[1],[],[],[]],outputs:[0]},depths:[3,5,7,9,11,12]}},7],
    [{mode:'fm2',fm:{algorithm:'custom',custom:{inputs:[[1],[1]],outputs:[0]}}},8],
    [{mode:'fm4',fm:{algorithm:'custom',custom:{inputs:[[1],[1],[],[]],outputs:[0]}}},9],
    [{mode:'fm4',fm:{algorithm:'custom',custom:{inputs:[[1,2],[1],[2],[]],outputs:[0]}}},10],
  ];
  for(const [config,version]of cases){
    const owner=await create(t);owner.setConfig(config);const before=json(owner);assert.equal(before.version,version);
    owner.setConfig({fm:{cycle2:{outputs:[0,1]}}});assert.deepEqual(json(owner),before);
  }
});
