// SPDX-License-Identifier: BSD-3-Clause
// Independent integration: actual editor APU + actual reference-song APU.
// Output fades are immediate injected guards; all DSP and checkpoints are real.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/gameboy_apu_wasm.js';
import {GameboyApu} from '../js/gameboyapu.js';
import {GameboyApuAudioEngine} from '../js/gameboyapuaudioengine.js';
import {VgmPlayer} from '../js/vgmplayer.js';
import {GameboyInstrument} from './instrument.js';
import {createGameboyCodeClient} from './code_endpoint.js';
import {createGameboySongAudition} from './song_audition.js';
import {createGameboySongTimeline} from './song_state.js';
import {prepareGameboySongVoice} from './song_voice.js';
import {createDmgSongFixture,DMG_SONG_FUTURE_WAVE} from '../../test/helpers/dmg_synth_song_fixture.mjs';

const wasmBinary=await readFile(new URL('../generated/gameboy_apu_wasm.wasm',import.meta.url));
const options={moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:44100};
const pcm=frames=>({left:new Float32Array(frames),right:new Float32Array(frames)});
const audible=value=>{assert(value.left.every(Number.isFinite)&&value.right.every(Number.isFinite));assert(value.left.some(sample=>Math.abs(sample)>.0001));};
async function editor(t){
  const core=await GameboyApu.create(options),writes=[],write=core.writeRegister.bind(core);
  core.writeRegister=(...args)=>{writes.push(args);return write(...args);};
  const instrument=new GameboyInstrument(core);t.after(()=>instrument.dispose());
  let generation=0,owner=null;
  const clients=[],engine={context:{currentTime:0},codeFadeNode:{},
    async getGameboyClient(){
      const mark=owner={generation:++generation,neutral:false},metadata=instrument.beginCode();
      const client=createGameboyCodeClient({metadata,isCurrent:()=>owner===mark&&!mark.neutral,ownsOutput:()=>owner===mark,
        invoke:async(method,args)=>instrument.code(metadata.session,method,args),
        dispose:async()=>{if(owner!==mark)throw new DOMException('Retired editor owner','AbortError');const result=instrument.code(metadata.session,'dispose',[]);mark.neutral=true;return result;}});
      clients.push(client);return client;
    }};
  return {core,instrument,writes,engine,clients};
}
async function song(t,bytes){
  const engine=await GameboyApuAudioEngine.create({...options,outputSampleRate:44100,masterVolume:1}),writes=[],write=engine.writeGameboyApu;
  engine.writeGameboyApu=function(...args){writes.push(args);return write.apply(this,args);};
  const timeline=createGameboySongTimeline(engine),player=new VgmPlayer(engine);player.load(bytes);player.play();
  t.after(()=>{timeline.dispose();engine.dispose();});return{engine,timeline,player,writes};
}
function controller(host,getSelection){
  return createGameboySongAudition({ensureAudio:async()=>host.engine,getAudio:()=>host.engine,getSelection,
    createOutput:({getContext,getGain})=>({
      async fadeOut(){assert(getContext());assert(getGain());},
      open(){assert(getContext());assert(getGain());},dispose(){},
    })});
}

