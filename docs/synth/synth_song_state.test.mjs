import test from 'node:test';
import assert from 'node:assert/strict';
import {createYm2612RegisterState, createYm2612SongTimeline} from './synth_song_state.js';
import {createSynthSongPreview} from './synth_song_preview.js';

test('register observation preserves logical operators, six channels and global controls', () => {
  const state = createYm2612RegisterState();
  for (const [logical, address] of [[1,0],[2,8],[3,4],[4,12]]) {
    state.write(0,0x30+address,(logical<<4)|logical);
    state.write(0,0x40+address,logical*10);
    state.write(0,0x50+address,0x80|logical);
    state.write(0,0x60+address,0x80|logical+1);
    state.write(0,0x70+address,logical+2);
    state.write(0,0x80+address,(logical<<4)|logical+3);
    state.write(0,0x90+address,logical+4);
  }
  state.write(0,0xb0,5|(6<<3));state.write(0,0xb4,0x80|(2<<4)|7);
  state.write(1,0xb2,3|(4<<3));state.write(1,0xb6,0x40);
  state.write(0,0x22,0x0b);state.write(0,0x2b,0x80);
  state.write(0,0x28,0xf0);state.write(0,0x28,0x26);
  const snapshot = state.snapshot(100);
  assert.equal(snapshot.frame,100);assert.equal(snapshot.channels.length,6);
  assert.deepEqual(snapshot.lfo,{enabled:true,frequency:3});assert.equal(snapshot.dacEnabled,true);
  const first = snapshot.channels[0];
  assert.equal(first.preset.algorithm,5);assert.equal(first.preset.feedback,6);
  assert.equal(first.preset.ams,2);assert.equal(first.preset.pms,7);
  assert.deepEqual(first.preset.pan,{left:true,right:false});
  assert.equal(first.gate,true);assert.equal(first.keyMask,15);
  for (let operator=1;operator<=4;operator++) {
    assert.deepEqual(first.preset.operators[operator],{dt:operator,multi:operator,tl:operator*10,
      rs:2,ar:operator,am:true,d1r:operator+1,d2r:operator+2,sl:operator,rr:operator+3,ssg:operator+4});
  }
  assert.equal(snapshot.channels[5].preset.algorithm,3);
  assert.equal(snapshot.channels[5].keyMask,2);
  assert.equal(snapshot.channels[5].lastKeyMask,2);
  assert.deepEqual(snapshot.channels[5].preset.pan,{left:false,right:true});
  state.write(0,0x4c,99);state.write(0,0x28,0);
  assert.equal(snapshot.channels[0].preset.operators[4].tl,40,'old snapshots remain independent');
  assert.equal(snapshot.channels[0].gate,true);
  assert.equal(state.snapshot().channels[0].gate,false);
  assert.equal(state.snapshot().channels[0].lastKeyMask,15,'key-off keeps the last voiced operator mask for frozen audition');
  assert(Object.isFrozen(first.preset.operators[4]));
  state.reset();assert.equal(state.snapshot().channels[0].lastKeyMask,0,'source reset forgets the preceding song mask');
});

test('normal frequency highs latch across ports and only low writes commit', () => {
  const clock=8000000,state=createYm2612RegisterState(clock);
  state.write(0,0xa4,0x22);
  assert.equal(state.snapshot().channels[0].fnum,0,'high write alone does not change the heard pitch');
  state.write(1,0xa0,0x34);
  let channel=state.snapshot().channels[3];
  assert.equal(channel.block,4);assert.equal(channel.fnum,0x234);
  state.write(0,0xa5,0x29);state.write(0,0xa0,0x55);
  channel=state.snapshot().channels[0];
  assert.equal(channel.block,5);assert.equal(channel.fnum,0x155);
  assert.equal(channel.frequencyHz,0x155*clock*2**4/(144*2**20));
  assert(Math.abs(channel.midi-(69+12*Math.log2(channel.frequencyHz/440)))<1e-12);
  assert.equal(state.snapshot().channels[3].fnum,0x234);
});

test('CH3 special pitches are reported in logical OP order with a separate latch', () => {
  const state=createYm2612RegisterState();
  state.write(0,0xa6,0x24);state.write(0,0xa2,0x90);
  state.write(0,0xac,0x10);state.write(0,0xa9,0x10);
  state.write(0,0xad,0x19);state.write(0,0xaa,0x20);
  state.write(0,0xae,0x22);state.write(0,0xa8,0x30);
  state.write(0,0x27,0x40);
  const snapshot=state.snapshot(),channel=snapshot.channels[2];
  assert.equal(channel.specialMode,true);assert.equal(snapshot.channels[0].specialMode,false);
  assert.deepEqual(channel.specialFrequencies.map(({block,fnum})=>({block,fnum})),[
    {block:2,fnum:0x10},{block:3,fnum:0x120},{block:4,fnum:0x230},{block:4,fnum:0x490},
  ]);
  state.write(0,0x27,0x80);assert.equal(state.snapshot().csmEnabled,true);
  assert.equal(state.snapshot().channels[2].specialMode,true);
});

