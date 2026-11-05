// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {MAX_DDA_SAMPLES, MAX_PRESET_BYTES, MAX_AUDIO_FILE_BYTES, MAX_DECODED_SECONDS,
  createDefaultDda, encodeDdaData, encodeDdaDataAsync, decodeDdaData, quantizeAudio} from './dda_pcm.js';

test('portable DDA data is canonical base64 for five-bit values, with bounded readonly caching', () => {
  assert.equal(MAX_PRESET_BYTES,32*1024*1024);assert.equal(MAX_AUDIO_FILE_BYTES,MAX_PRESET_BYTES);
  assert.equal(MAX_DDA_SAMPLES,16_777_216);assert.equal(MAX_DECODED_SECONDS,1800);
  assert.deepEqual(createDefaultDda(),{name:'',data:'',sampleRate:11025,rootNote:60,loop:false,speed:1});
  const a=createDefaultDda();a.loop=true;assert.equal(createDefaultDda().loop,false);
  for(let length=0;length<100;length++) {
    const bytes=Uint8Array.from({length},(_,index)=>(index*7+length)%32);
    const data=encodeDdaData(bytes);assert.equal(data,Buffer.from(bytes).toString('base64'));
    assert.deepEqual(decodeDdaData(data),bytes);
  }
  const source=Uint8Array.of(0,16,31),encoded=encodeDdaData(source);source[0]=9;
  assert.deepEqual([...decodeDdaData(encoded)],[0,16,31],'the encoder cache owns its sample bytes');
  const first=encodeDdaData([1]),firstView=decodeDdaData(first);
  const second=encodeDdaData([2]),secondView=decodeDdaData(second);
  assert.equal(decodeDdaData(first),firstView);
  encodeDdaData([3]);assert.equal(decodeDdaData(first),firstView);
  assert.notEqual(decodeDdaData(second),secondView,'the least-recently-used third array is not retained');
});

test('DDA rejects noncanonical base64, padding aliases and values outside the DAC range', () => {
  for(const value of [null,12,{},'A','AA','AA=','A===','====','AA===','AB==','AAB=','AA A','AA\nA','_AAA','-AAA','éAAA']) {
    assert.throws(()=>decodeDdaData(value),/canonical base64/);
  }
  assert.throws(()=>decodeDdaData(Buffer.from([32]).toString('base64')),/0 to 31/);
  for(const value of [[-1],[32],[.5],[NaN],Array(1),{},new Float32Array([1])]) assert.throws(()=>encodeDdaData(value));
  assert.throws(()=>encodeDdaData(new Uint8Array(MAX_DDA_SAMPLES+1)),/16,777,216/);
  const over='A'.repeat(Math.ceil(MAX_DDA_SAMPLES/3)*4);
  assert.throws(()=>decodeDdaData(over),/16,777,216/,'check decoded length before allocating');
  assert.throws(()=>decodeDdaData(over+'AAAA'),/16,777,216/);
});

test('the codec works in an AudioWorklet-like scope without browser base64 or Node globals', async () => {
  const source=await readFile(new URL('./dda_pcm.js',import.meta.url),'utf8');
  let codec;
  vm.runInNewContext(source.replace(/^export /gm,'')+'\nprovide({encodeDdaData,decodeDdaData});',{provide:value=>{codec=value;}});
  const encoded=codec.encodeDdaData([0,16,31,2]);
  assert.equal(encoded,Buffer.from([0,16,31,2]).toString('base64'));
  assert.deepEqual([...codec.decodeDdaData(encoded)],[0,16,31,2]);
});

test('long base64 inputs retain exact values without large argument lists', () => {
  const source=Uint8Array.from({length:200_003},(_,index)=>index%32);
  const encoded=Buffer.from(source).toString('base64');
  assert.deepEqual(decodeDdaData(encoded),source);
  assert.equal(encodeDdaData(source),encoded);
});

test('quantization centers silence at 16, clips full scale and preserves quiet amplitudes', async () => {
  const samples=Float32Array.of(-2,-1,-.5,0,.125,.5,1,2);
  assert.deepEqual([...await quantizeAudio([samples],8000,8000)],[0,0,8,16,18,24,31,31]);
  const left=Float32Array.of(-1,.5,0,1),right=Float32Array.of(1,-.5,0,-1);
  const original=left.slice();
  assert.deepEqual([...await quantizeAudio([left,right],8000,8000)],[16,16,16,16]);
  assert.deepEqual(left,original);
});

test('resampling area-averages downsampled intervals and linearly interpolates upsampling', async () => {
  assert.deepEqual([...await quantizeAudio([Float32Array.of(1,-1,1,-1,1,-1)],16000,8000)],[16,16,16]);
  assert.deepEqual([...await quantizeAudio([Float32Array.of(-1,1,-1)],12000,8000)],[11,11]);
  assert.deepEqual([...await quantizeAudio([Float32Array.of(0,1)],8000,16000)],[16,24,31,31]);
  assert.deepEqual([...await quantizeAudio([Float32Array.of(0)],44100,8000)],[16]);
});

test('conversion bounds validate rates, channel layout, duration and all finite samples', async () => {
  const valid=[new Float32Array(8)];
  for(const [source,target] of [[0,8000],[8000,44101],[44100.5,11025],[44100,7999]]) await assert.rejects(quantizeAudio(valid,source,target),/rate/i);
  for(const channels of [[],[[]],[new Float32Array(0)],[new Float32Array(1),new Float32Array(2)],Array(33).fill(new Float32Array(1))]) {
    await assert.rejects(quantizeAudio(channels,8000,8000));
  }
  await assert.rejects(quantizeAudio([Float32Array.of(0,NaN)],8000,8000),/finite/);
  await assert.rejects(quantizeAudio([new Float32Array(8000*1800+1)],8000,8000),/30 minutes/);
  await assert.rejects(quantizeAudio([new Float32Array(4_000_000)],8000,44100),/16,777,216/);
});

test('conversion and async encoding yield, cancel and never return partial data', async () => {
  const before=new AbortController();before.abort();
  await assert.rejects(quantizeAudio([new Float32Array(1)],8000,8000,{signal:before.signal}),{name:'AbortError'});
  await assert.rejects(encodeDdaDataAsync([16],{signal:before.signal}),{name:'AbortError'});
  const during=new AbortController();
  const quantized=quantizeAudio([new Float32Array(500_000)],44100,11025,{signal:during.signal});
  setTimeout(()=>during.abort(),0);await assert.rejects(quantized,{name:'AbortError'});
  const encoding=new AbortController();
  const encoded=encodeDdaDataAsync(new Uint8Array(500_000).fill(16),{signal:encoding.signal});
  setTimeout(()=>encoding.abort(),0);await assert.rejects(encoded,{name:'AbortError'});
  assert.equal(await encodeDdaDataAsync(Uint8Array.of(0,16,31)),encodeDdaData([0,16,31]));
  const owned=new Uint8Array(100_000).fill(16),snapshot=encodeDdaDataAsync(owned);
  owned.fill(31);
  assert(decodeDdaData(await snapshot).every(value=>value===16),'edits while encoding cannot make cached bytes disagree with base64');
});
