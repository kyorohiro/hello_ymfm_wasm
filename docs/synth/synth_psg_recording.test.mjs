import test from 'node:test';
import assert from 'node:assert/strict';
import {createPsgPreset} from './synth_psg_preset.js';
import {SynthPsgRecordingManager,PSG_RECORDING_FORMAT,PSG_RECORDING_MAX_SECONDS,PSG_RECORDING_MAX_COMMANDS,
  normalizePsgRecording,normalizePsgRecordingCommand} from './synth_psg_recording.js';

const settings=patch=>createPsgPreset(patch).settings;
const document=(commands=[{time:0,type:'noteOn',channel:0,block:4,fnum:1083},{time:.1,type:'noteOff',channel:0}],patch={})=>({
  format:PSG_RECORDING_FORMAT,version:1,durationSeconds:.2,initialState:{settings:settings(),pitchClock:7670454},commands,...patch,
});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(initial={}) {
  let time=0,current=settings(initial),clock=7670454,stopCalls=0,stopped=0;
  const changes=[],requests=[];
  const manager=new SynthPsgRecordingManager({now:()=>time,getSettings:()=>current,getPitchClock:()=>clock,
    onChange:state=>changes.push({...state}),onPlaybackStopped:()=>stopped++,stopPlayback:()=>stopCalls++,
    startPlayback:(recording,options)=>{const task=deferred();requests.push({recording,options,...task});return task.promise;}});
  return {manager,changes,requests,at:value=>{time=value;},setSettings:value=>{current=settings(value);},getSettings:()=>current,
    setClock:value=>{clock=value;},get stopCalls(){return stopCalls;},get stopped(){return stopped;}};
}

test('PSG records applied semantic notes, bend and settings as detached ordered JSON with the full initial sound',()=>{
  const f=fixture(),m=f.manager;assert.equal(m.exportRecording(),null);assert.equal(m.hasNotes,false);m.startRecord();
  m.recordCommand({type:'noteOn',channel:0,block:4,fnum:1083});f.at(.1);m.recordCommand({type:'setFrequency',channel:0,block:4,fnum:1200});
  assert.equal(m.hasNotes,true);assert.equal(m.commandCount,2);
  const next=settings({attenuation:9});f.at(.2);m.recordCommand({type:'setSettings',settings:next});next.attenuation=0;next.envelope.enabled=true;
  f.at(.3);m.recordCommand({type:'noteOff',channel:0});f.at(.4);const result=m.stopRecord();
  assert.deepEqual(result.commands.map(command=>[command.time,command.type]),[[0,'noteOn'],[.1,'setFrequency'],[.2,'setSettings'],[.3,'noteOff']]);
  assert.equal(result.commands[2].settings.attenuation,9);assert.equal(result.commands[2].settings.envelope.enabled,false);
  assert.equal(result.initialState.settings.attenuation,6);assert.equal(result.initialState.pitchClock,7670454);assert.equal(result.durationSeconds,.4);
  assert.deepEqual(normalizePsgRecording(JSON.parse(JSON.stringify(result))),result);
  assert.equal(m.hasNotes,true);assert.equal(m.commandCount,4);
  result.initialState.settings.envelope.attackMs=999;result.commands[0].fnum=1;assert.equal(m.exportRecording().commands[0].fnum,1083);
  assert.equal(m.exportRecording().initialState.settings.envelope.attackMs,10);assert.equal(m.isRecording(),false);
  assert(f.changes.some(change=>change.reason==='record-command'&&change.commandCount===4));
});

test('stopping closes held channels and retains independent captured release tails after later ADSR edits',()=>{
  const f=fixture({envelope:{enabled:true,releaseMs:500}}),m=f.manager;m.startRecord();
  m.recordCommand({type:'noteOn',channel:0,block:4,fnum:1000});f.at(.1);m.recordCommand({type:'noteOff',channel:0});
  f.at(.15);m.recordCommand({type:'setSettings',settings:settings({envelope:{enabled:true,releaseMs:100}})});
  f.at(.2);m.recordCommand({type:'noteOn',channel:1,block:4,fnum:1200});f.at(.25);
  const result=m.stopRecord();assert.equal(result.durationSeconds,.6,'the earlier released voice retains its 500ms release snapshot');
  assert.deepEqual(result.commands.at(-1),{type:'noteOff',time:.25,channel:1});
  assert.equal(result.commands.filter(command=>command.type==='noteOff'&&command.channel===0).length,1);
  const again=m.stopRecord();assert.deepEqual(again,result,'repeated Stop cannot append another release or extend the take');
});

