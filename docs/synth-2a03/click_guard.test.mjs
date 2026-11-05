// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputClickGuard} from './click_guard.js';

const stereo = (left, right = left) => ({left:Float32Array.from(left),right:Float32Array.from(right)});
const filled = (frames,left=.8,right=-.4) => ({left:new Float32Array(frames).fill(left),right:new Float32Array(frames).fill(right)});
const bytes = array => new Uint8Array(array.buffer,array.byteOffset,array.byteLength).slice();
const smoothstep = t => t * t * (3 - 2 * t);

test('click guard attacks start continuously, end at the exact raw sample and then pass through at both sample rates', () => {
  for (const sampleRate of [44100,48000]) {
    const guard = new OutputClickGuard({sampleRate}), frames = Math.round(sampleRate * .005);
    assert.deepEqual(guard.read(),{phase:'bypass',remainingFrames:0,durationFrames:frames});
    guard.process(stereo([.25],[-.5])); guard.attack();
    assert.equal(guard.read().remainingFrames,frames);
    const pcm=filled(frames+8), raw=structuredClone(pcm); guard.process(pcm);
    assert.equal(pcm.left[0],.25);assert.equal(pcm.right[0],-.5);
    for(const index of [1,Math.floor(frames/2),frames-2]) {
      const w=smoothstep(index/(frames-1));
      assert.equal(pcm.left[index],Math.fround(.25*(1-w)+raw.left[index]*w));
      assert.equal(pcm.right[index],Math.fround(-.5*(1-w)+raw.right[index]*w));
    }
    assert.deepEqual(bytes(pcm.left.subarray(frames-1)),bytes(raw.left.subarray(frames-1)));
    assert.deepEqual(bytes(pcm.right.subarray(frames-1)),bytes(raw.right.subarray(frames-1)));
    assert.deepEqual(guard.read(),{phase:'bypass',remainingFrames:0,durationFrames:frames});
  }
});

test('release ramps from the last emitted sample to zero and ignores arbitrary raw filter tails', () => {
  for(const sampleRate of [44100,48000]) {
    const guard=new OutputClickGuard({sampleRate}),frames=guard.read().durationFrames;
    guard.process(stereo([.3],[-.6]));guard.release();
    const pcm=filled(frames+31,-.9,.9);guard.process(pcm);
    assert.equal(pcm.left[0],Math.fround(.3));assert.equal(pcm.right[0],Math.fround(-.6));
    for(let index=1;index<frames;index++) {
      assert(pcm.left[index]<=pcm.left[index-1]&&pcm.left[index]>=0);
      assert(pcm.right[index]>=pcm.right[index-1]&&pcm.right[index]<=0);
    }
    assert(pcm.left.subarray(frames-1).every(value=>value===0));assert(pcm.right.subarray(frames-1).every(value=>value===0));
    assert.deepEqual(guard.read(),{phase:'muted',remainingFrames:0,durationFrames:frames});
    const later=filled(100);guard.process(later);assert(later.left.every(value=>value===0)&&later.right.every(value=>value===0));
  }
});

test('transitions are independent of render block boundaries, including one-sample and empty blocks', () => {
  for(const sampleRate of [44100,48000]) for(const operation of ['attack','release']) {
    const a=new OutputClickGuard({sampleRate}),b=new OutputClickGuard({sampleRate});
    for(const guard of [a,b]) {guard.process(stereo([-.17],[.23]));guard[operation]();}
    const frames=a.read().durationFrames+53;
    const input=stereo(Array.from({length:frames},(_,i)=>Math.sin(i*.19)*.4),Array.from({length:frames},(_,i)=>Math.cos(i*.13)*.6));
    const all=structuredClone(input),split=structuredClone(input);a.process(all);
    let start=0,index=0;
    while(start<frames) {
      const count=Math.min([1,17,128,3,41][index++%5],frames-start);
      const before=b.read();b.process(stereo([]));assert.deepEqual(b.read(),before);
      b.process({left:split.left.subarray(start,start+count),right:split.right.subarray(start,start+count)});start+=count;
    }
    assert.deepEqual(bytes(split.left),bytes(all.left));assert.deepEqual(bytes(split.right),bytes(all.right));assert.deepEqual(a.read(),b.read());
  }
});

