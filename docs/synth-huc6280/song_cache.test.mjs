// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHuc6280SongCache} from './song_cache.js';
const point=(frame,byteLength=20,rate=44100,mask=0)=>Object.freeze({frame,byteLength,rate,mask});
const setup=options=>{const cache=createHuc6280SongCache(options),source={};cache.reset(source);cache.setAvailable(true);return{cache,source};};
test('bounded checkpoints select only earlier matching-source/rate states and evict least-recently-used entries',()=>{
  const{cache,source}=setup({maxCount:3,maxBytes:60});const a=point(100),b=point(200),c=point(300),d=point(400);
  for(const p of[a,b,c])assert(cache.insert(source,p));assert.equal(cache.find(source,44100,250),b);
  assert(cache.insert(source,d));assert.equal(cache.read().count,3);assert.equal(cache.read().bytes,60);
  assert.equal(cache.find(source,44100,150),null,'the oldest unused point was evicted');
  assert.equal(cache.find(source,48000,1000),null);assert.equal(cache.find({},44100,1000),null);
  assert.equal(cache.find(source,44100,350),c);assert.equal(cache.read().restoredFrame,300);
  assert(!cache.insert(source,point(500,61)));assert(!cache.insert(source,c));
});
test('mute/source changes, disabling and Clear release snapshots and reset stats without retaining native resources',()=>{
  const{cache,source}=setup();cache.insert(source,point(100));cache.find(source,44100,100);cache.noteProgress(50);
  cache.setMask(1);assert.equal(cache.read().count,0);assert.equal(cache.read().hits,0);
  cache.insert(source,point(100,20,44100,1));cache.setEnabled(false);assert.equal(cache.read().count,0);
  assert(!cache.insert(source,point(100,20,44100,1)));cache.setEnabled(true);cache.insert(source,point(200,20,44100,1));
  cache.clear();assert.equal(cache.read().bytes,0);cache.insert(source,point(200,20,44100,1));cache.reset({});
  assert.equal(cache.read().count,0);assert.equal(cache.read().available,null);
});
test('rejected cache entries fall back without touching unrelated points, and progress begins fresh for each seek',()=>{
  const{cache,source}=setup(),a=point(100),b=point(200);cache.insert(source,a);cache.insert(source,b);
  cache.find(source,44100,250);cache.reject(b,Error('Invalid snapshot'));assert.equal(cache.read().count,1);assert.equal(cache.read().restoredFrame,0);
  assert.equal(cache.find(source,44100,250),a);cache.noteProgress(150);assert.equal(cache.read().reconstructedFrames,150);
  cache.beginSeek();assert.equal(cache.read().restoredFrame,0);assert.equal(cache.read().reconstructedFrames,0);assert.equal(cache.read().error,'');
  assert.throws(()=>cache.setEnabled(1),/boolean/);assert.throws(()=>cache.setMask(64),/mask/);assert.throws(()=>cache.noteProgress(-1),/frame/);
});
