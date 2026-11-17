// Resolve source and fixture URLs from the runtime directory.
const runtimeDirectoryUrl = new URL('../../tetorica_src/runtime/', import.meta.url);
// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import factory from '../../docs/generated/scsp_wasm.js';
import {Scsp} from '../../tetorica_src/runtime/scsp.js';
import {ScspSynth,createScspInitSample} from '../../tetorica_src/runtime/scspsynth.js';
import {Pcm44100Resampler} from '../../tetorica_src/runtime/pcm_44100_resampler.js';
import {createScspClient,SCSP_CONTROLS,SCSP_DSP_METHODS,createScspValidation,scspCommandArgs,validateScspDspCommand} from '../../tetorica_src/runtime/playground_scsp.js';
import {ScspVoiceInspector} from '../../tetorica_src/runtime/playground_scsp_inspector.js';
import {createProcessorPerformance} from '../../tetorica_src/runtime/playground_performance_processor.js';
import {receiveChipInspector} from '../../tetorica_src/runtime/playground_chip_inspector_state.js';
import {createPerformanceSender} from '../../tetorica_src/runtime/playground_performance_sender.js';
import {assembleScspDsp} from '../../tetorica_src/runtime/scsp_dsp_assembler.js';
const peak=a=>a.reduce((m,v)=>Math.max(m,Math.abs(v)),0);
async function setup(t,rate=48000){
 const wasmBinary=await readFile(new URL('../../docs/generated/scsp_wasm.wasm',runtimeDirectoryUrl)),source=await readFile(new URL('./playground_scsp_worklet.js',runtimeDirectoryUrl),'utf8');
 const main=new MessageChannel();let Processor;
 const scope={factory,Scsp,ScspSynth,createScspInitSample,Pcm44100Resampler,SCSP_CONTROLS,SCSP_DSP_METHODS,createScspValidation,scspCommandArgs,validateScspDspCommand,ScspVoiceInspector,receiveChipInspector,sampleRate:rate,currentFrame:0,
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
const gainProgram=()=>assembleScspDsp('000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=2\n001: EWT=1 ZERO=1');
const gainSetup=code=>({coefficients:{0:0,1:0,2:code}});
const twoBusProgram=()=>assembleScspDsp('000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0\n001: EWT=1 EWA=0 ZERO=1\n002: XSEL=1 YSEL=1 IRA=33 ZERO=1 COEF=0\n003: EWT=1 EWA=1 ZERO=1');
const twoBusSetup=()=>({coefficients:{0:2048,1:0,2:0}});

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

test('DSP owner acknowledgements retain independent word images and synchronize both clients',async t=>{
 const p=await setup(t),w=await worker(t,p),other=await setup(t);
 const words=gainProgram(),expected=Array.from(words),options=gainSetup(4095);
 const pending=w.applyDspProgram(words,options);
 words.fill(0);options.coefficients[2]=0;
 const applied=await pending;
 assert.equal(applied.profile,'ram-free');assert.equal(applied.configured,true);
 assert.deepEqual(applied.words,expected);assert.deepEqual(applied.coefficients.codes,[0,0,4095]);
 assert.deepEqual(await p.client.getDspProgram(),applied);
 applied.words.fill(0);applied.coefficients.codes[2]=0;
 assert.deepEqual((await p.client.getDspProgram()).words,expected);
 assert.equal((await other.client.getDspProgram()).configured,false);
 const broadcast=[],receive=p.client._getState();
 p.processor.port.postMessage=message=>broadcast.push(message);
 const coefficients=await w.setDspCoefficients({2:2048});
 assert.deepEqual(coefficients,{codes:[0,0,2048]});
 assert.deepEqual(p.client._getState().dsp.coefficients,coefficients);
 const delta=broadcast.find(message=>message.type==='scsp-dsp-update');
 assert.deepEqual(delta.args,[{2:2048}]);assert.equal(delta.method,'setDspCoefficients');
 assert(!JSON.stringify(delta).includes('words'),'Coefficient motion sends a small delta');
 assert.deepEqual(p.client._getState().dsp.words,receive.dsp.words);
 await p.client.setDspReturn({level:7,pan:16});
 assert.deepEqual((await w.getDspProgram()).return,{level:7,pan:16});
});

test('DSP Gain changes actual wet PCM without retriggering held slots at both host rates',async t=>{
 for(const rate of [44100,48000]){
  const full=await setup(t,rate),half=await setup(t,rate);
  for(const [p,code]of [[full,4095],[half,2048]]){
   await p.client.applyDspProgram(gainProgram(),gainSetup(code));
   await p.client.setDspReturn({level:7});
   p.client.setMix(31,{directLevel:0,dspSend:7});p.client.noteOn(31,69);await p.client.getState();
   assert.equal(p.processor.synth.getState().slots[31].gate,true);
  }
  const a=full.render(8192).left,b=half.render(8192).left;
  assert(peak(a)>.01);assert(Math.abs(peak(b)/peak(a)-.5)<.01);
  const before=await full.client.getState();
  assert.deepEqual(await full.client.setDspCoefficients({2:0}),{codes:[0,0,0]});
  assert.equal((await full.client.getState()).slots[31].gate,true);
  assert.deepEqual((await full.client.getState()).playingSampleIds,before.playingSampleIds);
  assert(full.render(512).left.subarray(8).every(value=>value===0));
  await full.client.setDspCoefficients({2:4095});
  assert(peak(full.render(512).left)>.01);
 }
});

test('indexed return acknowledgements synchronize both clients with small ordered deltas',async t=>{
 const p=await setup(t),w=await worker(t,p),other=await setup(t);
 await p.client.applyDspProgram(twoBusProgram(),twoBusSetup());
 assert.equal(Object.hasOwn(await w.getDspProgram(),'returns'),false);
 const broadcast=[];p.processor.port.postMessage=message=>broadcast.push(message);
 const patch={level:7,pan:15},pending=w.setDspReturn(1,patch);patch.level=0;patch.pan=0;
 assert.deepEqual(await pending,{level:7,pan:15});
 assert.deepEqual(await p.client.setDspReturn(0,{level:6,pan:31}),{level:6,pan:31});
 const expected=[{level:6,pan:31},{level:7,pan:15}];
 assert.deepEqual((await w.getDspProgram()).returns,expected);
 assert.deepEqual(p.client._getState().dsp.returns,expected);
 assert.deepEqual((await p.client.getDspProgram()).return,expected[0]);
 const deltas=broadcast.filter(message=>message.type==='scsp-dsp-update');
 assert.deepEqual(deltas.map(({method,args})=>({method,args})),[
  {method:'setDspReturn',args:[1,{level:7,pan:15}]},
  {method:'setDspReturn',args:[0,{level:6,pan:31}]},
 ]);
 assert(deltas[1].revision>deltas[0].revision);
 assert(deltas.every(message=>!JSON.stringify(message).includes('words')),'Return motion sends no program image');
 const detached=await w.getDspProgram();detached.returns[1].pan=0;
 assert.deepEqual((await p.client.getDspProgram()).returns,expected);
 assert.equal(Object.hasOwn(await other.client.getDspProgram(),'returns'),false);
 const state=await p.client.getState();
 for(const dspInput of [-1,2,.5,null]){
  assert.throws(()=>w.setMix(31,{dspInput}));assert.throws(()=>w.setPreset(31,{dspInput}));
 }
 for(const args of [[2,{level:7}],[1,{level:8}],[0]])await assert.rejects(w.setDspReturn(...args));
 assert.deepEqual(await p.client.getState(),state);
 await w._stopVoices();assert.deepEqual((await p.client.getDspProgram()).returns,expected);
 assert.equal(peak(p.render(512).left),0);assert.equal(peak(p.render(512).right),0);
 w.reset();await w.getState();await p.client.getState();
 assert.equal(p.client._getState().dsp,undefined);
 assert.equal(Object.hasOwn(await p.client.getDspProgram(),'returns'),false);
});

test('two-bus live and next-keyOn routing preserve held PCM phase at 44100 and 48000',async t=>{
 for(const rate of [44100,48000]){
  const p=await setup(t,rate),reference=await setup(t,rate),w=await worker(t,p);
  for(const current of [p,reference]){
   await current.client.applyDspProgram(twoBusProgram(),twoBusSetup());
   await current.client.setDspReturn(0,{level:7,pan:31});
   await current.client.setDspReturn(1,{level:7,pan:15});
   current.client.setPreset(31,{directLevel:0,dspSend:7,dspInput:0});
   current.client.noteOn(31,69);await current.client.getState();
  }
  const first=p.render(2048),expectedFirst=reference.render(2048);
  assert.deepEqual(first,expectedFirst);assert(peak(first.left)>.01);assert.equal(peak(first.right),0);
  const before=await w.getState(),frame=p.scope.currentFrame;
  w.setMix(31,{dspInput:1});await w.getState();
  assert.equal(p.scope.currentFrame,frame);
  const after=await p.client.getState();assert.equal(after.slots[31].gate,true);
  assert.deepEqual(after.playingSampleIds,before.playingSampleIds);
  const routed=p.render(1024),expected=reference.render(1024).left;
  assert.equal(peak(routed.left.subarray(8)),0);
  assert.deepEqual(routed.right.subarray(8),expected.subarray(8));
  w.setPreset(31,{dspInput:0});await w.getState();
  assert.equal(peak(p.render(512).left),0,'setPreset leaves the playing bus alone');
  assert(peak(p.render(512).right)>.01);
  w.noteOn(31,69);await w.getState();
  const rekey=p.render(512);assert(peak(rekey.left)>.01);assert.equal(peak(rekey.right.subarray(8)),0);
 }
});

test('DSP invalid programs and coefficient patches retain applied state and PCM bank',async t=>{
 const p=await setup(t);
 await p.client.applyDspProgram(gainProgram(),gainSetup(2048));
 const before=await p.client.getState(),program=await p.client.getDspProgram();
 for(const invoke of [
  ()=>p.client.applyDspProgram(assembleScspDsp('001: MRD=1')),
  ()=>p.client.applyDspProgram(gainProgram(),{coefficients:{2:4095}}),
  ()=>p.client.setDspCoefficients({2:4096}),
  ()=>p.client.setDspReturn({level:8}),
 ])await assert.rejects(invoke());
 assert.deepEqual(await p.client.getDspProgram(),program);
 assert.deepEqual(await p.client.getState(),before);
});

test('Worker DSP preparation retains owners and completes before rendering the note lookahead',async t=>{
 const p=await setup(t),channel=new MessageChannel(),owner={performanceOwner:'dsp-loop'};
 p.processor.port.onmessage({data:{primaryWorker:true,port:channel.port1}});
 const sender=createPerformanceSender({now:()=>1000,getLoop:()=>owner});
 sender.configure({session:29,audioSeconds:0,performanceEpochMs:1000,lookaheadSeconds:2});
 p.processor.receive({type:'performance-start',session:29},{postMessage(){}});
 const client=createScspClient(sender.port(channel.port2,'independent'),p.metadata);t.after(()=>client.dispose());
 const applied=await client.applyDspProgram(gainProgram(),gainSetup(4095));
 assert.deepEqual(applied.words,Array.from(gainProgram()));
 assert.equal(p.scope.currentFrame,0,'No rendering or lookahead wait is needed for setup');
 assert.equal(p.processor.performance.getStats().queuedCommands,0);
 await client.setDspCoefficients({2:2048});assert.deepEqual(await client.getDspCoefficients(),{codes:[0,0,2048]});
 await client.setDspReturn(1,{level:6,pan:15});
 assert.deepEqual((await p.client.getDspProgram()).returns,[{level:0,pan:0},{level:6,pan:15}]);
 assert.equal(p.scope.currentFrame,0,'Indexed return preparation also bypasses note lookahead');
 client.noteOn(31,69);await client.getState();
 assert.equal(p.processor.synth.getState().slots[31].gate,false);
 assert(p.processor.performance.getStats().queuedCommands>0);
 sender.cancelOwner('dsp-loop');
 await assert.rejects(client.setDspReturn(1,{level:0}),{name:'AbortError'});
 sender.stop();p.processor.receive({type:'performance-stop',session:29},{postMessage(){}});
 assert.deepEqual((await p.client.getDspProgram()).words,applied.words);
 const replies=[];
 p.processor.receive({performance:{session:29,owner:'dsp-loop',time:2},commands:[{method:'setDspCoefficients',args:[{2:0}],id:812}]},{postMessage:message=>replies.push(message)});
 assert(replies.some(message=>message.id===812&&message.error));
 assert.deepEqual(await p.client.getDspCoefficients(),{codes:[0,0,2048]});
 assert.deepEqual((await p.client.getDspProgram()).returns,[{level:0,pan:0},{level:6,pan:15}]);
 assert(p.render(256).left.every(value=>value===0));
});

test('DSP replies restore the captured caller and reject a stopped caller',async t=>{
 let current={name:'first'},stopped=false;const sent=[];
 const port={postMessage:message=>sent.push(message),start(){},close(){}};
 const client=createScspClient(port,{}, {captureContext:()=>current,restoreContext:scope=>{current=scope;},isStopped:()=>stopped});
 t.after(()=>client.dispose());
 const first=current,pending=client.setDspCoefficients({2:2048}),request=sent.at(-1);
 current={name:'other'};port.onmessage({data:{id:request.id,value:{codes:[0,0,2048]}}});
 await pending;assert.equal(current,first);
 const cancelled=client.getDspProgram(),next=sent.at(-1);stopped=true;
 port.onmessage({data:{id:next.id,value:{profile:'ram-free'}}});
 await assert.rejects(cancelled,{name:'AbortError'});
});

test('a DSP restore failure on Stop rejects its request immediately and retires the owner',async t=>{
 const p=await setup(t);
 await p.client.applyDspProgram(gainProgram(),gainSetup(4095));
 p.processor.synth.stopVoices=()=>{
  const error=new Error('Injected DSP restore failure');error.name='ScspDspRestoreError';error.fatal=true;throw error;
 };
 await assert.rejects(p.client._stopVoices(),{name:'ScspDspRestoreError'});
 assert.equal(p.processor.dead,true);
 const left=new Float32Array(128).fill(.5),right=left.slice();
 assert.equal(p.processor.process([],[[left,right]]),false);
 assert(left.every(value=>value===0));assert(right.every(value=>value===0));
});

test('managed Delay acknowledgements synchronize its reserved ring and preserve existing PCM handles',async t=>{
 const p=await setup(t),w=await worker(t,p),other=await setup(t);
 const initial=await p.client.getState(),original=initial.samples[0];
 p.client.noteOn(0,69);await p.client.getState();p.render(256);
 const settings={enabled:true,timeMs:40,feedback:.5};
 const pending=w.setDspDelay(settings);
 settings.timeMs=700;settings.feedback=0;
 const applied=await pending;
 assert.equal(applied.profile,'delay-ring');
 assert.deepEqual(applied.delay,{enabled:true,timeMs:40,feedback:.5});
 assert.equal(applied.ram.byteLength,65536);
 assert.equal(applied.ram.address%8192,0);
 assert(applied.ram.address>=initial.ramUsedBytes);
 const state=await p.client.getState();
 assert.deepEqual(state.dspRam,applied.ram);
 assert.equal(state.ramUsedBytes,applied.ram.address+65536);
 assert.equal(state.slots[0].sample.id,original.id);
 assert.equal(state.samples[0].address,original.address);
 assert.equal(state.slots[0].gate,true);
 assert.deepEqual(p.client._getState().dspRam,state.dspRam);
 assert.deepEqual(w._getState().dspRam,state.dspRam);
 assert.equal((await other.client.getState()).dspRam,undefined);
 assert.deepEqual(await w.getDspProgram(),applied);
 applied.ram.address=0;applied.delay.timeMs=700;
 assert.equal((await p.client.getDspProgram()).delay.timeMs,40);
 await w.setDspCoefficients({1:1024});
 assert.equal((await p.client.getDspProgram()).delay.feedback,.25);
 assert.equal(p.client._getState().dsp.delay.feedback,.25);
 const next=await p.client.loadPCM(new Int8Array(64),{rootNote:69});
 assert(next.address>=state.dspRam.address+state.dspRam.byteLength);
});

test('managed Delay produces wet audio at both host rates and Stop retains setup while clearing the tail',async t=>{
 for(const rate of [44100,48000]){
  const p=await setup(t,rate),w=await worker(t,p);
  await w.setDspDelay({enabled:true,timeMs:20,feedback:.5});
  await w.setDspReturn({level:7});
  w.setMix(0,{directLevel:0,dspSend:7});w.noteOn(0,69);await w.getState();
  assert.equal(peak(p.render(Math.floor(rate*.018)).left),0);
  assert(peak(p.render(Math.ceil(rate*.04)).left)>.01);
  const held=await w.getState(),program=await w.getDspProgram();
  await w.setDspDelay({feedback:.25});
  const changed=await w.getState();
  assert.equal(changed.slots[0].gate,true);
  assert.deepEqual(changed.playingSampleIds,held.playingSampleIds);
  assert.deepEqual(changed.dspRam,held.dspRam);
  assert.equal(changed.dsp.delay.feedback,.25);
  assert.equal(changed.dsp.revision,program.revision);
  const beforeStop=await w.getDspProgram();
  await w._stopVoices();
  assert.equal(peak(p.render(Math.ceil(rate*.1)).left),0);
  assert.deepEqual(await w.getDspProgram(),beforeStop);
  w.reset();await w.getState();
  assert.equal((await w.getState()).dsp,undefined);
  assert.deepEqual(w._getState().dspRam,held.dspRam);
  w.reset({clearRam:true});await w.getState();await p.client.getState();
  assert.equal(w._getState().dspRam,undefined);
  assert.equal(p.client._getState().dspRam,undefined);
 }
});

test('Delay rejects insufficient RAM and invalid patches before changing either client or the audio owner',async t=>{
 const p=await setup(t),w=await worker(t,p);
 for(let index=0;index<3;index++)await w.loadPCM(new Int16Array(65535),{rootNote:69});
 await w.loadPCM(new Int16Array(60000),{rootNote:69});
 const before=await w.getState();
 for(const settings of [{enabled:true},{timeMs:19},{timeMs:701},{feedback:1},{enabled:1},{send:7}]){
  await assert.rejects(w.setDspDelay(settings));
  assert.deepEqual(await w.getState(),before);
  assert.deepEqual(p.client._getState().dspRam,before.dspRam);
 }
 assert.equal(p.processor.dead,false);
});

test('Worker Delay setup observes owner cancellation and completes before note lookahead',async t=>{
 const p=await setup(t),channel=new MessageChannel(),owner={performanceOwner:'delay-loop'};
 p.processor.port.onmessage({data:{primaryWorker:true,port:channel.port1}});
 const sender=createPerformanceSender({now:()=>1000,getLoop:()=>owner});
 sender.configure({session:39,audioSeconds:0,performanceEpochMs:1000,lookaheadSeconds:2});
 p.processor.receive({type:'performance-start',session:39},{postMessage(){}});
 const client=createScspClient(sender.port(channel.port2,'independent'),p.metadata);
 t.after(()=>client.dispose());
 const applied=await client.setDspDelay({enabled:true,timeMs:40,feedback:.5});
 assert.equal(applied.profile,'delay-ring');
 assert.equal(p.scope.currentFrame,0);
 assert.equal(p.processor.performance.getStats().queuedCommands,0);
 const before=await client.getState();
 sender.cancelOwner('delay-loop');
 await assert.rejects(client.setDspDelay({timeMs:80}),{name:'AbortError'});
 assert.deepEqual(await p.client.getState(),before);
 const replies=[];
 p.processor.receive({performance:{session:39,owner:'delay-loop',time:2},commands:[
  {method:'setDspDelay',args:[{timeMs:80}],id:913},
 ]},{postMessage:message=>replies.push(message)});
 assert(replies.some(message=>message.id===913&&message.error));
 assert.equal((await p.client.getDspProgram()).delay.timeMs,40);
});

test('a delayed Delay reply cannot restore a ring after the client reset fence advances',async t=>{
 const sent=[],port={postMessage:message=>sent.push(message),start(){},close(){}};
 const client=createScspClient(port),validation=createScspValidation();
 t.after(()=>{client.dispose();validation.dispose();});
 const staleProgram=validation.setDspDelay({enabled:true,timeMs:40,feedback:.5});
 const staleState=validation.getState();
 const pending=client.setDspDelay({enabled:true,timeMs:40,feedback:.5});
 const request=sent.at(-1);
 client.reset({clearRam:true});
 const reset=sent.at(-1);
 assert.equal(reset.resourceFence,1);
 port.onmessage({data:{type:'scsp-resources',resourceFence:0,revision:1,bankEpoch:0,state:staleState}});
 port.onmessage({data:{id:request.id,value:staleProgram}});
 await assert.rejects(pending,{name:'AbortError'});
 assert.equal(client._getState().dspRam,undefined);
 assert.equal(client._getState().dsp,undefined);
 assert.equal(client._getState().ramUsedBytes,0);
});

test('late indexed return deltas and acknowledgements cannot cross the client reset fence',async t=>{
 const sent=[],port={postMessage:message=>sent.push(message),start(){},close(){}};
 const client=createScspClient(port);t.after(()=>client.dispose());
 const pending=client.setDspReturn(1,{level:7,pan:15}),request=sent.at(-1);
 client.reset();assert.equal(sent.at(-1).resourceFence,1);
 port.onmessage({data:{type:'scsp-dsp-update',method:'setDspReturn',args:[1,{level:7,pan:15}],revision:1,resourceFence:0}});
 port.onmessage({data:{id:request.id,value:{level:7,pan:15}}});
 await assert.rejects(pending,{name:'AbortError'});
 assert.equal(client._getState().dsp,undefined);
 assert(client._getState().slots.every(slot=>!Object.hasOwn(slot,'dspInput')));
});
