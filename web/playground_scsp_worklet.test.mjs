// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import factory from '../docs/generated/scsp_wasm.js';
import {Scsp} from './scsp.js';
import {ScspSynth,createScspInitSample} from './scspsynth.js';
import {Pcm44100Resampler} from './pcm_44100_resampler.js';
import {createScspClient,SCSP_CONTROLS,createScspValidation,scspCommandArgs} from './playground_scsp.js';
import {ScspVoiceInspector} from './playground_scsp_inspector.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
import {createPerformanceSender} from './playground_performance_sender.js';
const peak=a=>a.reduce((m,v)=>Math.max(m,Math.abs(v)),0);
async function setup(t,rate=48000){
 const wasmBinary=await readFile(new URL('../docs/generated/scsp_wasm.wasm',import.meta.url)),source=await readFile(new URL('./playground_scsp_worklet.js',import.meta.url),'utf8');
 const main=new MessageChannel();let Processor;
 const scope={factory,Scsp,ScspSynth,createScspInitSample,Pcm44100Resampler,SCSP_CONTROLS,createScspValidation,scspCommandArgs,ScspVoiceInspector,receiveChipInspector,sampleRate:rate,currentFrame:0,
 AudioWorkletProcessor:class{constructor(){this.port=main.port1;}},registerProcessor(name,Class){assert.equal(name,'tetorica-playground-scsp');Processor=Class;}};
 scope.createProcessorPerformance=options=>createProcessorPerformance({...options,rate,nowFrame:()=>scope.currentFrame});
 vm.runInNewContext(source.replace(/^import .*;\n/gm,'').replace('export class ScspInstrumentProcessor','class ScspInstrumentProcessor'),scope);
 const ready=new Promise((resolve,reject)=>{main.port2.onmessage=({data})=>data.ready?resolve(data):data.error?reject(Error(data.error)):undefined;});
 const processor=new Processor({processorOptions:{wasmBinary}}),metadata=await ready,remote=new MessageChannel();
 main.port2.postMessage({port:remote.port1},[remote.port1]);const client=createScspClient(remote.port2,metadata);await client.getState();
 t.after(()=>{client.dispose();processor.dispose();main.port1.close();main.port2.close();});
 return {processor,client,scope,metadata,render(frames){const left=new Float32Array(frames),right=left.slice();assert(processor.process([],[[left,right]]));scope.currentFrame+=frames;return {left,right};}};
}
async function worker(t,p){const channel=new MessageChannel();p.processor.port.onmessage({data:{primaryWorker:true,port:channel.port1}});const client=createScspClient(channel.port2,p.metadata);t.after(()=>client.dispose());await client.getState();return client;}

test('SCSP Worklet renders tuned stereo at 44100, 48000 and 96000, with phase-stable host conversion',async t=>{
 for(const rate of [44100,48000,96000]){
  const a=await setup(t,rate),b=await setup(t,rate);
  for(const p of [a,b]){assert.equal((await p.client.getState()).slots.length,32);p.client.noteOn(31,'A4');await p.client.getState();}
  const expected=a.render(12001).left,actual=new Float32Array(12001);for(let at=0;at<actual.length;at+=127)actual.set(b.render(Math.min(127,actual.length-at)).left,at);
  assert.deepEqual(actual,expected);assert(peak(actual)>.04&&peak(actual)<.25);
  let edges=0,first=-1,last=0;for(let i=1;i<actual.length;i++)if(actual[i-1]<=0&&actual[i]>0){if(first<0)first=i;last=i;edges++;}
  assert(Math.abs((edges-1)*rate/(last-first)-440)<.5);
  a.client.keyOff(31);await a.client.getState();assert(a.render(rate/4).left.subarray(-128).every(v=>v===0));
 }
});

test('PCM uploads synchronize two clients, preserve caller buffers, reject foreign/stale handles and recover after reset',async t=>{
 const p=await setup(t),w=await worker(t,p),other=await setup(t),init=createScspInitSample();
 const pcm=init.pcm.slice(),sample=await w.loadPCM(pcm,init.options);assert.deepEqual(pcm,init.pcm);
 await p.client.getState();p.client.setPreset(1,{sample});p.client.noteOn(1,69);await p.client.getState();assert(peak(p.render(128).left)>0);
 assert.throws(()=>other.client.setPreset(0,{sample}),/another bank/);
 w.reset({clearRam:true});await w.getState();await p.client.getState();assert.throws(()=>p.client.setPreset(1,{sample}),/another bank/);
 const fresh=await p.client.loadPCM(pcm,init.options);assert(fresh.id>sample.id);await w.getState();w.setPreset(0,{sample:fresh});w.noteOn(0,69);await w.getState();assert(peak(p.render(128).left)>0);
 const before=await w.getState();await assert.rejects(w.loadPCM(new Uint8Array(4),init.options));assert.deepEqual(await w.getState(),before);
});

