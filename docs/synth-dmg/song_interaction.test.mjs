// SPDX-License-Identifier: BSD-3-Clause
// Private reference-APU interaction: real WASM, numerical PCM, no audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/gameboy_apu_wasm.js';
import {GameboyApuAudioEngine} from '../js/gameboyapuaudioengine.js';
import {VgmPlayer} from '../js/vgmplayer.js';
import {createGameboySongTimeline} from './song_state.js';
import {createGameboySongInteraction} from './song_interaction.js';
import {createDefaultPreset,waveShape} from './preset.js';
import {createDmgSongFixture} from '../../test/helpers/dmg_synth_song_fixture.mjs';

const wasmBinary=await readFile(new URL('../generated/gameboy_apu_wasm.wasm',import.meta.url));
async function fixture(t,{interactive=true}={}){
  const engine=await GameboyApuAudioEngine.create({moduleFactory:factory,moduleOptions:{wasmBinary},outputSampleRate:44100,masterVolume:1});
  const nativeWrite=engine.writeGameboyApu,writes=[];engine.writeGameboyApu=function(...args){writes.push(args);return nativeWrite.apply(this,args);};
  const timeline=createGameboySongTimeline(engine),before={write:engine.writeGameboyApu,reset:engine.reset};
  const interaction=interactive?createGameboySongInteraction(engine):null;
  t.after(()=>{interaction?.dispose();timeline.dispose();engine.dispose();});
  return{engine,timeline,interaction,writes,before};
}
const write=(engine,register,value)=>engine.writeGameboyApu(register,value);
function boot(engine){
  const {events}=createDmgSongFixture();
  for(let i=0;i<events[0].writes.length;i+=3){assert.equal(events[0].writes[i],0xb3);write(engine,events[0].writes[i+1],events[0].writes[i+2]);}
}
const stereo=frames=>({left:new Float32Array(frames),right:new Float32Array(frames)});
const finite=pcm=>assert(pcm.left.every(Number.isFinite)&&pcm.right.every(Number.isFinite));

test('install/read/dispose do not initialize, reset, render or write the reference APU; all original VGM samples and timeline events are unchanged',async t=>{
  const a=await fixture(t),b=await fixture(t,{interactive:false}),bytes=createDmgSongFixture().bytes;
  assert.deepEqual(a.writes,[]);assert.equal(a.interaction.read().initialized,false);assert.equal(a.timeline.generatedFrames,0);
  assert.throws(()=>a.interaction.noteOn('before-power',60),/power on/);assert.deepEqual(a.writes,[]);
  const players=[a,b].map(({engine})=>{const player=new VgmPlayer(engine);player.setPrefetchFactor(1);player.setLoopEnabled(false);player.load(bytes);player.reset();player.play();return player;});
  for(const frames of [12000,30000,40000]){
    const x=stereo(frames),y=stereo(frames);assert.equal(players[0].process(x.left,x.right,frames),players[1].process(y.left,y.right,frames));assert.deepEqual(x,y);finite(x);
    assert.deepEqual(a.timeline.read(a.timeline.generatedFrames),b.timeline.read(b.timeline.generatedFrames));
  }
  const count=a.writes.length,generated=a.timeline.generatedFrames;a.interaction.dispose();
  assert.equal(a.writes.length,count);assert.equal(a.timeline.generatedFrames,generated);assert.equal(a.engine.writeGameboyApu,a.before.write);assert.equal(a.engine.reset,a.before.reset);
  assert.throws(()=>a.interaction.noteOn('retired',60),{name:'AbortError'});
  write(a.engine,0,0);assert.equal(a.writes.length,count+1,'the original timeline transport still works after helper retirement');
});