test('source/envelope toggles and explicit stop cancel old tails while retrigger only replaces that physical channel',()=>{
  const f=fixture({envelope:{enabled:true,releaseMs:5000}}),m=f.manager;m.startRecord();m.recordCommand({type:'noteOn',channel:0,block:4,fnum:1000});
  f.at(.1);m.recordCommand({type:'noteOff',channel:0});f.at(.2);m.recordCommand({type:'noteOn',channel:0,block:4,fnum:1200});
  f.at(.3);m.recordCommand({type:'setSettings',settings:settings({source:'noise',envelope:{enabled:true,releaseMs:200}})});
  m.recordCommand({type:'noteOn',channel:3,block:4,fnum:1000});f.at(.4);m.recordCommand({type:'noteOff',channel:3});
  f.at(.5);m.recordCommand({type:'stop'});f.at(.55);assert.equal(m.stopRecord().durationSeconds,.55);
  m.startRecord();m.recordCommand({type:'noteOn',channel:0,block:4,fnum:1000});f.at(.65);
  m.recordCommand({type:'setSettings',settings:settings({envelope:{enabled:false}})});f.at(.7);assert.equal(m.stopRecord().durationSeconds,.1499999999999999);
});

test('invalid files reject unknown fields, foreign formats, unordered times, wrong source channels and unbounded data atomically',()=>{
  const original=document(),before=structuredClone(original);
  const badFiles=[
    {...original,format:'megasynth-recording-v1'},{...original,version:2},{...original,extra:true},
    {...original,durationSeconds:NaN},{...original,durationSeconds:PSG_RECORDING_MAX_SECONDS+1},
    {...original,initialState:{...original.initialState,pitchClock:0}},
    {...original,initialState:{settings:{source:'tone'},pitchClock:7670454}},
    {...original,initialState:{...original.initialState,extra:true}},
    {...original,commands:[{time:.2,type:'stop'},{time:.1,type:'stop'}]},
    {...original,commands:[{time:.3,type:'stop'}]},
    {...original,commands:[{time:0,type:'noteOn',channel:3,block:4,fnum:1000}]},
    {...original,commands:[{time:0,type:'noteOn',channel:0,block:4,fnum:0}]},
    {...original,commands:[{time:0,type:'noteOff',channel:4}]},
    {...original,commands:[{time:0,type:'write',value:128}]},
    {...original,commands:[{time:0,type:'stop',extra:true}]},
    {...original,commands:[{type:'stop'}]},
    {...original,commands:[{time:0,type:'setSettings',settings:{...settings(),envelope:{enabled:true}}}]},
    {...original,commands:Array.from({length:PSG_RECORDING_MAX_COMMANDS+1},()=>({time:0,type:'stop'}))},
  ];
  for(const bad of badFiles)assert.throws(()=>normalizePsgRecording(bad));
  assert.deepEqual(original,before);
  assert.deepEqual(normalizePsgRecordingCommand({type:'stop'}),{type:'stop'});
  assert.throws(()=>normalizePsgRecordingCommand({type:'__proto__'}));
});

test('live malformed commands do not append or advance the recorder; the audio clock cannot reorder a take',()=>{
  const f=fixture(),m=f.manager;m.startRecord();f.at(.2);m.recordCommand({type:'noteOn',channel:0,block:4,fnum:1000});
  const before=m.exportRecording();
  for(const command of [{type:'noteOn',channel:3,block:4,fnum:1000},{type:'setSettings',settings:{source:'tone'}},{type:'stop',time:0}])assert.throws(()=>m.recordCommand(command));
  assert.deepEqual(m.exportRecording(),before);f.at(.1);m.recordCommand({type:'noteOff',channel:0});
  const result=m.stopRecord();assert.deepEqual(result.commands.map(command=>command.time),[.2,.2]);assert.equal(result.durationSeconds,.2);
});

test('a settings-only empty take does not start playback or restore an older take unexpectedly',async()=>{
  const f=fixture(),m=f.manager;m.importRecording(document());m.startRecord();f.at(.3);m.recordCommand({type:'setSettings',settings:settings({attenuation:12})});
  f.at(.5);const result=m.stopRecord();assert.deepEqual(result.commands,[]);assert.equal(result.durationSeconds,.5);
  assert.equal(await m.playRecording(null,{loop:true}),null);assert.equal(f.requests.length,0);assert.equal(m.isRecordingPlaybackActive(),false);assert.equal(m.hasNotes,false);
});

