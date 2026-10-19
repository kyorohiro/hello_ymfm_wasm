import test from 'node:test';
import assert from 'node:assert/strict';
import {TetoricaAudioRuntime} from './tetorica_audio_runtime.js';

test('failed callback and Promise audio decoding rejects the load without an unhandled second rejection',async()=>{
  const error=new Error('Invalid audio file');
  const runtime=new TetoricaAudioRuntime({audioContext:{decodeAudioData(_bytes,_resolve,reject){
    queueMicrotask(()=>reject(error));return Promise.reject(error);
  }}});
  await assert.rejects(runtime.loadSample('invalid',new ArrayBuffer(4)),value=>value===error);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(runtime.hasSample('invalid'),false);
});

for(const mode of ['callbacks','promise'])test(`sample decoding accepts the ${mode} completion path`,{timeout:1000},async()=>{
  const buffer={sampleRate:48000,length:4,numberOfChannels:1};
  const runtime=new TetoricaAudioRuntime({audioContext:{decodeAudioData(_bytes,resolve){
    if(mode==='callbacks'){queueMicrotask(()=>resolve(buffer));return;}
    return Promise.resolve(buffer);
  }}});
  assert.equal(await runtime.loadSample('sample',new ArrayBuffer(4)),buffer);
  assert.equal(runtime.getSample('sample'),buffer);
});

for(const reason of [null,undefined])test(`a ${String(reason)} decoder failure becomes a displayable Error`,async()=>{
  const runtime=new TetoricaAudioRuntime({audioContext:{decodeAudioData(_bytes,_resolve,reject){
    queueMicrotask(()=>reject(reason));return Promise.reject(reason);
  }}});
  await assert.rejects(runtime.loadSample('invalid',new ArrayBuffer(4)),{message:'Unable to decode audio data'});
  await new Promise(resolve=>setImmediate(resolve));
});
