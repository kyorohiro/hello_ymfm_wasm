import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import createModule from '../generated/ym2612_wasm.js';
import {Ym2612} from '../js/ym2612.js';
import {YM2612Synth,YM2612DirectTransport} from '../js/ym2612synth.js';
import {SynthLooper,applySynthLooperPatch} from './synth_looper.js';
import {createSynthPerformanceTarget} from './synth_performance.js';

function clock() {
  let time=0,id=0;
  const timers=new Map();
  return {now:()=>time,set:value=>{time=value;},
    setTimer(fn,delay){const next=++id;timers.set(next,{fn,at:time+delay/1000});return next;},
    clearTimer:id=>timers.delete(id),timers,
    advance(target){
      for(let count=0;count<1000;count++) {
        const next=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
        if(!next){time=target;return;}
        timers.delete(next[0]);time=next[1].at;next[1].fn();
      }
      assert.fail('Unbounded loop scheduling');
    }};
}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const special={keyMask:10,specialMode:true,specialFrequencies:[
  {block:3,fnum:1200},{block:4,fnum:1800},{block:5,fnum:1200},{block:4,fnum:1200},
]};
const partial={keyMask:10,specialMode:false,specialFrequencies:[]};
function patch(capturedVoice=null) {
  return {algorithm:7,feedback:0,lfoEnabled:false,lfoFrequency:0,dacEnabled:false,ams:0,pms:0,
    pan:{left:true,right:true},operators:Array.from({length:4},(_,operator)=>({
      dt:0,multi:operator===1?2:1,tl:operator===1||operator===3?16:127,rs:0,ar:31,am:false,d1r:0,d2r:0,sl:0,rr:15,ssg:0,
    })),...(capturedVoice?{capturedVoice:structuredClone(capturedVoice)}:{})};
}
function unit(id,voice,{channel=2,at=0,off=.4,audio=null}={}) {
  return {id,muted:false,patch:patch(voice),audio,events:[
    {type:'noteOn',channel,block:4,fnum:1000,time:at},
    {type:'noteOff',channel,time:off},
  ],playbackChannelMap:{}};
}
function fixture(options={}) {
  const time=clock(),live=[],playback=[],states=[];
  let currentPatch=patch();
  const target=log=>({noteOn:(...args)=>log.push(['on',...args]),noteOff:(...args)=>log.push(['off',...args])});
  const looper=new SynthLooper({synth:{start:async()=>{}},...time,
    liveTarget:target(live),playbackTarget:target(playback),getPatch:()=>currentPatch,
    onStateChange:state=>states.push(state),...options});
  return {looper,time,live,playback,states,setPatch:value=>{currentPatch=value;}};
}

test('partial masks keep ordinary channel routing and frozen patch/event metadata',async()=>{
  const state=fixture();state.setPatch(patch(partial));
  await state.looper.start();await state.looper.startRecording();
  state.looper.noteOn(4,4,1000);state.time.set(.2);state.looper.noteOff(4);state.time.set(.5);
  const saved=await state.looper.finishRecording();
  assert.equal(saved.events[0].channel,4);assert.equal(saved.events[0].capturedVoice.keyMask,10);
  assert.equal(state.live.find(item=>item[0]==='on')[1],4);
  state.time.advance(.5);
  const played=state.playback.find(item=>item[0]==='on');
  assert.equal(played[1],4);assert.deepEqual(played[4],partial);
  const exported=state.looper.getUnits();exported[0].patch.capturedVoice.keyMask=1;exported[0].events[0].capturedVoice.keyMask=1;
  assert.equal(state.looper.units[0].patch.capturedVoice.keyMask,10);
  assert.equal(state.looper.units[0].events[0].capturedVoice.keyMask,10);
  await state.looper.stop();assert.equal(state.time.timers.size,0);
});