test('decoder snapshots preserve uncommitted frequency latches, keys, counters and revision atomically', () => {
  const state=createYm2612RegisterState(8000000);
  for(const [port,register,value] of [[0,0xb0,7],[0,0xa4,0x22],[0,0xa0,0x44],
    [0,0xac,0x17],[0,0xa9,0x56],[0,0x28,0xf2],[0,0x28,2],[0,0x28,0xa2],
    [1,0xa5,0x29],[0,0xae,0x2a]])state.write(port,register,value);
  const expected=state.snapshot(42),saved=structuredClone(state.saveState());
  const detached=state.saveState();detached.registers[0][0xb0]=0;detached.keyOnCounts[2]=99;
  assert.deepEqual(state.snapshot(42),expected,'saving returns independent buffers');
  state.reset();state.write(0,0x28,0x10);state.loadState(saved);
  assert.deepEqual(state.snapshot(42),expected,'restore replaces cached decoded state, counters and revision');
  saved.registers[0][0xb0]=0;saved.highLatches[0]=0;
  state.write(1,0xa1,0x88);state.write(0,0xaa,0x55);
  const snapshot=state.snapshot();
  assert.equal(snapshot.channels[4].block,5);assert.equal(snapshot.channels[4].fnum,0x188,'cross-port normal high latch survives independently of saved capsule edits');
  assert.equal(snapshot.channels[2].specialFrequencies[1].block,5);
  assert.equal(snapshot.channels[2].specialFrequencies[1].fnum,0x255,'special high latch survives separately');
  assert.equal(snapshot.channels[2].keyOnCount,2);assert.equal(snapshot.channels[2].lastKeyMask,10);
  const before=state.saveState();
  for(const change of [
    value=>{value.clockHz=7670454;},value=>{value.registers[1]=new Uint8Array(3);},
    value=>{value.keys[5]=16;},value=>{value.highLatches[1]=64;},value=>{value.revision=-1;},
  ]) {
    const bad=structuredClone(before);change(bad);assert.throws(()=>state.loadState(bad));
    assert.deepEqual(state.saveState(),before,'invalid capsules do not partially restore fields');
  }
});

test('timeline exposes the audible prefix, discards consumed events and ignores DAC sample traffic', () => {
  const engine={reset(){},writeYm2612(){},processFrames(frames){return {left:new Float32Array(frames),right:new Float32Array(frames)};}};
  const original={...engine},timeline=createYm2612SongTimeline(engine);
  try {
    engine.reset();engine.writeYm2612(0,0xb0,1);engine.processFrames(100);
    engine.writeYm2612(0,0xb0,5);engine.processFrames(100);
    for(let value=0;value<10000;value++)engine.writeYm2612(0,0x2a,value&255);
    assert.equal(timeline.pendingEvents,2,'DAC byte streams do not accumulate UI events');
    assert.equal(timeline.read(0).channels[0].preset.algorithm,1);
    assert.equal(timeline.read(99).channels[0].preset.algorithm,1);
    assert.equal(timeline.read(100).channels[0].preset.algorithm,5);
    assert.equal(timeline.pendingEvents,0,'heard changes are discarded');
    engine.reset();assert.equal(timeline.read(0).channels[0].preset.algorithm,0);
  } finally {timeline.dispose();}
  assert.equal(engine.writeYm2612,original.writeYm2612);
  assert.equal(engine.processFrames,original.processFrames);
  assert.equal(engine.reset,original.reset);
});

test('timeline checkpoints restore the audible decoder and only pending future events for backward seek', () => {
  const engine={reset(){},writeYm2612(){},processFrames(frames){return {left:new Float32Array(frames),right:new Float32Array(frames)};}};
  const timeline=createYm2612SongTimeline(engine);
  try {
    engine.reset();
    for(const [register,value] of [[0xb0,1],[0xa4,0x22],[0xa0,0x44],[0x28,0xf0],[0xa5,0x29],[0xad,0x19]])engine.writeYm2612(0,register,value);
    engine.processFrames(100);engine.writeYm2612(1,0xa1,0x88);engine.writeYm2612(0,0x28,0);
    engine.processFrames(100);engine.writeYm2612(0,0xb0,5);engine.writeYm2612(0,0xa9,0x55);engine.writeYm2612(0,0x28,0xa0);
    engine.processFrames(100);
    const at50=timeline.read(50),saved=structuredClone(timeline.saveState());
    assert.equal(saved.generatedFrames,300);assert.equal(saved.lastReadFrame,50);
    assert(saved.events.every(event=>event.frame>=100),'consumed source writes are absent from the capsule');
    const at100=timeline.read(100),at250=timeline.read(250);
    assert.equal(at100.channels[4].fnum,0x188);assert.equal(at100.channels[4].block,5);
    assert.equal(at250.channels[0].keyOnCount,2);assert.equal(at250.channels[2].specialFrequencies[0].fnum,0x155);
    engine.writeYm2612(0,0xb0,7);engine.processFrames(100);timeline.read(400);
    timeline.loadState(saved);
    assert.deepEqual(timeline.read(50),at50);
    assert.deepEqual(timeline.read(100),at100);
    assert.deepEqual(timeline.read(250),at250);
    timeline.loadState(saved);saved.events[0].value=0;
    assert.deepEqual(timeline.read(100),at100,'pending events are detached from the restore argument');
    const before=timeline.saveState();
    for(const change of [
      value=>{value.generatedFrames=-1;},value=>{value.lastReadFrame=301;},
      value=>{value.events[0].frame=99;},value=>{value.events[0].register=0x2a;},
      value=>{value.decoder.keys[0]=16;},
    ]) {
      const bad=structuredClone(before);change(bad);assert.throws(()=>timeline.loadState(bad));
      assert.deepEqual(timeline.saveState(),before,'all timeline state stays unchanged on validation failure');
    }
  } finally {timeline.dispose();}
  assert.throws(()=>timeline.saveState(),/disposed/);assert.throws(()=>timeline.loadState({}),/disposed/);
});

