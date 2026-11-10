// Silent event capture and validation; no AudioContext or playback device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPcmBuiltinPreset,normalizePcmPreset,PCM_ENCODING,PCM_MAX_FRAMES} from './synth_pcm.js';
import {SynthPcmRecordingManager,normalizePcmRecording,normalizePcmRecordingCommand,
  PCM_RECORDING_FORMAT,PCM_RECORDING_MAX_SECONDS,PCM_RECORDING_MAX_COMMANDS,PCM_RECORDING_MAX_JSON_BYTES,PCM_RECORDING_MAX_BANKS} from './synth_pcm_recording.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const preset=(shape='sine',patch={})=>{const value=createPcmBuiltinPreset(shape);return normalizePcmPreset({...value,settings:{...value.settings,...patch}});};
function recording() {
  return {format:PCM_RECORDING_FORMAT,version:1,durationSeconds:.25,initialState:{preset:preset(),pitchClock:7670454},
    commands:[{time:0,type:'noteOn',channel:7,block:4,fnum:644},{time:.25,type:'noteOff',channel:7}]};
}
function fixture(initial=preset()) {
  let time=0,current=initial,clock=7670454;
  const requests=[],changes=[];let stopped=0,stopCalls=0;
  const manager=new SynthPcmRecordingManager({now:()=>time,getPreset:()=>current,getPitchClock:()=>clock,
    onChange:detail=>changes.push(detail),onPlaybackStopped:()=>stopped++,
    startPlayback:(value,options)=>{const task=deferred();requests.push({recording:value,options,...task});return task.promise;},
    stopPlayback:()=>stopCalls++});
  return {manager,requests,changes,at:value=>{time=value;},setPreset:value=>{current=value;},getPreset:()=>current,setClock:value=>{clock=value;},
    get stopped(){return stopped;},get stopCalls(){return stopCalls;}};
}

test('PCM recording format loads and validates without TextEncoder in an AudioWorklet-like global',async()=>{
  const previous=globalThis.TextEncoder;
  try {
    globalThis.TextEncoder=undefined;
    const portable=await import('./synth_pcm_recording.js?worklet-no-text-encoder');
    const value=recording();value.initialState.preset.sample.name='PCM 🎹 ひらがな';
    assert.deepEqual(portable.normalizePcmRecording(value),value);
    const manager=new portable.SynthPcmRecordingManager({now:()=>0,getPreset:()=>value.initialState.preset});
    manager.startRecord();manager.recordCommand({type:'noteOn',channel:7,block:4,fnum:644});
    assert.equal(manager.stopRecord().commands.length,2);
  } finally {globalThis.TextEncoder=previous;}
});

test('PCM take captures full initial sample, eight channels, settings, source changes and same-time operation order',()=>{
  const f=fixture(),m=f.manager;m.startRecord();
  for(let channel=0;channel<8;channel++)m.recordCommand({type:'noteOn',channel,block:4,fnum:644+channel});
  f.at(.1);m.recordCommand({type:'setFrequency',channel:7,block:4,fnum:700});
  m.recordCommand({type:'setSettings',settings:preset('sine',{volume:73,panLeft:0,panRight:15,loopStart:12}).settings});
  f.at(.2);m.recordCommand({type:'setSettings',settings:preset('sine',{loopEnd:128}).settings});
  m.recordCommand({type:'noteOn',channel:3,block:4,fnum:644});
  const triangle=preset('triangle',{loopEnabled:false});m.recordCommand({type:'setPreset',preset:triangle});
  m.recordCommand({type:'noteOn',channel:6,block:3,fnum:1000});f.at(.3);const result=m.stopRecord();
  assert.equal(result.initialState.preset.sample.data,preset().sample.data);
  assert.equal(result.format,PCM_RECORDING_FORMAT);assert.equal(result.durationSeconds,.3);
  assert.deepEqual(result.commands.slice(0,8).map(command=>command.channel),[0,1,2,3,4,5,6,7]);
  assert.deepEqual(result.commands.filter(command=>command.time===.2).map(command=>command.type),['setSettings','noteOn','setPreset','noteOn']);
  assert.deepEqual(result.commands.at(-1),{type:'noteOff',time:.3,channel:6},'sample changes clear previous held channels');
  assert.equal(result.commands.filter(command=>command.type==='noteOff').length,1);
  assert.equal(m.commandCount,result.commands.length);assert(m.hasNotes);assert(!m.isRecording());
  assert.deepEqual(normalizePcmRecording(JSON.parse(JSON.stringify(result,null,2))),result);
  result.initialState.preset.settings.volume=0;result.commands[0].fnum=1;triangle.sample.name='Mutated';
  assert.equal(m.exportRecording().initialState.preset.settings.volume,64);assert.equal(m.exportRecording().commands[0].fnum,644);
  assert.equal(m.exportRecording().commands.find(command=>command.type==='setPreset').preset.sample.name,'Triangle');
});