test('special event units stay on CH3, reserve it from normal units, and ignore an older stolen note-off',async()=>{
  const state=fixture();
  const normal=unit('normal',null,{channel:2,off:.9}),first=unit('first',special,{at:0,off:.4}),second=unit('second',special,{at:.2,off:.6});
  state.looper.units=[normal,first,second];state.looper.loopLength=1;state.looper._rebuildPlaybackChannelMaps();
  assert.notEqual(normal.playbackChannelMap[2],2);assert.equal(first.playbackChannelMap[2],2);assert.equal(second.playbackChannelMap[2],2);
  await state.looper.start();state.time.advance(.45);
  assert.equal(state.playback.filter(item=>item[0]==='on'&&item[1]===2).length,2);
  assert.equal(state.playback.filter(item=>item[0]==='off'&&item[1]===2).length,0,'first unit cannot key-off the newer CH3 note');
  state.time.advance(.65);
  assert.equal(state.playback.filter(item=>item[0]==='off'&&item[1]===2).length,1);
  await state.looper.stop();
});

test('normal event loops retain all six channels when CH3 is not reserved',async()=>{
  const state=fixture();state.looper.units=Array.from({length:6},(_,channel)=>unit('normal-'+channel,null,{channel}));
  state.looper._rebuildPlaybackChannelMaps();
  assert.deepEqual(state.looper.units.map((item,index)=>item.playbackChannelMap[index]),[0,1,2,3,4,5]);
  state.looper.units.push(unit('pcm-special',special,{audio:{pcm:true}}));state.looper._rebuildPlaybackChannelMaps();
  assert.equal(state.looper.units[2].playbackChannelMap[2],2,'PCM layers do not consume a physical chip channel');
  state.looper.units.unshift(state.looper.units.pop());state.looper._rebuildPlaybackChannelMaps();
  assert.equal(state.looper.units[3].playbackChannelMap[2],2,'an earlier PCM layer does not reserve CH3 either');
  await state.looper.stop();
});

test('PCM capture keeps the special voice patch and uses audio playback rather than a remapped event voice',async()=>{
  const played=[],audio={captured:true},state=fixture({stopAudioCapture:()=>({audio,audioDuration:.5}),scheduleAudioPlayback:(...args)=>played.push(args)});
  state.setPatch(patch(special));await state.looper.start();await state.looper.startRecording();
  state.looper.noteOn(0,4,1000);state.time.set(.2);state.looper.noteOff(0);state.time.set(.5);
  const saved=await state.looper.finishRecording();
  assert.equal(state.live[0][1],2);assert.equal(saved.events[0].channel,2);
  assert.deepEqual(saved.patch.capturedVoice,special);assert.equal(saved.audio,audio);
  state.time.advance(1.2);
  assert(played.length>=2);assert.equal(state.playback.filter(item=>item[0]==='on').length,0);
  await state.looper.stop();
});

test('Stop cancels slow initialization and pending capture; late completion cannot restart or schedule a loop',async()=>{
  const preparing=deferred(),state=fixture({synth:{start:()=>preparing.promise}});
  const starting=state.looper.start();await settle();await state.looper.stop();preparing.resolve();await starting;
  assert.equal(state.looper.running,false);assert.equal(state.time.timers.size,0);
  const capture=deferred();let stopped=0;
  const waiting=fixture({startAudioCapture:()=>capture.promise,stopAudioCapture:()=>{stopped++;return null;}});
  await waiting.looper.start();const recording=waiting.looper.startRecording();await settle();
  const stopping=waiting.looper.stop();assert.equal(waiting.looper.running,false);capture.resolve();await Promise.all([recording,stopping]);
  assert.equal(stopped,1);assert.equal(waiting.looper.recording,false);assert.equal(waiting.looper.currentUnit,null);
  assert.equal(waiting.looper.units.length,0);assert.equal(waiting.time.timers.size,0);
});

test('Stop during take finalization preserves the completed take but never schedules its late audio; Undo and Clear remove it safely',async()=>{
  const finalized=deferred(),played=[],state=fixture({stopAudioCapture:()=>finalized.promise,scheduleAudioPlayback:(...args)=>played.push(args)});
  await state.looper.start();await state.looper.startRecording();state.looper.noteOn(0,4,1000);state.time.set(.5);
  const finishing=state.looper.finishRecording();const stopping=state.looper.stop();finalized.resolve({audio:{late:true},audioDuration:.5});
  await Promise.all([finishing,stopping]);assert.equal(state.looper.units.length,1);
  assert.equal(played.length,0);assert.equal(state.time.timers.size,0);
  await state.looper.undo();assert.equal(state.looper.units.length,0);
  await state.looper.clear();assert.equal(state.looper.loopLength,null);
});

