// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDdaAudio} from './audio_import.js';
import {MAX_AUDIO_FILE_BYTES, decodeDdaData} from './dda_pcm.js';

function buffer(channels=[Float32Array.of(0,1,0,-1,0,1,0,-1)],sampleRate=44100) {
  return {sampleRate,length:channels[0].length,numberOfChannels:channels.length,getChannelData:index=>channels[index]};
}
function file(options={}) {
  return {name:'Original.wav',size:4,arrayBuffer:async()=>new ArrayBuffer(4),...options};
}
async function globals(values,callback) {
  const previous=new Map(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const[key,value]of Object.entries(values)) Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  try {return await callback();}
  finally {for(const[key,descriptor]of previous) {if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}

test('audio import uses an offline decoder, sanitizes the name and returns portable five-bit PCM', async () => {
  const calls=[];
  class Offline {
    constructor(...args){calls.push(args);}
    async decodeAudioData(bytes){assert.equal(bytes.byteLength,4);return buffer();}
  }
  await globals({OfflineAudioContext:Offline,AudioContext:class {constructor(){assert.fail('No speaker device may be started');}}},async()=>{
    const result=await prepareDdaAudio(file({name:'  tone\n\u2028.wav  '}));
    assert.deepEqual(calls,[[1,1,44100]]);
    assert.deepEqual({...result,data:''},{name:'tone  .wav',data:'',sampleRate:11025,rootNote:60,loop:false,speed:1});
    assert.deepEqual([...decodeDdaData(result.data)],[16,16]);
    const long=await prepareDdaAudio(file({name:'x'.repeat(200)}),{sampleRate:22050});
    assert.equal(long.name.length,120);assert.equal(long.sampleRate,22050);assert.equal(decodeDdaData(long.data).length,4);
  });
});

test('WebKit offline decoding fallback works without a normal AudioContext', async () => {
  await globals({OfflineAudioContext:undefined,webkitOfflineAudioContext:class {async decodeAudioData(){return buffer([new Float32Array(1)]);}}},async()=>{
    assert.equal((await prepareDdaAudio(file())).data,'EA==');
  });
});

test('invalid files, rates and missing decoder fail before reading or starting a decoder', async () => {
  let started=0,read=0;
  await globals({OfflineAudioContext:class {constructor(){started++;}}},async()=>{
    for(const bad of [null,{},file({size:0}),file({size:MAX_AUDIO_FILE_BYTES+1})]) await assert.rejects(prepareDdaAudio(bad));
    await assert.rejects(prepareDdaAudio(file({arrayBuffer:async()=>{read++;}}),{sampleRate:7999}),/rate/i);
    assert.equal(started,0);assert.equal(read,0);
    await assert.rejects(prepareDdaAudio(file({arrayBuffer:async()=>new ArrayBuffer(MAX_AUDIO_FILE_BYTES+1)})),/32 MiB/);
    assert.equal(started,0);
  });
  await globals({OfflineAudioContext:undefined,webkitOfflineAudioContext:undefined},()=>assert.rejects(prepareDdaAudio(file()),/offline audio decoding/));
});

test('decoder failures explain codec support, while malformed and long decoded buffers are rejected', async () => {
  const cause=new Error('Codec unavailable');
  await globals({OfflineAudioContext:class {async decodeAudioData(){throw cause;}}},async()=>{
    await assert.rejects(prepareDdaAudio(file()),error=>/Try a WAV file/.test(error.message)&&error.cause===cause);
  });
  for(const invalid of [null,{sampleRate:44100,length:1,numberOfChannels:0,getChannelData(){}},
    {sampleRate:44100,length:44100*1800+1,numberOfChannels:1,getChannelData(){assert.fail('Long audio must reject before channel reads');}},
    buffer([Float32Array.of(NaN)])]) {
    await globals({OfflineAudioContext:class {async decodeAudioData(){return invalid;}}},()=>assert.rejects(prepareDdaAudio(file())));
  }
});

test('cancellation before read and during non-cancellable decoding discards results', async () => {
  const early=new AbortController();early.abort();
  await globals({OfflineAudioContext:class {constructor(){assert.fail('Cancelled import starts nothing');}}},()=>assert.rejects(prepareDdaAudio(file(),{signal:early.signal}),{name:'AbortError'}));
  let release;
  const gate=new Promise(resolve=>{release=resolve;}),later=new AbortController();
  await globals({OfflineAudioContext:class {decodeAudioData(){return gate;}}},async()=>{
    const task=prepareDdaAudio(file(),{signal:later.signal});await Promise.resolve();await Promise.resolve();
    later.abort();release(buffer());await assert.rejects(task,{name:'AbortError'});
  });
});
