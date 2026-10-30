import test from 'node:test';import assert from 'node:assert/strict';
import {readScspAudio,prepareScspPCM} from './scsp_sample.js';import {encodeWav} from './wav.js';
test('long stereo WAV stays in host memory; explicit selection is mono and bounded without normalization',async()=>{
 const left=Float32Array.from({length:48000*3},(_,i)=>.25*Math.sin(i*Math.PI/24)),right=left.map(v=>v*.5);
 const wav=encodeWav({channels:[left,right],sampleRate:48000}),before=wav.slice(),audio=await readScspAudio(wav);
 const result=prepareScspPCM(audio,{startSeconds:1,endSeconds:1.25,rootNote:69,sourceSampleRate:44100});
 assert.equal(result.pcm.length,11025);assert.equal(result.sample.rootFrequencyHz,440);assert.equal(result.sample.loopStartSamples,null);assert.equal(result.sample.bits,16);
 assert(Math.max(...result.pcm)<7000&&Math.max(...result.pcm)>5000);assert.deepEqual(wav,before);
 assert.throws(()=>prepareScspPCM(audio,{endSeconds:3}),/65535/);assert.throws(()=>prepareScspPCM(audio,{startSeconds:-1,endSeconds:1}));
 const low=prepareScspPCM(audio,{endSeconds:3,sourceSampleRate:8000,bits:8});assert.equal(low.pcm.length,24000);assert(low.pcm instanceof Int8Array);
});
test('compressed decode is injected, caller bytes survive and bad audio never yields a draft',async()=>{
 const bytes=new Uint8Array([1,2,3,4]).buffer;let calls=0;
 const audio=await readScspAudio(bytes,{decodeAudio:async()=>{calls++;return {channels:[new Float32Array([-.5,0,.5,0])],sampleRate:4};}});assert.equal(calls,1);assert.equal(bytes.byteLength,4);
 assert.equal(prepareScspPCM(audio,{endSeconds:1,sourceSampleRate:4,bits:8}).pcm[0],-64);
 await assert.rejects(readScspAudio(new Uint8Array([0]).buffer));assert.throws(()=>prepareScspPCM({...audio,channels:[new Float32Array([NaN,0,0,0])]},{endSeconds:1,sourceSampleRate:4}));
});

test('file size and cancellation guards reject before reading or decoding',async()=>{
 let reads=0,decodes=0;
 class TooLarge extends Blob {get size(){return 65*1024*1024;}async arrayBuffer(){reads++;return new ArrayBuffer(0);}}
 await assert.rejects(readScspAudio(new TooLarge(['x']),{decodeAudio:async()=>{decodes++;throw Error('unexpected decoder');}}),/64 MiB/);
 assert.equal(reads,0);assert.equal(decodes,0);
 const controller=new AbortController();controller.abort();await assert.rejects(readScspAudio(new Blob(['x']),{signal:controller.signal}),{name:'AbortError'});
});