test('Undo cancels a pending capture without stopping the looper, and releases the owner of an undone CH3 unit',async()=>{
  const capture=deferred();let stopped=0;
  const state=fixture({startAudioCapture:()=>capture.promise,stopAudioCapture:()=>{stopped++;return null;}});
  await state.looper.start();const recording=state.looper.startRecording();await settle();const undo=state.looper.undo();capture.resolve();
  await Promise.all([recording,undo]);assert.equal(state.looper.running,true);assert.equal(state.looper.recording,false);assert.equal(stopped,1);
  state.looper.units=[unit('first',special),unit('second',special,{at:.2,off:.7})];state.looper.loopLength=1;state.looper._rebuildPlaybackChannelMaps();state.looper.loopStartedAt=0;
  state.looper._scheduleLoopCycle(0);state.time.advance(.3);await state.looper.undo();
  assert(state.playback.some(item=>item[0]==='off'&&item[1]===2),'undo releases the removed unit immediately');
  await state.looper.stop();
});

test('auto empty-take capture cannot re-arm after Stop interrupts its asynchronous preparation',async()=>{
  const second=deferred();let starts=0,stops=0;
  const state=fixture({startAudioCapture:()=>++starts===1?undefined:second.promise,stopAudioCapture:()=>{stops++;return null;}});
  await state.looper.start();state.looper.loopLength=1;state.looper.loopStartedAt=0;await state.looper.startRecording();
  const finishing=state.looper.finishRecording({auto:true});await settle();assert.equal(starts,2);
  const stopping=state.looper.stop();second.resolve();await Promise.all([finishing,stopping]);
  assert.equal(state.looper.recording,false);assert.equal(state.looper.currentUnit,null);assert.equal(state.time.timers.size,0);assert.equal(stops,2);
});

test('Stop releases every physical live channel even when the current performance adapter is CH3-only',async()=>{
  const released=[],target=createSynthPerformanceTarget({getSynth:()=>({noteOff:channel=>released.push(channel)}),getVoice:()=>special});
  const state=fixture({liveTarget:target});await state.looper.start();await state.looper.stop();
  assert.deepEqual([...new Set(released)].sort(),[0,1,2,3,4,5]);
});

test('real WASM event playback preserves partial KON and all four CH3 ratios with byte-exact output',async()=>{
  const wasmBinary=await readFile(new URL('../generated/ym2612_wasm.wasm',import.meta.url));
  const chips=[];
  try {
    for(const captured of [partial,special]) {
      const first=await Ym2612.create({moduleFactory:createModule,moduleOptions:{wasmBinary}}),second=await Ym2612.create({moduleFactory:createModule,moduleOptions:{wasmBinary}});chips.push(first,second);
      const reference=new YM2612Synth({transport:new YM2612DirectTransport(first)}),played=new YM2612Synth({transport:new YM2612DirectTransport(second)});
      const tone=patch(captured),channel=captured.specialMode?2:4;
      applySynthLooperPatch(reference,tone,channel);
      createSynthPerformanceTarget({getSynth:()=>reference,getVoice:()=>captured}).noteOn(channel,4,1088);
      const expected=first.generateStereo(5000),time=clock();
      const looper=new SynthLooper({synth:{},...time,liveTarget:{noteOn(){},noteOff(){}},
        playbackTarget:createSynthPerformanceTarget({getSynth:()=>played}),
        applyPatch:(tone,channel)=>applySynthLooperPatch(played,tone,channel)});
      looper.units=[{...unit('real',captured,{channel,off:.2}),patch:tone,events:[{type:'noteOn',channel,block:4,fnum:1088,time:0},{type:'noteOff',channel,time:.2}],playbackChannelMap:{}}];
      looper.loopLength=1;looper._rebuildPlaybackChannelMaps();await looper.start();time.advance(0);
      const actual=second.generateStereo(5000);assert.deepEqual(actual.left,expected.left);assert.deepEqual(actual.right,expected.right);
      if(captured.specialMode)assert.deepEqual(played.getState().channels[2].specialFrequencies,reference.getState().channels[2].specialFrequencies);
      const before=played.getState().modeRegister;
      applySynthLooperPatch(played,patch(partial),0);
      assert.equal(played.getState().modeRegister,before,'programming another channel does not disable CH3');
      await looper.stop();
    }
  } finally {for(const chip of chips)chip.dispose();}
});