test('rapid attack/release/retrigger starts at the actual emitted sample rather than resetting to zero', () => {
  const guard=new OutputClickGuard({sampleRate:48000});
  guard.attack();const first=filled(47);guard.process(first);
  const beforeRelease=[first.left.at(-1),first.right.at(-1)];guard.release();const release=filled(29,-.8,.7);guard.process(release);
  assert.equal(release.left[0],beforeRelease[0]);assert.equal(release.right[0],beforeRelease[1]);
  const beforeAttack=[release.left.at(-1),release.right.at(-1)];guard.attack();const next=filled(33,-.9,.3);guard.process(next);
  assert.equal(next.left[0],beforeAttack[0]);assert.equal(next.right[0],beforeAttack[1]);
  const beforeRetrigger=[next.left.at(-1),next.right.at(-1)];guard.attack();const retrigger=filled(9,.4,-.8);guard.process(retrigger);
  assert.equal(retrigger.left[0],beforeRetrigger[0]);assert.equal(retrigger.right[0],beforeRetrigger[1]);
});

test('bypass preserves raw Float32 bits, including signed zero and small samples, and remembers the emitted endpoint', () => {
  const guard=new OutputClickGuard({sampleRate:44100});
  const pcm=stereo([0,-0,1e-38,Math.fround(1/3),-.125],[-0,0,-1e-38,-Math.fround(1/3),.25]);
  const original=structuredClone(pcm);guard.process(pcm);
  assert.deepEqual(bytes(pcm.left),bytes(original.left));assert.deepEqual(bytes(pcm.right),bytes(original.right));
  guard.release();guard.process(filled(1000));guard.bypass();
  const after=stereo([-.7],[.9]);guard.process(after);assert.equal(after.left[0],Math.fround(-.7));assert.equal(after.right[0],Math.fround(.9));
  guard.attack();const first=filled(1);guard.process(first);assert.equal(first.left[0],after.left[0]);assert.equal(first.right[0],after.right[0]);
  const state=guard.read();state.phase='muted';assert.equal(guard.read().phase,'attack');
});

test('invalid blocks fail atomically before output mutation or transition progress', () => {
  const guard=new OutputClickGuard({sampleRate:48000});guard.process(stereo([.2],[-.4]));guard.attack();
  const left=new Float32Array([.1,.2,.3]),right=new Float32Array([.4,.5,NaN]),beforeLeft=bytes(left),beforeRight=bytes(right),before=guard.read();
  const overlap=new Float32Array(5);
  for(const pcm of [null,{}, {left,right:new Float32Array(2)},{left:new Float64Array(3),right:new Float32Array(3)},
    {left,right},{left:new Float32Array([Infinity]),right:new Float32Array(1)},
    {left:overlap.subarray(0,3),right:overlap.subarray(2,5)}]) {
    assert.throws(()=>guard.process(pcm));assert.deepEqual(guard.read(),before);
  }
  assert.deepEqual(bytes(left),beforeLeft);assert.deepEqual(bytes(right),beforeRight);
  const next=filled(1);guard.process(next);assert.equal(next.left[0],Math.fround(.2));assert.equal(next.right[0],Math.fround(-.4));
});

test('duration validation remains bounded and even a sub-frame request has continuous endpoints', () => {
  for(const sampleRate of [undefined,0,-1,NaN,Infinity]) assert.throws(()=>new OutputClickGuard({sampleRate}));
  for(const milliseconds of [0,-1,NaN,Infinity,Number.MAX_VALUE]) assert.throws(()=>new OutputClickGuard({sampleRate:48000,milliseconds}));
  const guard=new OutputClickGuard({sampleRate:1000,milliseconds:.01});assert.equal(guard.read().durationFrames,2);
  guard.process(stereo([1e38],[-1e38]));guard.attack();const tiny=filled(3,1e-30,-1e-30);guard.process(tiny);
  assert.equal(tiny.left[0],Math.fround(1e38));assert.equal(tiny.left[1],Math.fround(1e-30));assert.equal(tiny.right[1],Math.fround(-1e-30));
  assert.deepEqual(bytes(tiny.left.subarray(1)),bytes(new Float32Array(2).fill(1e-30)));
});
