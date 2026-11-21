// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeScspSsfDspSnapshot,SCSP_SSF_DSP_SNAPSHOT_WORDS} from './ssf_snapshot.js';

function words(){const value=new Uint32Array(SCSP_SSF_DSP_SNAPSHOT_WORDS);value.set([0x53445031,1,37,0,512,64,32,16]);return value;}

test('DSP observation decodes every raw word and signed boundary into detached arrays',()=>{
  const raw=words();raw[8]=0x8000;raw[519]=0xffff;raw.set([0x1000,0x1fff,0,0xfff],520);raw[584]=0xabcd;raw.set([0x8000,0xffff,0,0x7fff],616);
  const dsp=decodeScspSsfDspSnapshot(raw,37);assert.equal(dsp.frame,37);
  assert(dsp.program instanceof Uint16Array);assert.equal(dsp.program.length,512);assert.equal(dsp.program[0],0x8000);assert.equal(dsp.program[511],0xffff);
  assert.deepEqual([...dsp.coefficients.slice(0,4)],[-4096,-1,0,4095]);assert.deepEqual([...dsp.outputs.slice(0,4)],[-32768,-1,0,32767]);assert.equal(dsp.addresses[0],0xabcd);
  raw.fill(0);assert.equal(dsp.program[0],0x8000);assert.equal(dsp.coefficients[0],-4096);
});

test('missing, malformed, wrong-frame and out-of-range DSP payloads reject instead of implying silence',()=>{
  for(const value of [undefined,null,[],new Uint16Array(632),new Uint32Array(631)])assert.throws(()=>decodeScspSsfDspSnapshot(value));
  for(const [index,value]of [[0,0],[1,2],[4,511],[5,63],[6,31],[7,15],[8,0x10000],[520,0x2000],[584,0x10000],[616,0x10000]]){
    const raw=words();raw[index]=value;assert.throws(()=>decodeScspSsfDspSnapshot(raw));
  }
  assert.throws(()=>decodeScspSsfDspSnapshot(words(),38),/frame/);
});