test('sparse edits merge against the latest generated VGM bits, not the stale audible UI, and match direct physical writes sample-exactly',async t=>{
  const a=await fixture(t),b=await fixture(t,{interactive:false});for(const f of [a,b]){boot(f.engine);f.engine.processFrames(2048);}
  // A prior UI observation predates these newer generated writes. In
  // particular duty must retain the latest six length bits, and an envelope
  // pace edit must retain the latest VGM initial volume/direction.
  const stale=a.timeline.read(0);assert.notEqual(stale.registers[1],0x6f);
  for(const f of [a,b]){write(f.engine,1,0x6f);write(f.engine,2,0x9d);write(f.engine,21,0x75);}
  const before=a.interaction.read(),count=a.writes.length;
  a.interaction.applyEdit({channel:0,changes:{'pulse.duty':.75,'pulse.envelope.period':2,'pan.left':false}});
  for(const[register,value]of [[2,0x9a],[1,0xef],[21,0x65]])write(b.engine,register,value);
  assert.deepEqual(a.writes.slice(count),[[2,0x9a],[1,0xef],[21,0x65]]);
  const after=a.interaction.read();for(const register of [3,4,6,7,8,9,10,12,13,14,17,18,19])assert.equal(after.registers[register],before.registers[register]);
  const x=a.engine.processFrames(4096),y=b.engine.processFrames(4096);finite(x);assert.deepEqual(x,y);
  assert.deepEqual(a.timeline.read(a.timeline.generatedFrames),b.timeline.read(b.timeline.generatedFrames),'manual writes use the same audible-time timeline');
  const state=a.interaction.read(),n=a.writes.length;
  for(const edit of [{channel:1,changes:{'pulse.sweep.enabled':true}},{channel:0,changes:{'pulse.volume':16}},{channel:2,changes:{'wave.samples':Array(31).fill(0)}}])assert.throws(()=>a.interaction.applyEdit(edit));
  assert.equal(a.writes.length,n);assert.deepEqual(a.interaction.read(),state);
});

test('new VGM triggers and DAC/power-off retire manual ownership, so old key-up, Pitch reset and keyboard cleanup cannot alter later song notes',async t=>{
  const {engine,interaction,writes}=await fixture(t);boot(engine);engine.processFrames(1024);
  assert.equal(interaction.noteOn('manual',60,{channel:0}).channel,0);assert.equal(interaction.read().voices.length,1);
  interaction.setPitch(2);const period=interaction.read().registers[4];write(engine,4,period|128);
  assert.deepEqual(interaction.read().voices,[]);let count=writes.length;
  assert.equal(interaction.noteOff('manual'),false);interaction.setPitch(0);interaction.releaseKeyboard();assert.equal(writes.length,count);
  const playing=engine.processFrames(2048);finite(playing);assert(playing.left.some(value=>Math.abs(value)>.001));
  interaction.noteOn('new',64,{channel:1});write(engine,7,0);assert.deepEqual(interaction.read().voices,[]);count=writes.length;assert(!interaction.noteOff('new'));assert.equal(writes.length,count);
  interaction.noteOn('wave',60,{channel:2});write(engine,10,0);assert.deepEqual(interaction.read().voices,[]);
  interaction.noteOn('noise',0,{channel:3});interaction.setPitch(2);write(engine,22,0);assert.deepEqual(interaction.read().voices,[]);assert(!interaction.read().initialized);
  assert.equal(interaction.read().pitch,2,'a raw VGM power-off does not move the user’s software Pitch wheel');
  count=writes.length;assert.throws(()=>interaction.noteOn('powered-off',60),/power on/);assert.equal(writes.length,count);
  write(engine,22,128);assert(interaction.read().initialized);assert.equal(interaction.read().voice[2],0,'no default envelope was invented at power-on');
});

test('source replacement releases only manual gates while parameter-only VGM writes keep their current owner',async t=>{
  const {engine,interaction,writes,timeline}=await fixture(t);boot(engine);write(engine,0,0);
  interaction.noteOn('manual',60,{channel:0});write(engine,3,0x91);assert.equal(interaction.read().voices[0].id,'manual','a period update is not a new VGM trigger');
  interaction.setPitch(2);const previous=createDefaultPreset(),next={...previous,source:'noise'},frames=timeline.generatedFrames,count=writes.length;
  const changed=interaction.applyPreset(next,{previous,replace:false});
  assert.deepEqual(changed.voices,[]);assert.equal(changed.pitch,0);assert(changed.edits.every(edit=>!Object.keys(edit.changes).length));
  assert.deepEqual(writes.slice(count),[[2,0]],'source switching releases the manual CH1 but does not shut down the VGM’s other three voices');
  assert.equal(timeline.generatedFrames,frames);assert(engine.processFrames(2048).left.some(value=>Math.abs(value)>.001));
});

