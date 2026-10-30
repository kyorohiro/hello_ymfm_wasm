import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {Scsp} from '../js/scsp.js';import factory from '../generated/scsp_wasm.js';import {SynthInstrument} from './instrument.js';import {readPatch} from './patch.js';import {routing,operatorSlot} from './routing.js';
let module;async function create(t){module??=factory({wasmBinary:await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url))});const core=await Scsp.create({moduleFactory:()=>module}),instrument=new SynthInstrument(core);t.after(()=>instrument.dispose());return instrument;}
const peak=a=>a.reduce((v,x)=>Math.max(v,Math.abs(x)),0);
test('FM assigns a whole pair, pitch/ratio/depth are live, mute modulator still changes carrier',async t=>{
 const a=await create(t),b=await create(t);for(const i of [a,b])i.setConfig({mode:'fm2'});a.noteOn('a',69);b.noteOn('b',69);
 let state=a.read();assert.deepEqual(state.voiceGroups[0].slots,[6,7]);assert.equal(state.channels[6].directLevel,0);assert.equal(state.channels[7].modulation.xOffset,63);assert.equal(state.voiceCapacity,13);
 b.setConfig({fm:{depth:0}});assert.notDeepEqual(a.synth.generateStereo(8192),b.synth.generateStereo(8192));
 a.setConfig({transpose:2,fm:{ratio:3,depth:8}});state=a.read();assert(Math.abs(state.channels[7].frequencyHz-440*2**(2/12))<1e-8);assert.equal(state.channels[6].frequencyHz,state.channels[7].frequencyHz*3);assert.equal(state.channels[7].modulation.depth,8);assert(state.channels[6].gate&&state.channels[7].gate);
 a.invoke('setMix',[1,{totalLevel:48}]);a.invoke('setLfo',[0,{pitchDepth:3}]);assert.equal(a.read().channels[6].totalLevel,48);assert.equal(a.read().channels[7].lfo.pitchDepth,3);
 assert(a.noteOff('a'));assert(!a.read().channels[6].gate&&!a.read().channels[7].gate);a.stopVoices();assert.equal(peak(a.synth.generateStereo(128).left),0);
});
test('13 FM / 26 PCM groups steal released first and stale releases never touch replacements',async t=>{
 const i=await create(t);i.setConfig({mode:'fm2'});for(let n=0;n<13;n++)i.noteOn('fm'+n,60+n%12);i.noteOff('fm8');const stolen=i.noteOn('new',69);assert.equal(stolen.stolenId,'fm8');assert.deepEqual(stolen.slots,[22,23]);assert.equal(i.noteOff('fm8'),false);assert(i.read().channels[23].gate);
 const old=i.noteOn('overflow',60);assert.equal(old.stolenId,'fm0');assert.equal(i.noteOff('fm0'),false);
 i.setConfig({mode:'pcm'});assert.equal(i.read().voiceGroups.length,0);assert(i.synth.generateStereo(128).left.every(v=>v===0));for(let n=0;n<26;n++)i.noteOn('pcm'+n,60);assert.equal(i.noteOn('last',61).stolenId,'pcm0');assert(i.read().voiceGroups.every(g=>g.slots.length===1));
});
test('editing holds and infinite releases pins old PCM; invalid config and PCM edits are atomic',async t=>{
 const i=await create(t);i.setConfig({mode:'fm2'});i.invoke('setEnvelope',[0,{releaseRate:0}]);i.noteOn('old',69);const before=i.read(),old=before.playingSampleIds[7];i.noteOff('old');
 const sample=i.invoke('applyPCM',[0,new Int16Array(64).fill(1200),{baseFrequencyHz:44100/64,loopStartSamples:0}]);assert.notEqual(sample.id,old);assert.equal(i.read().playingSampleIds[7],old);assert(i.read().samples.some(s=>s.id===old));
 const saved=i.read();for(const fn of [()=>i.setConfig({fm:{depth:13}}),()=>i.setConfig({fm:{ratio:0}}),()=>i.invoke('applyPCM',[0,new Int16Array(64),{rootNote:69}]),()=>i.invoke('setMix',[1,{directLevel:8}])]){assert.throws(fn);assert.deepEqual(i.read(),saved);}
 i.stopVoices();assert(i.read().playingSampleIds.every(x=>x===null));
});
test('two-operator preset restores exact PCM and rejects malformed input without stopping current voice; v1 remains readable',async t=>{
 const a=await create(t),b=await create(t);a.setConfig({mode:'fm2',fm:{depth:10,ratio:1.5},transpose:-2});a.invoke('setLfo',[1,{frequencyCode:20,pitchDepth:3}]);
 a.invoke('applyPCM',[1,Int8Array.from({length:64},(_,n)=>Math.round(32*Math.sin(n*Math.PI/32))),{baseFrequencyHz:44100/64,loopStartSamples:0}]);
 const patch=a.exportPatch();assert.equal(patch.version,3);assert.equal(patch.operators.modulator.bits,8);b.loadPatch(JSON.parse(JSON.stringify(patch)));a.noteOn('a',64);b.noteOn('b',64);assert.deepEqual(a.synth.generateStereo(8192),b.synth.generateStereo(8192));
 const before=b.read();for(const change of [p=>p.fm.ratio=NaN,p=>p.fm.depth=13,p=>{p.fm.depth=0;delete p.operators.carrier.options.loopStartSamples;},p=>p.operators.carrier.pcm[0]=32768,p=>p.operators.carrier.options.loopStartSamples=1,p=>delete p.operators.modulator,p=>p.version=4]){const invalid=structuredClone(patch);change(invalid);assert.throws(()=>b.loadPatch(invalid));assert.deepEqual(b.read(),before);}
 const {carrier}=patch.operators,legacy={...carrier,format:'tetorica-scsp-voice',version:1};assert.equal(readPatch(legacy).mode,'pcm');b.loadPatch(legacy);assert.equal(b.read().config.mode,'pcm');assert.equal(b.read().voiceGroups.length,0);
});

