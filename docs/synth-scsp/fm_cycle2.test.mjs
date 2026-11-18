// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../js/scsp.js';
import {scspPitch} from '../js/scspsynth.js';
import {Pcm44100Resampler} from '../js/pcm_44100_resampler.js';
import {SynthInstrument} from './instrument.js';

let module;
async function create(t){
  module??=factory({wasmBinary:await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url))});
  const owner=new SynthInstrument(await Scsp.create({moduleFactory:()=>module}));
  if(t)t.after(()=>owner.dispose());return owner;
}
const ratios=[1.25,1.875,1,1,1,1];
const stack=core=>Array.from({length:64},(_,i)=>core.read(0x600+i*2));
const put=(core,i,value)=>core.write(0x600+i*2,value&65535);
const markers=(core,start=2000)=>{for(let i=0;i<64;i++)put(core,i,start+i*19);return stack(core);};
const cells=p=>[p,p+32,p+1,p+33];
const clearExpected=(ring,p)=>ring.map((v,i)=>cells(p).includes(i)?0:v);
const setup=(owner,{depth=8,outputs=[1],extra={}}={})=>owner.setConfig({mode:'fm2',fm:{algorithm:'cycle2',cycle2:{outputs},depth,ratios,...extra}});
function waves(owner){
  for(let op=0;op<2;op++){
    const pcm=Int16Array.from({length:64},(_,i)=>Math.round(1800*Math.sin((i+op*7)*Math.PI/32)+250*Math.cos((op+2)*i*Math.PI/32)));
    owner.invoke('applyPCM',[op,pcm,{baseFrequencyHz:44100/64,loopStartSamples:0}]);
    owner.invoke('setMix',[op,{totalLevel:18+op*3,directLevel:5,pan:0}]);
    owner.invoke('setEnvelope',[op,{releaseRate:3,keyRateScaling:15}]);
  }
}
function render(converter,frames=512){
  const left=new Float32Array(frames),right=new Float32Array(frames);
  for(let offset=0;offset<frames;offset+=128)converter.render(left,right,Math.min(128,frames-offset),offset);
  return {left,right};
}
// This reference never imports the Synth routing/planner/mapping helpers.
// The unchanged low-level adapter installs only PCM/pitch/envelope/mix and
// triggers native slots. The two modulation words and history policy are
// authored directly below before any frame is rendered.
function directPair(owner,p,midi,depth,outputs,{wrongReturn=false}={}){
  const voices=owner.synth.getState().slots;
  for(let op=0;op<2;op++){
    const v=voices[op];
    owner.synth.setPreset(p+op,{sample:v.sample,envelope:v.envelope,lfo:v.lfo,
      totalLevel:v.totalLevel,directLevel:outputs.includes(op)?v.directLevel:0,
      pan:v.pan,frequencyHz:440*2**((midi-69)/12)*ratios[op],
      modulation:{depth:0,xOffset:0,yOffset:0,writeInhibit:false}});
  }
  for(const cell of cells(p))put(owner.core,cell,0);
  owner.synth.keyOn(p);owner.synth.keyOn(p+1);
  owner.core.write(p*32+14,depth?(depth<<12)|(33<<6)|(wrongReturn?33:1):0);
  owner.core.write((p+1)*32+14,depth?(depth<<12)|(63<<6)|63:0);
}
function rawLive(owner,p,{depths,frequency,transpose=0}){
  if(depths){
    owner.core.write(p*32+14,depths[0]?(depths[0]<<12)|(33<<6)|1:0);
    owner.core.write((p+1)*32+14,depths[1]?(depths[1]<<12)|(63<<6)|63:0);
  }
  if(frequency!==undefined)for(let op=0;op<2;op++){
    const frequencyHz=frequency*ratios[op]*2**(transpose/12);
    owner.core.write((p+op)*32+16,scspPitch(frequencyHz/(44100/64)).word);
  }
}

