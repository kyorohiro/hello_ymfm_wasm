import test from 'node:test';
import assert from 'node:assert/strict';
import {createPsgRegisterState,createPsgSongTimeline} from './synth_song_psg_state.js';
import {createYm2612SongTimeline} from './synth_song_state.js';

test('PSG source decoder retains tone latch/data, last audible attenuation, noise control and detached immutable snapshots',()=>{
  const state=createPsgRegisterState(),cold=state.snapshot();
  assert.equal(cold.kind,'segapsg');assert.equal(cold.channels.length,4);
  assert.deepEqual(cold.lastAttenuations,[15,15,15,15]);
  assert(cold.channels.slice(0,3).every(voice=>voice.constantOutput&&voice.frequencyHz===null&&voice.midi===null));
  for(const value of [0x8c,0x15,0x96,0x9f])state.write(value);
  let view=state.snapshot(20),tone=view.channels[0];
  assert.equal(tone.period,0x15c);assert.equal(tone.attenuation,15);assert.equal(tone.lastAttenuation,6);
  assert.equal(tone.frequencyHz,3579545/(32*0x15c));assert.equal(tone.active,false);
  assert.equal(tone.preset.envelope.enabled,false);
  state.write(3);assert.equal(state.snapshot().channels[0].attenuation,3,'a data byte also edits the latched volume');
  assert.equal(tone.attenuation,15,'earlier snapshots do not track later writes');
  for(const value of [0xc2,2,0xe7,0xf4])state.write(value);
  view=state.snapshot();const noise=view.channels[3];
  assert.equal(noise.source,'noise');assert.equal(noise.period,34);assert.equal(noise.noiseRate,'tone3');assert.equal(noise.noiseType,'white');
  assert.equal(noise.noiseClockHz,3579545/(32*34));assert.equal(noise.frequencyHz,null);assert.equal(noise.midi,null);
  assert.equal(noise.attenuation,4);assert.equal(view.noiseWriteCount,1);
  state.write(0xe7);assert.equal(state.snapshot().noiseWriteCount,2,'even the same noise-control value resets the real LFSR');
  state.write(0xff);assert.equal(state.snapshot().noiseWriteCount,2,'attenuation is independent of a noise reset');
  state.write(0xe3);assert.equal(state.snapshot().channels[3].frequencyHz,3579545/(32*34*16));
  state.write(0xe0);assert.equal(state.snapshot().channels[3].noiseClockHz,3579545/512);
  state.write(0xe1);assert.equal(state.snapshot().channels[3].noiseClockHz,3579545/1024);
  state.write(0xe2);assert.equal(state.snapshot().channels[3].noiseClockHz,3579545/2048);
  state.write(0xe0);state.write(7);assert.equal(state.snapshot().noiseMode,7,'data bytes also update a latched noise register');
  assert(Object.isFrozen(tone)&&Object.isFrozen(tone.preset)&&Object.isFrozen(tone.preset.envelope)&&Object.isFrozen(view.periods));
  assert.equal(cold.channels[0].lastAttenuation,15);
  state.reset();assert.deepEqual(state.snapshot().lastAttenuations,[15,15,15,15]);
});

test('PSG decoder checkpoints preserve high-byte continuation and reject malformed state atomically',()=>{
  const state=createPsgRegisterState(4000000);for(const value of [0xa7,0x23,0xb5,0xcf,0xe5])state.write(value);
  const saved=state.saveState(),expected=state.snapshot();
  state.write(0x83);state.write(0x24);state.loadState(structuredClone(saved));assert.deepEqual(state.snapshot(),expected);
  state.write(3);assert.equal(state.snapshot().noiseMode,3,'the restored noise latch receives the continuation');
  state.loadState(saved);const before=state.saveState();
  for(const patch of [{version:2},{clockHz:3579545},{periods:[0,0,1024]},{attenuations:[0,0,0,-1]},
    {lastAttenuations:[0,0,0,16]},{latched:8},{noiseMode:8},{noiseWriteCount:Number.MAX_SAFE_INTEGER}]) {
    assert.throws(()=>state.loadState({...saved,...patch}));assert.deepEqual(state.saveState(),before);
  }
  for(const value of [-1,256,1.5,NaN])assert.throws(()=>state.write(value));
  assert.deepEqual(state.saveState(),before);saved.periods.fill(0);assert.notDeepEqual(state.saveState().periods,saved.periods);
});