test('failed PCM to FM switch leaves the held PCM voice and its settings intact',async t=>{
 const i=await create(t);i.invoke('applyPCM',[0,new Int16Array(2048).fill(1200),{rootNote:69}]);i.noteOn('held',69);const before=i.read();assert.throws(()=>i.setConfig({mode:'fm2'}),/full forward loop/);assert.deepEqual(i.read(),before);assert(i.synth.generateStereo(128).left.some(x=>x!==0));
});
test('full protected FM editor RAM fails atomically; Stop releases complete group references for reuse',async t=>{
 const i=await create(t);i.setConfig({mode:'fm2'});const pcm=new Int16Array(65535).fill(1200),options={rootNote:69,loopStartSamples:0};const first=i.invoke('applyPCM',[0,pcm,options]);i.noteOn('pins-page',69);const before=i.read();
 assert.throws(()=>i.invoke('applyPCM',[0,pcm.map(x=>-x),options]),/RAM is full|protected/);assert.deepEqual(i.read(),before);
 i.stopVoices();const used=i.read().ramUsedBytes,second=i.invoke('applyPCM',[0,pcm.map(x=>-x),options]);assert.equal(second.allocationAddress,first.allocationAddress);assert.equal(i.read().ramUsedBytes,used);i.noteOn('new-page',69);assert.equal(i.read().playingSampleIds[7],second.id);
});

