// SPDX-License-Identifier: BSD-3-Clause
// Independent numerical integration. All APU synthesis is real WASM; the
// AudioContext below only records scheduled buffers and never opens a device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/gameboy_apu_wasm.js';
import {GameboyApu} from '../js/gameboyapu.js';
import {GameboyApuAudioEngine} from '../js/gameboyapuaudioengine.js';
import {GameboySynth} from '../js/gameboysynth.js';
import {VgmPlayer} from '../js/vgmplayer.js';
import {GameboyInstrument} from './instrument.js';
import {createGameboySongPreview} from './song_preview.js';
import {createDmgSongFixture,DMG_SONG_FUTURE_FRAME,DMG_SONG_RELEASE_FRAME,
  DMG_SONG_END_FRAME,DMG_SONG_INITIAL_WAVE,DMG_SONG_FUTURE_WAVE} from '../../test/helpers/dmg_synth_song_fixture.mjs';

const RATE=44100,wasmBinary=await readFile(new URL('../generated/gameboy_apu_wasm.wasm',import.meta.url));
const nativeOptions={moduleFactory:factory,moduleOptions:{wasmBinary},outputSampleRate:RATE,masterVolume:1};
const stereo=frames=>({left:new Float32Array(frames),right:new Float32Array(frames)});
const packed=wave=>Array.from({length:16},(_,i)=>(wave[i*2]<<4)|wave[i*2+1]);

function fixture(){
  const source=createDmgSongFixture();
  // Make history observable: slow CH1 Sweep, changing hardware envelopes and
  // a running Noise LFSR. Replaying visible registers alone cannot recreate it.
  const initial=source.events[0].writes;
  const patches=new Map([[0,0x7b],[2,0xa2],[7,0x83],[17,0x59]]);
  for(let i=0;i<initial.length;i+=3)if(patches.has(initial[i+1]))initial[i+2]=patches.get(initial[i+1]);
  source.bytes.set(initial,256);
  return source;
}
function hostFixture(){
  const starts=[],timers=new Map(),gains=[];let id=0;
  const context={state:'running',sampleRate:48000,currentTime:0,resumes:0,closes:0,
    async resume(){this.resumes++;},async close(){this.closes++;this.state='closed';},
    createGain(){
      const gain={context,connections:[],disconnected:false,
        gain:{value:1,cancelScheduledValues(){},setValueAtTime(value){this.value=value;},linearRampToValueAtTime(value){this.value=value;}},
        connect(value){this.connections.push(value);},disconnect(){this.disconnected=true;this.connections=[];}};
      gains.push(gain);return gain;
    },
    createBuffer(channels,length,sampleRate){const data=Array.from({length:channels},()=>new Float32Array(length));return{
      length,sampleRate,copyToChannel(values,ch){data[ch].set(values);},getChannelData(ch){return data[ch];}};},
    createBufferSource(){return{buffer:null,stopped:false,onended:null,
      connect(value){this.output=value;},disconnect(){this.disconnected=true;},
      start(at,offset=0){this.at=at;this.offset=offset;starts.push(this);},stop(){this.stopped=true;}};},
  };
  const host={context,songInputNode:{context,gain:{value:.28}},
    command(){throw Error('Reference seeking cannot command the author APU');},
    getGameboyClient(){throw Error('Reference seeking cannot borrow the author APU');}};
  return{host,context,starts,timers,gains,
    schedule(fn,ms){const token=++id;timers.set(token,{fn,at:context.currentTime+ms/1000});return token;},cancel(token){timers.delete(token);},
    advance(seconds){
      const end=context.currentTime+seconds;let callbacks=0;
      for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;
        assert(++callbacks<10000);timers.delete(next[0]);context.currentTime=next[1].at;next[1].fn();}
      context.currentTime=end;
    },
  };
}
async function baseline(t,bytes){
  const engine=await GameboyApuAudioEngine.create(nativeOptions);t.after(()=>engine.dispose());
  const player=new VgmPlayer(engine);player.setPrefetchFactor(1);player.setLoopEnabled(false);player.load(bytes);player.reset();player.play();
  const pcm=stereo(DMG_SONG_END_FRAME);
  assert.equal(player.process(pcm.left,pcm.right,DMG_SONG_END_FRAME),DMG_SONG_END_FRAME);
  assert(pcm.left.every(Number.isFinite)&&pcm.right.every(Number.isFinite));
  assert(pcm.left.some(sample=>Math.abs(sample)>.0001));
  return pcm;
}
function expectedRegisters(source,frame){
  const synth=new GameboySynth({transport:{writeRegister(){},reset(){}}});
  try{
    for(const event of source.events){if(event.frame>frame)break;for(let i=0;i<event.writes.length;i+=3)synth.writeRegister(event.writes[i+1],event.writes[i+2]);}
    return synth._getState();
  }finally{synth.dispose();}
}
async function previewFixture(t,extra={}){
  const f=hostFixture(),records=[],states=[];
  const preview=createGameboySongPreview({getAudio:()=>f.host,beforePlay:async()=>{},onState:state=>states.push(state),
    schedule:f.schedule,cancel:f.cancel,
    createEngine:async()=>{
      const engine=await GameboyApuAudioEngine.create(nativeOptions),record={disposed:0,writes:0};records.push(record);
      const dispose=engine.dispose.bind(engine),write=engine.writeGameboyApu.bind(engine);
      engine.dispose=()=>{record.disposed++;return dispose();};
      engine.writeGameboyApu=(...args)=>{record.writes++;return write(...args);};
      return engine;
    },...extra});
  t.after(()=>preview.dispose());return{...f,preview,records,states};
}
function available(f,mark){return f.starts.slice(mark).reduce((sum,node)=>sum+node.buffer.length-Math.round(node.offset*node.buffer.sampleRate),0);}
function scheduled(f,mark,frames){
  for(let i=0;available(f,mark)<frames&&i<20;i++)f.advance(.05);
  assert(available(f,mark)>=frames,'the seek commit must retain sufficient unconsumed PCM');
  const result=stereo(frames);let written=0;
  for(const node of f.starts.slice(mark)){
    assert.equal(node.buffer.sampleRate,RATE,'native VGM frame rate remains independent of the device rate');
    const offset=Math.round(node.offset*RATE),count=Math.min(frames-written,node.buffer.length-offset);
    if(count<=0)continue;
    result.left.set(node.buffer.getChannelData(0).subarray(offset,offset+count),written);
    result.right.set(node.buffer.getChannelData(1).subarray(offset,offset+count),written);written+=count;
    if(written===frames)break;
  }
  return result;
}
function matches(pcm,linear,target,frames){
  assert.deepEqual(pcm.left,linear.left.subarray(target,target+frames));
  assert.deepEqual(pcm.right,linear.right.subarray(target,target+frames));
}

