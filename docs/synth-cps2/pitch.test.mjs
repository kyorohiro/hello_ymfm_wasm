// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {presetPitches} from './pitch.js';
test('reports distinct pitches in the attack and the sustained loop',()=>{
  const bytes=Uint8Array.from({length:6000},(_,i)=>Math.round(90*Math.sin(2*Math.PI*i/(i<3000?100:50))));
  const p={start:0,end:6000,loop:1000,rate:4096};
  const {onset,loop}=presetPitches(bytes,p,22000);
  assert.equal(onset.name,'A3');assert.equal(loop.name,'A4');
  assert.ok(Math.abs(loop.hz-440)<1);
  assert.ok(Math.abs(loop.c4Rate-2435)<2);
  assert.equal(presetPitches(bytes,{...p,rate:2048},22000).loop.name,'A3');
});
test('silence, unpitched noise and unavailable bytes yield no pitch',()=>{
  let seed=1;
  for(const bytes of [new Uint8Array(4000),new Uint8Array(),Uint8Array.from({length:4000},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>24;})]){
    assert.deepEqual(presetPitches(bytes,{start:0,end:4000,loop:2048,rate:0},24000),{onset:null,loop:null});
  }
});