function song(ymClock=7670454) {
  const commands=ymClock ? [0x52,0xb0,1,0x61,0x3a,0x11, // Alg1 for 4410 VGM ticks.
    0x52,0xb0,5,0x61,0x3a,0x11,0x66] : [0x50,0x90,0x61,0x3a,0x11,0x66];
  const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);
  view.setUint32(8,0x171,true);view.setUint32(0x34,204,true);
  view.setUint32(0x2c,ymClock,true);if(!ymClock)view.setUint32(0xc,3579545,true);
  view.setUint32(0x18,8820,true);bytes.set(commands,256);
  return bytes;
}
function host() {
  const context={currentTime:0,async resume(){},
    createGain(){return {context,gain:{value:1},connect(){},disconnect(){}};},
    createBuffer(channels,length,sampleRate){return {length,sampleRate,copyToChannel(){}};},
    createBufferSource(){return {buffer:null,connect(){},disconnect(){},start(){},stop(){},onended:null};},
  };
  return {context,output:{context}};
}

test('reference live state follows consumed audio despite VgmPlayer render-ahead, and freezes on Pause', async () => {
  const audio=host(),writes=[];
  const engine={reset(){},dispose(){},sampleRate:()=>44100,
    writeYm2612(port,register,value){writes.push({register,value});},writePsg(){},
    processFrames(frames){return {left:new Float32Array(frames),right:new Float32Array(frames)};},
  };
  const preview=createSynthSongPreview({getAudio:()=>audio,createEngine:async()=>engine});
  try {
    preview.load(song(),'timed.vgm');await preview.play();
    assert.equal(preview.getState().liveState.channels[0].preset.algorithm,1);
    // Advance the fake device in increments inside the low-latency queue, so
    // the producer reaches the next patch while the audible cursor stays
    // before it. Do not require the old 200-ms startup render-ahead.
    audio.context.currentTime=.04;await new Promise(resolve=>setTimeout(resolve,35));
    audio.context.currentTime=.08;
    const deadline=Date.now()+1000;
    while(!writes.some(write=>write.register===0xb0&&write.value===5)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,15));
    assert(writes.some(write=>write.register===0xb0&&write.value===5),'future register writes were already rendered');
    assert.equal(preview.getState().liveState.channels[0].preset.algorithm,1,'the future patch remains hidden behind the audible cursor');
    audio.context.currentTime=.10;
    assert.equal(preview.getState().liveState.channels[0].preset.algorithm,1,'90 ms consumed: future patch is hidden');
    audio.context.currentTime=.12;
    assert.equal(preview.getState().liveState.channels[0].preset.algorithm,5,'110 ms consumed: second patch is now audible');
    preview.pause();const frozen=preview.getState().liveState;
    audio.context.currentTime=5;
    assert.deepEqual(preview.getState().liveState,frozen,'paused view and frame stay frozen');
    await preview.resume();assert.equal(preview.getState().liveState.channels[0].preset.algorithm,5);
    preview.stop();assert.equal(preview.getState().liveState,null);
  } finally {preview.dispose();}
});

test('a song with no declared YM2612 never fabricates a live FM instrument', async () => {
  const audio=host(),engine={reset(){},dispose(){},sampleRate:()=>44100,writeYm2612(){},writePsg(){},
    processFrames(frames){return {left:new Float32Array(frames),right:new Float32Array(frames)};}};
  const preview=createSynthSongPreview({getAudio:()=>audio,createEngine:async()=>engine});
  try {
    preview.load(song(0),'no-ym.vgm');await preview.play();
    assert.equal(preview.getState().liveState,null);
  } finally {preview.dispose();}
});
