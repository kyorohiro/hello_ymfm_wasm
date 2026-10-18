import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import factory from '../docs/generated/spc_wasm.js';
import {SpcCore} from './spc.js';
import {SpcResampler} from './spc_resampler.js';
import {createSpcClient} from './playground_spc.js';
import {createSpcAudio} from './playground_spc_audio.js';
import {createPerformanceSender} from './playground_performance_sender.js';
import {createSyntheticSpc} from './spc_test_fixture.mjs';

const wasmBinary = await readFile(new URL('../docs/generated/spc_wasm.wasm', import.meta.url));
const module = await factory({wasmBinary});
const source = (await readFile(new URL('./spc-worklet.js', import.meta.url), 'utf8'))
  .replace(/^import .*;$/gm, '').replace('export class ', 'class ');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function setup(t, {worker = false} = {}) {
  class WorkletBase {
    constructor() {this.port = {messages: [], postMessage(data) {this.messages.push(data);}, close() {}};}
  }
  const Processor = vm.runInNewContext(source + '\nSpcProcessor;', {
    AudioWorkletProcessor:WorkletBase, SpcCore, SpcResampler, moduleFactory:async () => module,
    sampleRate:48000, Float32Array, Uint8Array, Error, RangeError, Set, Object, Promise,
    registerProcessor() {},
  });
  const processor = new Processor({processorOptions:{wasmBinary}});
  await processor.ready;
  processor.port.onmessage({data:{type:'performance-start',session:1,id:'host-start'}});
  assert.equal(processor.port.messages.at(-1).type,'performance-result','the host performance handshake accepts file players');
  const channel = new MessageChannel();
  processor.port.onmessage({data:{type:'attach-spc-port', port:channel.port1}});
  let owner = 'old';
  const sender = createPerformanceSender({getLoop:() => ({performanceOwner:owner}), now:() => 1000});
  sender.configure({session:1,audioSeconds:1,performanceEpochMs:1000,lookaheadSeconds:.5});
  const client = createSpcClient(worker ? sender.port(channel.port2, 'spc') : channel.port2, {sampleRate:48000});
  t.after(() => {client.dispose(); processor.dispose(); channel.port1.close(); channel.port2.close();});
  return {client,processor,sender,channel,setOwner(value){owner=value;},render(frames=4800) {
    const channels = [new Float32Array(frames),new Float32Array(frames)]; processor.process([], [channels]); return channels;
  }};
}

for (const worker of [false,true]) test(`SPC ${worker?'Worker':'Main'} client plays actual DSP stereo and freezes/resets native time`, async t => {
  const f=await setup(t,{worker}), input=createSyntheticSpc(), original=input.slice();
  const loaded=await f.client.loadSPC(input); assert.equal(loaded.loaded,true); assert.equal(loaded.playing,false);
  assert.deepEqual(input,original,'upload transfers an owned copy');
  await f.client.play(); const first=f.render();
  assert.ok(first[0].some(value=>Math.abs(value)>.01)); assert.notDeepEqual(first[0],first[1]);
  const paused=await f.client.pause(); const frame=paused.playbackNativeFrames;
  assert.ok(f.render().every(channel=>channel.every(value=>value===0)));
  assert.equal((await f.client.getState()).playbackNativeFrames,frame);
  await f.client.seek(.25); assert.equal((await f.client.getState()).positionSeconds,.25);
  await f.client.play(); assert.ok(f.render()[0].some(value=>value!==0));
  await f.client.stop(); assert.equal((await f.client.getState()).positionSeconds,0);
  await f.client.play(); assert.deepEqual(f.render(),first);
  await f.client.setMuteMask(255); f.render(); assert.ok(f.render().every(channel=>channel.every(value=>value===0)));
  const snapshot=await f.client.snapshot(); assert.equal(snapshot.ram.length,65536); assert.equal(snapshot.dsp.length,128);
});

