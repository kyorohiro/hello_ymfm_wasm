// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAudio,prepareBrrFile,resampleMono,MAX_AUDIO_FILE_BYTES} from './audio_import.js';
import {encodeBase64,decodeBase64,MAX_BRR_BYTES,MAX_PCM_FRAMES} from './sample.js';
import {encodeBrr} from '../js/snes_brr_encoder.js';
import {decodeBrr} from '../js/snes_brr.js';

const fixture=Float32Array.from({length:64},(_,index)=>.5*Math.sin(index*Math.PI/16));
const file=(bytes=Uint8Array.of(1,2,3),name='voice.wav')=>({size:bytes.length,name,arrayBuffer:async()=>bytes.slice().buffer});
function buffer(channels=[fixture],sampleRate=16000) {
  return {numberOfChannels:channels.length,length:channels[0].length,sampleRate,getChannelData:index=>channels[index]};
}
const originals=new WeakMap();
function globals(t,values) {
  if(!originals.has(t))originals.set(t,new Map());
  const saved=originals.get(t);
  for(const [key,value]of Object.entries(values)) {
    if(!saved.has(key)) {
      const descriptor=Object.getOwnPropertyDescriptor(globalThis,key);saved.set(key,descriptor);
      t.after(()=>descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key]);
    }
    Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  }
}
function decoder(t,output=buffer()) {
  const calls=[];
  globals(t,{Worker:undefined,AudioContext:class{constructor(){assert.fail('Sample import must not open a speaker AudioContext');}},
    OfflineAudioContext:class{constructor(...args){calls.push(args);}async decodeAudioData(){return typeof output==='function'?output():output;}}});
  return calls;
}

test('audio import decodes offline, declares tuning and uses the existing exact BRR encoder',async t=>{
  const calls=decoder(t),result=await prepareAudio(file());
  assert.deepEqual(calls,[[1,1,32000]]);assert.equal(result.name,'voice.wav');
  assert.deepEqual(Object.keys(result),['name','data','rootNote','basePitch','loopStartSamples']);
  assert.equal(result.rootNote,60);assert.equal(result.basePitch,2048);assert.equal(result.loopStartSamples,null);
  assert.deepEqual(decodeBase64(result.data),encodeBrr(fixture).brr);
  assert.equal(decodeBrr(decodeBase64(result.data)).pcm.length,64);
});

test('mono preparation averages channels, area downsamples, linearly upsamples and never normalizes',async()=>{
  assert.deepEqual([...await resampleMono([Float32Array.of(1,-1,1,-1)],16000,8000)],[0,0]);
  assert.deepEqual([...await resampleMono([Float32Array.of(0,1)],8000,16000)],[0,.5,1,1]);
  assert.deepEqual([...await resampleMono([Float32Array.of(1,.5,-1),Float32Array.of(-1,-.5,1)],8000,8000)],[0,0,0]);
  assert.deepEqual(await resampleMono([Float32Array.of(-1,1,-1)],12000,8000),Float32Array.of(-1/3,-1/3));
  const samples=Float32Array.of(.1,.2,.3),before=samples.slice();
  assert.deepEqual(await resampleMono([samples],8000,8000),samples);assert.deepEqual(samples,before);
  for(const values of [Float32Array.of(NaN),Float32Array.of(Infinity),Float32Array.of(-Infinity)]) await assert.rejects(resampleMono([values],8000,8000),/finite/);
});

test('decoder overshoots clamp only after mixing and resampling rather than normalizing input channels',async t=>{
  assert.deepEqual([...await resampleMono([Float32Array.of(1.2,.5,-1.2)],8000,8000)],[1,.5,-1]);
  assert.deepEqual([...await resampleMono([Float32Array.of(2,-2),Float32Array.of(-2,2)],8000,8000)],[0,0]);
  assert.deepEqual([...await resampleMono([Float32Array.of(2,-.5)],16000,8000)],[.75]);
  assert.deepEqual([...await resampleMono([Float32Array.of(-2,.5)],16000,8000)],[-.75]);
  decoder(t,buffer([Float32Array.of(1.2,.5,-1.2)],16000));
  const result=await prepareAudio(file());
  assert.deepEqual(decodeBase64(result.data),encodeBrr(Float32Array.of(1,.5,-1)).brr);
});

test('resampling rejects invalid layouts and resource limits without silently truncating',async()=>{
  for(const channels of [[],[new Float32Array(0)],[Float32Array.of(1),Float32Array.of(1,0)],[[0]],Array(33).fill(Float32Array.of(0))]) {
    await assert.rejects(resampleMono(channels,8000,8000));
  }
  for(const [source,target]of[[7999,8000],[384001,8000],[8000,7999],[8000,32001],[8000.5,16000]]) {
    await assert.rejects(resampleMono([Float32Array.of(0)],source,target),/rate/);
  }
  await assert.rejects(resampleMono([new Float32Array(MAX_PCM_FRAMES+1)],32000,32000),/SNES sample RAM/);
  await assert.rejects(resampleMono([new Float32Array(8000*1800+1)],8000,8000),/30 minutes/);
});

test('conversion choices preserve playback rate, filename safety and block-aligned whole-sample loops',async t=>{
  decoder(t,buffer([fixture],32000));
  for(const [rate,pitch]of[[8000,1024],[16000,2048],[32000,4096]]) {
    const result=await prepareAudio(file(undefined,'\u0000bell\n.wav'),{sampleRate:rate,rootNote:57});
    assert.equal(result.basePitch,pitch);assert.equal(result.rootNote,57);assert.equal(result.name,'bell .wav');
  }
  globals(t,{OfflineAudioContext:class{async decodeAudioData(){return buffer([Float32Array.of(0,.5,0,-.5,0)],16000);}}});
  const loop=await prepareAudio(file(),{loop:true});const decoded=decodeBrr(decodeBase64(loop.data));
  assert.equal(loop.loopStartSamples,0);assert.equal(decoded.loop,true);assert.equal(decoded.pcm.length,16);
});

