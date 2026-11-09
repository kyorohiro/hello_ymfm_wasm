import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import createModule from '../generated/ym2612_wasm.js';
import {Ym2612} from '../js/ym2612.js';
import {YM2612Synth,YM2612DirectTransport} from '../js/ym2612synth.js';
import {createSynthPerformanceTarget,normalizeCapturedVoice} from './synth_performance.js';
import {SynthRecordingManager,SYNTH_RECORDING_FORMAT} from './synth_recording.js';

const specialVoice=()=>({keyMask:10,specialMode:true,specialFrequencies:[
  {block:3,fnum:1200},{block:4,fnum:1800},{block:5,fnum:1200},{block:4,fnum:1200},
]});
const partialVoice=()=>({keyMask:8,specialMode:false,specialFrequencies:[]});
const normalVoice=()=>({keyMask:15,specialMode:false,specialFrequencies:[]});

function clock() {
  let now=0,next=1;
  const timers=new Map();
  return {now:()=>now,timers,setTimer(fn,delay){const id=next++;timers.set(id,{fn,time:now+delay/1000});return id;},
    clearTimer:id=>timers.delete(id),advance(time){
      assert(time>=now);
      for(let work=0;;work++) {
        assert(work<10000,'A finite test advance cannot spin forever');
        const entry=[...timers].filter(([,timer])=>timer.time<=time+1e-12).sort((a,b)=>a[1].time-b[1].time||a[0]-b[0])[0];
        if(!entry)break;
        timers.delete(entry[0]);now=entry[1].time;entry[1].fn();
      }
      now=time;
    }};
}
function captureSynth() {
  const writes=[];
  const synth=new YM2612Synth({transport:{write:(port,register,value)=>writes.push({port,register,value}),reset:()=>writes.splice(0)}});
  return {synth,writes};
}
function program(synth,voice=partialVoice()) {
  const operators=[0,1,2,3].map((_,index)=>({dt:0,multi:1,tl:[24,18,30,16][index],rs:0,ar:31,am:false,d1r:0,d2r:0,sl:0,rr:15,ssg:0}));
  for(let channel=0;channel<6;channel++)synth.setPreset(channel,{algorithm:7,feedback:0,pan:{left:true,right:true},operators});
  synth.setChannel3SpecialMode(voice?.specialMode??false);
  if(voice?.specialMode)voice.specialFrequencies.forEach((pitch,operator)=>synth.setChannel3SpecialFrequency(operator,pitch.block,pitch.fnum));
}
// Match the relevant MegaSynth wrappers: manual captured triggers must suppress
// their nested noteOff/frequency writes, while normal noteOn remains unchanged.
function hook(synth,manager) {
  const shapes={noteOn:([channel,block,fnum])=>({channel,block,fnum}),noteOff:([channel])=>({channel}),
    setChannel3SpecialMode:([enabled])=>({enabled}),setChannel3SpecialFrequency:([operator,block,fnum])=>({operator,block,fnum})};
  for(const [method,fields] of Object.entries(shapes)) {
    const original=synth[method];
    synth[method]=(...args)=>{const result=original.apply(synth,args);manager.recordCommand({type:method,...fields(args)});return result;};
  }
}
function fixture({voice=partialVoice(),stopped=()=>{}}={}) {
  const {synth,writes}=captureSynth(),time=clock();
  program(synth,voice);
  const manager=new SynthRecordingManager({synth,now:time.now,setTimer:time.setTimer,clearTimer:time.clearTimer,onPlaybackStopped:stopped});
  hook(synth,manager);
  const target=createSynthPerformanceTarget({getSynth:()=>synth,getVoice:()=>voice,
    onCapturedCommand:(command,action)=>manager.perform(command,action)});
  return {synth,writes,time,manager,target};
}

test('normal voices keep round-robin channels, wrapped noteOn and legacy recording format', () => {
  for(const voice of [null,normalVoice()]) {
    const {synth,writes,time,manager,target}=fixture({voice});
    manager.start();
    for(let channel=0;channel<6;channel++)target.noteOn(channel,4,1000);
    time.advance(.1);for(let channel=0;channel<6;channel++)target.noteOff(channel);
    time.advance(.2);const recorded=manager.stop();
    assert.equal(recorded.format,'megasynth-recording-v1');
    assert.deepEqual(recorded.commands.filter(command=>command.type==='noteOn').map(command=>command.channel),[0,1,2,3,4,5]);
    assert.equal(recorded.commands.length,12);
    assert(writes.some(write=>write.register===0x28&&write.value===0xf6));
    assert.equal(synth.channels[5].fnum,1000);
  }
});

