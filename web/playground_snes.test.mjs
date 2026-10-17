import test from 'node:test';
import assert from 'node:assert/strict';
import {createSnesClient} from './playground_snes.js';
import {createProcessorPerformance,identifyPerformanceNote,performanceNoteRelease} from './playground_performance_processor.js';
import {createPerformanceSender} from './playground_performance_sender.js';
import {SnesSynth} from './snessynth.js';
const brr=new Uint8Array([0x13,...Array(8).fill(0x78)]);
function rpc() {
  const channel=new MessageChannel(),synth=new SnesSynth({core:{reset(){},loadRam(){},writeDsp(){},readDsp(){return 42;},snapshot(){return {ram:new Uint8Array(65536),dsp:new Uint8Array(128),nativeFrames:0};},dispose(){}}}),messages=[];
  channel.port1.onmessage=({data})=>{messages.push(data);if(data.method==='dispose')return;try{const value=synth[data.method](...data.args);if(data.id!==undefined)channel.port1.postMessage({id:data.id,value});}catch(error){channel.port1.postMessage({id:data.id,error:error.message});}};
  const client=createSnesClient(channel.port2,{sampleRate:44100});
  return{client,messages,remote:channel.port1,close(){client.dispose();channel.port1.close();}};
}
test('SNES client waits for BRR upload, copies caller bytes, validates controls and exposes applied state',async t=>{
  const p=rpc();t.after(()=>p.close());const original=brr.slice();
  const sample=await p.client.loadBRR(original,{rootNote:60,loopStartSamples:0});assert.deepEqual(original,brr);assert.equal(sample.startAddress,0x400);
  p.client.setPreset(7,{sample,gain:127});p.client.noteOn(7,'C5');
  const state=await p.client.getState();assert.equal(state.channels[7].pitch,8192);assert.equal(state.channels[7].sample,0);
  p.client.noteOff(7);assert.equal(await p.client.readDsp(0),42);
  assert.throws(()=>p.client.noteOn(8,'C4'),/channel/);assert.throws(()=>p.client.setFrequency(0,440),/Assign/);
  p.client.reset();assert.equal((await p.client.getState()).samples.length,1);
  p.client.dispose();assert.throws(()=>p.client.keyOn(0),/disposed/);await assert.rejects(p.client.loadBRR(brr,{rootNote:60,loopStartSamples:0}),/disposed/);
});
test('SNES failed upload remains retryable and processor failure rejects pending RPC then disposes',async t=>{
  const p=rpc();t.after(()=>p.close());
  await assert.rejects(p.client.loadBRR(brr,{rootNote:60}),/loopStartSamples/);
  const sample=await p.client.loadBRR(brr,{rootNote:60,loopStartSamples:0});assert.equal(sample.id,0);
  const pending=p.client.snapshot();p.remote.postMessage({fatal:true,error:'DSP failed'});
  await pending.catch(()=>{});await new Promise(resolve=>setImmediate(resolve));
  assert.throws(()=>p.client.keyOff(0),/disposed/);
});
test('SNES owner retirement uses KOFF for fixed voices and cannot release a newer owner',()=>{
  let frame=0;const commands=[],port={postMessage(){}};
  const p=createProcessorPerformance({chip:'snes',nowFrame:()=>frame,rate:1000,apply:command=>commands.push(command)});
  const send=(owner,time,method,args)=>p.receive({performance:{session:1,owner,time},commands:[{method,args}]},port);
  p.receive({type:'performance-start',session:1},port);
  send('old',.001,'noteOn',[7,'C4']);send('new',.002,'keyOn',[7]);send('old',.003,'keyOff',[7]);
  p.render(new Float32Array(4),new Float32Array(4),()=>{});frame=4;
  assert.deepEqual(commands.map(c=>c.method),['noteOn','keyOn']);
  p.receive({type:'performance-cancel-owner',session:1,owner:'old'},port);assert.equal(commands.length,2);
  p.receive({type:'performance-cancel-owner',session:1,owner:'new'},port);assert.deepEqual(commands.at(-1),{method:'keyOff',args:[7]});
  assert.deepEqual(performanceNoteRelease('snes',3),{method:'keyOff',args:[3]});
});
test('SNES raw multi-voice KON tracks each physical voice for cancellation',()=>{
  const commands=[],port={postMessage(){}};
  const p=createProcessorPerformance({chip:'snes',nowFrame:()=>0,rate:1000,apply:command=>commands.push(command)});
  p.receive({type:'performance-start',session:2},port);
  p.receive({performance:{session:2,owner:'chord',time:0},commands:[{method:'writeDsp',args:[0x4c,0x81]}]},port);
  p.render(new Float32Array(1),new Float32Array(1),()=>{});
  p.receive({type:'performance-cancel-owner',session:2,owner:'chord'},port);
  assert.deepEqual(commands.slice(-2),[{method:'keyOff',args:[0]},{method:'keyOff',args:[7]}]);
  assert.equal(identifyPerformanceNote('snes',{method:'keyOn',args:[6]}).key,6);
});
test('Worker SNES BRR/read resources are immediate while note and preset share performance lookahead',()=>{
  const posts=[],port={postMessage:data=>posts.push(data)},sender=createPerformanceSender({now:()=>1000,getLoop:()=>({performanceOwner:'lead'})});
  sender.configure({session:1,audioSeconds:2,performanceEpochMs:1000,lookaheadSeconds:.5});const proxy=sender.port(port,'independent');
  proxy.postMessage({method:'loadBRR',args:[brr,{rootNote:60,loopStartSamples:0}],id:1});
  proxy.postMessage({method:'setPreset',args:[0,{sample:0}]});proxy.postMessage({method:'noteOn',args:[0,'C4']});proxy.postMessage({method:'snapshot',args:[],id:2});
  assert.equal(posts[0].method,'loadBRR');assert.equal(posts[0].performance,undefined);
  assert.equal(posts[1].performance.time,2.5);assert.equal(posts[2].performance.time,2.5);assert.equal(posts[3].method,'snapshot');
});