test('real four-channel paused trials preserve the song queue, original Wave RAM and exact resumed PCM',async t=>{
  const fixture=createDmgSongFixture(),original=fixture.bytes.slice(),a=await song(t,fixture.bytes),b=await song(t,fixture.bytes);
  const host=await editor(t),authorReference=await editor(t);
  // Start from the same opaque author phase, not just identical JSON.
  host.instrument.generateStereo(157);authorReference.instrument.generateStereo(157);
  const author=host.instrument.read(),prefix=pcm(44100),baseline=pcm(44100);
  a.player.process(prefix.left,prefix.right,44100);b.player.process(baseline.left,baseline.right,44100);assert.deepEqual(prefix,baseline);
  a.player.pause();b.player.pause();const snapshot=a.timeline.read(44100),songWrites=a.writes.length,nativeFrames=a.timeline.generatedFrames;
  let selected=null;const trial=controller(host,()=>selected);t.after(()=>trial.dispose());
  for(let channel=0;channel<4;channel++){
    selected={key:`original:44100:${channel}`,snapshot,channel};
    const prepared=prepareGameboySongVoice(snapshot,channel);assert(prepared.playable);
    const beforeWrites=host.writes.length;
    assert.deepEqual(await trial.noteOn(`trial-${channel}`,64),{channel,stolenId:null});
    const observed=host.instrument.observeCode();assert(observed);
    assert.equal(observed.registers[21]&((1<<channel)|(16<<channel)),(1<<channel)|(16<<channel));
    assert.deepEqual(host.writes.slice(beforeWrites).filter(([register,value])=>[4,9,14,19].includes(register)&&(value&128)).map(([register])=>register),
      [channel*5+4],'exactly the selected physical channel receives a trigger');
    if(channel===2)assert.deepEqual(prepared.preset.wave.samples,DMG_SONG_FUTURE_WAVE);
    if(channel<3){
      const period=Math.round(2048-4194304/((channel===2?64:32)*(440*2**((64-69)/12))));
      assert.equal(observed.registers[channel*5+3]|((observed.registers[channel*5+4]&7)<<8),period);
    }else{assert.equal(observed.voice[18],0x1b);assert.equal(trial.read().pitch,0);}
    audible(host.instrument.generateStereo(2048));
    assert.deepEqual(host.instrument.read(),author,'public author state stays behind the temporary checkpoint');
    assert.equal(a.writes.length,songWrites);assert.equal(a.timeline.generatedFrames,nativeFrames);
    assert.deepEqual(a.timeline.read(44100),snapshot);
    await trial.noteOff(`trial-${channel}`);assert.equal(trial.read().soundingCount,0);
    const released=host.instrument.generateStereo(2048);
    assert(released.left.every(Number.isFinite));
    assert(released.left.slice(-256).every(value=>Math.abs(value)<1e-6),`native release tail settles for CH${channel+1}`);
    await trial.stop();assert.equal(host.instrument.observeCode(),null);assert.deepEqual(host.instrument.read(),author);
    assert.throws(()=>host.clients.at(-1).wave.noteOn('C4'),{name:'AbortError'},'retired trial clients cannot modify a later author');
  }
  assert.deepEqual(fixture.bytes,original);assert.equal(a.writes.length,songWrites);
  // An ordinary subsequent author note also matches a never-borrowed APU.
  host.instrument.noteOn('author',64);authorReference.instrument.noteOn('author',64);
  assert.deepEqual(host.instrument.generateStereo(2048),authorReference.instrument.generateStereo(2048));
  host.instrument.stop();authorReference.instrument.stop();
  a.player.resume();b.player.resume();const resumed=pcm(12000),expected=pcm(12000);
  a.player.process(resumed.left,resumed.right,12000);b.player.process(expected.left,expected.right,12000);
  assert.deepEqual(resumed,expected,'trial and Capture preparation never advance or rebuild the retained song PCM');
});

test('Noise ignores keyboard pitch and only physical CH1 receives the configured Sweep',async t=>{
  const fixture=createDmgSongFixture(),source=await song(t,fixture.bytes),host=await editor(t),prefix=pcm(22050);
  source.player.process(prefix.left,prefix.right,22050);source.player.pause();
  const snapshot=structuredClone(source.timeline.read(22050));snapshot.voice[0]=snapshot.registers[0]=0x19;
  let selected={key:'sweep:0',snapshot,channel:0};const trial=controller(host,()=>selected);t.after(()=>trial.dispose());
  await trial.noteOn('one',60);assert.equal(host.instrument.observeCode().voice[0],0x19);audible(host.instrument.generateStereo(1024));await trial.stop();
  selected={key:'sweep:1',snapshot,channel:1};await trial.noteOn('two',60);assert.equal(host.instrument.observeCode().voice[0]&0x77,0);audible(host.instrument.generateStereo(1024));await trial.stop();
  selected={key:'noise:3',snapshot,channel:3};
  let pitchedRegisters=null;
  for(const [id,midi,pitch]of [['low',0,-24],['high',127,24]]){
    await trial.setPitch(pitch);await trial.noteOn(id,midi);const state=host.instrument.observeCode();
    assert.equal(state.voice[18],0x43);assert.equal(trial.read().pitch,0);
    const periods=[3,4,8,9,13,14].map(index=>state.registers[index]);
    if(pitchedRegisters)assert.deepEqual(periods,pitchedRegisters,'Noise keys do not write any pitched channel period');
    else pitchedRegisters=periods;
    audible(host.instrument.generateStereo(1024));await trial.noteOff(id);
  }
  await trial.stop();assert.equal(host.instrument.observeCode(),null);
});