test('all13 Cycle2 allocations match independent raw-register PCM and64-cell history at44.1/48kHz',async()=>{
  let comparisons=0;
  for(const depth of [0,1,4,8,12])for(const rate of [44100,48000])for(const outputs of [[1],[0,1]]){
    const owner=await create(),reference=await create();
    try{
      for(const value of [owner,reference])waves(value);
      setup(owner,{depth,outputs});markers(owner.core);markers(reference.core);
      const actualResampler=new Pcm44100Resampler(owner.core,rate),referenceResampler=new Pcm44100Resampler(reference.core,rate);
      for(let pair=0;pair<13;pair++){
        const p=6+pair*2,midi=60+pair%12;
        const result=owner.noteOn('pair'+pair,midi);directPair(reference,p,midi,depth,outputs);
        assert.deepEqual(result.slots,[p,p+1]);
        const state=owner.read(),group=state.voiceGroups.find(g=>g.id==='pair'+pair);
        assert.deepEqual(group.operatorSlots,[p,p+1]);
        assert.deepEqual(state.slots[p].modulation,{depth,xOffset:33,yOffset:1,writeInhibit:false});
        assert.deepEqual(state.slots[p+1].modulation,{depth,xOffset:63,yOffset:63,writeInhibit:false});
        assert.equal(owner.core.read(p*32+14),depth?(depth<<12)|0x841:0);
        assert.equal(owner.core.read((p+1)*32+14),depth?(depth<<12)|0xfff:0);
        const actual=render(actualResampler,257),expected=render(referenceResampler,257);
        assert.deepEqual(actual,expected,`pair${pair} depth${depth} outputs${outputs} rate${rate}`);
        assert.deepEqual(stack(owner.core),stack(reference.core));
        assert(actual.left.every(Number.isFinite)&&actual.right.every(Number.isFinite));comparisons++;
      }
      assert.equal(owner.read().voiceCapacity,13);
    }finally{owner.dispose();reference.dispose();}
  }
  assert.equal(comparisons,260);
});

test('independent wrong-return reference differs, and explicit empty/A/B output requests do not infer a carrier',async t=>{
  const owner=await create(t),wrong=await create(t);
  for(const value of [owner,wrong])waves(value);setup(owner);owner.noteOn('cycle',69);directPair(wrong,6,69,8,[1],{wrongReturn:true});
  assert.notDeepEqual(owner.synth.generateStereo(4096),wrong.synth.generateStereo(4096),'two-history return is not previous1 duplicated');
  for(const outputs of [[],[0],[1],[0,1]]){
    owner.setConfig({fm:{cycle2:{outputs}}});owner.noteOn('output'+outputs,69);
    const state=owner.read(),group=state.voiceGroups.at(-1);
    for(let op=0;op<2;op++)assert.equal(state.slots[group.operatorSlots[op]].directLevel,outputs.includes(op)?5:0);
    const pcm=owner.synth.generateStereo(512);
    assert(pcm.left.every(Number.isFinite));
    if(!outputs.length)assert(pcm.left.every(v=>v===0));
  }
});

test('each new owned pair clears exactly four cells after validation and before keyOn without rendering or core reset',async t=>{
  const owner=await create(t);setup(owner);
  for(let pair=0;pair<13;pair++){
    const before=markers(owner.core,3000+pair*100),p=6+pair*2,writes=[];
    const write=owner.core.write.bind(owner.core),reset=owner.core.reset.bind(owner.core),renderInto=owner.core.renderInto.bind(owner.core);
    let resets=0,renders=0;
    owner.core.write=(...args)=>{writes.push(args);return write(...args);};
    owner.core.reset=(...args)=>{resets++;return reset(...args);};
    owner.core.renderInto=(...args)=>{renders++;return renderInto(...args);};
    try{owner.noteOn('held'+pair,60+pair);}finally{owner.core.write=write;owner.core.reset=reset;owner.core.renderInto=renderInto;}
    assert.equal(resets,0);assert.equal(renders,0);assert.deepEqual(stack(owner.core),clearExpected(before,p));
    const clears=writes.filter(([a])=>a>=0x600&&a<0x700);
    assert.deepEqual(clears,cells(p).map(cell=>[0x600+cell*2,0]));
    const keyOn=writes.findIndex(([a,v])=>a<0x400&&a%32===0&&(v&0x1800)===0x1800);
    assert(keyOn>=0);assert(Math.max(...clears.map(call=>writes.indexOf(call)))<keyOn);
  }
});

