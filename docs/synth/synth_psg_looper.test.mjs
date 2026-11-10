import test from 'node:test';
import assert from 'node:assert/strict';
import {SynthPsgLooper,PSG_LOOP_MIN_SECONDS,PSG_LOOP_MAX_SECONDS} from './synth_psg_looper.js';
import {createPsgPreset} from './synth_psg_preset.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>queueMicrotask(resolve));
const note={type:'noteOn',channel:0,block:4,fnum:1083};
const pcm=recording=>{
  const length=Math.max(1,Math.ceil(recording.durationSeconds*8000));
  return {left:new Float32Array(length).fill(.25),right:new Float32Array(length).fill(-.125),sampleRate:8000};
};
function fixture({initial={},render=async recording=>pcm(recording),...options}={}) {
  let time=0,timerId=0,settings=createPsgPreset(initial).settings;
  const timers=new Map(),renders=[],starts=[],adds=[],removes=[],stops=[],states=[],held=new Set();
  const looper=new SynthPsgLooper({now:()=>time,getSettings:()=>settings,getPitchClock:()=>7670454,
    setTimer:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,at:time+delay/1000});return id;},clearTimer:id=>timers.delete(id),
    releaseLiveNotes:()=>{for(const channel of [...held]){held.delete(channel);looper.captureCommand({type:'noteOff',channel});}},
    renderRecording:(recording,configuration)=>{renders.push({recording:structuredClone(recording),configuration});return render(recording,configuration);},
    startPlayback:(config,units)=>starts.push({config,units}),addPlaybackUnit:unit=>adds.push(unit),removePlaybackUnit:unit=>removes.push(unit),
    stopPlayback:()=>stops.push(time),onStateChange:state=>states.push(state),...options});
  function command(value){
    if(value.type==='noteOn')held.add(value.channel);else if(value.type==='noteOff')held.delete(value.channel);else if(value.type==='stop')held.clear();
    if(value.type==='setSettings'){if(settings.source!==value.settings.source||settings.envelope.enabled!==value.settings.envelope.enabled)held.clear();settings=structuredClone(value.settings);}
    return looper.captureCommand(value);
  }
  async function due(){for(let i=0;i<20;i++){const next=[...timers].find(([,timer])=>timer.at<=time);if(!next)return;timers.delete(next[0]);next[1].fn();await turn();}throw Error('unbounded timer callback loop');}
  return {looper,timers,renders,starts,adds,removes,stops,states,held,command,at:value=>{time=value;},due,
    setSettings:patch=>{settings=createPsgPreset(patch).settings;},get settings(){return structuredClone(settings);}};
}
async function layer(f,duration=.2) {
  await f.looper.startRecording();f.command(note);f.at(f.looper.currentUnit.startedAt+duration);
  return f.looper.finishRecording();
}

test('first capture sets the performed loop length while retaining the entire independent software release PCM',async()=>{
  const f=fixture({initial:{envelope:{enabled:true,releaseMs:500}}}),l=f.looper;
  await l.start();await l.startRecording();f.command(note);f.at(.2);const result=await l.finishRecording();
  assert.equal(l.loopLength,.2);assert.equal(result.recording.durationSeconds,.7);
  assert.equal(result.audioDuration,.7);assert.equal(result.left.length,5600);assert.equal(result.offsetSeconds,0);
  assert.deepEqual(result.recording.commands.at(-1),{type:'noteOff',channel:0,time:.2});assert.equal(f.held.size,0);
  assert.equal(f.starts.length,1);assert.equal(f.starts[0].config.loopLength,.2);assert.equal(f.starts[0].config.startTime,.25);
  assert.equal(f.starts[0].units[0],result);assert.equal(result.left[0],.25,'controller does not bake in Master or PSG calibration gain');
  assert.equal(result.right[0],-.125);assert.equal(l.getState().unitCount,1);assert.equal(l.getState().busy,false);
  assert.equal(f.timers.size,0);assert(f.states.some(state=>state.reason==='record-finish'));
});

