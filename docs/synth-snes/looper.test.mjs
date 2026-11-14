import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createSnesLooper,makeLoopBuffer} from './looper.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({waitForAudio}={}) {
  let node,audioGate=waitForAudio;const sources=[],edges=[],releases=[];
  const context={currentTime:10,sampleRate:8000,audioWorklet:{addModule:async()=>{}},
    createBuffer(channels,length,sampleRate){const pcm=Array.from({length:channels},()=>new Float32Array(length));return {length,sampleRate,getChannelData:i=>pcm[i]};},
    createBufferSource(){const source={connect:dest=>edges.push(dest),start:(...args)=>source.startArgs=args,stop:()=>source.stopped=true,disconnect(){}};sources.push(source);return source;}};
  const engine={context,songInputNode:{name:'pre-Master'},codeOutputNode:{connect:dest=>edges.push(dest),disconnect(){}}};
  const looper=createSnesLooper({ensureAudio:()=>audioGate??Promise.resolve(engine),releaseNotes:async()=>releases.push(true),createNode:()=>{
    node={addEventListener:(_name,listener)=>node.fault=listener,connect:dest=>edges.push(dest),disconnect(){},port:{close(){},postMessage(message){node.messages.push(message);if(message.method==='start')queueMicrotask(()=>node.port.onmessage?.({data:{id:message.id,started:true,startFrame:80000}}));}},messages:[]};return node;
  }});
  return{looper,engine,context,sources,edges,releases,setAudioGate(value){audioGate=value;},get node(){return node;},async take({frames=8000,value=.2}={}){await looper.record();await looper.record();const id=node.messages.findLast(m=>m.method==='start').id;node.port.onmessage({data:{id,done:true,startFrame:80000,bodyFrames:frames,left:new Float32Array(frames+2000).fill(value),right:new Float32Array(frames+2000).fill(-value)}});await tick();}};
}
test('live PCM layers retain independent sound, use one pre-Master bus, Undo and Stop/Start preserve period',async()=>{
 const f=fixture();assert.equal(f.node,undefined);await f.looper.start();await f.take();assert.equal(f.looper.read().unitCount,1);assert.equal(f.looper.read().loopLength,1);const first=f.sources[0].buffer;assert.equal(first.getChannelData(0)[3000],Math.fround(.2));assert(Math.abs(first.getChannelData(0)[0]-.4)<1e-6,'tail folds across cycle');
 await f.take({value:.1});assert.equal(f.looper.read().unitCount,2);assert.equal(f.sources[0].buffer,first);assert(f.edges.filter(e=>e===f.engine.songInputNode).length===3);f.looper.undo();assert.equal(f.looper.read().unitCount,1);assert(f.sources[1].stopped);f.looper.stop();assert(f.sources[0].stopped);await f.looper.start();assert.equal(f.sources.at(-1).buffer,first);f.looper.clear();assert.equal(f.looper.read().unitCount,0);assert.equal(f.looper.read().loopLength,0);f.looper.dispose();
});
test('Stop during lazy initialization and late capture replies cannot resurrect playback',async()=>{
 let resolve;const f=fixture({waitForAudio:new Promise(r=>resolve=r)}),starting=f.looper.start();await tick();f.looper.stop();resolve(f.engine);await starting;assert.equal(f.node,undefined);assert.equal(f.looper.read().running,false);
 const g=fixture();await g.looper.start();await g.looper.record();const id=g.node.messages.findLast(m=>m.method==='start').id;g.looper.undo();g.node.port.onmessage({data:{id,done:true,left:new Float32Array(8000),right:new Float32Array(8000),bodyFrames:8000,startFrame:80000}});await tick();assert.equal(g.looper.read().unitCount,0);assert.equal(g.sources.length,0);g.looper.dispose();
});
test('layer cap, short takes, capture failure and context replacement retain completed audio',async()=>{
 const f=fixture();await f.looper.start();await f.take({frames:100});assert.match(f.looper.read().error,/short/);assert.equal(f.sources.length,0);
 for(let i=0;i<16;i++)await f.take({frames:400});await f.looper.record();assert.match(f.looper.read().error,/16 layer/);assert.equal(f.looper.read().unitCount,16);const oldNode=f.node;f.node.fault();assert.equal(f.looper.read().running,false);assert.equal(f.looper.read().unitCount,16);await f.looper.start();assert.equal(f.looper.read().running,true);oldNode.fault();assert.equal(f.looper.read().running,true,'stale capture failure is ignored');f.looper.audioClosed();assert.equal(f.looper.read().unitCount,16);f.looper.dispose();
});
test('folding overdubs preserves phase and signed stereo tails',()=>{
 const f=fixture();const b=makeLoopBuffer(f.context,{sampleRate:8000,left:new Float32Array([1,2,3,4,5]),right:new Float32Array([-1,-2,-3,-4,-5])},4/8000,2/8000);assert.deepEqual([...b.getChannelData(0)],[3,4,6,2]);assert.deepEqual([...b.getChannelData(1)],[-3,-4,-6,-2]);f.looper.dispose();
});
test('actual capture processor records only its input, emits silence, auto-finishes and cancels',async()=>{
 let Processor;const messages=[];let frame=0;const sandbox={Float32Array,sampleRate:8000,currentFrame:0,AudioWorkletProcessor:class{constructor(){this.port={postMessage:data=>messages.push(data)};}},registerProcessor:(_name,type)=>Processor=type};
 vm.runInNewContext((await readFile(new URL('./looper-processor.js',import.meta.url),'utf8')).replace('export class','class'),sandbox);const p=new Processor();
 const send=data=>p.port.onmessage({data}),process=()=>{sandbox.currentFrame=frame;frame+=128;const out=[new Float32Array(128).fill(1),new Float32Array(128).fill(1)];p.process([[new Float32Array(128).fill(.25),new Float32Array(128).fill(-.5)]],[out]);assert(out.every(c=>c.every(v=>v===0)));};
 send({method:'start',id:1,maxFrames:256});for(let i=0;i<20;i++)process();const take=messages.find(m=>m.done);assert.equal(take.bodyFrames,256);assert.equal(take.left.length,2256);assert(take.left.every(v=>v===.25));assert(take.right.every(v=>v===-.5));assert(messages.some(m=>m.ending));send({method:'start',id:2,maxFrames:8000});process();send({method:'cancel'});for(let i=0;i<80;i++)process();assert.equal(messages.filter(m=>m.done).length,1);
});

test('Undo during a pending restart cancels startup and leaves the controller usable',async()=>{
 const f=fixture();await f.looper.start();await f.take();f.looper.stop();let resolve;f.setAudioGate(new Promise(r=>resolve=r));const restart=f.looper.start();await tick();f.looper.undo();resolve(f.engine);await restart;assert.equal(f.looper.read().running,false);assert.equal(f.looper.read().unitCount,0);f.setAudioGate(null);await f.looper.start();await f.take();assert.equal(f.looper.read().unitCount,1);f.looper.dispose();
});