test('manual round robin, fixed channel stealing, hardware Sweep and Noise clock follow the real four physical roles',async t=>{
  const {engine,interaction,writes}=await fixture(t);boot(engine);write(engine,0,0);
  assert.equal(interaction.noteOn('one',60).channel,0);assert.equal(interaction.noteOn('two',64).channel,1);
  const stolen=interaction.noteOn('three',67);assert.equal(stolen.channel,0);assert.equal(stolen.stolenId,'one');let count=writes.length;
  assert(!interaction.noteOff('one'));assert.equal(writes.length,count);interaction.releaseKeyboard();
  write(engine,0,0x41);assert.equal(interaction.noteOn('sweep-one',60).channel,0);assert.equal(interaction.noteOn('sweep-two',64).channel,0);
  assert.equal(interaction.noteOn('fixed-two',64,{channel:1}).channel,1);assert.equal(interaction.read().voice[0],0x41);interaction.releaseKeyboard();
  assert.equal(interaction.noteOn('wave',48,{source:'wave'}).channel,2);interaction.noteOff('wave');
  const clock=interaction.read().voice[18];assert.equal(interaction.noteOn('noise-low',0,{source:'noise'}).channel,3);interaction.noteOff('noise-low');interaction.noteOn('noise-high',127,{channel:3});
  count=writes.length;interaction.setPitch(24);assert.equal(writes.length,count);assert.equal(interaction.read().voice[18],clock);
  interaction.releaseKeyboard();write(engine,0,0);interaction.noteOn('range',36,{channel:0});const before=interaction.read();count=writes.length;
  assert.throws(()=>interaction.setPitch(-24),/frequency range/);assert.throws(()=>interaction.noteOn('too-low',0,{channel:0}),/frequency range/);
  assert.equal(writes.length,count);assert.deepEqual(interaction.read(),before);
});

test('Sweep Off preserves untouched NR10 direction and other bits, never retriggers, and avoids native negate-clear muting',async t=>{
  const a=await fixture(t),b=await fixture(t),counterexample=await fixture(t);
  for(const {engine,interaction}of [a,b,counterexample]){
    boot(engine);
    for(const channel of [1,2,3])engine.setChannelMuted(channel,true);
    // Downward Sweep with a nonzero shift makes the native negate-used latch
    // true at the fresh trigger. Bit7 is deliberately retained as an untouched
    // raw bit as well; Off changes only pace/shift (mask 0x77).
    write(engine,0,0x99);interaction.noteOn('held',60,{channel:0});engine.processFrames(512);
  }
  const before=a.interaction.read(),count=a.writes.length,frames=a.timeline.generatedFrames;
  a.interaction.applyEdit({channel:0,changes:{'pulse.sweep.enabled':false}});
  write(b.engine,0,0x88);write(counterexample.engine,0,0x80);
  const after=a.interaction.read();assert.deepEqual(a.writes.slice(count),[[0,0x88]]);
  assert.equal(a.timeline.generatedFrames,frames);assert.deepEqual(after.voices,before.voices);
  for(let register=1;register<48;register++){
    assert.equal(after.registers[register],before.registers[register]);assert.equal(after.voice[register],before.voice[register]);
  }
  assert.deepEqual(after,b.interaction.read(),'matches an independent raw write that preserves the direction bit');
  const actual=a.engine.processFrames(4096),expected=b.engine.processFrames(4096),muted=counterexample.engine.processFrames(4096);
  finite(actual);assert.deepEqual(actual,expected,'no extra key edge or native envelope/oscillator restart');
  const rms=values=>Math.sqrt(values.slice(1024).reduce((sum,value)=>sum+value*value,0)/(values.length-1024));
  assert(rms(actual.left)>.001,'the original held Sweep voice remains audible numerically');
  assert(rms(muted.left)<rms(actual.left)*.05,'clearing the untouched negate bit is a real native channel-disable counterexample');
});

