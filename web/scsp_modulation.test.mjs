// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';
import factory from '../docs/generated/scsp_wasm.js';import {Scsp} from './scsp.js';import {ScspSynth,createScspInitSample} from './scspsynth.js';
const wasmBinary=await readFile(new URL('../docs/generated/scsp_wasm.wasm',import.meta.url));let module;
async function create(t,bits=16,depth=15){const core=await Scsp.create({moduleFactory:async()=>module??=await factory({wasmBinary})}),synth=new ScspSynth(core);t.after(()=>synth.dispose());let {pcm,options}=createScspInitSample();if(bits===8)pcm=Int8Array.from(pcm,v=>Math.round(v/256));const sample=synth.loadPCM(pcm,{...options,modulationDepth:depth});return {core,synth,sample,pcm};}
function start(synth,sample,{depth=9,offset=63,direct=0,tl=0,inhibit=false}={}){synth.setPreset(0,{sample,frequencyHz:220,directLevel:direct,totalLevel:tl,modulation:{writeInhibit:inhibit}});synth.setPreset(1,{sample,frequencyHz:440,totalLevel:16,modulation:{depth,xOffset:offset,yOffset:offset}});synth.keyOn(0);synth.keyOn(1);}
const delta=(a,b)=>a.reduce((v,x,i)=>Math.max(v,Math.abs(x-b[i])),0);
test('two-slot address modulation: every MDL and PCM format, muted modulator, TL, X/Y average, STWINH and stack generations',async t=>{
 const rows=[];
 for(const bits of [8,16]){
  const {core,synth,sample}=await create(t,bits);start(synth,sample,{depth:0});const base=synth.generateStereo(8192).left;
  for(let depth=1;depth<=15;depth++){
   synth.stopVoices();start(synth,sample,{depth});const out=synth.generateStereo(8192).left;const diff=delta(base,out);assert(diff>.001,`PCM${bits} depth${depth}`);assert(out.every(Number.isFinite));rows.push({bits,depth,delta:diff});
  }
  synth.stopVoices();start(synth,sample,{inhibit:true});assert.deepEqual(base,synth.generateStereo(8192).left); // no writes, zero-filled stack
  synth.stopVoices();start(synth,sample,{tl:255});assert(delta(base,synth.generateStereo(8192).left)<.02); // TL controls modulation strength
  synth.stopVoices();start(synth,sample);const latest=synth.generateStereo(8192).left;
  synth.stopVoices();start(synth,sample,{offset:31});const previous=synth.generateStereo(8192).left;assert(delta(latest,previous)>.001);
  synth.stopVoices();start(synth,sample);synth.setModulation(1,{xOffset:62});const averaged=synth.generateStereo(8192).left;assert(delta(latest,averaged)>.001);
  synth.setModulation(0,{writeInhibit:true});synth.setMix(0,{totalLevel:20});assert.equal(core.read(12)&0x200,0x200);assert.equal(core.read(12)&255,20);
 }
 if(process.env.SCSP_FM_REPORT)await writeFile(process.env.SCSP_FM_REPORT,JSON.stringify({passed:true,rows,coreSlotWriteDelay:0,hardwareAccuracy:false},null,2)+'\n');
});
test('periodic guards cover the full signed displacement and never read a neighboring allocation',async t=>{
 for(const bits of [8,16])for(const depth of [1,5,10,15]){
  const {core,synth,sample,pcm}=await create(t,bits,depth),width=bits/8,padding=2**(depth-1);
  assert.equal(sample.address,sample.allocationAddress+padding*width);assert.equal(sample.byteLength,(pcm.length+1+2*padding)*width);
  const data=core.readRam(sample.allocationAddress,sample.byteLength),view=new DataView(data.buffer);
  for(let i=0;i<pcm.length+1+2*padding;i++){const expected=pcm[((i-padding)%pcm.length+pcm.length)%pcm.length];assert.equal(bits===8?view.getInt8(i):view.getInt16(i*2,false),expected);}
  start(synth,sample,{depth});const before=synth.generateStereo(8192);synth.loadPCM(new Int16Array(2000).fill(32767),{rootNote:69});synth.stopVoices();start(synth,sample,{depth});assert.deepEqual(before,synth.generateStereo(8192));
 }
});
test('depth zero is exact legacy PCM, live changes preserve phase and partitioning, Stop clears routing state',async t=>{
 const a=await create(t),b=await create(t);
 for(const {synth,sample}of [a,b])start(synth,sample);
 const whole=a.synth.generateStereo(16384),left=new Float32Array(16384),right=new Float32Array(16384);for(let i=0;i<left.length;i+=23)b.synth.renderInto(left,right,Math.min(23,left.length-i),i);assert.deepEqual(whole,{left,right});
 a.synth.setModulation(1,{depth:0});assert.equal(a.core.read(46),0);assert(a.synth.getState().slots[1].gate);
 a.synth.stopVoices();a.synth.setModulation(1,{depth:0,xOffset:63,yOffset:31});a.synth.keyOn(1);
 b.synth.stopVoices();b.synth.setModulation(1,{depth:0,xOffset:0,yOffset:0});b.synth.keyOn(1);assert.deepEqual(a.synth.generateStereo(8192),b.synth.generateStereo(8192));
 assert(a.synth.getState().playingModulations[0]===null);
});
test('unsafe PCM/routing fails atomically and pending presets do not leak into held routing',async t=>{
 const {core,synth,sample}=await create(t);start(synth,sample);let before=synth.getState();
 for(const bad of [{depth:16},{depth:-1},{xOffset:64},{yOffset:.5},{writeInhibit:1},{source:0}]){assert.throws(()=>synth.setModulation(1,bad));assert.deepEqual(synth.getState(),before);}
 for(const options of [{rootNote:69,modulationDepth:1},{rootNote:69,loopStartSamples:1,modulationDepth:5},{rootNote:69,loopStartSamples:0,modulationDepth:16}])assert.throws(()=>synth.loadPCM(new Int16Array(64),options));
 const plain=synth.loadPCM(new Int16Array(64),{rootNote:69,loopStartSamples:0});assert.throws(()=>synth.setPreset(2,{sample:plain,modulation:{depth:1}}),/padding/);
 synth.setPreset(1,{modulation:{xOffset:31,depth:12}});synth.setModulation(1,{yOffset:62});assert.equal(core.read(46),(9<<12)|(63<<6)|62);assert.equal(synth.getState().slots[1].modulation.depth,12);
 const state=synth.getState();state.slots[1].modulation.depth=0;state.playingModulations[1].depth=0;assert.equal(synth.getState().playingModulations[1].depth,9);
 synth.setPreset(1,{sample:plain,modulation:{depth:0}});assert.throws(()=>synth.setModulation(1,{depth:2}),/padding/);
 // An editor allocation retains its own guards and is pinned through release.
 const edited=synth._editPCM(2,new Int16Array([100,200]),{rootNote:69,loopStartSamples:0,modulationDepth:10});assert(edited.address>edited.allocationAddress);synth.setPreset(2,{modulation:{depth:10}});synth.keyOn(2);synth.keyOff(2);const next=synth._editPCM(2,new Int16Array([200,100]),{rootNote:69,loopStartSamples:0,modulationDepth:10});assert.notEqual(next.allocationAddress,edited.allocationAddress);
});

test('editable two-slot example renders a whole phrase through actual WASM and releases both operators',async t=>{
 const {synth}=await create(t),loops=[],audio=[];
 const source=await readFile(new URL('../docs/playground/examples/scsp/scsp-two-slot-fm.js',import.meta.url),'utf8');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 await new AsyncFunction('useSoundChip','setBpm','liveLoop','beat',source)(async kind=>{assert.equal(kind,'scsp');return synth;},()=>{},(_name,fn)=>loops.push(fn),async()=>{audio.push(synth.generateStereo(4096).left);});
 assert.equal(loops.length,1);await loops[0]();assert(audio.some(a=>a.some(x=>Math.abs(x)>.01)));assert.equal(synth.getState().slots[0].gate,false);assert.equal(synth.getState().slots[1].gate,false);assert.equal(synth.getState().slots[0].directLevel,0);assert.equal(synth.getState().slots[1].modulation.depth,9);
});
