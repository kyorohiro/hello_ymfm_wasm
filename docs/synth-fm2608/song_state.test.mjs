import test from 'node:test';
import assert from 'node:assert/strict';
import {createFm2608RegisterState,createFm2608SongTimeline,captureFm2608SongPreset} from './song_state.js';
import {createDefaultPreset,decodeBase64} from './preset.js';
import {installFm2608SongMix} from './song_engine.js';

function engineFixture() {
  const writes=[];
  return {writes,writeYm2608(...args){writes.push(args);},processFrames:frames=>({left:new Float32Array(frames),right:new Float32Array(frames)}),
    reset(){},loadAdpcmBMemory(){},clearAdpcmBMemory(){}};
}
test('OPNA observation decodes all sections and the actual 0xc0 special/0x80 CSM modes',()=>{
  const state=createFm2608RegisterState();state.write(0,0x29,128);state.write(0,0x27,0xc0);state.write(0,0x24,0xaa);state.write(0,0x25,2);
  state.write(0,0,100);state.write(0,7,0x3e);state.write(0,8,0x1b);state.write(0,6,17);state.write(0,0x11,42);state.write(0,0x18,0xda);
  const snapshot=state.snapshot();assert.equal(snapshot.channel3.mode,'special');assert.equal(snapshot.channel3.timerA,682);
  assert.equal(snapshot.ssg.channels[0].tone,true);assert.equal(snapshot.ssg.channels[0].envelope,true);assert.equal(snapshot.ssg.channels[0].volume,11);
  assert.equal(snapshot.ssg.noisePeriod,17);assert.equal(snapshot.rhythm.volume,42);assert.equal(snapshot.rhythm.voices[0].volume,26);
  state.write(0,0x27,0x81);assert.equal(state.snapshot().channel3.mode,'csm');assert.equal(state.snapshot().channel3.running,true);
  state.write(0,0x27,0x80);assert.equal(state.snapshot().channel3.running,false);
  const hz=snapshot.ssg.channels[0].frequencyHz;state.write(0,0x2e,0);assert.equal(state.snapshot().ssg.channels[0].frequencyHz,hz*2);
});
test('ADPCM capture preserves exact bytes, absolute memory range, playback rate and sample cache',()=>{
  const state=createFm2608RegisterState(7987200),bytes=Uint8Array.from({length:64},(_,i)=>i*3&255);
  state.loadMemory(bytes,0x100);state.write(1,1,0xc2);state.write(1,2,8);state.write(1,4,9);state.write(1,9,0xff);state.write(1,10,0x7f);state.write(1,11,123);state.write(1,0,0xb0);
  const first=state.snapshot(),revision=first.adpcm.memoryRevision;
  state.write(1,11,124);const second=state.snapshot();assert.equal(second.adpcm.memoryRevision,revision);assert.equal(first.adpcm.bytes,second.adpcm.bytes);
  const preset=captureFm2608SongPreset(second,{section:'adpcm',referenceNote:48});
  assert.deepEqual(decodeBase64(preset.adpcm.data),bytes);assert.equal(preset.adpcm.address,0x100);assert.equal(preset.adpcm.start,0x100);assert.equal(preset.adpcm.end,0x140);
  assert.equal(preset.adpcm.rootNote,48);assert.equal(preset.adpcm.volume,124);assert.equal(preset.adpcm.repeat,true);
});
test('CPU memory upload follows native dummy/start/stop semantics and preserves block bytes',()=>{
  const state=createFm2608RegisterState(),bytes=new Uint8Array(64).fill(0x55);state.loadMemory(bytes,0x100);
  state.write(1,1,2);state.write(1,2,8);state.write(1,4,8);state.write(1,0,0x60);
  for(let i=0;i<32;i++)state.write(1,8,i);
  state.write(1,0,0xa0);state.write(1,9,128);
  const sample=state.snapshot().adpcm.bytes;
  assert.deepEqual(sample.subarray(0,31),Uint8Array.from({length:31},(_,i)=>i));assert.equal(sample[31],0x55);
});
test('unknown or CPU-direct data cannot be silently exported as a sample',()=>{
  const state=createFm2608RegisterState();state.write(1,1,2);state.write(1,0,0xa0);state.write(1,9,1);
  assert.throws(()=>captureFm2608SongPreset(state.snapshot(),{section:'adpcm'}),/complete ADPCM/);
  state.write(1,0,0x80);assert.throws(()=>captureFm2608SongPreset(state.snapshot(),{section:'adpcm'}),/CPU-driven/);
});
test('capturing one FM channel preserves the other channels and its partial key mask',()=>{
  const state=createFm2608RegisterState(),base=createDefaultPreset();state.write(0,0xb0,7);state.write(0,0x28,0x30);
  const preset=captureFm2608SongPreset(state.snapshot(),{section:'fm',channel:0,basePreset:base});
  assert.equal(preset.fm[0].algorithm,7);assert.equal(preset.fm[0].keyMask,3);assert.deepEqual(preset.fm[1],base.fm[1]);
  const muted=state.snapshot();muted.fm.channels[0].selectedKeyMask=0;
  assert.equal(captureFm2608SongPreset(muted,{section:'fm',channel:0,basePreset:base}).fm[0].keyMask,0);
});
test('audible timeline accounts for memory upload timing and excludes manual writes from songLiveState',()=>{
  const engine=engineFixture(),timeline=createFm2608SongTimeline(engine);
  engine.writeYm2608(1,1,2);engine.writeYm2608(1,0,0xa0);engine.processFrames(20);engine.loadAdpcmBMemory(new Uint8Array(32).fill(0x34),0);
  assert.equal(timeline.read(19).adpcm.available,false);assert.equal(timeline.read(20).adpcm.available,true);
  engine.fm2608ManualWrite=true;engine.writeYm2608(0,0xb0,7);engine.fm2608ManualWrite=false;
  assert.equal(timeline.read(20).fm.channels[0].preset.algorithm,7);assert.equal(timeline.readSong(20).fm.channels[0].preset.algorithm,0);
  timeline.dispose();
});
test('software mutes preserve pre-mute observation and restore the latest channel values',()=>{
  const engine=engineFixture(),mix=installFm2608SongMix(engine,8000000);
  engine.writeYm2608(0,0x40,12);mix.setChannelEnabled('fm',0,false);engine.writeYm2608(0,0x40,22);
  assert.deepEqual(engine.writes.at(-1),[0,0x40,127]);assert.equal(mix.snapshot().fm.channels[0].preset.operators[1].tl,22);
  mix.setChannelEnabled('fm',0,true);assert.ok(engine.writes.some(write=>write.join(',')==='0,64,22'));
  engine.writeYm2608(0,8,15);mix.setChannelEnabled('ssg',0,false);assert.deepEqual(engine.writes.at(-1),[0,8,0]);
  engine.writeYm2608(0,0x18,0xdf);mix.setChannelEnabled('rhythm',0,false);assert.deepEqual(engine.writes.at(-1),[0,0x18,31]);
  mix.dispose();
});