test('stopped seeks remain paused and exact-boundary Live/PCM match linear real APU playback in both directions',async t=>{
  const source=fixture(),linear=await baseline(t,source.bytes),f=await previewFixture(t);
  await f.preview.load(source.bytes,'independent-seek.vgm');
  const targets=[DMG_SONG_FUTURE_FRAME-1,DMG_SONG_FUTURE_FRAME,8820,DMG_SONG_RELEASE_FRAME,0];
  f.preview.setLiveEnabled(false);
  for(const requested of targets){
    const count=f.starts.length;assert.equal(await f.preview.seek(requested/RATE),true);
    const state=f.preview.read(),target=state.positionFrames;
    assert.equal(target,requested);assert.equal(state.playback,'paused');assert.equal(state.seeking,false);
    assert.equal(state.liveEnabled,false);assert.equal(state.liveState.positionFrames,target);
    assert.equal(f.starts.length,count,'a seek from Stop/Pause must schedule no audible sources');
    const expected=expectedRegisters(source,target);
    assert.deepEqual(state.liveState.registers,expected.registers);assert.deepEqual(state.liveState.voice,expected.voice);
    assert.deepEqual(state.liveState.registers.slice(32),packed(target>=DMG_SONG_FUTURE_FRAME?DMG_SONG_FUTURE_WAVE:DMG_SONG_INITIAL_WAVE));
    const writes=f.records.reduce((sum,record)=>sum+record.writes,0);
    for(let ch=0;ch<4;ch++){f.preview.setLiveVoice(ch);assert.equal(f.preview.read().liveState.positionFrames,target);}
    assert.equal(f.records.reduce((sum,record)=>sum+record.writes,0),writes,'CH selection is a passive view');
    const mark=f.starts.length;assert.equal(await f.preview.resume(),true);
    const frames=Math.min(8192,DMG_SONG_END_FRAME-target);matches(scheduled(f,mark,frames),linear,target,frames);
    f.preview.pause();
  }
  assert.equal(f.context.closes,0);assert(f.records.slice(0,-1).every(record=>record.disposed===1));
});