test('overdub retains loop phase and clamps late auto-stop and note events to the actual boundary',async()=>{
  const f=fixture({initial:{envelope:{enabled:true,releaseMs:300}}}),l=f.looper;
  await l.start();await layer(f,1);assert.equal(l.loopStartedAt,1.05);
  f.at(1.3);await l.startRecording();assert(Math.abs(l.currentUnit.offsetSeconds-.25)<1e-12);
  f.command({...note,channel:1});f.at(2.2);
  assert.equal(f.command({type:'setFrequency',channel:1,block:5,fnum:1200}),false,'a late event belongs to live playing, not the ended capture');
  const done=l.finishRecording();await done;
  const unit=l.getUnits()[1];assert(Math.abs(unit.offsetSeconds-.25)<1e-12);
  assert(Math.abs(unit.recording.commands.at(-1).time-.75)<1e-12);
  assert(!unit.recording.commands.some(command=>command.type==='setFrequency'));
  assert(Math.abs(unit.recording.durationSeconds-1.05)<1e-12);
  assert.equal(l.loopLength,1);assert.equal(f.starts.length,1);assert.equal(f.adds.length,1);
});

test('Tone/Noise, pitch and software setting edits stay in the layer while initial settings remain detached',async()=>{
  const f=fixture(),l=f.looper;await l.start();await l.startRecording();f.command(note);f.at(.1);
  f.command({type:'setFrequency',channel:0,block:4,fnum:1200});f.command({type:'stop'});
  const settings=createPsgPreset({source:'noise',noiseType:'periodic',noiseRate:'tone3',envelope:{enabled:true,releaseMs:200}}).settings;
  f.command({type:'setSettings',settings});settings.noiseType='white';
  f.command({...note,channel:3});f.at(.2);const unit=await l.finishRecording();
  assert.equal(unit.recording.initialState.settings.source,'tone');
  assert.equal(unit.recording.commands.find(command=>command.type==='setSettings').settings.noiseType,'periodic');
  assert.equal(unit.recording.commands.at(-1).channel,3);assert.equal(unit.recording.durationSeconds,.4);
});

test('settings-only takes stay empty, first-note minimum length is bounded, and first capture auto-stops at the duration limit',async()=>{
  const f=fixture(),l=f.looper;await l.start();await l.startRecording();f.command({type:'setSettings',settings:createPsgPreset({attenuation:8}).settings});f.at(.3);
  assert.equal(await l.finishRecording(),null);assert.equal(l.loopLength,null);assert.equal(l.units.length,0);assert.equal(f.starts.length,0);
  await l.startRecording();f.command(note);assert(await l.finishRecording());assert.equal(l.loopLength,PSG_LOOP_MIN_SECONDS);
  await l.clear();await l.start();f.at(10);await l.startRecording();f.command(note);f.at(10+PSG_LOOP_MAX_SECONDS+.5);await f.due();
  await l.finishRecording();assert.equal(l.loopLength,PSG_LOOP_MAX_SECONDS);
  assert(l.getUnits()[0].recording.commands.every(command=>command.time<=PSG_LOOP_MAX_SECONDS));
});

test('Undo cancels an active capture or pending render, and completed Undo removes only the newest layer',async()=>{
  const f=fixture(),l=f.looper;await l.start();await layer(f,1);
  f.at(1.2);await l.startRecording();f.command(note);const canceled=await l.undo();
  assert.equal(canceled.type,'record-cancel');assert.equal(l.units.length,1);assert.equal(f.timers.size,0);assert.equal(f.held.size,0);
  f.at(1.3);await l.startRecording();f.command(note);f.at(1.5);await l.finishRecording();
  const original=l.units[0],removed=await l.undo();assert.equal(f.removes.at(-1),removed);assert.equal(l.units[0],original);assert.equal(l.loopLength,1);
  await l.undo();assert.equal(l.units.length,0);assert.equal(l.loopLength,null);assert.equal(l.running,true);assert.equal(l.getState().canUndo,false);
});

