// SPDX-License-Identifier: BSD-3-Clause
// Independent actual-APU tests. This host only records PCM buffers; no browser,
// AudioContext, output device or author-Code lease is created by the tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/gameboy_apu_wasm.js';
import {GameboyApu} from '../js/gameboyapu.js';
import {GameboyApuAudioEngine} from '../js/gameboyapuaudioengine.js';
import {VgmPlayer} from '../js/vgmplayer.js';
import {GameboyInstrument} from './instrument.js';
import {createGameboySongPreview} from './song_preview.js';
import {createGameboySongTimeline} from './song_state.js';
import {createDmgSongFixture,DMG_SONG_FUTURE_FRAME} from '../../test/helpers/dmg_synth_song_fixture.mjs';

const RATE=44100,FRAMES=16000;
const wasmBinary=await readFile(new URL('../generated/gameboy_apu_wasm.wasm',import.meta.url));
const module=await factory({wasmBinary});
const nativeOptions={moduleFactory:async()=>module,outputSampleRate:RATE,masterVolume:1};
const stereo=frames=>({left:new Float32Array(frames),right:new Float32Array(frames)});
function fixture(){
  const source=createDmgSongFixture(),initial=source.events[0].writes,patches=new Map([[0,0x7b],[2,0xa2],[7,0x83],[17,0x59]]);
  // Slow Sweep, changing hardware envelopes and a running Noise LFSR make
  // continued synthesis distinguishable from reinitializing visible settings.
  for(let i=0;i<initial.length;i+=3)if(patches.has(initial[i+1]))initial[i+2]=patches.get(initial[i+1]);
  source.bytes.set(initial,256);return source;
}
const setMask=(preview,enabled)=>{for(let ch=0;ch<4;ch++)preview.setChannelEnabled(ch,Boolean(enabled&(1<<ch)));};
const setNativeMask=(engine,enabled)=>{for(let ch=0;ch<4;ch++)engine.setChannelMuted(ch,!(enabled&(1<<ch)));};
function identical(actual,expected,message){
  assert.equal(actual.length,expected.length,message);
  const different=actual.findIndex((value,i)=>!Object.is(value,expected[i]));
  assert.equal(different,-1,`${message}; first mismatch=${different}${different<0?'':`, actual=${actual[different]}, expected=${expected[different]}`}`);
}
function matchPcm(actual,expected,message){for(const side of ['left','right'])identical(actual[side],expected[side],`${message} ${side}`);}
function playerFor(engine,bytes){
  const timeline=createGameboySongTimeline(engine),player=new VgmPlayer(engine);
  player.setPrefetchFactor(1);player.setLoopEnabled(false);player.load(bytes,{logger:null});player.reset();player.play();
  return{timeline,player};
}
function render(player,frames){const pcm=stereo(frames);assert.equal(player.process(pcm.left,pcm.right,frames),frames);return pcm;}
function rawProgram(engine,events){
  let position=0,index=0;
  return frames=>{
    const pcm=stereo(frames),end=position+frames;let written=0;
    const advance=next=>{
      if(next===position)return;
      const values=engine.processFrames(next-position);
      for(const side of ['left','right'])pcm[side].set(values[side],written);
      written+=next-position;position=next;
    };
    while(index<events.length&&events[index].frame<=end){
      const event=events[index++];advance(event.frame);
      for(let i=0;i<event.writes.length;i+=3)engine.writeGameboyApu(event.writes[i+1],event.writes[i+2]);
    }
    advance(end);return pcm;
  };
}
async function linear(bytes,frames,enabled=15){
  const engine=await GameboyApuAudioEngine.create(nativeOptions),{timeline,player}=playerFor(engine,bytes);
  try{setNativeMask(engine,enabled);return render(player,frames);}finally{timeline.dispose();engine.dispose();}
}
function hostFixture(){
  const starts=[],timers=new Map();let timerId=0;
  const context={state:'running',sampleRate:48000,currentTime:0,closes:0,
    async resume(){},async close(){this.closes++;this.state='closed';},
    createGain(){return{context,gain:{value:1},connect(value){this.output=value;},disconnect(){this.disconnected=true;}};},
    createBuffer(channels,length,sampleRate){const data=Array.from({length:channels},()=>new Float32Array(length));return{
      length,sampleRate,copyToChannel(values,ch){data[ch].set(values);},getChannelData(ch){return data[ch];}};},
    createBufferSource(){return{stopped:false,disconnected:false,connect(value){this.output=value;},disconnect(){this.disconnected=true;},
      start(at,offset=0){this.at=at;this.offset=offset;starts.push(this);},stop(){this.stopped=true;}};},
  };
  const host={context,songInputNode:{context,gain:{value:.28}},
    command(){assert.fail('Reference channel flags cannot command the author APU');},
    getGameboyClient(){assert.fail('Reference channel flags cannot acquire an author/Code lease');}};
  return{host,context,starts,timers,schedule(fn,ms){const id=++timerId;timers.set(id,{fn,at:context.currentTime+ms/1000});return id;},cancel(id){timers.delete(id);},
    advance(seconds){const end=context.currentTime+seconds;let callbacks=0;
      for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;
        assert(++callbacks<10000);timers.delete(next[0]);context.currentTime=next[1].at;next[1].fn();}context.currentTime=end;}};
}
async function previewFixture(t,extra={}){
  const f=hostFixture(),records=[];let audioRequests=0;
  const preview=createGameboySongPreview({getAudio:()=>{audioRequests++;return f.host;},beforePlay:async()=>{},
    schedule:f.schedule,cancel:f.cancel,nowMs:()=>0,yieldTask:async()=>{},
    createEngine:async()=>{
      const engine=await GameboyApuAudioEngine.create(nativeOptions),record={engine,frames:0,writes:[],disposed:0};records.push(record);
      const process=engine.processFrames.bind(engine),reset=engine.reset.bind(engine),write=engine.writeGameboyApu.bind(engine),dispose=engine.dispose.bind(engine);
      engine.processFrames=frames=>{const pcm=process(frames);record.frames+=frames;return pcm;};
      engine.reset=()=>{record.frames=0;return reset();};engine.writeGameboyApu=(...args)=>{record.writes.push(args);return write(...args);};
      engine.dispose=()=>{record.disposed++;return dispose();};return engine;
    },...extra});
  t.after(()=>preview.dispose());return{...f,preview,records,get audioRequests(){return audioRequests;}};
}
function scheduledPrefix(f,mark,frames){
  const size=()=>f.starts.slice(mark).reduce((sum,node)=>sum+node.buffer.length-Math.round(node.offset*RATE),0);
  for(let i=0;size()<frames&&i<20;i++)f.advance(.05);
  assert(size()>=frames);const pcm=stereo(frames);let written=0;
  for(const node of f.starts.slice(mark)){
    assert.equal(node.buffer.sampleRate,RATE);const offset=Math.round(node.offset*RATE),count=Math.min(frames-written,node.buffer.length-offset);
    for(const [side,ch]of [['left',0],['right',1]])pcm[side].set(node.buffer.getChannelData(ch).subarray(offset,offset+count),written);
    written+=count;if(written===frames)break;
  }
  return pcm;
}