test('liveOff/On, mix/LFO/DSP, pitch and release preserve histories, PCM and owned mappings',async t=>{
  const owner=await create(t);waves(owner);setup(owner);const session=owner.beginCode().session;
  owner.code(session,'noteOn',[0,69]);owner.noteOn('keyboard',64);owner.physicalNoteOn('manual',31,60);
  owner.setEffect({enabled:true});owner.setDspSourceSend(0,{input:1,level:4});owner.setDspSourceSend(1,{input:0,level:5});
  owner.synth.generateStereo(137);
  const before=owner.read(),ring=stack(owner.core),ram=owner.core.readRam(),dsp=owner.readDspSetup();
  const write=owner.core.write.bind(owner.core),writes=[];owner.core.write=(...args)=>{writes.push(args);return write(...args);};
  try{
    owner.setConfig({fm:{depth:0}});for(const g of owner.read().voiceGroups)for(const slot of g.slots)assert.equal(owner.core.read(slot*32+14),0);
    owner.setConfig({fm:{depths:[12,4,1,1,1,1],ratios:[.5,3,1,1,1,1]}});owner.setPitchBend(.5);owner.code(session,'setFrequency',[0,330]);
    owner.invoke('setMix',[0,{totalLevel:42}]);owner.invoke('setLfo',[1,{frequencyCode:17,pitchDepth:2}]);
    owner.noteOff('keyboard');owner.code(session,'keyOff',[0]);
  }finally{owner.core.write=write;}
  const state=owner.read();
  assert.deepEqual(stack(owner.core),ring);assert.deepEqual(owner.core.readRam(),ram);
  assert(!writes.some(([a])=>a>=0x600&&a<0x700));assert.deepEqual(owner.readDspSetup(),dsp);
  assert.deepEqual(state.manualVoices,before.manualVoices);assert(state.slots[31].gate);
  for(const g of state.voiceGroups){
    const [a,b]=g.operatorSlots;assert.deepEqual(g.operatorSlots,g.slots);
    assert.equal(state.slots[a].modulation.depth,12);assert.equal(state.slots[b].modulation.depth,4);
    assert.equal(state.slots[a].totalLevel,42);assert.equal(state.slots[b].lfo.frequencyCode,17);
    assert.equal(state.dspRouting.slots[a].level,4);assert.equal(state.dspRouting.slots[b].level,5);
    assert.equal(g.held,false);
  }
});

test('same-lane reattack and released-first steal clear only replacement pair; stale releases cannot affect replacements',async t=>{
  const owner=await create(t);setup(owner);const session=owner.beginCode().session;
  owner.code(session,'noteOn',[0,69]);owner.noteOn('other',64);owner.physicalNoteOn('manual',31,60);
  const before=owner.read(),other=before.voiceGroups.find(g=>g.id==='other'),ring=markers(owner.core,4000),dsp=owner.readDspSetup();
  owner.code(session,'noteOn',[0,72]);
  assert.deepEqual(stack(owner.core),clearExpected(ring,6));
  assert.deepEqual(owner.read().voiceGroups.find(g=>g.id==='other'),other);
  assert.deepEqual(owner.read().manualVoices,before.manualVoices);assert.deepEqual(owner.readDspSetup(),dsp);
  owner.stopVoices();for(let i=0;i<13;i++)owner.noteOn('old'+i,60+i%12);owner.noteOff('old7');
  const seeded=markers(owner.core,5000),result=owner.noteOn('replacement',69);
  assert.equal(result.stolenId,'old7');assert.deepEqual(result.slots,[20,21]);assert.deepEqual(stack(owner.core),clearExpected(seeded,20));
  assert.equal(owner.noteOff('old7'),false);assert(owner.read().slots[20].gate&&owner.read().slots[21].gate);
});