test('scheduled notes wait, manual slot leases resist stale releases, Stop cancels notes and clears resampler tails',async t=>{
 const p=await setup(t),port={postMessage(){}};
 p.processor.receive({type:'performance-start',session:4},port);
 p.processor.receive({performance:{session:4,owner:'future',time:.1},commands:[{method:'noteOn',args:[31,69]}]},port);
 assert.equal(peak(p.render(1024).left),0);assert(peak(p.render(6000).left)>0);
 const i=p.processor.inspector;i.invoke('auditionOn',[31,72,'new']);assert.equal(i.invoke('auditionOff',[31,'old']),false);
 p.processor.receive({performance:{session:4,owner:'future',time:1},commands:[{method:'keyOff',args:[31]}]},port);
 assert(peak(p.render(48000).left)>.01);assert.equal(i.read().auditions[0].id,'new');
 i.invoke('auditionOff',[31,'new']);p.processor.receive({performance:{session:4,owner:'future',time:3},commands:[{method:'noteOn',args:[0,69]}]},port);
 p.processor.receive({type:'performance-stop',session:4},port);assert.equal(peak(p.render(100000).left),0);
 assert.throws(()=>i.invoke('auditionOn',[0,200,'bad']));assert.equal(i.read().auditions.length,0);
});

test('Worker preparation barriers reset/upload immediately while note gates retain lookahead',async t=>{
 const p=await setup(t),channel=new MessageChannel();p.processor.port.onmessage({data:{primaryWorker:true,port:channel.port1}});
 const sender=createPerformanceSender({now:()=>1000,getLoop:()=>({performanceOwner:'worker'})});sender.configure({session:7,audioSeconds:0,performanceEpochMs:1000,lookaheadSeconds:.5});
 p.processor.receive({type:'performance-start',session:7},{postMessage(){}});
 const w=createScspClient(sender.port(channel.port2,'independent'),p.metadata);t.after(()=>w.dispose());
 w.reset({clearRam:true});const init=createScspInitSample(),sample=await w.loadPCM(init.pcm,init.options);w.setPreset(0,{sample});w.noteOn(0,69);await w.getState();
 assert.equal(peak(p.render(1024).left),0);assert(peak(p.render(30000).left)>0);
 p.processor.stopVoices();assert.equal(peak(p.render(1024).left),0);
});

test('a cancelled applied owner releases only its slots and stale owners cannot release replacements',async t=>{
 const p=await setup(t),port={postMessage(){}};
 p.processor.receive({type:'performance-start',session:10},port);
 p.processor.receive({performance:{session:10,owner:'a',time:0},commands:[{method:'noteOn',args:[0,60]}]},port);
 p.processor.receive({performance:{session:10,owner:'b',time:0},commands:[{method:'noteOn',args:[31,69]}]},port);p.render(128);
 p.processor.receive({type:'performance-cancel-owner',session:10,owner:'a'},port);p.render(4410);
 assert.equal(p.processor.synth.getState().slots[0].gate,false);assert.equal(p.processor.synth.getState().slots[31].gate,true);
 p.processor.receive({performance:{session:10,owner:'c',time:p.scope.currentFrame/48000},commands:[{method:'noteOn',args:[31,72]}]},port);p.render(128);
 p.processor.receive({type:'performance-cancel-owner',session:10,owner:'b'},port);assert.equal(p.processor.synth.getState().slots[31].gate,true);
});

test('a new manual key takes over the same physical slot while its old release stays harmless',async t=>{
 const p=await setup(t),i=p.processor.inspector;
 i.invoke('auditionOn',[31,69,'first']);p.render(128);
 i.invoke('auditionOn',[31,72,'second']);assert(Math.abs(p.processor.synth.getState().slots[31].frequencyHz-523.251)<.01);
 assert.equal(i.invoke('auditionOff',[31,'first']),false);assert(peak(p.render(128).left)>.01);
 assert.equal(i.invoke('auditionOff',[31,'second']),true);assert(p.render(4410).left.subarray(-128).every(v=>v===0));
});