test('4/6-op connections run on actual WASM, with only declared outputs and bounded two-input stack offsets',async t=>{
 for(const mode of ['fm4','fm6'])for(const algorithm of ['chain','pairs','branch']){
  const a=await create(t),dry=await create(t);
  a.setConfig({mode,fm:{algorithm}});dry.setConfig({mode,fm:{algorithm,depth:0}});
  a.noteOn('voice',69);dry.noteOn('voice',69);const state=a.read(),group=state.voiceGroups[0],graph=routing(state.config);
  assert.equal(group.slots.length,mode==='fm4'?4:6);assert.equal(state.voiceCapacity,mode==='fm4'?6:4);
  graph.inputs.forEach((sources,index)=>{
   const slot=operatorSlot(group,index),voice=state.channels[slot];assert(sources.length<=2);
   assert.equal(voice.directLevel,graph.outputs.includes(index)?state.channels[index].directLevel:0);
   assert.equal(voice.modulation.depth,sources.length?9:0);
   if(sources.length){const offsets=sources.map(source=>(operatorSlot(group,source)-slot+64)%64);assert.equal(voice.modulation.xOffset,offsets[0]);assert.equal(voice.modulation.yOffset,offsets[1]??offsets[0]);}
  });
  const wet=a.synth.generateStereo(8192),plain=dry.synth.generateStereo(8192);assert(wet.left.every(Number.isFinite));assert(peak(wet.left)>.001);assert.notDeepEqual(wet,plain);
  a.noteOff('voice');for(const slot of group.slots)assert(!a.read().channels[slot].gate);
 }
});
test('all six operators affect serial sound; independent ratios, PCM protection, release-first steal and routing stop',async t=>{
 const a=await create(t);a.setConfig({mode:'fm6'});a.noteOn('old',69);let state=a.read(),group=state.voiceGroups[0];
 const ratios=[.5,1,1.5,2,2.5,3];a.setConfig({fm:{ratios},transpose:2});a.invoke('setMix',[5,{totalLevel:48,directLevel:7}]);a.invoke('setLfo',[4,{pitchDepth:3}]);state=a.read();
 for(let index=0;index<6;index++)assert(Math.abs(state.channels[operatorSlot(group,index)].frequencyHz-440*2**(2/12)*ratios[index])<1e-8);
 assert.equal(state.channels[6].directLevel,0);assert.equal(state.channels[6].totalLevel,48);assert.equal(state.channels[7].lfo.pitchDepth,3);
 const old=state.playingSampleIds[6];a.invoke('applyPCM',[5,Int8Array.from({length:64},(_,n)=>n<32?32:-32),{baseFrequencyHz:44100/64,loopStartSamples:0}]);assert.equal(a.read().playingSampleIds[6],old);
 for(let n=0;n<3;n++)a.noteOn('extra'+n,60+n);a.noteOff('extra1');assert.equal(a.noteOn('replacement',72).stolenId,'extra1');assert.equal(a.noteOff('extra1'),false);
 a.setConfig({fm:{algorithm:'pairs'}});assert.equal(a.read().voiceGroups.length,0);assert.equal(peak(a.synth.generateStereo(128).left),0);
 for(let index=0;index<6;index++){
  const normal=await create(t),changed=await create(t);for(const x of [normal,changed])x.setConfig({mode:'fm6'});changed.invoke('setMix',[index,{totalLevel:255}]);normal.noteOn('a',69);changed.noteOn('b',69);assert.notDeepEqual(normal.synth.generateStereo(4096),changed.synth.generateStereo(4096),`operator ${index} must affect sound`);
 }
});
test('six-operator v3 roundtrip is exact; v2 migrates; illegal route and RAM overflow leave sound intact',async t=>{
 const a=await create(t),b=await create(t);a.setConfig({mode:'fm6',fm:{algorithm:'branch',ratios:[1,2,3,4,5,6]}});
 for(let n=0;n<6;n++)a.invoke('applyPCM',[n,Int8Array.from({length:64},(_,i)=>Math.round((16+n)*Math.sin(i*Math.PI/32))),{baseFrequencyHz:44100/64,loopStartSamples:0}]);
 const patch=JSON.parse(JSON.stringify(a.exportPatch()));b.loadPatch(patch);for(const x of [a,b])x.noteOn('held',64);assert.deepEqual(a.synth.generateStereo(8192),b.synth.generateStereo(8192));
 const before=b.read();for(const mutate of [p=>delete p.operators.f,p=>p.fm.algorithm='feedback',p=>p.fm.ratios[5]=9,p=>p.operators.modulator.options.loopStartSamples=1,p=>{for(const op of Object.values(p.operators))op.pcm=Array(65535).fill(1000);for(const op of Object.values(p.operators))op.bits=16;}]){const invalid=structuredClone(patch);mutate(invalid);assert.throws(()=>b.loadPatch(invalid));assert.deepEqual(b.read(),before);}
 const legacy={...patch,version:2,mode:'fm2',fm:{depth:9,ratio:3},operators:{carrier:patch.operators.carrier,modulator:patch.operators.modulator}};b.loadPatch(legacy);assert.equal(b.read().config.mode,'fm2');assert.deepEqual(b.read().config.fm.ratios,[1,3,3,3,3,3]);assert.equal(Object.keys(b.exportPatch().operators).length,6);
 b.invoke('applyPCM',[2,new Int16Array(64).fill(1000),{rootNote:69}]);b.noteOn('pcm',69);const saved=b.read();assert.throws(()=>b.setConfig({mode:'fm6'}),/full forward loop/);assert.deepEqual(b.read(),saved);
});

test('changing to a connection that would modulate a one-shot is rejected before stopping held groups',async t=>{
 const i=await create(t);i.setConfig({mode:'fm6',fm:{algorithm:'pairs'}});
 i.invoke('applyPCM',[1,new Int16Array(64).fill(1200),{rootNote:69}]);i.noteOn('held',69);const before=i.read();
 assert.throws(()=>i.setConfig({fm:{algorithm:'branch'}}),/full forward loop/);assert.deepEqual(i.read(),before);
});
