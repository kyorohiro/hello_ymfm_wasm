import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {Scsp} from '../js/scsp.js';import factory from '../generated/scsp_wasm.js';import {SynthInstrument} from './instrument.js';import {readPatch} from './patch.js';
let module;async function create(t){module??=factory({wasmBinary:await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url))});const core=await Scsp.create({moduleFactory:()=>module}),instrument=new SynthInstrument(core);t.after(()=>instrument.dispose());return instrument;}
const peak=a=>a.reduce((v,x)=>Math.max(v,Math.abs(x)),0);
test('FM assigns a whole pair, pitch/ratio/depth are live, mute modulator still changes carrier',async t=>{
 const a=await create(t),b=await create(t);for(const i of [a,b])i.setConfig({mode:'fm2'});a.noteOn('a',69);b.noteOn('b',69);
 let state=a.read();assert.deepEqual(state.voiceGroups[0].slots,[2,3]);assert.equal(state.channels[2].directLevel,0);assert.equal(state.channels[3].modulation.xOffset,63);assert.equal(state.voiceCapacity,15);
 b.setConfig({fm:{depth:0}});assert.notDeepEqual(a.synth.generateStereo(8192),b.synth.generateStereo(8192));
 a.setConfig({transpose:2,fm:{ratio:3,depth:8}});state=a.read();assert(Math.abs(state.channels[3].frequencyHz-440*2**(2/12))<1e-8);assert.equal(state.channels[2].frequencyHz,state.channels[3].frequencyHz*3);assert.equal(state.channels[3].modulation.depth,8);assert(state.channels[2].gate&&state.channels[3].gate);
 a.invoke('setMix',[1,{totalLevel:48}]);a.invoke('setLfo',[0,{pitchDepth:3}]);assert.equal(a.read().channels[2].totalLevel,48);assert.equal(a.read().channels[3].lfo.pitchDepth,3);
 assert(a.noteOff('a'));assert(!a.read().channels[2].gate&&!a.read().channels[3].gate);a.stopVoices();assert.equal(peak(a.synth.generateStereo(128).left),0);
});
test('15 FM / 30 PCM groups steal released first and stale releases never touch replacements',async t=>{
 const i=await create(t);i.setConfig({mode:'fm2'});for(let n=0;n<15;n++)i.noteOn('fm'+n,60+n%12);i.noteOff('fm8');const stolen=i.noteOn('new',69);assert.equal(stolen.stolenId,'fm8');assert.deepEqual(stolen.slots,[18,19]);assert.equal(i.noteOff('fm8'),false);assert(i.read().channels[19].gate);
 const old=i.noteOn('overflow',60);assert.equal(old.stolenId,'fm0');assert.equal(i.noteOff('fm0'),false);
 i.setConfig({mode:'pcm'});assert.equal(i.read().voiceGroups.length,0);assert(i.synth.generateStereo(128).left.every(v=>v===0));for(let n=0;n<30;n++)i.noteOn('pcm'+n,60);assert.equal(i.noteOn('last',61).stolenId,'pcm0');assert(i.read().voiceGroups.every(g=>g.slots.length===1));
});
test('editing holds and infinite releases pins old PCM; invalid config and PCM edits are atomic',async t=>{
 const i=await create(t);i.setConfig({mode:'fm2'});i.invoke('setEnvelope',[0,{releaseRate:0}]);i.noteOn('old',69);const before=i.read(),old=before.playingSampleIds[3];i.noteOff('old');
 const sample=i.invoke('applyPCM',[0,new Int16Array(64).fill(1200),{baseFrequencyHz:44100/64,loopStartSamples:0}]);assert.notEqual(sample.id,old);assert.equal(i.read().playingSampleIds[3],old);assert(i.read().samples.some(s=>s.id===old));
 const saved=i.read();for(const fn of [()=>i.setConfig({fm:{depth:13}}),()=>i.setConfig({fm:{ratio:0}}),()=>i.invoke('applyPCM',[0,new Int16Array(64),{rootNote:69}]),()=>i.invoke('setMix',[1,{directLevel:7}])]){assert.throws(fn);assert.deepEqual(i.read(),saved);}
 i.stopVoices();assert(i.read().playingSampleIds.every(x=>x===null));
});
test('two-operator preset restores exact PCM and rejects malformed input without stopping current voice; v1 remains readable',async t=>{
 const a=await create(t),b=await create(t);a.setConfig({mode:'fm2',fm:{depth:10,ratio:1.5},transpose:-2});a.invoke('setLfo',[1,{frequencyCode:20,pitchDepth:3}]);
 a.invoke('applyPCM',[1,Int8Array.from({length:64},(_,n)=>Math.round(32*Math.sin(n*Math.PI/32))),{baseFrequencyHz:44100/64,loopStartSamples:0}]);
 const patch=a.exportPatch();assert.equal(patch.version,2);assert.equal(patch.operators.modulator.bits,8);b.loadPatch(JSON.parse(JSON.stringify(patch)));a.noteOn('a',64);b.noteOn('b',64);assert.deepEqual(a.synth.generateStereo(8192),b.synth.generateStereo(8192));
 const before=b.read();for(const change of [p=>p.fm.ratio=NaN,p=>p.fm.depth=13,p=>{p.fm.depth=0;delete p.operators.carrier.options.loopStartSamples;},p=>p.operators.carrier.pcm[0]=32768,p=>p.operators.carrier.options.loopStartSamples=1,p=>delete p.operators.modulator,p=>p.version=3]){const invalid=structuredClone(patch);change(invalid);assert.throws(()=>b.loadPatch(invalid));assert.deepEqual(b.read(),before);}
 const {carrier}=patch.operators,legacy={...carrier,format:'tetorica-scsp-voice',version:1};assert.equal(readPatch(legacy).mode,'pcm');b.loadPatch(legacy);assert.equal(b.read().config.mode,'pcm');assert.equal(b.read().voiceGroups.length,0);
});

test('failed PCM to FM switch leaves the held PCM voice and its settings intact',async t=>{
 const i=await create(t);i.invoke('applyPCM',[0,new Int16Array(2048).fill(1200),{rootNote:69}]);i.noteOn('held',69);const before=i.read();assert.throws(()=>i.setConfig({mode:'fm2'}),/full forward loop/);assert.deepEqual(i.read(),before);assert(i.synth.generateStereo(128).left.some(x=>x!==0));
});
test('full protected FM editor RAM fails atomically; Stop releases complete group references for reuse',async t=>{
 const i=await create(t);i.setConfig({mode:'fm2'});const pcm=new Int16Array(65535).fill(1200),options={rootNote:69,loopStartSamples:0};const first=i.invoke('applyPCM',[0,pcm,options]);i.noteOn('pins-page',69);const before=i.read();
 assert.throws(()=>i.invoke('applyPCM',[0,pcm.map(x=>-x),options]),/RAM is full|protected/);assert.deepEqual(i.read(),before);
 i.stopVoices();const used=i.read().ramUsedBytes,second=i.invoke('applyPCM',[0,pcm.map(x=>-x),options]);assert.equal(second.allocationAddress,first.allocationAddress);assert.equal(i.read().ramUsedBytes,used);i.noteOn('new-page',69);assert.equal(i.read().playingSampleIds[3],second.id);
});