test('partial OP notes record one detached performance command without nested hook duplicates', () => {
  const voice=partialVoice(),{manager,target,time,writes}=fixture({voice});
  manager.start();target.noteOn(4,4,1000);time.advance(.1);target.setFrequency(4,4,1120);time.advance(.2);target.noteOff(4);time.advance(.3);
  const recorded=manager.stop();
  assert.equal(recorded.format,SYNTH_RECORDING_FORMAT);
  assert.deepEqual(recorded.commands.map(command=>command.type),['capturedNoteOn','capturedFrequency','noteOff']);
  assert.deepEqual(recorded.commands.map(command=>command.channel),[4,4,4]);
  assert(writes.some(write=>write.register===0x28&&write.value===0x85));
  voice.keyMask=15;
  assert.equal(recorded.commands[0].voice.keyMask,8,'metadata is independent from later editor changes');
  recorded.commands[0].voice.keyMask=1;
  assert.equal(manager.exportRecording().commands[0].voice.keyMask,8,'export returns an independent copy');
});

test('CH3 special is monophonic on actual CH3; bend/replay use recorded canonical ratios', () => {
  const voice=specialVoice(),{synth,writes,manager,target,time}=fixture({voice});
  manager.start();target.noteOn(0,4,1000);
  assert.deepEqual(synth.channels[2].specialFrequencies.map(pitch=>pitch.fnum*2**pitch.block),[8000,24000,32000,16000]);
  time.advance(.1);target.setFrequency(5,4,1120);
  assert.deepEqual(synth.channels[2].specialFrequencies.map(pitch=>pitch.fnum*2**pitch.block),[8960,26880,35840,17920]);
  time.advance(.2);target.noteOff(0);time.advance(.3);const recorded=manager.stop();
  assert(recorded.commands.every(command=>command.channel===2));
  assert.deepEqual(recorded.commands[1].voice.specialFrequencies,specialVoice().specialFrequencies);
  assert(writes.some(write=>write.register===0x28&&write.value===0xa2));
  // IgnoreOp keeps today's operator patch, but OP masks / tuning describe the
  // recorded performance and still apply even when patches are ignored.
  synth.setOperator(2,3,{tl:44});
  manager.play(recorded,{loop:false,reset:false,ignorePatch:true,ignoreOperators:true});
  time.advance(.3);
  assert.equal(synth.channels[2].operators[3].tl,44);
  assert.deepEqual(synth.channels[2].specialFrequencies.map(pitch=>pitch.fnum*2**pitch.block),[8000,24000,32000,16000]);
  time.advance(.4);
  assert.deepEqual(synth.channels[2].specialFrequencies.map(pitch=>pitch.fnum*2**pitch.block),[8960,26880,35840,17920]);
  manager.stopPlayback();
});

test('explicit playback voice overrides do not reuse the currently edited captured voice', () => {
  const {synth,writes,target}=fixture({voice:specialVoice()});
  target.noteOn(5,4,1000,null);
  assert(writes.some(write=>write.register===0x28&&write.value===0xf6),'null explicitly selects normal FM on CH6');
  target.noteOn(4,4,1000,partialVoice());
  assert(writes.some(write=>write.register===0x28&&write.value===0x85));
  assert.equal(synth._modeRegister&0x40,0x40,'a normal non-CH3 channel does not disable another CH3 voice');
});

test('legacy files import/play; malformed captured or standard data keep active playback and export unchanged', () => {
  const {synth,time,manager}=fixture();
  const legacy={format:'megasynth-recording-v1',version:1,durationSeconds:.3,initialState:structuredClone(synth.getState()),commands:[
    {time:0,type:'noteOn',channel:0,block:4,fnum:1000},{time:.2,type:'noteOff',channel:0},
  ]};
  assert.equal(manager.importRecording(legacy).format,'megasynth-recording-v1');
  manager.play(null,{loop:true});const before=manager.exportRecording(),timers=[...time.timers.keys()];
  for(const invalid of [
    {...legacy,format:SYNTH_RECORDING_FORMAT,commands:[{time:0,type:'capturedNoteOn',channel:0,block:4,fnum:1000,voice:{...partialVoice(),keyMask:0}}]},
    {...legacy,format:SYNTH_RECORDING_FORMAT,commands:[{time:0,type:'capturedNoteOn',channel:0,block:4,fnum:1000,voice:specialVoice()}]},
    {...legacy,format:SYNTH_RECORDING_FORMAT,commands:[{time:0,type:'capturedFrequency',channel:2,block:4,fnum:1000,voice:{...specialVoice(),specialFrequencies:specialVoice().specialFrequencies.map((pitch,i)=>i===3?{...pitch,fnum:0}:pitch)}}]},
    {...legacy,commands:[{time:NaN,type:'noteOn',channel:0,block:4,fnum:1000}]},
    {...legacy,commands:[{time:0,type:'setOperator',channel:0,operator:0,params:{ar:32}}]},
  ]) {
    const chipBefore=structuredClone(synth.getState());
    assert.throws(()=>manager.importRecording(invalid));
    assert.throws(()=>manager.play(invalid));
    assert.equal(manager.isPlaying(),true);assert.deepEqual([...time.timers.keys()],timers);
    assert.deepEqual(manager.exportRecording(),before);assert.deepEqual(synth.getState(),chipBefore);
  }
  manager.stopPlayback();
});