test('SPC Worker transport bypasses lookahead while old-owner cancellation cannot stop a replacement', async t => {
  const f=await setup(t,{worker:true});
  await f.client.loadSPC(createSyntheticSpc()); await f.client.play();
  assert.equal(f.processor.playbackOwner.owner,'old'); assert.equal(f.processor.state().playing,true);
  assert.ok(f.render()[0].some(value=>value!==0),'no 500 ms pre-roll is inserted');
  f.sender.cancelOwner('old'); f.setOwner('new');
  assert.equal((await f.client.getState()).playing,false);
  await f.client.play();
  f.channel.port2.postMessage({type:'performance-cancel-owner',session:1,owner:'old'});
  assert.equal((await f.client.getState()).playing,true);
  f.channel.port2.postMessage({method:'pause',args:[],id:999,spcPerformance:{session:1,owner:'old'}});
  assert.equal((await f.client.getState()).playing,true,'an old queued finally cannot pause the new song');
  f.sender.stop(); await tick(); await tick();
  assert.equal(f.processor.state().playing,false); assert.ok(f.render().every(channel=>channel.every(value=>value===0)));
});

test('SPC disposal rejects pending uploads and never permits a late play or seek', async t => {
  const f=await setup(t);
  const pending=f.client.loadSPC(createSyntheticSpc()); f.client.dispose();
  await assert.rejects(pending,{name:'AbortError'});
  assert.throws(()=>f.client.play(),{name:'AbortError'});
  await assert.rejects(f.client.seek(1),{name:'AbortError'});
  await tick(); await tick(); assert.equal(f.processor.disposed,true);
});

test('overlapping SPC seeks retain the original playback intent instead of inheriting the temporary pause', async t => {
  const f=await setup(t);
  await f.client.loadSPC(createSyntheticSpc()); await f.client.play();
  const command=f.processor.command.bind(f.processor);
  let second;
  f.processor.command=(data,reply)=>{
    const result=command(data,reply);
    if(data.type==='seek-begin'&&!second) second=f.client.seek(.25);
    return result;
  };
  await assert.rejects(f.client.seek(10),{name:'AbortError'});
  const final=await second;
  assert.equal(final.positionSeconds,.25); assert.equal(final.playing,true);
});

test('SPC malformed files and invalid controls leave the client retryable', async t => {
  const f=await setup(t);
  await assert.rejects(f.client.loadSPC(new Uint8Array(12)),/size/);
  const malformed=createSyntheticSpc(); malformed[0]=0;
  await assert.rejects(f.client.loadSPC(malformed),/header/);
  await f.client.loadSPC(createSyntheticSpc());
  assert.throws(()=>f.client.setMuteMask(256),/mask/);
  for (const seconds of [NaN,-1,Infinity,3601]) await assert.rejects(f.client.seek(seconds),/seconds/);
  await f.client.play(); assert.ok(f.render()[0].some(value=>value!==0));
});

function audioMock(t,{ready=true}={}) {
  const original=globalThis.AudioWorkletNode,nodes=[],listeners=new Set();
  const context={sampleRate:48000,state:'running',audioWorklet:{async addModule(){}},addEventListener(_,fn){listeners.add(fn);},removeEventListener(_,fn){listeners.delete(fn);}};
  globalThis.AudioWorkletNode=class{
    constructor(_context,name){assert.equal(name,'tetorica-spc');this.disconnects=0;this.messages=[];this.port={postMessage:data=>this.messages.push(data),close(){}};nodes.push(this);
      if(ready)queueMicrotask(()=>this.port.onmessage?.({data:{type:'ready',sampleRate:48000}}));}
    connect(destination){this.destination=destination;} disconnect(){this.disconnects++;}
  };
  t.after(()=>{globalThis.AudioWorkletNode=original;});
  return{context,nodes,listeners,options:{fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)})}};
}
test('SPC audio connects one bare Worklet to the supplied bus and releases it after failure',async t=>{
  const f=audioMock(t),destination={},device=await createSpcAudio(f.context,destination,f.options);
  t.after(()=>{device.dispose();device.port.close();});
  assert.equal(device.node.destination,destination); assert.equal(f.nodes.length,1); assert.equal(device.nativeSampleRate,32000);
  assert.equal(device.node.messages[0].type,'attach-spc-port');
  device.node.onprocessorerror(); assert.equal(device.node.disconnects,1); assert.equal(f.listeners.size,0);
});
test('SPC audio initialization cancellation cleans the late node without closing the shared context',async t=>{
  const f=audioMock(t,{ready:false}),controller=new AbortController();
  const pending=createSpcAudio(f.context,{}, {...f.options,signal:controller.signal});
  await tick(); assert.equal(f.nodes.length,1); controller.abort();
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal(f.nodes[0].disconnects,1); assert.equal(f.listeners.size,0); assert.equal(f.context.state,'running');
});