test('held notes survive Loop End shrink and grow and receive their final recorded releases',()=>{
  const f=fixture(),m=f.manager;m.startRecord();
  for(let channel=0;channel<8;channel++)m.recordCommand({type:'noteOn',channel,block:4,fnum:644+channel});
  f.at(.1);m.recordCommand({type:'setSettings',settings:preset('sine',{loopEnd:64}).settings});
  f.at(.2);m.recordCommand({type:'setSettings',settings:preset('sine',{loopEnd:192,loopStart:32}).settings});
  f.at(.3);const result=m.stopRecord();
  assert.deepEqual(result.commands.slice(-8),Array.from({length:8},(_,channel)=>({time:.3,type:'noteOff',channel})));
  assert.equal(result.commands.filter(command=>command.type==='noteOn').length,8);
  assert.equal(result.commands.filter(command=>command.type==='noteOff').length,8);
  assert.deepEqual(normalizePcmRecording(result),result);
});

test('Stop releases all eight held channels once and source stop clears them without invented releases',()=>{
  const f=fixture(),m=f.manager;m.startRecord();
  for(let channel=0;channel<8;channel++)m.recordCommand({type:'noteOn',channel,block:4,fnum:644});
  f.at(.4);const result=m.stopRecord();
  assert.deepEqual(result.commands.slice(-8).map(command=>[command.type,command.channel,command.time]),Array.from({length:8},(_,channel)=>['noteOff',channel,.4]));
  assert.deepEqual(m.stopRecord(),result);
  m.startRecord();m.recordCommand({type:'noteOn',channel:2,block:4,fnum:644});m.recordCommand({type:'stop'});f.at(.5);
  assert.equal(m.stopRecord().commands.filter(command=>command.type==='noteOff').length,0);
});

test('strict PCM imports reject foreign, partial, malformed, reversed or oversized events and samples atomically',()=>{
  const original=recording(),before=structuredClone(original),f=fixture();f.manager.importRecording(original);
  const cases=[{...original,format:'tetorica-sega-psg-recording-v1'},{...original,version:2},{...original,extra:true},
    {...original,durationSeconds:NaN},{...original,durationSeconds:PCM_RECORDING_MAX_SECONDS+1},
    {...original,initialState:{...original.initialState,pitchClock:0}},
    {...original,initialState:{...original.initialState,preset:{...preset(),version:2}}},
    {...original,initialState:{...original.initialState,extra:true}},
    {...original,commands:[{time:.2,type:'stop'},{time:.1,type:'stop'}]},
    {...original,commands:[{time:.3,type:'stop'}]},{...original,commands:[{type:'stop'}]},
    {...original,commands:[{time:0,type:'noteOn',channel:8,block:4,fnum:644}]},
    {...original,commands:[{time:0,type:'noteOn',channel:0,block:8,fnum:644}]},
    {...original,commands:[{time:0,type:'noteOn',channel:0,block:4,fnum:0}]},
    {...original,commands:[{time:0,type:'setSettings',settings:{volume:1}}]},
    {...original,commands:[{time:0,type:'setSettings',settings:preset('sine',{loopEnd:256}).settings},
      {time:.1,type:'setPreset',preset:{...preset(),sample:{...preset().sample,data:'gA=='},settings:preset('sine',{loopEnd:1}).settings}},
      {time:.2,type:'setSettings',settings:preset().settings}]},
    {...original,commands:[{time:0,type:'setPreset',preset:{...preset(),sample:{...preset().sample,data:'/w=='}}}]},
    {...original,commands:[{time:0,type:'stop',extra:1}]},{...original,commands:[{time:0,type:'__proto__'}]},
    {...original,commands:Array.from({length:PCM_RECORDING_MAX_COMMANDS+1},()=>({time:0,type:'stop'}))},
  ];
  for(const value of cases){assert.throws(()=>f.manager.importRecording(value));assert.deepEqual(f.manager.exportRecording(),before);}
  assert.deepEqual(original,before);assert.deepEqual(normalizePcmRecordingCommand({type:'stop'}),{type:'stop'});
  assert.throws(()=>normalizePcmRecordingCommand({type:'setSettings',settings:preset().settings},{frames:1}));
  assert.throws(()=>normalizePcmRecordingCommand({type:'stop'},{frames:0}));
  const long=preset();long.sample={...long.sample,encoding:PCM_ENCODING,data:btoa(String.fromCharCode(...new Uint8Array(PCM_MAX_FRAMES).fill(128)))};
  long.settings={...long.settings,loopEnd:PCM_MAX_FRAMES};
  const huge={...original,commands:Array.from({length:200},()=>({time:0,type:'setPreset',preset:long}))};
  assert.throws(()=>normalizePcmRecording(huge),/16 MiB/);assert.deepEqual(f.manager.exportRecording(),before);
});

