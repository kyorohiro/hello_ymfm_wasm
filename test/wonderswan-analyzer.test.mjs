import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createWonderSwanVgm} from './helpers/wonderswan_vgm_fixture.mjs';
import {Ym2612VGM} from '../docs/js/ym2612vgm.js';
import {createPlaybackEngine,createPlaybackPlayer,selectPlaybackConfiguration,playbackMuteControls,applyPlaybackMutes} from '../docs/vgm_analyzer/playback_core.js';
import {getNodePlaybackFactory,renderSource} from '../cli/render.js';
import {inspectSourceSupport,listSourceScoreChannels,exportSource,analyzeSource} from '../docs/vgm_analyzer/analyzer_core.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';
import {sourcesForChip} from '../docs/vgm_analyzer/source_mutes.js';

async function open(bytes,{mute=[],volume=1}={}) {
  const parser=new Ym2612VGM(bytes),configuration=selectPlaybackConfiguration(parser);
  const engine=await createPlaybackEngine(parser,{getFactory:getNodePlaybackFactory,masterVolume:volume});
  applyPlaybackMutes(engine,configuration,mute);
  const player=createPlaybackPlayer(engine,bytes);player.setPrefetchFactor(1);player.play();
  return {engine,player,configuration};
}
function pull(player,frames,sizes=[257]) {
  const left=new Float32Array(frames),right=new Float32Array(frames);let at=0,block=0;
  while(at<frames){const count=Math.min(sizes[block++%sizes.length],frames-at);player.process(left.subarray(at,at+count),right.subarray(at,at+count),count);at+=count;}
  return {left,right};
}
async function pcm(bytes,options={}) {const f=await open(bytes,options);try{return pull(f.player,8192);}finally{f.engine.dispose();}}

test('WonderSwan shared playback policy, four mutes, centered output, seek and Stop replay use real WASM',async()=>{
  const bytes=createWonderSwanVgm({channel:2,seconds:1,loop:false}),f=await open(bytes);
  try {
    assert.equal(f.configuration.kind,'wonderswan');assert.deepEqual(f.configuration.chips.map(c=>c.id),['wonderswan']);
    assert.deepEqual(playbackMuteControls(f.configuration).map(c=>c.id),[1,2,3,4].map(ch=>'wonderswan-ch-'+ch));
    assert.deepEqual(sourcesForChip('wonderswan'),[]);
    assert.deepEqual([...f.engine.playbackMixer.strips.keys()],['wonderswan']);assert.equal(f.engine.playbackMixer.get('wonderswan').gain,1);
    const reference=pull(f.player,20000,[1,7,113,257]);assert(reference.left.some(v=>v<0)&&reference.left.some(v=>v>0));
    assert(reference.left.every(Number.isFinite));assert.equal(f.engine.chip.readMemory(0x1200),255);assert.equal(f.player.supportsState(),false);
    await seekPlayback(f.player,1379,{yieldTask:async()=>{}});f.player.play();
    const sought=pull(f.player,4096,[31]);assert.deepEqual(sought.left,reference.left.slice(1379,1379+4096));
    f.player.stop();f.player.play();assert.deepEqual(pull(f.player,20000,[113]).left,reference.left);
  }finally{f.engine.dispose();}
  const full=await pcm(bytes),half=await pcm(bytes,{volume:.5});assert.deepEqual(half.left,Float32Array.from(full.left,v=>v*.5));
  assert((await pcm(bytes,{mute:['wonderswan-ch-3']})).left.every(v=>v===0));
  assert.deepEqual((await pcm(bytes,{mute:['wonderswan-ch-1']})).left,full.left);
});

test('WonderSwan works in a mixed header with independent source Mixer/mutes and one master gain',async()=>{
  const ws=createWonderSwanVgm({channel:0,seconds:1,loop:false});
  const psg=await readFile(new URL('./fixtures/psg-tone.vgm',import.meta.url));
  function prefix(bytes){const p=new Ym2612VGM(bytes);while(true){const at=p.position,e=p.step();if(e.type==='wait'||e.type==='end')return [...p.bytes.subarray(p.header.dataOffset,at)];}}
  const data=[...prefix(ws),...prefix(psg),0x61,0x44,0xac,0x66];
  const bytes=new Uint8Array(256+data.length);bytes.set(ws.subarray(0,256));bytes.set(data,256);
  const view=new DataView(bytes.buffer);view.setUint32(4,bytes.length-4,true);view.setUint32(0x0c,new Ym2612VGM(psg).header.psgClock,true);
  const f=await open(bytes);
  try {assert.equal(f.configuration.kind,'mixed');assert.deepEqual([...f.engine.playbackMixer.strips.keys()].sort(),['psg','wonderswan']);}finally{f.engine.dispose();}
  const all=await pcm(bytes),wave=await pcm(bytes,{mute:['genesis']}),tone=await pcm(bytes,{mute:['wonderswan']});
  assert(wave.left.some(Boolean)&&tone.left.some(Boolean));
  assert.deepEqual(all.left,Float32Array.from(wave.left,(v,i)=>v+tone.left[i]));
  assert((await pcm(bytes,{mute:['genesis','wonderswan']})).left.every(v=>v===0));
  const half=await pcm(bytes,{volume:.5});assert.deepEqual(half.left,Float32Array.from(all.left,v=>v*.5));
});

test('WonderSwan Analyzer capabilities and headless WAV/score exports agree with supported data',async()=>{
  const bytes=createWonderSwanVgm({channel:0,seconds:.2,loop:false});
  assert.equal(analyzeSource(bytes).chips[0].id,'wonderswan');
  const support=await inspectSourceSupport(bytes);assert.equal(support.render.status,'configuration-supported');assert.equal(support.render.engine,'wonderswan');
  for(const format of ['midi','musicxml','lilypond'])assert.equal(support.exports[format].status,'available');
  for(const format of ['tfi','vgi','sbi'])assert.equal(support.exports[format].status,'unavailable');
  assert.deepEqual(listSourceScoreChannels(bytes).channels.map(c=>c.id),[1,2,3,4].map(ch=>'wonderswan-ch'+ch));
  const wav=await renderSource(bytes,{maxSeconds:.1});assert.deepEqual(wav.warnings,[]);assert(wav.bytes.subarray(44).some(Boolean));
  assert((await renderSource(bytes,{maxSeconds:.1,mute:['wonderswan-ch-1']})).bytes.subarray(44).every(v=>v===0));
  const midi=exportSource(bytes,{format:'midi',bpm:120});assert(midi instanceof Uint8Array||midi.bytes instanceof Uint8Array);
  const dual=bytes.slice();new DataView(dual.buffer).setUint32(0xc0,0x40000000+3072000,true);
  assert.throws(()=>selectPlaybackConfiguration(new Ym2612VGM(dual)),e=>e.code==='UNSUPPORTED_CONFIGURATION');
  const variant=bytes.slice();new DataView(variant.buffer).setUint32(0xc0,0x80000000+3072000,true);
  assert.throws(()=>selectPlaybackConfiguration(new Ym2612VGM(variant)),e=>e.code==='UNSUPPORTED_CONFIGURATION');
});