test('invalid import/playback leaves the current take, active sound and playback generation untouched',async()=>{
  const f=fixture(),m=f.manager;m.importRecording(document());const task=m.playRecording(null,{loop:true});
  assert.equal(f.requests.length,1);f.requests[0].resolve();await task;
  const before=m.exportRecording();
  assert.throws(()=>m.importRecording({...document(),format:'megasynth-recording-v1'}));
  await assert.rejects(m.playRecording({...document(),commands:[{time:.9,type:'stop'}]}));
  await assert.rejects(m.playRecording(null,{loop:'yes'}));
  assert.deepEqual(m.exportRecording(),before);assert.equal(f.stopCalls,0);assert.equal(m.isRecordingPlaybackActive(),true);
  assert.equal(f.requests[0].options.signal.aborted,false);m.stopRecordingPlayback();
});

test('Ignore sound snapshots the current settings while replay always leaves editor state and the stored take untouched',async()=>{
  const f=fixture({source:'noise',attenuation:11,envelope:{enabled:true,releaseMs:400}}),m=f.manager;m.importRecording(document());
  f.setClock(8000000);const own=structuredClone(f.getSettings()),original=m.exportRecording();
  const task=m.playRecording(null,{loop:true,ignorePatch:true});const request=f.requests[0];
  assert.deepEqual(request.options.settings,own);assert.equal(request.options.pitchClock,8000000);assert.equal(request.options.loop,true);assert.equal(request.options.ignorePatch,true);
  f.getSettings().attenuation=1;assert.equal(request.options.settings.attenuation,11,'later GUI edits cannot mutate playback sound captured at Play');
  request.recording.commands[0].fnum=1;request.options.settings.envelope.enabled=false;request.resolve();await task;
  assert.deepEqual(m.exportRecording(),original);assert.equal(f.getSettings().envelope.enabled,true,'playback does not apply recorded settings to the editor');
  request.options.onEnded();assert.equal(m.isRecordingPlaybackActive(),false);assert.equal(f.stopped,1);assert.equal(f.stopCalls,0);
});

test('stop and a newer Play cancel pending audio preparation; stale resolve/reject/end cannot stop the newer playback',async()=>{
  const f=fixture(),m=f.manager;m.importRecording(document());
  const old=m.playRecording(null,{loop:true}),first=f.requests[0];assert(m.isRecordingPlaybackActive());
  assert.equal(m.stopRecordingPlayback(),true);assert(first.options.signal.aborted);assert.equal(f.stopCalls,1);
  const next=m.playRecording(null,{loop:true}),second=f.requests[1];
  first.options.onEnded();first.resolve();assert.equal(await old,null);assert(m.isRecordingPlaybackActive());assert.equal(f.stopCalls,1);
  second.resolve();await next;assert.equal(second.options.signal.aborted,false);
  second.options.onEnded();assert.equal(m.isRecordingPlaybackActive(),false);assert.equal(f.stopped,2);
  assert.equal(m.stopRecordingPlayback(),false);assert.equal(f.stopCalls,1,'a completed run does not stop an unrelated later endpoint');
  const stale=m.playRecording(),third=f.requests[2];const newer=m.playRecording(),fourth=f.requests[3];
  third.reject(new Error('obsolete preparation failed'));assert.equal(await stale,null);assert(m.isRecordingPlaybackActive());fourth.resolve();await newer;m.stopRecordingPlayback();
});

test('a current preparation error retires only its run, and starting a fresh take cancels pending playback',async()=>{
  const f=fixture(),m=f.manager;m.importRecording(document());const task=m.playRecording(),request=f.requests[0];
  request.reject(new Error('PSG device unavailable'));await assert.rejects(task,/PSG device unavailable/);assert.equal(m.isRecordingPlaybackActive(),false);assert.equal(f.stopCalls,1);
  const pending=m.playRecording(),next=f.requests[1];m.startRecord();assert(next.options.signal.aborted);assert(m.isRecording());
  next.resolve();assert.equal(await pending,null);assert.equal(m.isRecordingPlaybackActive(),false);
  assert.throws(()=>m.importRecording(document()),/Stop PSG recording/);m.stopRecord();
});