test('pending render is shared by Record and can be canceled without waiting for an uncooperative renderer',async()=>{
  const pending=deferred(),f=fixture({render:()=>pending.promise}),l=f.looper;
  await l.start();await l.startRecording();f.command(note);f.at(.2);const finish=l.finishRecording();await turn();
  assert.equal(l.getState().rendering,true);assert.equal(l.getState().canUndo,true);assert.equal(l.toggleRecord(),finish);
  const canceled=await l.undo();assert.equal(canceled.type,'record-cancel');assert.equal(f.renders[0].configuration.signal.aborted,true);
  assert.equal(l.getState().busy,false);pending.resolve(pcm(f.renders[0].recording));assert.equal(await finish,null);
  assert.equal(l.units.length,0);assert.equal(f.starts.length,0);assert.equal(l.running,true);
});

test('Stop/Clear discard unfinished capture and ignore stale PCM completion, while completed layers survive Stop/Restart',async()=>{
  const tasks=[],f=fixture({render:recording=>{const task=deferred();tasks.push({task,recording});return task.promise;}}),l=f.looper;
  await l.start();await l.startRecording();f.command(note);f.at(.2);const first=l.finishRecording();await turn();
  await l.stop();assert.equal(l.running,false);assert.equal(l.recording,false);assert(f.stops.length);assert.equal(f.timers.size,0);
  await l.start();tasks[0].task.resolve(pcm(tasks[0].recording));assert.equal(await first,null);assert.equal(l.units.length,0);
  await l.startRecording();f.command(note);f.at(.4);const second=l.finishRecording();await turn();tasks[1].task.resolve(pcm(tasks[1].recording));await second;
  const unit=l.units[0];await l.stop();assert.equal(l.units[0],unit);f.at(3);await l.start();
  assert.equal(f.starts.at(-1).units[0],unit);assert.equal(f.starts.at(-1).config.startTime,3.05);
  await l.startRecording();f.command(note);await l.clear();assert.equal(l.units.length,0);assert.equal(l.loopLength,null);assert.equal(l.running,false);assert.equal(l.getState().pcmBytes,0);
});

test('render failure and layer/memory bounds preserve already playing layers and report a useful state',async()=>{
  let fail=false;
  const f=fixture({maxPCMBytes:14000,render:async recording=>{if(fail)throw Error('conversion failed');return pcm(recording);}}),l=f.looper;
  await l.start();await layer(f,.2);const original=l.units[0];f.at(.3);await l.startRecording();f.command(note);f.at(.45);fail=true;
  assert.equal(await l.finishRecording(),null);assert.equal(l.units[0],original);assert.equal(l.running,true);
  assert(f.states.some(state=>state.reason==='record-error'&&state.error.message==='conversion failed'));
  fail=false;f.at(.5);await l.startRecording();f.command(note);f.at(.6);assert.equal(await l.finishRecording(),null);
  assert.equal(l.units.length,1);assert(f.states.some(state=>state.error?.message.includes('memory limit')));
  const one=fixture({maxUnits:1});await one.looper.start();await layer(one,.2);assert.equal(await one.looper.startRecording(),null);
  assert.equal(one.looper.units.length,1);assert(one.states.at(-1).error.message.includes('layer limit'));
});

test('auto-stop closes one overdub and late canceled callbacks cannot restart capture or append layers',async()=>{
  const f=fixture(),l=f.looper;await l.start();await layer(f,.5);f.at(.8);await l.startRecording();f.command(note);
  const timer=[...f.timers.values()][0];await l.stop();f.at(2);timer.fn();await turn();
  assert.equal(l.units.length,1);assert.equal(l.recording,false);assert.equal(l.running,false);assert.equal(f.adds.length,0);
});

