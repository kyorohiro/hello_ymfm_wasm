// Controller tests use fake audio-clock/timers and PCM arrays, never devices.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SynthPcmLooper,PCM_LOOP_MIN_SECONDS,PCM_LOOP_MAX_SECONDS} from './synth_pcm_looper.js';
import {createPcmBuiltinPreset} from './synth_pcm.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>queueMicrotask(resolve));
const note={type:'noteOn',channel:0,block:4,fnum:644};
const audio=recording=>{
  const count=Math.max(1,Math.ceil(recording.durationSeconds*8000))+8;
  return {left:new Float32Array(count).fill(.25),right:new Float32Array(count).fill(-.125),sampleRate:8000};
};
function fixture({initial=createPcmBuiltinPreset('sine'),render=async recording=>audio(recording),...options}={}) {
  let time=0,timerId=0,preset=structuredClone(initial);
  const timers=new Map(),renders=[],starts=[],adds=[],removes=[],stops=[],states=[],held=new Set();
  const looper=new SynthPcmLooper({now:()=>time,getPreset:()=>preset,getPitchClock:()=>7670454,
    setTimer:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,at:time+delay/1000});return id;},clearTimer:id=>timers.delete(id),
    releaseLiveNotes:()=>{for(const channel of [...held]){held.delete(channel);looper.captureCommand({type:'noteOff',channel});}},
    renderRecording:(recording,configuration)=>{renders.push({recording:structuredClone(recording),configuration});return render(recording,configuration);},
    startPlayback:(config,units)=>starts.push({config,units}),addPlaybackUnit:unit=>adds.push(unit),removePlaybackUnit:unit=>removes.push(unit),
    stopPlayback:()=>stops.push(time),onStateChange:state=>states.push(state),...options});
  function command(value) {
    if(value.type==='noteOn')held.add(value.channel);else if(value.type==='noteOff')held.delete(value.channel);else if(value.type==='stop')held.clear();
    else if(value.type==='setPreset'){preset=structuredClone(value.preset);held.clear();}
    else if(value.type==='setSettings')preset={...preset,settings:structuredClone(value.settings)};
    return looper.captureCommand(value);
  }
  async function due(){for(let i=0;i<20;i++){const next=[...timers].find(([,timer])=>timer.at<=time);if(!next)return;timers.delete(next[0]);next[1].fn();await turn();}throw Error('unbounded callback loop');}
  return {looper,timers,renders,starts,adds,removes,stops,states,held,command,at:value=>{time=value;},due,
    setPreset:value=>{preset=structuredClone(value);},get preset(){return structuredClone(preset);}};
}
async function layer(f,duration=.2) {
  await f.looper.startRecording();f.command(note);f.at(f.looper.currentUnit.startedAt+duration);return f.looper.finishRecording();
}

test('first PCM layer closes all eight voices, preserves sample/settings and raw audio, and sets the performed period',async()=>{
  const initial=createPcmBuiltinPreset('sine');initial.settings.panRight=3;
  const f=fixture({initial}),l=f.looper;await l.start();await l.startRecording();
  for(let channel=0;channel<8;channel++)f.command({...note,channel});f.at(.2);const unit=await l.finishRecording();
  assert.equal(unit.id,'pcm-unit-1');assert.equal(l.loopLength,.2);assert.equal(l.loopStartedAt,.25);
  assert.equal(unit.recording.format,'tetorica-rf5c164-recording-v1');assert.deepEqual(unit.recording.initialState.preset,initial);
  assert.equal(unit.recording.durationSeconds,.2);assert.equal(unit.recording.commands.filter(c=>c.type==='noteOff').length,8);
  assert.deepEqual([...f.held],[]);assert.equal(unit.left[0],.25);assert.equal(unit.right[0],-.125);
  assert.equal(unit.byteLength,unit.left.byteLength+unit.right.byteLength);assert.equal(l.getState().pcmBytes,unit.byteLength);
  assert.equal(f.starts[0].units[0],unit);assert.equal(f.timers.size,0);assert.equal(l.getState().busy,false);
  initial.sample.data='changed';initial.settings.panRight=0;assert.equal(unit.recording.initialState.preset.settings.panRight,3);
  const view=l.getUnits();view[0].recording.initialState.preset.sample.name='changed';assert.equal(l.getUnits()[0].recording.initialState.preset.sample.name,'Sine');
});

