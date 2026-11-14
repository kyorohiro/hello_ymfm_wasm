// SPDX-License-Identifier: BSD-3-Clause
// Existing native HuC and shared ADPCM engines render into inert arrays only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../../tetorica_src/runtime/generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../../tetorica_src/runtime/huc6280audioengine.js';
import {Msm5205AudioEngine} from '../../tetorica_src/runtime/msm5205audioengine.js';
import {VgmPlayer} from '../../tetorica_src/runtime/vgmplayer.js';
import {createHuc6280SongEngine,readHuc6280SongMix} from './song_engine.js';
import {prepareHuc6280SongSource} from './song_source.js';
import {createHuc6280SongPreview} from './song_preview.js';
import {fakeAudio,vgm,init,voice,wait} from './song_test_helpers.mjs';

const wasmBinary=await readFile(new URL('../../tetorica_src/runtime/generated/huc6280_wasm.wasm',import.meta.url));
const moduleFactory=()=>factory({wasmBinary});
const create=header=>createHuc6280SongEngine(header,{moduleFactory});
function mixed({huc=true}={}){
  const nibbles=Array.from({length:120},(_,i)=>i%12<6?7:15);
  const bytes=vgm([...(huc?[...init,...voice()]:[]),0x32,0,
    ...nibbles.flatMap(n=>[0x32,0x10|n,...wait(11)]),...wait(4096)],{clock:huc?3579545:0});
  const view=new DataView(bytes.buffer);view.setUint32(8,0x172,true);view.setUint32(0xf0,384000,true);bytes[0xd7]=4;return bytes;
}
function playback(engine,bytes,frames=4000){
  const player=new VgmPlayer(engine);player.load(bytes,{logger:null});player.setPrefetchFactor(1);player.setLoopEnabled(false);player.reset();player.play();
  const left=new Float32Array(frames),right=new Float32Array(frames);
  assert.equal(player.process(left,right,frames),frames);return{left,right};
}
const peak=pcm=>Math.max(...pcm.left.map(Math.abs),...pcm.right.map(Math.abs));

test('mixed VGM renders exact independent HuC and MSM contributions with per-source gain and mute',async()=>{
  const bytes=mixed(),source=await prepareHuc6280SongSource(bytes);
  const huc=await Huc6280AudioEngine.create({moduleFactory,clock:3579545,outputSampleRate:44100,masterVolume:1});
  const msm=new Msm5205AudioEngine({clock:384000,flags:4,outputSampleRate:44100});
  try{
    const h=playback(huc,bytes),m=playback(msm,bytes);assert(peak(h)>.01);assert(peak(m)>.01);
    for(const mixer of [{},{huc6280:{volume:.44},msm5205:{volume:.5}},{huc6280:{muted:true}},{msm5205:{muted:true}}]){
      const engine=await create(source.header);try{
        engine.setSourceMix(mixer);const pcm=playback(engine,bytes),settings=readHuc6280SongMix(mixer);
        for(const side of ['left','right']){
          const expected=Float32Array.from(h[side],(value,i)=>value*(settings.huc6280.muted?0:settings.huc6280.volume)+m[side][i]*(settings.msm5205.muted?0:settings.msm5205.volume));
          assert.deepEqual(pcm[side],expected);
        }
        assert.equal(engine.supportsState(),false);assert.match(engine.stateReason,/MSM5205.*snapshot/);
        for(const name of ['saveState','validateState','loadState'])assert.throws(()=>engine[name]({}),/MSM5205.*snapshot/);
      }finally{engine.dispose();engine.dispose();}
    }
  }finally{huc.dispose();msm.dispose();}
});

test('pure HuC keeps exact old PCM and opaque state while its source gain participates in compatibility',async()=>{
  const bytes=vgm([...init,...voice(),...wait(10000)]),header=(await prepareHuc6280SongSource(bytes)).header;
  const a=await create(header),b=await create(header),raw=await Huc6280AudioEngine.create({moduleFactory,clock:3579545,outputSampleRate:44100,masterVolume:1});
  try{
    assert.deepEqual(playback(a,bytes),playback(raw,bytes));assert(a.supportsState());
    a.setSourceMix({huc6280:{volume:.44}});const state=a.saveState(),expected=a.processFrames(777);
    assert.throws(()=>b.loadState(state),/setting|incompatible|match/i);
    b.setSourceMix({huc6280:{volume:.44}});b.loadState(state);assert.deepEqual(b.processFrames(777),expected);
    const before=b.getSourceMix();assert.throws(()=>b.setSourceMix({huc6280:{volume:.5},msm5205:{volume:Infinity}}),/mixer/);assert.deepEqual(b.getSourceMix(),before);
    const nativeBefore=a.saveState();a.setSourceMix({huc6280:{volume:.44},cdda:{volume:.1}});assert(a.validateState(nativeBefore),'CD-DA does not change this native source path');
  }finally{a.dispose();b.dispose();raw.dispose();}
});

test('MSM-only playback uses no recorded PSG and retains ADPCM time through normal replay Seek',async()=>{
  const graph=fakeAudio();let opens=0;
  const preview=createHuc6280SongPreview({getAudio:()=>{opens++;return graph.audio;},schedule:graph.schedule,cancel:graph.cancel,yieldTask:async()=>{},nowMs:()=>0,createEngine:create});
  try{
    await preview.load(mixed({huc:false}),'ADPCM only');preview.setSourceMix({huc6280:{volume:.44},msm5205:{volume:1}});assert.equal(opens,0);
    assert(await preview.seek(.02));const state=preview.read();assert(state.paused);assert.equal(state.seekCache.available,false);assert.equal(state.seekCache.count,0);
    assert.match(state.cacheUnavailableReason,/MSM5205.*snapshot/);assert.deepEqual(state.sourceChips,{huc6280:false,msm5205:true,cdda:false});assert(!state.manualReady);
    const first=graph.buffers[0].data.map(side=>side.slice());assert(first.some(side=>side.some(v=>Math.abs(v)>.01)));
    assert(await preview.seek(.02));assert.deepEqual(graph.buffers.at(-1).data,first,'normal Seek repeats exact complete ADPCM state');
    assert(await preview.resume());for(let i=0;i<100&&preview.read().playing;i++)graph.tick(.008);assert.equal(preview.read().playback,'ended');
  }finally{preview.dispose();await preview.whenIdle();}
});

test('only VGM source mix changes clear clean checkpoints; muted new Seek PCM is silent',async()=>{
  const graph=fakeAudio(),preview=createHuc6280SongPreview({getAudio:()=>graph.audio,schedule:graph.schedule,cancel:graph.cancel,yieldTask:async()=>{},nowMs:()=>0,createEngine:create,cacheIntervalSeconds:.01});
  try{
    await preview.load(vgm([...init,...voice(),...wait(44100)]));await preview.seek(.05);let state=preview.read();assert(state.seekCache.count>0);
    preview.setSourceMix({cdda:{volume:.5,muted:true}});assert.equal(preview.read().seekCache.count,state.seekCache.count,'CD-DA settings are outside VGM');
    preview.setSourceMix({huc6280:{volume:.44}});assert.equal(preview.read().seekCache.count,0);
    await preview.seek(.05);assert(preview.read().seekCache.count>0);
    preview.setSourceMix({huc6280:{volume:.44,muted:true}});assert.equal(preview.read().seekCache.count,0);
    const first=graph.buffers.length;await preview.seek(.1);assert(graph.buffers.slice(first).every(b=>b.data.every(side=>side.every(value=>value===0))));
  }finally{preview.dispose();await preview.whenIdle();}
});
