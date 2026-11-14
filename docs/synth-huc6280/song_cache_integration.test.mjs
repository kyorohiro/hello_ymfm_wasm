// SPDX-License-Identifier: BSD-3-Clause
// Actual stateful WASM into inert Web Audio buffers. Never opens a device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../../tetorica_src/runtime/generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../../tetorica_src/runtime/huc6280audioengine.js';
import {createHuc6280SongPreview} from './song_preview.js';
import {createSeekFixture} from './song_seek_fixtures.mjs';
import {fakeAudio,counterEngine,vgm,init,voice,block,streamSetup,streamStart,wait} from './song_test_helpers.mjs';
const wasmBinary=await readFile(new URL('../../tetorica_src/runtime/generated/huc6280_wasm.wasm',import.meta.url));
const native=()=>Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:44100,masterVolume:1});
function setup(options={}){
  const graph=fakeAudio();let live=0,maxLive=0;
  const preview=createHuc6280SongPreview({getAudio:()=>graph.audio,schedule:graph.schedule,cancel:graph.cancel,nowMs:()=>0,yieldTask:async()=>{},cacheIntervalSeconds:.05,
    createEngine:async()=>{const engine=await native();assert(engine.supportsState(),'Build the state-capable SDK before running cache checks');live++;maxLive=Math.max(maxLive,live);const dispose=engine.dispose;
      engine.dispose=function(){if(this.handle)live--;return dispose.call(this);};return engine;},...options});
  return{...graph,preview,get live(){return live;},get maxLive(){return maxLive;}};
}
async function tail(f,seconds){
  const start=f.buffers.length;assert(await f.preview.seek(seconds));const state=f.preview.read(),snapshot=state.liveState;
  assert(state.paused);assert.equal(state.positionFrames,Math.round(seconds*44100));assert(await f.preview.resume());
  for(let i=0;i<500&&f.preview.read().playing;i++)f.tick(.008);
  assert.equal(f.preview.read().playback,'ended');const pcm=[];
  for(const buffer of f.buffers.slice(start))for(let i=0;i<buffer.length;i++)pcm.push(buffer.data[0][i],buffer.data[1][i]);
  return{pcm,snapshot,cache:state.seekCache};
}
function semanticSnapshot(snapshot){
  // revision counts observed transitions: a cooperative yield can expose extra
  // same-frame writes. Compare every sound/known-state field, not that UI counter.
  const{revision,...state}=snapshot;assert(Number.isInteger(revision));return state;
}

test('cold, cached and nearby native seeks have identical Wave/LFO/Noise/DDA/stream PCM and known/unknown Live state',async()=>{
  for(const[kind,bytes]of[...['wave','lfo','noise','dda'].map(kind=>[kind,createSeekFixture(kind,.7)]),['stream',vgm([...init,...voice(0,{dda:true}),...block([0,31,4,26,8,22,12,18]),...streamSetup(),...streamStart(8,{mode:129}),...wait(33075),0x94,0])]]){
    const f=setup();try{
      await f.preview.load(bytes,kind);f.preview.setLiveEnabled(false);f.preview.setCacheEnabled(false);const cold=await tail(f,.2),coldNearby=await tail(f,.21);
      f.preview.setCacheEnabled(true);const collecting=await tail(f,.2);assert.deepEqual(collecting.pcm,cold.pcm,kind+' collecting');assert.equal(collecting.cache.hits,0);
      assert(collecting.cache.count>0,`${kind}: ${collecting.cache.error}`);const warm=await tail(f,.2);
      assert(warm.cache.hits>0);assert.equal(warm.cache.restoredFrame,8820);assert.equal(warm.cache.reconstructedFrames,0);
      assert.deepEqual(warm.pcm,cold.pcm,kind+' warm tail');assert.deepEqual(semanticSnapshot(warm.snapshot),semanticSnapshot(cold.snapshot),kind+' exact Live state');
      const nearby=await tail(f,.21);assert(nearby.cache.restoredFrame>=8820);assert(nearby.cache.reconstructedFrames<=441);
      assert.deepEqual(nearby.pcm,cold.pcm.slice(882),kind+' nearby tail');assert.equal(nearby.snapshot.positionFrames,9261);
      assert.deepEqual(semanticSnapshot(nearby.snapshot),semanticSnapshot(coldNearby.snapshot),kind+' nearby Live state');
      assert(f.maxLive<=2,'only old reference plus one candidate');
    }finally{f.preview.dispose();await f.preview.whenIdle();assert.equal(f.live,0);}
  }
});