test('stop cancels old callbacks and reports only actual playback stops', () => {
  let stops=0;
  const {manager,target,time,writes}=fixture({stopped:()=>stops++});
  manager.start();assert.equal(stops,0);target.noteOn(0,4,1000);time.advance(.1);target.noteOff(0);time.advance(.2);manager.stop();
  manager.play(null,{loop:true});assert.equal(stops,0);
  const stale=[...time.timers.values()].map(timer=>timer.fn);
  time.advance(.2);manager.stopPlayback();assert.equal(stops,1);assert.equal(time.timers.size,0);
  const count=writes.length;for(const callback of stale)callback();assert.equal(writes.length,count);
  manager.stopPlayback();assert.equal(stops,1);
  manager.start();assert.equal(stops,1);
});

test('invalid voice descriptions reject before any chip operation', () => {
  const {writes,target}=fixture({voice:{...specialVoice(),specialFrequencies:[]}}),before=writes.length;
  assert.throws(()=>target.noteOn(0,4,1000),/frequencies/);
  assert.equal(writes.length,before);
  assert.throws(()=>normalizeCapturedVoice({...partialVoice(),keyMask:16}),/keyMask/);
});

test('real WASM captured partial/CH3 recording replays identical PCM and release', async () => {
  const wasmBinary=await readFile(new URL('../generated/ym2612_wasm.wasm',import.meta.url));
  for(const voice of [partialVoice(),specialVoice()]) {
    const source=await Ym2612.create({moduleFactory:createModule,moduleOptions:{wasmBinary}});
    const replay=await Ym2612.create({moduleFactory:createModule,moduleOptions:{wasmBinary}});
    try {
      const synth=new YM2612Synth({transport:new YM2612DirectTransport(source)}),player=new YM2612Synth({transport:new YM2612DirectTransport(replay)});
      program(synth,voice);
      const sourceTime=clock(),replayTime=clock(),manager=new SynthRecordingManager({synth,now:sourceTime.now,setTimer:sourceTime.setTimer,clearTimer:sourceTime.clearTimer});
      hook(synth,manager);
      const target=createSynthPerformanceTarget({getSynth:()=>synth,getVoice:()=>voice,onCapturedCommand:(command,action)=>manager.perform(command,action)});
      const channel=voice.specialMode?2:5,rate=source.sampleRate(),expected=[];
      manager.start();target.noteOn(channel,4,1000);expected.push(source.generateStereo(1024));sourceTime.advance(1024/rate);
      target.setFrequency(channel,4,1120);expected.push(source.generateStereo(1024));sourceTime.advance(2048/rate);
      target.noteOff(channel);expected.push(source.generateStereo(12000));sourceTime.advance(14048/rate);
      const recording=JSON.parse(JSON.stringify(manager.stop()));
      const playback=new SynthRecordingManager({synth:player,now:replayTime.now,setTimer:replayTime.setTimer,clearTimer:replayTime.clearTimer});
      playback.importRecording(recording);playback.play(null,{loop:false});replayTime.advance(0);
      for(const [index,frames] of [1024,1024,12000].entries()) {
        const actual=replay.generateStereo(frames);
        assert.deepEqual(actual.left,expected[index].left,`${voice.specialMode?'CH3':'partial'} left segment ${index}`);
        assert.deepEqual(actual.right,expected[index].right,`${voice.specialMode?'CH3':'partial'} right segment ${index}`);
        if(index<2)replayTime.advance((index+1)*1024/rate);
      }
      playback.stopPlayback();
    } finally {source.dispose();replay.dispose();}
  }
});