import {createSnesAudio} from './playground_snes_audio.js';
function audioMock(t,{ready=true}={}) {
  const original=globalThis.AudioWorkletNode,nodes=[],listeners=new Set();
  const context={sampleRate:48000,state:'running',audioWorklet:{async addModule(){}},addEventListener(_,fn){listeners.add(fn);},removeEventListener(_,fn){listeners.delete(fn);}};
  globalThis.AudioWorkletNode=class{constructor(_context,name){assert.equal(name,'tetorica-playground-snes');this.disconnected=0;this.port={postMessage(){},close(){}};nodes.push(this);if(ready)queueMicrotask(()=>this.port.onmessage?.({data:{ready:true,sampleRate:48000}}));}connect(){}disconnect(){this.disconnected++;}};
  t.after(()=>{globalThis.AudioWorkletNode=original;});
  return{context,nodes,listeners,options:{fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)})}};
}
test('SNES audio endpoint binds direct port, reports native rate and cleans a late processor failure',async t=>{
  const p=audioMock(t),device=await createSnesAudio(p.context,{},p.options);t.after(()=>{device.dispose();device.port.close();});
  assert.equal(device.sampleRate,48000);assert.equal(device.nativeSampleRate,32000);assert.equal(p.listeners.size,1);
  p.nodes[0].onprocessorerror();assert.equal(p.nodes[0].disconnected,1);assert.equal(p.listeners.size,0);device.dispose();assert.equal(p.nodes[0].disconnected,1);
});
test('SNES audio initialization abort releases node and pending readiness',async t=>{
  const p=audioMock(t,{ready:false}),controller=new AbortController(),pending=createSnesAudio(p.context,{}, {...p.options,signal:controller.signal});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(p.nodes.length,1);controller.abort(new Error('cancel creation'));
  await assert.rejects(pending,/cancel creation/);assert.equal(p.nodes[0].disconnected,1);assert.equal(p.listeners.size,0);
});
test('SNES closing AudioContext rejects initialization and releases node without waiting forever',async t=>{
  const p=audioMock(t,{ready:false}),pending=createSnesAudio(p.context,{},p.options);
  await new Promise(resolve=>setImmediate(resolve));p.context.state='closed';for(const callback of [...p.listeners])callback();
  await assert.rejects(pending,/closed/);assert.equal(p.nodes[0].disconnected,1);assert.equal(p.listeners.size,0);
});