test('physical takeover retires the whole pair, while CodeStop preserves keyboard/manual ownership and shared history',async t=>{
  const owner=await create(t);setup(owner);const session=owner.beginCode().session;
  owner.code(session,'noteOn',[0,69]);owner.noteOn('keyboard',64);owner.setEffect({enabled:true});
  const ring=markers(owner.core,6000),ram=owner.core.readRam(),dsp=owner.readDspSetup();
  const result=owner.physicalNoteOn('manual',6,72);
  assert(result.retiredGroupIds.includes(`code:${session}:0`));assert.equal(owner.code(session,'noteOff',[0]),false);
  assert(!owner.read().slots[7].gate);assert(owner.read().slots[6].gate);
  assert.deepEqual(owner.read().manualVoices.map(v=>v.slot),[6]);assert.equal(owner.read().manualVoices.length,1);
  assert.deepEqual(stack(owner.core),ring);
  assert(owner.endCode(session));assert(owner.read().slots[6].gate&&owner.read().slots[8].gate);
  assert.deepEqual(stack(owner.core),ring);assert.deepEqual(owner.core.readRam(),ram);assert.deepEqual(owner.readDspSetup(),dsp);
  owner.stopVoices();assert(stack(owner.core).every(v=>v===0));assert.equal(owner.read().voiceGroups.length,0);
  assert.deepEqual(owner.core.readRam(),ram);
});

test('Cycle noteOff uses existingClickGuard while keyOff bypasses it; neither clears the ring',async t=>{
  const owner=await create(t);setup(owner);for(let op=0;op<2;op++)owner.invoke('setEnvelope',[op,{releaseRate:31,keyRateScaling:15}]);
  const session=owner.beginCode().session;owner.code(session,'noteOn',[0,69]);let ring=markers(owner.core,7000);
  assert(owner.code(session,'noteOff',[0]));for(const slot of [6,7])assert.equal(owner.core.read(slot*32+10)&31,25);
  assert.deepEqual(stack(owner.core),ring);owner.code(session,'noteOn',[0,69]);ring=markers(owner.core,8000);
  assert(owner.code(session,'keyOff',[0]));for(const slot of [6,7])assert.equal(owner.core.read(slot*32+10)&31,31);
  assert.deepEqual(stack(owner.core),ring);
});

test('invalidCycle requests and incompatiblePCM reject before writes, history or ownership mutation',async t=>{
  const owner=await create(t);setup(owner);const session=owner.beginCode().session;
  owner.code(session,'noteOn',[0,69]);owner.physicalNoteOn('manual',31,60);owner.synth.generateStereo(137);
  const before=owner.read(),ring=stack(owner.core),ram=owner.core.readRam(),write=owner.core.write.bind(owner.core);let writes=0;
  owner.core.write=(...args)=>{writes++;return write(...args);};
  try{
    for(const cycle2 of [null,undefined,{},[],{outputs:[2]},{outputs:[0,0]},{outputs:Array(1)},{outputs:[1],extra:0},{outputs:[1],[Symbol('hidden')]:0}])assert.throws(()=>owner.setConfig({fm:{cycle2}}));
    for(const patch of [{mode:'pcm'},{mode:'fm4'},{mode:'fm6'},{fm:{depth:13}},{fm:{depths:[8,13,0,0,0,0]}},{fm:{algorithm:'custom',custom:{inputs:[[1],[0]],outputs:[1]}}}])assert.throws(()=>owner.setConfig(patch));
    for(const op of [0,1])assert.throws(()=>owner.invoke('applyPCM',[op,new Int16Array(64),{rootNote:69}]),/full forward loop/);
    assert.equal(writes,0);assert.deepEqual(owner.read(),before);assert.deepEqual(stack(owner.core),ring);assert.deepEqual(owner.core.readRam(),ram);
  }finally{owner.core.write=write;}
  const shot=await create(t);shot.invoke('applyPCM',[1,new Int16Array(64),{rootNote:69}]);const saved=shot.read();
  assert.throws(()=>setup(shot,{depth:0}),/full forward loop/);assert.deepEqual(shot.read(),saved);
});