test('overdub keeps its own new sample and performed phase, auto-closing the remaining loop interval',async()=>{
  const f=fixture(),l=f.looper;await l.start();const first=await layer(f,1),wave=createPcmBuiltinPreset('square');wave.settings.volume=32;f.setPreset(wave);
  f.at(1.3);await l.startRecording();f.command({...note,channel:7});
  assert(Math.abs(l.currentUnit.offsetSeconds-.25)<1e-12);f.at(2.4);
  assert.equal(f.command({type:'setFrequency',channel:7,block:5,fnum:644}),false);
  await l.finishRecording();const unit=l.getUnits()[1];
  assert.equal(l.loopLength,1);assert(Math.abs(unit.offsetSeconds-.25)<1e-12);
  assert(Math.abs(unit.recording.durationSeconds-.75)<1e-12);assert(!unit.recording.commands.some(c=>c.type==='setFrequency'));
  assert.equal(unit.recording.initialState.preset.sample.name,'Square');assert.equal(unit.recording.initialState.preset.settings.volume,32);
  assert.equal(first.recording.initialState.preset.sample.name,'Sine');assert.equal(f.starts.length,1);assert.equal(f.adds[0],l.units[1]);
});

test('PCM sample, Pan, root, pitch and Loop changes remain semantic operations inside their layer',async()=>{
  const f=fixture(),l=f.looper;await l.start();await l.startRecording();f.command(note);f.at(.05);
  const settings={...f.preset.settings,volume:80,panLeft:0,panRight:15,rootNote:72,loopStart:12};
  f.command({type:'setSettings',settings});settings.volume=0;f.command({type:'setFrequency',channel:0,block:5,fnum:700});
  f.command({type:'setSettings',settings:{...f.preset.settings,loopEnd:180}});const saw=createPcmBuiltinPreset('saw');f.command({type:'setPreset',preset:saw});
  saw.sample.name='changed';f.command({...note,channel:7});f.at(.2);const unit=await l.finishRecording();
  assert.equal(unit.recording.commands.find(c=>c.type==='setSettings').settings.volume,80);
  assert.equal(unit.recording.commands.find(c=>c.type==='setPreset').preset.sample.name,'Saw');
  assert.equal(unit.recording.commands.at(-1).channel,7);assert.equal(unit.recording.initialState.preset.sample.name,'Sine');
});

test('empty recordings never create a layer; zero-time notes use minimum period and first capture stops at 120 seconds',async()=>{
  const f=fixture(),l=f.looper;await l.start();await l.startRecording();f.command({type:'setSettings',settings:{...f.preset.settings,volume:20}});f.at(.2);
  assert.equal(await l.finishRecording(),null);assert.equal(l.loopLength,null);assert.equal(l.units.length,0);assert.equal(f.starts.length,0);
  await l.startRecording();f.command(note);assert(await l.finishRecording());assert.equal(l.loopLength,PCM_LOOP_MIN_SECONDS);
  await l.clear();await l.start();f.at(10);await l.startRecording();f.command(note);f.at(10+PCM_LOOP_MAX_SECONDS+.5);await f.due();
  await l.finishRecording();assert.equal(l.loopLength,PCM_LOOP_MAX_SECONDS);assert.equal(l.getUnits()[0].recording.durationSeconds,120);
});