test('all 16 reference output masks equal the independently rendered sum of their physical channels; all Off is exact silence',async t=>{
  const source=fixture(),solos=[];
  for(let ch=0;ch<4;ch++)solos.push(await linear(source.bytes,8192,1<<ch));
  let originalSnapshot;
  for(let enabled=0;enabled<16;enabled++){
    const f=await previewFixture(t);assert.deepEqual(f.preview.read().channelEnabled,[true,true,true,true]);
    setMask(f.preview,enabled);assert.equal(f.audioRequests,0);assert.equal(f.records.length,0,'setting flags before a file is passive');
    await f.preview.load(source.bytes);assert(await f.preview.play());
    const actual=scheduledPrefix(f,0,8192),independent=await linear(source.bytes,8192,enabled);
    matchPcm(actual,independent,`reference mask ${enabled} matches the real engine output exactly`);
    for(const side of ['left','right'])for(let i=0;i<8192;i++){
      let sum=0,absoluteSum=0;for(let ch=0;ch<4;ch++)if(enabled&(1<<ch)){sum+=solos[ch][side][i];absoluteSum+=Math.abs(solos[ch][side][i]);}
      // Solo outputs and the final combined mix are individually rounded to
      // Float32. Bound that rounding by their absolute sum, not a loose RMS.
      assert(Math.abs(actual[side][i]-sum)<=2**-22*absoluteSum+Number.EPSILON,`mask=${enabled}, ${side}, frame=${i}`);
      if(!enabled)assert.equal(actual[side][i],0);
    }
    const snapshot=f.preview.read().liveState;
    if(!originalSnapshot)originalSnapshot=snapshot;else assert.deepEqual(snapshot,originalSnapshot,'output flags do not rewrite source registers or Live');
    assert.deepEqual(f.preview.read().channelEnabled,Array.from({length:4},(_,ch)=>Boolean(enabled&(1<<ch))));
    f.preview.dispose();assert.equal(f.context.closes,0);
  }
});