test('Wave RAM edits stop only Wave; common preset edits broadcast only changed fields and full replacement never invents a trigger',async t=>{
  const {engine,interaction,writes}=await fixture(t);boot(engine);write(engine,0,0);
  interaction.noteOn('pulse',60,{channel:0});interaction.noteOn('wave',60,{channel:2});interaction.noteOn('noise',60,{channel:3});
  let count=writes.length;interaction.applyEdit({channel:2,changes:{'wave.samples':waveShape('square'),'wave.level':1}});
  assert.deepEqual(interaction.read().voices.map(voice=>voice.id),['pulse','noise']);assert(!interaction.noteOff('wave'));
  assert(auditRegisters(writes.slice(count)).every(register=>register===10||register===12||register>=32),'Wave edit cannot release Pulse or Noise');
  const previous=createDefaultPreset(),next=structuredClone(previous);next.pulse.volume=7;
  const before=interaction.read();count=writes.length;const common=interaction.applyPreset(next,{previous,replace:false});
  assert.deepEqual(auditRegisters(writes.slice(count)),[2,7]);for(const register of [1,3,4,6,8,9,10,12,13,14,17,18,19,21])assert.equal(interaction.read().registers[register],before.registers[register]);
  assert.deepEqual(common.edits,[{channel:0,changes:{'pulse.volume':7}},{channel:1,changes:{'pulse.volume':7}},{channel:2,changes:{}},{channel:3,changes:{}}]);
  assert.deepEqual(interaction.read().voices.map(voice=>voice.id),['pulse','noise']);
  interaction.setPitch(2);count=writes.length;const replaced=interaction.applyPreset(next,{replace:true});assert(!writes.slice(count).some(([register,value])=>[4,9,14,19].includes(register)&&(value&128)),'preset edits never trigger a new note');
  assert.deepEqual(replaced.voices,[]);assert.equal(replaced.pitch,0);assert.equal(replaced.edits.length,4);assert(Object.hasOwn(replaced.edits[3].changes,'noise.width'));
  assert.equal(interaction.read().voice[2]>>4,7);assert.equal(interaction.read().voice[7]>>4,7);
  interaction.noteOn('validation-owner',60,{channel:1});const original=interaction.read(),n=writes.length;
  assert.throws(()=>interaction.applyPreset({...next,wave:{...next.wave,samples:Array(31).fill(0)}}));assert.equal(writes.length,n);assert.deepEqual(interaction.read(),original);
});

function auditRegisters(writes){return writes.map(([register])=>register);}

test('engine reset clears generation-head settings and manual identities without defaults; detached reads cannot mutate the live APU',async t=>{
  const {engine,interaction,timeline,writes}=await fixture(t);boot(engine);interaction.noteOn('held',60);interaction.setPitch(2);engine.processFrames(2048);
  const copy=interaction.read();copy.voice[1]=255;copy.registers[21]=0;copy.voices.length=0;assert.equal(interaction.read().voices.length,1);
  const count=writes.length;engine.reset();assert.equal(writes.length,count);assert.equal(timeline.generatedFrames,0);assert.equal(timeline.pendingEvents,0);
  const reset=interaction.read();assert.deepEqual(reset.voices,[]);assert.equal(reset.pitch,0);assert(!reset.initialized);assert(reset.registers.every(value=>value===0));
  assert(!interaction.noteOff('held'));assert.throws(()=>interaction.applyEdit({channel:1,changes:{'pulse.duty':.25}}),/power on/);assert.equal(writes.length,count);
  interaction.dispose();assert.equal(writes.length,count);assert.throws(()=>interaction.setPitch(0),{name:'AbortError'});
});