test('Undo cancels current recording/render/transfer without disturbing previously completed PCM layers',async()=>{
  const f=fixture(),l=f.looper;await l.start();const original=await layer(f,.5);
  f.at(.7);await l.startRecording();f.command(note);assert.equal((await l.undo()).type,'record-cancel');assert.equal(l.units[0],original);assert.equal(f.held.size,0);
  f.at(.8);await layer(f,.1);assert.equal(l.units.length,2);const removed=await l.undo();assert.equal(f.removes.at(-1),removed);assert.equal(l.units[0],original);
  await l.undo();assert.equal(l.loopLength,null);assert.equal(l.running,true);
  for(const phase of ['render','prepare']) {
    const pending=deferred(),requests=[];
    const g=fixture({render:phase==='render'?()=>pending.promise:undefined,preparePlaybackUnit:(unit,options)=>{requests.push({unit,options});return phase==='prepare'?pending.promise:undefined;}}),x=g.looper;
    await x.start();await x.startRecording();g.command(note);g.at(.2);const finish=x.finishRecording();await turn();await turn();
    const signal=phase==='render'?g.renders[0].configuration.signal:requests[0].options.signal;
    assert.equal((await x.undo()).type,'record-cancel');assert(signal.aborted);
    pending.resolve(phase==='render'?audio(g.renders[0].recording):undefined);assert.equal(await finish,null);assert.equal(x.units.length,0);assert.equal(g.starts.length,0);
  }
});

test('Stop/Clear discard unfinished work; completed PCM layers survive Stop and resume at a new clock epoch',async()=>{
  const pending=deferred(),f=fixture({render:()=>pending.promise}),l=f.looper;
  await l.start();await l.startRecording();f.command(note);f.at(.2);const finish=l.finishRecording();await turn();await l.stop();
  pending.resolve(audio(f.renders[0].recording));assert.equal(await finish,null);assert.equal(l.units.length,0);
  const g=fixture(),x=g.looper;await x.start();const unit=await layer(g,.2);await x.stop();g.at(4);await x.start();
  assert.equal(x.units[0],unit);assert.equal(g.starts.at(-1).units[0],unit);assert.equal(g.starts.at(-1).config.startTime,4.05);
  await x.startRecording();g.command(note);await x.clear();assert.equal(x.running,false);assert.equal(x.units.length,0);assert.equal(x.getState().pcmBytes,0);assert.equal(g.timers.size,0);
});

test('delayed preparation sets start time only after ready, and canceled resume cannot restart playback',async()=>{
  const pending=deferred(),requests=[];
  const f=fixture({preparePlaybackUnit:(unit,options)=>{requests.push({unit,options});return pending.promise;}}),l=f.looper;
  await l.start();await l.startRecording();f.command(note);f.at(.2);const finish=l.finishRecording();await turn();await turn();
  f.at(5);pending.resolve();await finish;assert.equal(f.starts[0].config.startTime,5.05);assert.equal(l.loopLength,.2);
  let resume=deferred();l.preparePlaybackUnit=(unit,options)=>{requests.push({unit,options});return resume.promise;};
  await l.stop();const task=l.start();await turn();const signal=requests.at(-1).options.signal;await l.undo();assert(signal.aborted);
  const starts=f.starts.length;resume.resolve();assert.equal(await task,null);assert.equal(f.starts.length,starts);assert.equal(l.running,false);
});

test('render/transfer failures and layer/audio memory limits retain already-playing PCM layers',async()=>{
  let failing=false;
  const f=fixture({maxUnits:2,maxPCMBytes:14000,render:async recording=>{if(failing)throw Error('offline failure');return audio(recording);}}),l=f.looper;
  await l.start();const first=await layer(f,.2);f.at(.3);failing=true;assert.equal(await layer(f,.1),null);assert.equal(l.units[0],first);
  failing=false;f.at(.5);assert.equal(await layer(f,.1),null);assert.equal(l.units.length,1);assert(f.states.some(s=>s.error?.message.includes('memory limit')));
  const one=fixture({maxUnits:1});await one.looper.start();await layer(one,.2);assert.equal(await one.looper.startRecording(),null);assert.equal(one.looper.units.length,1);
  assert(one.states.at(-1).error.message.includes('layer limit'));
  assert.throws(()=>new SynthPcmLooper({getPreset:()=>f.preset,maxUnits:17}));
});