test('forward/backward seeks preserve Playing versus Pause and subsequent Resume consumes the exact target prefix',async t=>{
  const source=fixture(),linear=await baseline(t,source.bytes),f=await previewFixture(t);
  await f.preview.load(source.bytes);await f.preview.play();f.advance(.15);
  const oldActive=f.starts.filter(node=>node.at+node.buffer.length/RATE>f.context.currentTime);
  let mark=f.starts.length;assert.equal(await f.preview.seek(1),true);
  let state=f.preview.read();assert.equal(state.playback,'playing');assert.equal(state.positionFrames,RATE);
  assert(oldActive.every(node=>node.stopped&&node.disconnected),'old scheduled playback is retired before the replacement becomes audible');
  matches(scheduled(f,mark,12000),linear,state.positionFrames,12000);
  f.preview.pause();const frozen=f.preview.read().liveState;f.advance(5);assert.deepEqual(f.preview.read().liveState,frozen);
  mark=f.starts.length;assert.equal(await f.preview.seek(.2),true);state=f.preview.read();assert.equal(state.playback,'paused');assert.equal(state.positionFrames,8820);
  assert.equal(f.starts.length,mark);await f.preview.resume();matches(scheduled(f,mark,12000),linear,state.positionFrames,12000);
  mark=f.starts.length;assert.equal(await f.preview.seek(.07),true);state=f.preview.read();assert.equal(state.playback,'playing');
  matches(scheduled(f,mark,8192),linear,state.positionFrames,8192);
});

test('seeking reconstructs native Envelope/Sweep/LFSR history rather than merely replaying visible registers',async t=>{
  const source=fixture(),linear=await baseline(t,source.bytes),f=await previewFixture(t),target=8820,frames=8192;
  await f.preview.load(source.bytes);await f.preview.seek(target/RATE);const state=f.preview.read();
  assert.equal(state.liveState.voice[0],0x7b);assert.equal(state.liveState.voice[2],0xa2);assert.equal(state.liveState.voice[17],0x59);
  const naive=await GameboyApuAudioEngine.create(nativeOptions);t.after(()=>naive.dispose());naive.reset();
  for(const event of source.events){if(event.frame>target)break;for(let i=0;i<event.writes.length;i+=3)naive.writeGameboyApu(event.writes[i+1],event.writes[i+2]);}
  assert.notDeepEqual(naive.processFrames(frames).left,linear.left.subarray(target,target+frames),
    'register replay without elapsed chip clocks is a concrete counterexample');
  const mark=f.starts.length;await f.preview.resume();matches(scheduled(f,mark,frames),linear,target,frames);
});

test('reference seeks never command, reset, write, borrow or advance the separate editable author APU',async t=>{
  async function author(){
    const core=await GameboyApu.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:48000}),instrument=new GameboyInstrument(core);
    t.after(()=>instrument.dispose());const preset=instrument.read().preset;preset.source='wave';preset.wave.samples=Array.from({length:32},(_,i)=>i%2?2:13);instrument.loadPreset(preset);
    instrument.noteOn('held-author',64);instrument.generateStereo(157);return{core,instrument};
  }
  const a=await author(),untouched=await author(),before=a.instrument.read(),writes=[];
  const write=a.core.writeRegister.bind(a.core);a.core.writeRegister=(...args)=>{writes.push(args);return write(...args);};
  const f=await previewFixture(t);await f.preview.load(fixture().bytes);
  for(const seconds of [.2,1,.9,.05])assert.equal(await f.preview.seek(seconds),true);
  assert.deepEqual(writes,[]);assert.deepEqual(a.instrument.read(),before);
  assert.deepEqual(a.instrument.generateStereo(2048),untouched.instrument.generateStereo(2048),
    'even the author oscillator/filter phase is unchanged, not just its JSON');
  assert.equal(f.context.closes,0);
});