test('live validation and backwards clock do not mutate a take, and command-limit failure leaves space for final key-ups',()=>{
  const f=fixture(),m=f.manager;m.startRecord();f.at(.2);m.recordCommand({type:'noteOn',channel:0,block:4,fnum:644});
  const before=m.exportRecording();
  for(const command of [{type:'noteOn',channel:8,block:4,fnum:644},{type:'setSettings',settings:{volume:1}},{type:'stop',time:0}])assert.throws(()=>m.recordCommand(command));
  assert.deepEqual(m.exportRecording(),before);f.at(.1);m.recordCommand({type:'noteOff',channel:0});
  assert.deepEqual(m.stopRecord().commands.map(command=>command.time),[.2,.2]);
  m.startRecord();m.recordCommand({type:'noteOn',channel:7,block:4,fnum:644});
  for(let index=1;index<PCM_RECORDING_MAX_COMMANDS-8;index++)m.recordCommand({type:'stop'});
  assert.throws(()=>m.recordCommand({type:'stop'}),/command limit/);
  assert(m.stopRecord().commands.length<=PCM_RECORDING_MAX_COMMANDS);
});

test('settings-only takes replace older notes with a silent empty take, while invalid clocks cannot start or append',async()=>{
  const f=fixture(),m=f.manager;m.importRecording(recording());m.startRecord();
  m.recordCommand({type:'setSettings',settings:preset('sine',{volume:2}).settings});f.at(.5);
  const empty=m.stopRecord();assert.deepEqual(empty.commands,[]);assert.equal(m.hasNotes,false);assert.equal(await m.playRecording(),null);assert.equal(f.requests.length,0);
  f.at(NaN);assert.throws(()=>m.startRecord(),/clock/);assert.deepEqual(m.exportRecording(),empty);
  f.at(0);m.startRecord();f.at(Infinity);assert.throws(()=>m.recordCommand({type:'stop'}),/clock/);
  f.at(PCM_RECORDING_MAX_SECONDS+1);assert.throws(()=>m.recordCommand({type:'stop'}),/time/);m.stopRecord();
});

test('current sound snapshots its sample and all settings at Play; playback never applies the take to the editor',async()=>{
  const f=fixture(preset('triangle',{volume:90,loopEnabled:false})),m=f.manager;m.importRecording(recording());f.setClock(8000000);
  const own=structuredClone(f.getPreset()),saved=m.exportRecording();const task=m.playRecording(null,{loop:true,ignorePatch:true}),request=f.requests[0];
  assert.equal(m.isRecordingPlaybackActive(),true);assert.deepEqual(request.options.preset,own);assert.equal(request.options.pitchClock,8000000);
  assert.equal(request.options.loop,true);assert.equal(request.options.ignorePatch,true);
  f.getPreset().sample.name='Later';assert.equal(request.options.preset.sample.name,'Triangle');
  request.options.preset.settings.volume=1;request.recording.commands[0].fnum=1;request.resolve();await task;
  assert.deepEqual(m.exportRecording(),saved);assert.equal(f.getPreset().settings.volume,90);
  request.options.onEnded();assert.equal(m.isRecordingPlaybackActive(),false);assert.equal(f.stopped,1);assert.equal(f.stopCalls,0);
});

