// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeFm2608Adpcm} from './adpcm_encoder.js';
import {waveShape,decodeAdpcm} from './preset.js';
import {encodeAdpcmB,readSamplePCM} from '../js/adpcm_b_sample.js';
import {encodeWav} from '../js/wav.js';

const rms=values => Math.sqrt(values.reduce((sum,value) => sum+value*value,0)/values.length);
const error=(bytes,target) => decodeAdpcm(bytes).map((value,index) => value-(target[index]??0));
const jump=values => values.slice(1).reduce((max,value,index) => Math.max(max,Math.abs(value-values[index])),0);
function repeated(bytes) {
  const scales=[57,57,57,57,77,102,128,153],result=[];
  let value=0,step=127;
  const apply=code => {
    value=Math.max(-32768,Math.min(32767,value+Math.floor((2*(code&7)+1)*step/8)*(code&8?-1:1)));
    step=Math.max(127,Math.min(24576,Math.floor(step*scales[code&7]/64)));
  };
  apply(bytes.at(-1)&15);
  for(let index=0;index<bytes.length*2;index++) {
    if(index===bytes.length*2-1){value=0;step=127;}
    apply(bytes[index>>1]>>(index&1?0:4)&15);result.push(value/32768);
  }
  return result;
}
function compare(pcm,rate=pcm.sampleRate) {
  return {baseline:encodeAdpcmB(pcm,rate),improved:encodeFm2608Adpcm(pcm,rate)};
}

for(const shape of ['saw','square','sine','triangle'])test(`bounded lookahead improves ${shape} without editing PCM or timing`,() => {
  const target=Float32Array.from(waveShape(shape)),copy=target.slice(),pcm={channels:[target],sampleRate:33488};
  const {baseline,improved}=compare(pcm);
  assert.deepEqual(target,copy);
  for(const key of ['frames','paddedFrames','sampleRate'])assert.equal(improved[key],baseline[key]);
  assert.equal(improved.bytes.length,baseline.bytes.length);
  const before=error(baseline.bytes,target),after=error(improved.bytes,target);
  assert(rms(after)<rms(before),'fresh decoded RMS error decreases');
  assert(Math.max(...after.map(Math.abs))<=Math.max(...before.map(Math.abs))+.000031,'peak error does not increase');
  const repeatError=bytes => repeated(bytes).map((value,index) => value-target[index]);
  assert(rms(repeatError(improved.bytes))<rms(repeatError(baseline.bytes)),'the real Repeat reset is considered separately');
  for(const decode of [decodeAdpcm,repeated]) {
    const beforeValues=decode(baseline.bytes),afterValues=decode(improved.bytes);
    assert(Math.max(...afterValues)<=Math.max(...beforeValues),'positive overshoot cannot hide beneath the initial-error bound');
    assert(Math.min(...afterValues)>=Math.min(...beforeValues),'negative overshoot does not grow');
    assert(jump(afterValues)<=jump(beforeValues),'lower RMS does not buy larger decoded discontinuities');
  }
  if(shape==='saw') {
    assert.equal(decodeAdpcm(improved.bytes)[0],-238/32768,'initial maximum delta remains an honest hardware limit');
    assert(rms(after.slice(8))<rms(before.slice(8))*.93,'settling after the unavoidable start improves');
  }
  if(shape==='square')assert(Math.max(...after.map(Math.abs))<.60,'lookahead anticipates the internal full-height transition');
});

test('ordinary WAV attack/transient is encoded more accurately through the same public helper',async() => {
  const source=Float32Array.from({length:512},(_,index) => Math.sin(index*.11)*.6*(index<96?index/96:Math.exp(-(index-96)/150)));
  const wav=encodeWav({left:source,sampleRate:33488}),pcm=await readSamplePCM(wav);
  const {baseline,improved}=compare(pcm),target=pcm.channels[0];
  assert(rms(error(improved.bytes,target))<rms(error(baseline.bytes,target))*.85);
  assert.equal(improved.frames,512);
  assert.equal(improved.bytes.length,256);
});

test('resampling, channel averaging, clipping and addressing padding match the shared encoder',() => {
  const pcm={sampleRate:48000,channels:[Float32Array.from({length:133},(_,i) => Math.sin(i*.13)*1.4),
    Float32Array.from({length:133},(_,i) => Math.cos(i*.17)*.3)]};
  const before=structuredClone(pcm),rate=22050,{baseline,improved}=compare(pcm,rate);
  assert.deepEqual(pcm,before);
  assert.equal(improved.frames,Math.round(133*rate/48000));
  assert.equal(improved.frames,baseline.frames);
  assert.equal(improved.paddedFrames,baseline.paddedFrames);
  assert.equal(improved.sampleRate,rate);
  assert.equal(improved.bytes.length%32,0);
  const target=Float32Array.from({length:baseline.paddedFrames},(_,index) => {
    if(index>=baseline.frames)return 0;
    const mono=Float32Array.from({length:133},(_,i) => (Math.max(-1,Math.min(1,pcm.channels[0][i]))+pcm.channels[1][i])/2);
    const position=index*48000/rate,first=Math.floor(position),fraction=position-first;
    return mono[first]*(1-fraction)+mono[Math.min(first+1,132)]*fraction;
  });
  assert(rms(error(improved.bytes,target))<=rms(error(baseline.bytes,target))+1/32768);
});

test('long WAV bounded search retains source, metadata and fresh/Repeat quality guarantees',() => {
  const target=Float32Array.from({length:32768},(_,index) => .6*Math.sin(index*.041)*(index%10000<100?index%10000/100:1));
  const pcm={sampleRate:44100,channels:[target]},copy=target.slice(),{baseline,improved}=compare(pcm);
  assert.deepEqual(target,copy);
  assert.equal(improved.bytes.length,16384);
  assert.equal(improved.frames,32768);
  assert.equal(improved.sampleRate,44100);
  assert(rms(error(improved.bytes,target))<=rms(error(baseline.bytes,target))+1/32768);
  const repeatError=bytes => repeated(bytes).map((value,index) => value-target[index]);
  assert(rms(repeatError(improved.bytes))<=rms(repeatError(baseline.bytes))+1/32768);
});

test('silent PCM and malformed or oversized input retain shared codec handling',() => {
  const silence={sampleRate:44100,channels:[new Float32Array(128)]};
  const {baseline,improved}=compare(silence);
  assert.deepEqual(improved,baseline,'no candidate trades silence for step growth');
  assert.throws(() => encodeFm2608Adpcm({sampleRate:44100,channels:[[NaN]]},44100),/Nonfinite/);
  assert.throws(() => encodeFm2608Adpcm(silence,44100,32),/memory/);
});
