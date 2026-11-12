// SPDX-License-Identifier: BSD-3-Clause
// Real APU tests: no AudioContext, speakers, games or external downloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/gameboy_apu_wasm.js';
import {GameboyApuAudioEngine} from '../js/gameboyapuaudioengine.js';
import {VgmPlayer} from '../js/vgmplayer.js';
import {createGameboySongTimeline} from './song_state.js';
import {createDmgSongFixture,DMG_SONG_FUTURE_FRAME,DMG_SONG_RELEASE_FRAME,
  DMG_SONG_END_FRAME,DMG_SONG_INITIAL_WAVE,DMG_SONG_FUTURE_WAVE} from '../../test/helpers/dmg_synth_song_fixture.mjs';

const wasmBinary=await readFile(new URL('../generated/gameboy_apu_wasm.wasm',import.meta.url));
async function engine(t){
  const value=await GameboyApuAudioEngine.create({moduleFactory:factory,moduleOptions:{wasmBinary},outputSampleRate:44100,masterVolume:1});
  t.after(()=>value.dispose());return value;
}
function writes(target,bytes){for(let index=0;index<bytes.length;index+=3){assert.equal(bytes[index],0xb3);target.writeGameboyApu(bytes[index+1],bytes[index+2]);}}
function packed(wave){return Array.from({length:16},(_,index)=>(wave[index*2]<<4)|wave[index*2+1]);}
function stereo(frames){return{left:new Float32Array(frames),right:new Float32Array(frames)};}
function append(output,pcm,offset){output.left.set(pcm.left,offset);output.right.set(pcm.right,offset);}
function direct(target,events,frames){
  const output=stereo(frames);let position=0;
  for(let index=0;index<events.length;index++){
    const event=events[index];if(event.frame>=frames)break;
    if(event.frame>position){append(output,target.processFrames(event.frame-position),position);position=event.frame;}
    writes(target,event.writes);
    const end=Math.min(frames,events[index+1]?.frame??frames);
    append(output,target.processFrames(end-position),position);position=end;
  }
  return output;
}

test('original four-channel VGM PCM is sample-exact to authored register events, while Live follows consumed frames',async t=>{
  const rendered=await engine(t),reference=await engine(t),fixture=createDmgSongFixture();
  const timeline=createGameboySongTimeline(rendered),player=new VgmPlayer(rendered);
  t.after(()=>timeline.dispose());player.load(fixture.bytes);player.play();
  const output=stereo(DMG_SONG_END_FRAME);let copied=0;
  // Deliberately request a large prefetched block: all future writes have
  // reached the native APU before the user has heard frame zero.
  for(const frames of [45000,DMG_SONG_END_FRAME-45000]){
    const chunk=stereo(frames);copied+=player.process(chunk.left,chunk.right,frames);append(output,chunk,copied-frames);
  }
  assert.equal(copied,DMG_SONG_END_FRAME);
  const expected=direct(reference,fixture.events,DMG_SONG_END_FRAME);
  assert.deepEqual(output,expected,'timeline observation must not alter any actual APU sample');
  assert(output.left.every(Number.isFinite)&&output.right.every(Number.isFinite));
  assert(output.left.slice(2048,DMG_SONG_FUTURE_FRAME).some(value=>Math.abs(value)>.001));
  assert(output.left.slice(DMG_SONG_RELEASE_FRAME+2048).every(value=>value===0),'all four authored DAC-off writes silence the real APU');
  assert(timeline.generatedFrames>=DMG_SONG_END_FRAME);
  assert(timeline.pendingEvents>0,'future observations remain buffered separately from native rendering');
  const initial=timeline.read(0);
  assert.equal(initial.voice[1]>>6,1);assert.equal(initial.voice[6]>>6,2);
  assert.deepEqual(initial.registers.slice(32,48),packed(DMG_SONG_INITIAL_WAVE));
  assert.equal(initial.voice[18],0x43);assert.equal(initial.activeMask,null);
  assert.equal(initial.observation.hardwareEnvelope,false);
  const before=timeline.read(DMG_SONG_FUTURE_FRAME-1);
  assert.equal(before.voice[1]>>6,1,'render-ahead must not show the future duty');
  assert.deepEqual(before.registers.slice(32,48),packed(DMG_SONG_INITIAL_WAVE));
  const changed=timeline.read(DMG_SONG_FUTURE_FRAME);
  assert.equal(changed.voice[1]>>6,3);assert.equal(changed.voice[6]>>6,0);
  assert.deepEqual(changed.registers.slice(32,48),packed(DMG_SONG_FUTURE_WAVE));
  assert.equal(changed.voice[18],0x1b);
  assert.equal(initial.voice[1]>>6,1,'old paused snapshots must not alias the new register arrays');
  const ended=timeline.read(DMG_SONG_END_FRAME);
  for(const index of [2,7,10,17])assert.equal(ended.voice[index],0);
  assert.equal(timeline.pendingEvents,0);
});

test('actual prefetched APU Pause and channel observation preserve queued PCM until Resume',async t=>{
  const a=await engine(t),b=await engine(t),fixture=createDmgSongFixture();
  const timeline=createGameboySongTimeline(a),player=new VgmPlayer(a),baseline=new VgmPlayer(b);
  t.after(()=>timeline.dispose());
  for(const item of [player,baseline]){item.load(fixture.bytes);item.play();}
  const prefix=stereo(35000),refPrefix=stereo(35000);
  player.process(prefix.left,prefix.right,prefix.left.length);baseline.process(refPrefix.left,refPrefix.right,refPrefix.left.length);assert.deepEqual(prefix,refPrefix);
  const frozen=timeline.read(prefix.left.length),nativeBefore=timeline.generatedFrames;
  player.pause();
  for(let i=0;i<4;i++){
    assert.deepEqual(timeline.read(prefix.left.length),frozen,'switching CH can reuse one frozen all-channel snapshot');
    const silent=stereo(2048);assert.equal(player.process(silent.left,silent.right,2048),0);assert(silent.left.every(value=>value===0));
  }
  assert.equal(timeline.generatedFrames,nativeBefore,'Pause never advances native synthesis');
  player.resume();
  const resumed=stereo(12000),expected=stereo(12000);
  player.process(resumed.left,resumed.right,12000);baseline.process(expected.left,expected.right,12000);
  assert.deepEqual(resumed,expected,'Resume consumes the retained queue at exactly the same sample');
  const changed=timeline.read(47000);assert.equal(changed.voice[1]>>6,3);
  player.reset();assert.equal(timeline.generatedFrames,0);assert.equal(timeline.pendingEvents,0);
  assert(timeline.read(0).registers.every(value=>value===0));
  player.play();const restart=stereo(2048);player.process(restart.left,restart.right,2048);
  assert.deepEqual(restart.left,prefix.left.slice(0,2048));assert.deepEqual(restart.right,prefix.right.slice(0,2048));
});