test('muted voices continue Envelope, Sweep, oscillator and Noise history; unmuting matches uninterrupted native PCM exactly',async()=>{
  const source=fixture(),target=60000,frames=8192;
  const expected=await linear(source.bytes,target+frames);
  const engine=await GameboyApuAudioEngine.create(nativeOptions),timeline=createGameboySongTimeline(engine),program=rawProgram(engine,source.events);
  try{
    program(4096);const before=timeline.read(4096);
    const write=engine.writeGameboyApu;let writes=0;engine.writeGameboyApu=function(...args){writes++;return write.apply(this,args);};
    setNativeMask(engine,0);assert.equal(writes,0,'output flags send no trigger, DAC, envelope, routing or pitch register writes');
    const muted=program(target-4096);assert(muted.left.every(value=>value===0));assert(muted.right.every(value=>value===0));
    const at=timeline.read(target);assert.notDeepEqual(at.voice,before.voice,'future song writes continue while output is muted');
    setNativeMask(engine,15);const continued=program(frames);
    matchPcm(continued,{left:expected.left.subarray(target),right:expected.right.subarray(target)},'unmuting keeps actual native history');
  }finally{timeline.dispose();engine.dispose();}
});

test('channel toggles preserve already queued PCM and source position; only the first subsequently generated native frame uses the new mask',async t=>{
  const source=fixture(),all=await linear(source.bytes,FRAMES),solo=await linear(source.bytes,FRAMES,1),f=await previewFixture(t);
  await f.preview.load(source.bytes);await f.preview.play();const record=f.records[0],before=f.preview.read(),oldNodes=f.starts.slice();
  const saved=oldNodes.map(node=>[node.buffer.getChannelData(0).slice(),node.buffer.getChannelData(1).slice()]);
  const firstBoundary=record.frames,writes=record.writes.length,count=f.starts.length;
  assert(firstBoundary>=before.renderedFrames);assert(firstBoundary-before.positionFrames<=.2*RATE+2048+256,'lookahead including the parser queue is bounded');
  setMask(f.preview,0);const off=f.preview.read();assert.equal(record.frames,firstBoundary);assert.equal(record.writes.length,writes);
  assert.equal(f.starts.length,count);assert.equal(off.positionFrames,before.positionFrames);assert.equal(off.renderedFrames,before.renderedFrames);
  assert.deepEqual(off.liveState,before.liveState);
  for(let i=0;i<oldNodes.length;i++){
    assert(!oldNodes[i].stopped&&!oldNodes[i].disconnected,'muting does not stop or reschedule an old source');
    identical(oldNodes[i].buffer.getChannelData(0),saved[i][0],'queued left PCM remains unchanged');
    identical(oldNodes[i].buffer.getChannelData(1),saved[i][1],'queued right PCM remains unchanged');
  }
  f.advance(.05);const secondBoundary=record.frames;assert(secondBoundary>firstBoundary);
  f.preview.setChannelEnabled(0,true);assert.equal(record.frames,secondBoundary);
  f.advance(.05);assert(record.frames>secondBoundary);
  for(const node of f.starts){
    const firstFrame=Math.round((node.at-.01)*RATE),offset=Math.round(node.offset*RATE);
    for(const [side,ch]of [['left',0],['right',1]]){
      const actual=node.buffer.getChannelData(ch);
      for(let i=offset;i<actual.length;i++){
        const frame=firstFrame+i-offset;
        const expected=frame<firstBoundary?all[side][frame]:frame<secondBoundary?0:solo[side][frame];
        assert.equal(actual[i],expected,`native mix boundary ${side} frame=${frame}`);
      }
    }
  }
});