test('PCM editor copies signed data, allocates only on Apply, preserves shared/held samples and rejects invalid uploads atomically',async t=>{
 const p=await setup(t),i=p.processor.inspector,initial=p.processor.synth.getState();
 const original=i.invoke('getPCM',[0]);assert.deepEqual(Array.from(original.pcm),Array.from(createScspInitSample().pcm));
 original.pcm.fill(0);assert.notDeepEqual(i.invoke('getPCM',[0]).pcm,original.pcm);
 i.invoke('auditionOn',[0,69,'held']);p.render(128);
 const pcm=Int8Array.from([-128,-64,0,64,127,64,0,-64]);
 const sample=i.invoke('applyPCM',[0,pcm,{baseFrequencyHz:44100/8,loopStartSamples:0}]);
 assert.equal(sample.bits,8);assert.deepEqual(Array.from(i.invoke('getPCM',[0]).pcm),Array.from(pcm));
 const changed=p.processor.synth.getState();assert.equal(changed.slots[1].sample.id,initial.slots[1].sample.id);assert(changed.slots[0].gate);assert(peak(p.render(128).left)>0);
 i.invoke('setEnvelope',[0,{attackRate:20}]);assert.equal(p.processor.synth.getState().slots[0].envelope.attackRate,20);
 i.invoke('setMix',[0,{pan:15}]);assert.equal(p.processor.synth.getState().slots[0].pan,15);
 const before=p.processor.synth.getState();
 assert.throws(()=>i.invoke('applyPCM',[0,pcm,{baseFrequencyHz:0}]));assert.deepEqual(p.processor.synth.getState(),before);
 assert.throws(()=>i.invoke('applyPCM',[0,pcm,{baseFrequencyHz:.001,loopStartSamples:7}]));assert.deepEqual(p.processor.synth.getState(),before);
 assert.throws(()=>i.invoke('setEnvelope',[0,{attackRate:32}]));assert.deepEqual(p.processor.synth.getState(),before);
 await p.client.getState();assert(p.client._getState().samples.some(s=>s.id===sample.id));
 i.invoke('auditionOff',[0,'held']);i.invoke('auditionOn',[0,69,'new']);assert(peak(p.render(128).right)>0);
});

test('editor reuse synchronizes clients and preserves descriptors referenced by queued presets',async t=>{
 const p=await setup(t),i=p.processor.inspector,w=await worker(t,p),{pcm,options}=createScspInitSample();
 const first=i.invoke('applyPCM',[0,pcm,options]);await p.client.getState();
 const port={postMessage(){}};p.processor.receive({type:'performance-start',session:30},port);assert.throws(()=>i.invoke('applyPCM',[0,pcm,options]),/Stop scheduled playback/,'an active producer is protected even before its first batch arrives');
 p.processor.receive({performance:{session:30,owner:'pending',time:.2},commands:[{method:'setPreset',args:[1,{sample:first}]},{method:'noteOn',args:[1,69]}]},port);
 const beforeQueuedEdit=p.processor.synth.getState();assert.throws(()=>i.invoke('applyPCM',[0,pcm.map(v=>v/2),options]),/Stop scheduled playback/);assert.deepEqual(p.processor.synth.getState(),beforeQueuedEdit);
 assert(peak(p.render(15000).left)>0);assert.equal(p.processor.synth.getState().slots[1].sample.id,first.id);assert.equal(p.processor.dead,false);
 p.processor.stopVoices();i.invoke('setPreset',[1,{sample:null}]);
 const before=p.processor.synth.getState().ramUsedBytes;
 for(let n=0;n<100;n++)i.invoke('applyPCM',[0,pcm,options]);assert.equal(p.processor.synth.getState().ramUsedBytes,before);
 await new Promise(resolve=>setTimeout(resolve,10));w.noteOn(0,69);await w.getState();assert(peak(p.render(128).left)>0,'Worker validation adopts the replacement for a retired editor handle');
});