test('invalid files and options, oversized decoded samples and bad layouts fail without reading channels',async t=>{
  const calls=decoder(t);
  let reads=0;
  await assert.rejects(prepareAudio({size:MAX_AUDIO_FILE_BYTES+1,arrayBuffer(){reads++;}}),/bytes/);assert.equal(reads,0);
  for(const options of [{sampleRate:7999},{sampleRate:32001},{sampleRate:16000.5},{rootNote:128},{rootNote:60.5},{loop:1}]) await assert.rejects(prepareAudio(file(),options));
  assert.deepEqual(calls,[]);
  const huge={sampleRate:32000,length:MAX_PCM_FRAMES+1,numberOfChannels:1,getChannelData(){assert.fail('Oversized audio must reject before reading channel data');}};
  globals(t,{OfflineAudioContext:class{async decodeAudioData(){return huge;}}});
  await assert.rejects(prepareAudio(file(),{sampleRate:32000}),/SNES sample RAM/);
  for(const output of [null,{...huge,length:1,numberOfChannels:0},{...huge,length:1,sampleRate:NaN}]) {
    globals(t,{OfflineAudioContext:class{async decodeAudioData(){return output;}}});
    await assert.rejects(prepareAudio(file()),/layout/);
  }
  globals(t,{OfflineAudioContext:class{async decodeAudioData(){throw new Error('unsupported');}}});
  await assert.rejects(prepareAudio(file()),/Try WAV/);
});

test('cancellation before reading, during decoding and during conversion discards the result',async t=>{
  decoder(t);const before=new AbortController();before.abort();
  await assert.rejects(prepareAudio(file(),{signal:before.signal}),{name:'AbortError'});
  const during=new AbortController();let release;
  globals(t,{OfflineAudioContext:class{decodeAudioData(){return new Promise(resolve=>{release=()=>resolve(buffer());});}}});
  const pending=prepareAudio(file(),{signal:during.signal});
  while(!release)await new Promise(resolve=>setTimeout(resolve,0));during.abort();release();
  await assert.rejects(pending,{name:'AbortError'});
  const converting=new AbortController();setTimeout(()=>converting.abort(),0);
  await assert.rejects(resampleMono([new Float32Array(MAX_PCM_FRAMES)],32000,32000,{signal:converting.signal}),{name:'AbortError'});
});

test('raw BRR imports only complete bounded blocks and retains explicit user tuning',async()=>{
  const oneShot=encodeBrr(fixture).brr,result=await prepareBrrFile(file(oneShot,'tone.brr'),{rootNote:65,basePitch:3072});
  assert.deepEqual(result,{name:'tone.brr',data:encodeBase64(oneShot),rootNote:65,basePitch:3072,loopStartSamples:null});
  const loop=encodeBrr(fixture,{loopStartSamples:0}).brr;
  const defaultLoop=await prepareBrrFile(file(loop));assert.equal(defaultLoop.loopStartSamples,0);
  assert.equal((await prepareBrrFile(file(loop),{loopStartSamples:32})).loopStartSamples,32);
  for(const options of [{loopStartSamples:null},{loopStartSamples:1},{loopStartSamples:64}]) await assert.rejects(prepareBrrFile(file(loop),options));
  await assert.rejects(prepareBrrFile(file(oneShot),{loopStartSamples:0}),/LOOP/);
  const trailing=new Uint8Array(oneShot.length+9);trailing.set(oneShot);
  await assert.rejects(prepareBrrFile(file(trailing)),/trailing/);
  await assert.rejects(prepareBrrFile(file(Uint8Array.of(1,2))),/BRR/);
  await assert.rejects(prepareBrrFile(file(new Uint8Array(MAX_BRR_BYTES+1))),/bytes/);
  await assert.rejects(prepareBrrFile(file(oneShot),{rootNote:128}));
  const stopped=new AbortController();stopped.abort();await assert.rejects(prepareBrrFile(file(oneShot),{signal:stopped.signal}),{name:'AbortError'});
  const during=new AbortController();let release;
  const pending=prepareBrrFile({size:oneShot.length,arrayBuffer(){return new Promise(resolve=>{release=()=>resolve(oneShot.slice().buffer);});}},{signal:during.signal});
  during.abort();release();await assert.rejects(pending,{name:'AbortError'});
});

test('browser worker encoding transfers PCM, returns identical codec bytes and terminates on Cancel',async t=>{
  decoder(t);let terminated=0,created=0;
  globals(t,{Worker:class {
    constructor(){created++;}
    postMessage(data){setTimeout(()=>this.onmessage?.({data:{brr:encodeBrr(new Float32Array(data.pcm),data.options).brr.buffer}}),0);}
    terminate(){terminated++;}
  }});
  const result=await prepareAudio(file());assert.deepEqual(decodeBase64(result.data),encodeBrr(fixture).brr);
  assert.equal(created,1);assert.equal(terminated,1);
  const controller=new AbortController();
  globals(t,{Worker:class {postMessage(){controller.abort();}terminate(){terminated++;}}});
  await assert.rejects(prepareAudio(file(),{signal:controller.signal}),{name:'AbortError'});assert.equal(terminated,2);
});