test('cache survives Stop but not source/mute/disable/clear, remains bounded, and never reuses an old output mix',async()=>{
  const f=setup({cacheMaxCount:3,cacheMaxBytes:200000});try{
    await f.preview.load(createSeekFixture('lfo',1));assert(await f.preview.seek(.4));let state=f.preview.read();assert(state.seekCache.count>0);assert(state.seekCache.count<=3);assert(state.seekCache.bytes<=200000);
    const frame=state.positionFrames,snapshot=state.liveState;f.preview.stop();assert(f.preview.read().seekCache.count>0);assert(await f.preview.seek(.4));assert(f.preview.read().seekCache.hits>0);
    f.preview.setChannelEnabled(0,false);f.preview.setChannelEnabled(1,false);assert.equal(f.preview.read().seekCache.count,0);assert.equal(f.preview.read().positionFrames,frame);assert.deepEqual(f.preview.read().liveState,snapshot);
    assert(await f.preview.seek(.4));assert(await f.preview.seek(.4));state=f.preview.read();assert(state.seekCache.hits>0);assert.equal(state.channelMuteMask,3);
    const start=f.buffers.length;assert(await f.preview.resume());for(let i=0;i<200&&f.preview.read().playing;i++)f.tick(.008);
    assert(f.buffers.slice(start).every(buffer=>buffer.data.every(side=>side.every(value=>value===0))));
    f.preview.clearSeekCache();assert.equal(f.preview.read().seekCache.count,0);f.preview.setCacheEnabled(false);assert(await f.preview.seek(.3));assert.equal(f.preview.read().seekCache.count,0);
    f.preview.setCacheEnabled(true);assert(await f.preview.seek(.3));assert(f.preview.read().seekCache.count>0);
    await f.preview.load(createSeekFixture('noise',1),'new');assert.equal(f.preview.read().seekCache.count,0);
  }finally{f.preview.dispose();await f.preview.whenIdle();}
});

test('normal-play checkpoints wait until old queued mix drains after a mute change',async()=>{
  const f=setup({cacheIntervalSeconds:.005});try{
    await f.preview.load(createSeekFixture('wave',1));assert(await f.preview.play());
    f.tick(.1);f.preview.setChannelEnabled(0,false);assert.equal(f.preview.read().seekCache.count,0);
    for(let i=0;i<20;i++)f.tick(.008);f.preview.pause();assert(f.preview.read().seekCache.count>0);
    const first=f.buffers.length;assert(await f.preview.seek(.45));assert(f.preview.read().seekCache.restoredFrame>0);
    assert(f.buffers.slice(first).every(buffer=>buffer.data.every(side=>side.every(value=>value===0))),'restored queue cannot contain pre-mute PCM');
  }finally{f.preview.dispose();await f.preview.whenIdle();}
});

test('unsupported state cores and oversized checkpoints still seek correctly without a cache',async()=>{
  const f=setup({createEngine:async()=>counterEngine()});try{await f.preview.load(createSeekFixture('wave',1));assert(await f.preview.seek(.3));assert.equal(f.preview.read().seekCache.available,false);assert.equal(f.preview.read().seekCache.count,0);}finally{f.preview.dispose();}
  const small=setup({cacheMaxBytes:32});try{await small.preview.load(createSeekFixture('wave',1));assert(await small.preview.seek(.3));assert.equal(small.preview.read().positionFrames,13230);assert.equal(small.preview.read().seekCache.count,0);assert.match(small.preview.read().seekCache.error,/budget/);}finally{small.preview.dispose();}
});