test('editor deltas carry actual playing sources and validate new short-loop notes before they reach render',async t=>{
 const p=await setup(t),w=await worker(t,p),i=p.processor.inspector,{pcm,options}=createScspInitSample();
 const first=i.invoke('applyPCM',[0,pcm,options]);i.invoke('auditionOn',[0,69,'held-source']);
 const second=i.invoke('applyPCM',[0,new Int16Array(128).fill(1000),{baseFrequencyHz:44100/128,loopStartSamples:0}]);
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(w._getState().slots[0].sample.id,second.id);assert.equal(w._getState().playingSampleIds[0],first.id);
 w.setFrequency(0,440);await w.getState();p.render(128);assert.equal(p.processor.dead,false);
 p.processor.stopVoices();i.invoke('setPreset',[0,{frequencyHz:440}]);i.invoke('applyPCM',[0,new Int16Array([1000,-1000]),{baseFrequencyHz:440,loopStartSamples:1}]);
 await new Promise(resolve=>setTimeout(resolve,10));assert.throws(()=>w.noteOn(0,81),/pitch step exceeds forward loop/);assert.equal(p.processor.dead,false);p.render(128);
});

test('Main/Worker LFO edits and inspector leases share the same processor without retriggering',async t=>{
 const p=await setup(t),w=await worker(t,p);p.client.noteOn(0,69);await p.client.getState();p.render(256);
 w.setLfo(0,{frequencyCode:20,pitchWave:2,pitchDepth:4,amplitudeDepth:5});await w.getState();
 assert.equal(p.processor.synth.getState().slots[0].lfo.frequencyCode,20);assert.equal(p.processor.synth.getState().slots[0].gate,true);assert(peak(p.render(12000).left)>.01);
 p.processor.inspector.invoke('auditionOn',[31,69,'lfo-held']);p.processor.inspector.invoke('setLfo',[31,{frequencyCode:0,amplitudeDepth:7,reset:true}]);
 assert.equal(p.processor.synth.getState().slots[31].lfo.reset,true);assert.equal(p.processor.inspector.invoke('auditionOff',[31,'stale']),false);
 p.processor.inspector.invoke('setLfo',[31,{reset:false}]);assert.equal(p.processor.synth.getState().slots[31].lfo.amplitudeDepth,7);
 await p.client._stopVoices();assert(p.render(256).left.every(v=>v===0));assert.equal(p.processor.synth.getState().slots[31].lfo.amplitudeDepth,7);
});

test('slot modulation crosses Main/Worker ports, keeps padded PCM owned and respects manual leases',async t=>{
 const p=await setup(t),w=await worker(t,p),{pcm,options}=createScspInitSample();
 const sample=await w.loadPCM(pcm,{...options,modulationDepth:12});
 w.setPreset(0,{sample,directLevel:0});w.setPreset(1,{sample,totalLevel:16,modulation:{depth:9,xOffset:63,yOffset:63}});w.noteOn(0,57);w.noteOn(1,69);await w.getState();
 assert(peak(p.render(4096).left)>.01);
 w.setModulation(1,{depth:10});let state=await w.getState();assert.equal(state.playingModulations[1].depth,10);assert.equal(state.slots[1].modulation.xOffset,63);
 const before=structuredClone(state);assert.throws(()=>w.setModulation(1,{depth:13}),/padding/);assert.deepEqual(await w.getState(),before);
 // UI takes a manual lease on carrier slot 1; scheduled code cannot change it.
 const scheduled={postMessage(){}};p.processor.receive({type:'performance-start',session:88},scheduled);
 p.processor.receive({type:'chip-inspector',action:'invoke',method:'auditionOn',args:[1,69,'fm-lease'],id:8787},p.processor.port);
 p.processor.receive({performance:{session:88,owner:'fm-code',time:0},commands:[{method:'setModulation',args:[1,{depth:0}]},{method:'setLfo',args:[1,{amplitudeDepth:7}]}]},scheduled);p.render(128);assert.equal(p.processor.synth.getState().slots[1].modulation.depth,10);assert.equal(p.processor.synth.getState().slots[1].lfo.amplitudeDepth,0);
 p.processor.receive({type:'chip-inspector',action:'invoke',method:'setModulation',args:[1,{depth:8}],id:8788},p.processor.port);assert.equal(p.processor.synth.getState().slots[1].modulation.depth,8);
 await w._stopVoices();assert.equal(peak(p.render(128).left),0);assert.equal((await w.getState()).samples.find(s=>s.id===sample.id).modulationDepth,12);
});