test('invalid imports or playback preserve the active take/session and a newer Play cancels stale preparation and end callbacks',async()=>{
  const f=fixture(),m=f.manager;m.importRecording(recording());const old=m.playRecording(null,{loop:true}),first=f.requests[0];
  assert.throws(()=>m.importRecording({...recording(),format:'megasynth-recording-v1'}));
  await assert.rejects(m.playRecording({...recording(),commands:[{time:2,type:'stop'}]}));
  await assert.rejects(m.playRecording(null,{loop:'yes'}));assert.equal(f.stopCalls,0);assert(!first.options.signal.aborted);
  const next=m.playRecording(),second=f.requests[1];assert(first.options.signal.aborted);assert.equal(f.stopCalls,1);
  first.options.onEnded();first.reject(new Error('stale'));assert.equal(await old,null);assert(m.isRecordingPlaybackActive());
  second.resolve();await next;second.options.onEnded();assert(!m.isRecordingPlaybackActive());assert.equal(f.stopped,2);
  assert.equal(m.stopRecordingPlayback(),false);assert.equal(f.stopCalls,1);
});

test('Stop, current prepare errors and starting a fresh take retire only the owned playback generation',async()=>{
  const f=fixture(),m=f.manager;m.importRecording(recording());let task=m.playRecording(),request=f.requests[0];
  assert.equal(m.stopRecordingPlayback(),true);assert(request.options.signal.aborted);request.resolve();assert.equal(await task,null);
  task=m.playRecording();request=f.requests[1];request.reject(new Error('PCM endpoint unavailable'));await assert.rejects(task,/unavailable/);assert(!m.isRecordingPlaybackActive());
  task=m.playRecording();request=f.requests[2];m.startRecord();assert(request.options.signal.aborted);request.resolve();assert.equal(await task,null);
  assert(m.isRecording());assert.throws(()=>m.importRecording(recording()),/Stop PCM recording/);assert.throws(()=>m.startRecord(),/Stop PCM recording/);
  assert.throws(()=>new SynthPcmRecordingManager({getPreset:1}));m.stopRecord();
});

test('live sample changes honor the JSON budget without losing the accepted take, and readable export stays within input size bound',()=>{
  const f=fixture(),m=f.manager;m.startRecord();m.recordCommand({type:'noteOn',channel:7,block:4,fnum:644});
  const large=preset();large.sample={...large.sample,data:btoa(String.fromCharCode(...new Uint8Array(PCM_MAX_FRAMES).fill(128)))};large.settings={...large.settings,loopEnd:PCM_MAX_FRAMES};
  let accepted=0;
  assert.throws(()=>{for(;;){m.recordCommand({type:'setPreset',preset:large});accepted++;}},/16 MiB/);
  assert(accepted>100&&accepted<200);const take=m.stopRecord();assert(take.commands.some(command=>command.type==='noteOn'));
  const json=JSON.stringify(take,null,2);assert(new TextEncoder().encode(json).byteLength<PCM_RECORDING_MAX_JSON_BYTES);
  assert.deepEqual(normalizePcmRecording(JSON.parse(json)),take);
});

test('recording and import share the prepared-bank bound, deduplicate repeated banks and preserve the last valid take',()=>{
  const large=preset();large.sample={...large.sample,data:btoa(String.fromCharCode(...new Uint8Array(PCM_MAX_FRAMES).fill(128)))};
  large.settings={...large.settings,loopEnd:PCM_MAX_FRAMES};
  const f=fixture(large),m=f.manager;m.startRecord();m.recordCommand({type:'noteOn',channel:7,block:4,fnum:644});
  for(let end=1;end<PCM_RECORDING_MAX_BANKS;end++)m.recordCommand({type:'setSettings',settings:{...large.settings,loopEnd:end}});
  const before=m.exportRecording();assert.throws(()=>m.recordCommand({type:'setSettings',settings:{...large.settings,loopEnd:PCM_RECORDING_MAX_BANKS}}),/512.*RAM banks/);
  assert.deepEqual(m.exportRecording(),before,'rejected bank cannot append or replace the accepted sample/settings');
  const accepted=m.stopRecord();assert.deepEqual(normalizePcmRecording(accepted),accepted);
  const tooMany={...accepted,commands:[...accepted.commands,{time:accepted.durationSeconds,type:'setSettings',settings:{...large.settings,loopEnd:PCM_RECORDING_MAX_BANKS}}]};
  assert.throws(()=>m.importRecording(tooMany),/512.*RAM banks/);assert.deepEqual(m.exportRecording(),accepted);
  const repeated={...accepted,commands:Array.from({length:PCM_RECORDING_MAX_BANKS*3},(_,index)=>({time:0,type:'setSettings',settings:{...large.settings,loopEnd:index%2+1}}))};
  assert.doesNotThrow(()=>normalizePcmRecording(repeated),'revisiting an existing sample/end bank does not allocate another one');
});
