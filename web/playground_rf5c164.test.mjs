import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MessageChannel} from 'node:worker_threads';
import factory from '../docs/generated/rf5c164_wasm.js';
import {Rf5c164} from './rf5c164.js';
import {createRf5c164Control,createRf5c164Client,encodeRf5c164} from './playground_rf5c164.js';
const make=()=>Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary:readFileBytes},sampleRate:48000});
const readFileBytes=await readFile(new URL('../docs/generated/rf5c164_wasm.wasm',import.meta.url));
test('all eight channels produce finite PCM, stop, reset and raw register state',async()=>{
 const chip=await make(),ctl=createRf5c164Control(chip);
 try{const pcm=encodeRf5c164({channels:[Float32Array.from({length:256},(_,i)=>Math.sin(i*2*Math.PI/256))],sampleRate:32768});ctl.loadMemory(pcm.bytes.buffer,0);
 for(let ch=0;ch<8;ch++){ctl.setChannel(ch,{start:0,loopStart:0,step:3543,volume:200,pan:{left:15,right:0}});ctl.keyOn(ch);const out=chip.generateStereo(4096);assert(out.left.some(x=>Math.abs(x)>.01));assert(out.left.every(Number.isFinite));assert(out.right.every(x=>x===0));ctl.keyOff(ch);chip.generateStereo(128);assert(chip.generateStereo(128).left.every(x=>x===0));}
 ctl.writeRegister(8,254);ctl.keyOff(0);assert(chip.generateStereo(128).left.every(x=>x===0));ctl.reset();assert.equal(chip.readMemory(256),255);
 assert.throws(()=>ctl.setChannel(0,{start:1}),/aligned/);assert.throws(()=>ctl.loadMemory(new Uint8Array(65537)),/64 KiB/);assert.throws(()=>ctl.keyOn(8),/channel/);
 }finally{chip.dispose();}
});
test('direct port RPC supports sample conversion, validation and disposal',async()=>{
 const chip=await make(),ctl=createRf5c164Control(chip),{port1,port2}=new MessageChannel();
 port1.on('message',({id,method,args})=>{try{const value=ctl[method](...args);if(id)port1.postMessage({id,value});}catch(e){port1.postMessage({id,error:e.message});}});
 const client=createRf5c164Client(port2,async()=>({channels:[new Float32Array([1,-1,0])],sampleRate:22050}));
 try{const wave=await client.loadSample(new ArrayBuffer(0));assert.equal(wave.loopStart,4);assert.equal(chip.readMemory(0),254);assert.equal(chip.readMemory(1),126);await client.setChannel(0,{...wave,volume:255,pan:{left:15,right:15}});await client.keyOn(0);chip.generateStereo(256);assert(chip.generateStereo(256).left.every(x=>x===0));await assert.rejects(client.setPitch(0,65536),/step/);await assert.rejects(client.loadSample(new ArrayBuffer(0),{address:1}),/aligned/);}
 finally{await client.reset();client.dispose();await new Promise(r=>setTimeout(r,20));port1.close();}
});
test('Worklet initializes real WASM, accepts direct port and disposes',async()=>{
 let Processor;const ready=new Promise(resolve=>{
 globalThis.sampleRate=48000;
 globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage:data=>resolve(data)};}};
 globalThis.registerProcessor=(name,ctor)=>{Processor=ctor;};
 });
 await import('../docs/js/rf5c164-worklet.js');
 const processor=new Processor({processorOptions:{wasmBinary:readFileBytes}});
 assert.deepEqual(await ready,{ready:true});
 const {port1,port2}=new MessageChannel();processor.port.onmessage({data:{port:port1}});
 const pcm=createRf5c164Client(port2,async()=>({channels:[new Float32Array(32).fill(.5)],sampleRate:32000}));
 const wave=await pcm.loadSample(new ArrayBuffer(0),{loopStart:0});await pcm.setChannel(7,{...wave,volume:255,pan:{left:15,right:15}});await pcm.keyOn(7);
 const output=[[new Float32Array(128),new Float32Array(128)]];assert.equal(processor.process([],output),true);assert(output[0][0].some(x=>x>0));
 pcm.dispose();await new Promise(r=>setTimeout(r,20));assert.equal(processor.process([],output),false);port1.close();
 delete globalThis.AudioWorkletProcessor;delete globalThis.registerProcessor;delete globalThis.sampleRate;
});