test('Cycle snapshots/dormantCustom retain their own data and Phase1 explicitly refuses portableCycle export',async t=>{
  const owner=await create(t),copy=await create(t);waves(owner);
  const custom={inputs:[[],[0]],outputs:[0,1]};owner.setConfig({mode:'fm2',fm:{algorithm:'custom',custom}});
  setup(owner);const idle=owner.exportIdleState();copy.loadIdleState(idle);assert.deepEqual(copy.read().config,owner.read().config);
  for(const value of [owner,copy])value.noteOn('held',67);assert.deepEqual(owner.synth.generateStereo(2048),copy.synth.generateStereo(2048));
  assert.throws(()=>owner.exportPatch(),/Cycle|cycle|version 11|v11/);
  owner.setConfig({fm:{algorithm:'chain'}});const legacy=owner.exportPatch();assert(!Object.hasOwn(legacy.fm,'cycle2'));
  owner.setConfig({fm:{algorithm:'custom'}});assert.deepEqual(owner.read().config.fm.custom,custom);
  owner.setConfig({mode:'fm4',fm:{algorithm:'custom'}});assert.deepEqual(owner.read().config.fm.custom.inputs,[[],[0],[],[]]);
  owner.setConfig({mode:'fm2',fm:{algorithm:'cycle2'}});assert.deepEqual(owner.read().config.fm.cycle2,{outputs:[1]});
});

test('oldpreset getters cannot introduce active or dormantCycle after the early version guards',async t=>{
  const owner=await create(t),source=await create(t);source.setConfig({mode:'fm2'});
  const legacy=source.exportPatch();owner.noteOn('keyboard',64);owner.physicalNoteOn('manual',31,60);
  const before=owner.read(),ring=markers(owner.core,10000),ram=owner.core.readRam(),write=owner.core.write.bind(owner.core);let writes=0;
  owner.core.write=(...args)=>{writes++;return write(...args);};
  try{
    for(const active of [false,true]){
      const preset=structuredClone(legacy),normal=preset.fm;let reads=0;
      Object.defineProperty(preset,'fm',{enumerable:true,configurable:true,get(){
        return ++reads<6?normal:{...normal,...(active?{algorithm:'cycle2'}:{}),cycle2:{outputs:[1]}};
      }});
      assert.throws(()=>owner.loadPatch(preset),/Cycle|cycle|version 11|v11/);
      assert(reads>=6,'exercise normalized state after the upfront guards');assert.equal(writes,0);
      assert.deepEqual(owner.read(),before);assert.deepEqual(stack(owner.core),ring);assert.deepEqual(owner.core.readRam(),ram);
    }
  }finally{owner.core.write=write;}
});

test('raw-reference live edits stay aligned across resampler cache boundaries without reattack',async t=>{
  for(const rate of [44100,48000]){
    const owner=await create(t),reference=await create(t);for(const value of [owner,reference])waves(value);
    setup(owner);const session=owner.beginCode().session;owner.code(session,'noteOn',[0,69]);directPair(reference,6,69,8,[1]);
    const actual=new Pcm44100Resampler(owner.core,rate),expected=new Pcm44100Resampler(reference.core,rate);
    assert.deepEqual(render(actual,117),render(expected,117));
    for(const [depths,frequency]of [[[0,8],330],[[12,4],220],[[8,8],440]]){
      owner.setConfig({fm:{depths:[...depths,0,0,0,0]}});owner.code(session,'setFrequency',[0,frequency]);rawLive(reference,6,{depths,frequency});
      assert.deepEqual(render(actual,139),render(expected,139),`${rate}/${depths}/${frequency}`);
      assert.deepEqual(stack(owner.core),stack(reference.core));
    }
  }
});

test('unexpected Cycle commit write failure is fatal but invalid prevalidation never enters commit',async t=>{
  const owner=await create(t);setup(owner);const ring=markers(owner.core,9000),write=owner.core.write.bind(owner.core);let clears=0;
  owner.core.write=(address,...args)=>{if(address>=0x600&&address<0x700&&++clears===3)throw new Error('injected native commit failure');return write(address,...args);};
  try{assert.throws(()=>owner.noteOn('partial',69),error=>error.fatal===true&&/injected|commit|Cycle|cycle/i.test(error.message));}
  finally{owner.core.write=write;}
  assert.equal(clears,3);assert.notDeepEqual(stack(owner.core),ring,'partial writes are not falsely described as rollback');
});