test('playback callback failure rolls back only the attempted layer and Undo serializes a competing new capture',async()=>{
  let failStart=true,failAdd=false;
  const removes=[],removing=deferred();
  const f=fixture({startPlayback:()=>{if(failStart)throw Error('start failed');},addPlaybackUnit:()=>{if(failAdd)throw Error('add failed');},
    removePlaybackUnit:unit=>{removes.push(unit);if(unit.id==='psg-unit-2')return removing.promise;}}),l=f.looper;
  await l.start();assert.equal(await layer(f,.2),null);assert.equal(l.units.length,0);assert.equal(l.loopLength,null);assert(f.stops.length);
  failStart=false;await layer(f,.2);const original=l.units[0];failAdd=true;f.at(.5);assert.equal(await layer(f,.1),null);
  assert.equal(l.units[0],original);assert.equal(l.units.length,1);assert.equal(removes.at(-1).id,'psg-unit-3');
  const undo=l.undo();await turn();assert.equal(l.getState().busy,true);
  const pendingRecord=l.startRecording();assert.equal(l.recording,false);removing.resolve();await undo;await pendingRecord;
  assert.equal(l.loopLength,null);assert.equal(l.currentUnit.offsetSeconds,0);assert.equal(l.recording,true);await l.stop();
});

test('PCM preparation precedes choosing start time and preserves the performed period after an asynchronous delay',async()=>{
  const prepared=deferred(),requests=[];
  const f=fixture({preparePlaybackUnit:(unit,options)=>{requests.push({unit,options});return prepared.promise;}}),l=f.looper;
  await l.start();await l.startRecording();f.command(note);f.at(.2);const done=l.finishRecording();await turn();await turn();
  assert.equal(requests.length,1);assert.equal(requests[0].options.loopLength,.2);assert.equal(f.starts.length,0);
  assert.equal(l.getState().rendering,true);f.at(4);prepared.resolve();await done;
  assert.equal(l.loopLength,.2);assert.equal(f.starts[0].config.startTime,4.05);assert.equal(f.starts[0].units[0],requests[0].unit);
});

test('Stop and Undo cancel pending PCM preparation without starting or appending the stale layer',async()=>{
  for(const action of ['stop','undo']) {
    const prepared=deferred(),requests=[];
    const f=fixture({preparePlaybackUnit:(unit,options)=>{requests.push({unit,options});return prepared.promise;}}),l=f.looper;
    await l.start();await l.startRecording();f.command(note);f.at(.2);const done=l.finishRecording();await turn();await turn();
    assert.equal(requests.length,1);await l[action]();assert.equal(requests[0].options.signal.aborted,true);
    prepared.resolve();assert.equal(await done,null);assert.equal(l.units.length,0);assert.equal(f.starts.length,0);
  }
});

test('resume prepares saved layers before selecting its new epoch and Undo cancels an in-flight resume',async()=>{
  let pending=null;const requests=[];
  const f=fixture({preparePlaybackUnit:(unit,options)=>{requests.push({unit,options});return pending?.promise;}}),l=f.looper;
  await l.start();await layer(f,.2);const unit=l.units[0];await l.stop();f.at(2);pending=deferred();
  const resumed=l.start();await turn();assert.equal(requests.at(-1).unit,unit);assert.equal(f.starts.length,1);
  f.at(5);pending.resolve();await resumed;assert.equal(f.starts.at(-1).config.startTime,5.05);
  await l.stop();f.at(6);pending=deferred();const canceled=l.start();await turn();const signal=requests.at(-1).options.signal;
  await l.undo();assert.equal(signal.aborted,true);assert.equal(l.running,false);assert.equal(l.units.length,0);
  const starts=f.starts.length;pending.resolve();assert.equal(await canceled,null);assert.equal(f.starts.length,starts);
});