function engine() {
  return {writes:[],resets:0,writePsg(value){this.writes.push(['psg',value]);},writeYm2612(...args){this.writes.push(['ym',...args]);},
    processFrames(frames){return {left:new Float32Array(frames),right:new Float32Array(frames)};},reset(){this.resets++;}};
}
test('PSG timeline reveals only audible writes, preserves same-frame ordering and restores pending future events',()=>{
  const host=engine(),timeline=createPsgSongTimeline(host);
  try {
    for(const value of [0x8c,0x15,0x96])host.writePsg(value);
    host.processFrames(32);host.writePsg(0x99);host.processFrames(32);host.writePsg(0xe7);host.writePsg(0xf3);
    assert.equal(timeline.read(0).channels[0].attenuation,6);
    assert.equal(timeline.read(31).channels[0].attenuation,6);
    const saved=timeline.saveState();assert.equal(saved.events.length,3);
    assert.equal(timeline.read(32).channels[0].attenuation,9);assert.equal(timeline.read(63).channels[3].attenuation,15);
    assert.equal(timeline.read(64).channels[3].attenuation,3);assert.equal(timeline.pendingEvents,0);
    assert.throws(()=>timeline.read(32),/backwards/);
    timeline.loadState(saved);assert.equal(timeline.read(31).channels[0].attenuation,6);
    const expected=timeline.read(64);assert.equal(expected.channels[0].period,0x15c);assert.equal(expected.channels[3].noiseType,'white');
    host.reset();assert.equal(timeline.read(0).channels[3].lastAttenuation,15);
  } finally {timeline.dispose();}
});

test('PSG timeline checkpoint validation is atomic and retains a bounded pending window',()=>{
  const host=engine(),timeline=createPsgSongTimeline(host);
  try {
    host.writePsg(0x96);host.processFrames(16);host.writePsg(0x97);host.processFrames(16);timeline.read(1);
    const saved=timeline.saveState();
    for(const patch of [{version:2},{generatedFrames:0},{lastReadFrame:40},{events:[{frame:33,value:0}]},
      {events:[{frame:16,value:300}]},{events:[{frame:20,value:0},{frame:16,value:0}]},
      {decoder:{...saved.decoder,latched:10}}]) {
      assert.throws(()=>timeline.loadState({...saved,...patch}));assert.deepEqual(timeline.saveState(),saved);
    }
    timeline.read(32);
    for(let i=0;i<1000;i++){host.writePsg(0x90|(i%15));host.processFrames(10);timeline.read(42+i*10);}
    assert.equal(timeline.pendingEvents,0,'consumed source traffic is discarded');
    assert.throws(()=>timeline.read(NaN));
  } finally {timeline.dispose();}
  assert.throws(()=>timeline.saveState(),/disposed/);
});

test('PSG and YM timelines share generated time and unwind process/reset wrappers in reverse order',()=>{
  const host=engine(),original={writePsg:host.writePsg,writeYm2612:host.writeYm2612,processFrames:host.processFrames,reset:host.reset};
  const ym=createYm2612SongTimeline(host),psg=createPsgSongTimeline(host);
  host.writeYm2612(0,0xb0,4);host.writePsg(0x93);host.processFrames(50);
  assert.equal(ym.read(50).channels[0].preset.algorithm,4);assert.equal(psg.read(50).channels[0].attenuation,3);
  host.reset();assert.equal(ym.read(0).channels[0].preset.algorithm,0);assert.equal(psg.read(0).channels[0].attenuation,15);
  psg.dispose();ym.dispose();for(const [name,value]of Object.entries(original))assert.equal(host[name],value,name);
});