test('paused seeks retain the latest channel flags and exact source snapshots even when the flags change during silent fast-forward',async t=>{
  const source=fixture(),target=DMG_SONG_FUTURE_FRAME,solo=await linear(source.bytes,target+8192,4);
  let release,entered;const gate=new Promise(resolve=>release=resolve),begun=new Promise(resolve=>entered=resolve);let waits=0;
  const f=await previewFixture(t,{yieldTask:async()=>{if(!waits++){entered();await gate;}}});
  setMask(f.preview,1);await f.preview.load(source.bytes,'first.vgm');f.preview.setLiveEnabled(false);
  const seeking=f.preview.seek(target/RATE);await begun;setMask(f.preview,4);release();assert(await seeking);
  const state=f.preview.read();assert(state.paused);assert.equal(state.positionFrames,target);assert.equal(f.starts.length,0);
  assert.deepEqual(state.channelEnabled,[false,false,true,false]);assert.equal(state.liveEnabled,false);
  assert.deepEqual(state.liveState.registers.slice(32),Array.from({length:16},()=>0xf0),'Wave RAM comes from the source, independent of its output flag');
  const mark=f.starts.length;await f.preview.resume();matchPcm(scheduledPrefix(f,mark,8192),{
    left:solo.left.subarray(target),right:solo.right.subarray(target)},'masked seek keeps elapsed source phase');
  f.preview.stop();assert.deepEqual(f.preview.read().channelEnabled,[false,false,true,false]);
  await f.preview.load(source.bytes,'second.vgm');assert.deepEqual(f.preview.read().channelEnabled,[false,false,true,false]);
  await f.preview.seek(.2);assert(f.preview.read().paused);assert.deepEqual(f.preview.read().channelEnabled,[false,false,true,false]);
  const copied=f.preview.read().channelEnabled;copied.fill(true);assert.deepEqual(f.preview.read().channelEnabled,[false,false,true,false]);
});

test('reference output masks never command, borrow, advance or silence the separate author APU',async t=>{
  async function author(){
    const core=await GameboyApu.create({moduleFactory:async()=>module,sampleRate:48000}),instrument=new GameboyInstrument(core);
    t.after(()=>instrument.dispose());const preset=instrument.read().preset;preset.source='wave';preset.wave.samples=Array.from({length:32},(_,i)=>i%2?1:14);instrument.loadPreset(preset);
    instrument.noteOn('author-held',65);instrument.generateStereo(157);return{core,instrument};
  }
  const a=await author(),untouched=await author(),before=a.instrument.read(),writes=[];
  const write=a.core.writeRegister.bind(a.core);a.core.writeRegister=(...args)=>{writes.push(args);return write(...args);};
  const f=await previewFixture(t);await f.preview.load(fixture().bytes);await f.preview.play();
  for(let enabled=0;enabled<16;enabled++){setMask(f.preview,enabled);f.advance(.01);}
  f.preview.pause();setMask(f.preview,0);await f.preview.seek(.9);f.preview.stop();
  assert.deepEqual(writes,[]);assert.deepEqual(a.instrument.read(),before);
  matchPcm(a.instrument.generateStereo(2048),untouched.instrument.generateStereo(2048),'author output and native phase remain untouched');
  assert.equal(f.context.closes,0);
});
