import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createNativeGenesisWorkerBridge} from './native_genesis_worker.js';
import {createDx7Client} from './playground_dx7.js';
import {createPerformanceHost} from './playground_performance_host.js';
import {createInitVoice,createVoiceSysex,createBankSysex} from './msfa_dx7/src/sysex.js';
import {presetToVoice,voiceToPreset} from './msfa_dx7/src/preset.js';

const ticks=async()=>{for(let index=0;index<30;index++)await Promise.resolve();};
function fixture(){
  let session=0,frame=0,revision=0,voices=[createInitVoice()],selectedVoice=0,failNext=false;
  const calls=[],errors=[],queued=[],notes=new Map();
  const status=()=>({session,sampleRate:48000,frame,running:true});
  const snapshot=()=>({voices:voices.map(voice=>Array.from(voice)),selectedVoice,revision,frame,
    pendingCommands:queued.map(command=>command.message.id).filter(Boolean),activeNotes:[...notes].map(([midi,entry])=>({midi,velocity:entry.velocity}))});
  function apply({message:m}){
    if(m.method==='load-bank'){voices=m.voices.map(voice=>new Uint8Array(voice));selectedVoice=0;notes.clear();}
    else if(m.method==='set-preset')voices[selectedVoice]=new Uint8Array(m.voice);
    else if(m.method==='edit-voice')for(const index of m.indices)voices[selectedVoice][index]=m.voice[index];
    else if(m.method==='select-voice')selectedVoice=m.index;
    else if(m.method==='note-on')notes.set(m.note,{velocity:m.velocity,voice:m.voice});
    else if(m.method==='note-off'){if(m.voice===undefined||notes.get(m.note)?.voice===m.voice)notes.delete(m.note);}
    else if(['panic','all-notes-off'].includes(m.method))notes.clear();
    revision++;
  }
  const invoke=async(command,args)=>{
    calls.push({command,args});
    if(command==='native_genesis_start'){session++;return status();}
    if(command==='native_genesis_stop'){queued.length=0;notes.clear();return status();}
    if(command==='native_genesis_status')return status();
    if(command==='native_genesis_dx7_status')return snapshot();
    if(command==='native_genesis_performance'&&args.op==='cancel-owner'){
      const retained=queued.filter(command=>command.performance!==args.performance||command.owner!==args.owner);queued.splice(0,queued.length,...retained);
    }
    if(command==='native_genesis_commands'&&failNext){failNext=false;throw new Error('DX7 control failed');}
    if(command==='native_genesis_commands')for(const command of args.commands)if(command.type==='dx7'){
      if(command.frame>frame)queued.push(command);else apply(command);
    }
  };
  const synth=new NativeGenesisSynth({invoke,now:()=>frame/48,mode:'dx7',onError:error=>errors.push(error)});
  return {synth,calls,errors,snapshot,failNext(){failNext=true;},commands:()=>calls.filter(call=>call.command==='native_genesis_commands').flatMap(call=>call.args.commands),
    advance(value){frame=value;for(const command of queued.splice(0).sort((a,b)=>a.frame-b.frame)){if(command.frame<=frame)apply(command);else queued.push(command);}}};
}

test('Native DX7 exposes only its real primary chip and preserves the common native clock and mixer',async()=>{
  const f=fixture();assert.equal(f.calls.length,0);await f.synth.start();
  assert.deepEqual(f.calls[0],{command:'native_genesis_start',args:{mode:'dx7'}});
  assert.equal(f.synth.fm,null);assert.equal(f.synth.psg,null);assert.equal(f.synth.pcm,null);
  assert.deepEqual(f.synth.primaryEndpoints,[{name:'dx7',globalName:'dx7',client:f.synth.dx7}]);
  assert.equal(f.synth.node,null);assert.equal(f.synth.audioContext,null);
  assert.equal(f.synth.capabilities.chip,'dx7');assert.equal(f.synth.capabilities.fmChannels,0);
  assert.equal(f.synth.capabilities.dac,false);assert.equal(f.synth.capabilities.psg,false);
  assert.deepEqual(f.synth.chipInspector.list().map(entry=>entry.id),['dx7']);
  assert.deepEqual(f.synth.mixer.list().map(entry=>entry.id),['dx7']);
  f.synth.mixer.set('dx7',{volume:.4,pan:-.25,muted:true});await f.synth.flush();
  assert.deepEqual(f.commands().at(-1).message,{method:'mix',volume:0,pan:-.25});
  await assert.rejects(f.synth.dispatchNativeCommand({type:'write',port:0,register:0x28,value:0xf0}),/OPN\/PSG/);
  await f.synth.close();assert.equal(f.errors.length,0);
});

test('shared preset and SysEx codecs preserve all fields while masked live edits touch only supplied parameters',async()=>{
  const f=fixture();await f.synth.start();const dx7=f.synth.dx7;
  await dx7.setPreset({name:'ORIGINAL',algorithm:5,feedback:4,operators:{1:{coarse:3,fine:7,outputLevel:80}}});
  const before=await dx7.getPreset();await dx7.setOperator(1,{outputLevel:80});
  const edit=f.commands().filter(command=>command.type==='dx7'&&command.message.method==='edit-voice').at(-1).message;
  assert.deepEqual(edit.indices,[121]);assert.equal(edit.voice[121],80);
  await dx7.setOperators([[1,{fine:10}],[6,{coarse:2}]]);await dx7.setFeedback(6);
  const after=await dx7.getPreset();assert.equal(after.name,before.name);assert.equal(after.algorithm,5);assert.equal(after.feedback,6);
  assert.equal(after.operators[1].coarse,3);assert.equal(after.operators[1].fine,10);assert.equal(after.operators[6].coarse,2);
  const bytes=createVoiceSysex(presetToVoice({name:'OFFSET'})),backing=new Uint8Array(bytes.length+8);backing.set(bytes,4);
  await dx7.loadSysex(backing.subarray(4,-4));assert.equal((await dx7.getPreset()).name,'OFFSET');
  const bad=bytes.slice();bad[bad.length-2]^=1;
  await assert.rejects(dx7.loadSysex(bad),/checksum/);assert.equal((await dx7.getPreset()).name,'OFFSET');
  await assert.rejects(dx7.setOperators([[1,{fine:2}],[1,{fine:3}]]),/Duplicate/);
  assert.equal(f.synth.state,'ready');await f.synth.close();
});

test('future Worker patches acknowledge logical state while inspector reports only native applied state',async()=>{
  const f=fixture();await f.synth.start();
  const result=await f.synth.dispatchNativeDx7Command({method:'setFeedback',args:[5],id:9},{time:1,performance:2,owner:3});
  assert.equal(result.id,9);assert.equal((await f.synth.dx7.getPreset()).feedback,5);
  const command=f.commands().at(-1);assert.equal(command.frame,48000);assert.equal(command.performance,2);assert.equal(command.owner,3);
  let snapshot=await f.synth.chipInspector.read('dx7');assert.equal(snapshot.preset.feedback,0);assert.equal(snapshot.logical.preset.feedback,5);assert.equal(snapshot.logical.pendingCommands,1);
  f.advance(48000);snapshot=await f.synth.chipInspector.read('dx7');assert.equal(snapshot.preset.feedback,5);assert.equal(snapshot.logical.pendingCommands,0);
  await f.synth.close();
});

test('queued DX7 edits snapshot mutable caller inputs and public bank selection remains synchronous',async()=>{
  const f=fixture();await f.synth.start();const dx7=f.synth.dx7;
  const preset={name:'COPY',feedback:3,operators:{1:{coarse:2}}},setting=dx7.setPreset(preset);
  preset.feedback=7;preset.operators[1].coarse=6;await setting;
  let state=await dx7.getPreset();assert.equal(state.feedback,3);assert.equal(state.operators[1].coarse,2);
  const params={fine:5},editing=dx7.setOperator(1,params);params.fine=40;await editing;
  assert.equal((await dx7.getPreset()).operators[1].fine,5);
  const bytes=createVoiceSysex(createInitVoice('CAPTURE')),loading=dx7.loadSysex(bytes);bytes.fill(0);await loading;
  assert.equal((await dx7.getPreset()).name,'CAPTURE');
  await dx7.loadSysex(createBankSysex(Array.from({length:32},(_,index)=>createInitVoice(`COPY ${index}`))));
  dx7.selectVoice(8);assert.equal(dx7.selectedVoice,8);await dx7.getState();assert.equal(dx7.selectedVoice,8);
  await f.synth.close();
});

test('Worker owner cancellation removes future patch projections and retires that owner\'s note leases',async()=>{
  const f=fixture();await f.synth.start();
  await f.synth.dispatchNativeDx7Command({method:'setFeedback',args:[5],id:1},{time:1,performance:2,owner:3});
  await f.synth.dispatchNativeDx7Command({method:'noteOn',args:[60,100]},{performance:2,owner:3});
  assert.equal((await f.synth.dx7.getPreset()).feedback,5);
  await f.synth.setNativePerformance({op:'cancel-owner',performance:2,owner:3});
  assert.equal((await f.synth.dx7.getPreset()).feedback,0);
  await f.synth.dispatchNativeDx7Command({method:'noteOff',args:[60]},{performance:2,owner:3});
  assert.equal(Object.hasOwn(f.commands().at(-1).message,'voice'),false);
  await f.synth.close();
});

test('Native inspector edit failures reject the UI operation instead of disappearing in its serial queue',async()=>{
  const f=fixture();await f.synth.start();f.failNext();
  await assert.rejects(f.synth.chipInspector.invoke('dx7','setFeedback',[4]),/DX7 control failed/);
  await ticks();assert.equal(f.synth.state,'error');assert.equal(f.errors.length,1);await f.synth.close();
});

test('manual keyboard audition identities use native leases and block conflicting script edits',async()=>{
  const f=fixture();await f.synth.start();const inspector=f.synth.chipInspector;
  await inspector.invoke('dx7','auditionOn',[0,60,'old',100]);
  const old=f.commands().filter(command=>command.message?.method==='note-on').at(-1).message;
  await inspector.invoke('dx7','auditionOn',[0,60,'new',90]);
  const newer=f.commands().filter(command=>command.message?.method==='note-on').at(-1).message;
  assert(old.audition);assert(newer.audition);assert.notEqual(old.voice,newer.voice);
  let snapshot=await inspector.read('dx7');assert.deepEqual(snapshot.activeNotes,[{midi:60,velocity:90,manual:true}]);
  assert.equal(await inspector.invoke('dx7','auditionOff',[0,'old']),false);
  const count=f.commands().length;
  await f.synth.dispatchNativeDx7Command({method:'setFeedback',args:[7],id:1},{time:1,performance:2,owner:3});
  assert.equal(f.commands().length,count,'manual patch lease also blocks a newly accepted future edit');
  await assert.rejects(f.synth.dx7.loadSysex(createVoiceSysex(createInitVoice())),/manual audition/);
  await inspector.invoke('dx7','setFeedback',[3]);snapshot=await inspector.read('dx7');assert.equal(snapshot.preset.feedback,3);
  await inspector.invoke('dx7','auditionOff',[0,'new']);assert.equal((await inspector.read('dx7')).activeNotes.length,0);
  await f.synth.close();assert.equal(f.errors.length,0);
});

test('Stop retains the actual bank and cancels projected future patches before the next Run',async()=>{
  const f=fixture();await f.synth.start();
  await f.synth.dx7.loadSysex(createBankSysex(Array.from({length:32},(_,index)=>createInitVoice(`VOICE ${index}`))));
  f.synth.dx7.selectVoice(7);await ticks();await f.synth.flush();
  await f.synth.dx7.setFeedback(4);
  await f.synth.dispatchNativeDx7Command({method:'setFeedback',args:[6],id:2},{time:10,performance:1,owner:1});
  await f.synth.stopNativeAudio();
  const state=await f.synth.dx7.getState();assert.equal(state.selectedVoice,7);assert.equal(state.voices.length,32);
  assert.equal((await f.synth.dx7.getPreset()).feedback,4);
  assert.equal((await f.synth.chipInspector.read('dx7')).logical.pendingCommands,0);
  await f.synth.close();
});

test('existing DX7 client runs through real Native Worker MessagePorts with request acknowledgements',async()=>{
  const f=fixture();await f.synth.start();const errors=[];
  const bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:error=>errors.push(error)});
  const host=createPerformanceHost({getContext:()=>f.synth.clock});await host.start([bridge.port],.1);
  const client=createDx7Client(bridge.dx7Port,f.synth.dx7._getState());
  try{
    await client.setPreset({name:'PORT DX7',operators:{1:{outputLevel:70}}});
    assert.equal((await client.getPreset()).name,'PORT DX7');
    client.noteOn(64,90);await client.getState();assert.equal((await f.synth.chipInspector.read('dx7')).activeNotes[0].midi,64);
    client.noteOff(64);await client.getState();assert.equal((await f.synth.chipInspector.read('dx7')).activeNotes.length,0);
    client.noteOn(65,90);await client.getState();client.noteOn(65,0);await client.getState();
    assert.equal((await f.synth.chipInspector.read('dx7')).activeNotes.length,0,'velocity zero releases the existing lease');
    await client.loadSysex(createVoiceSysex(createInitVoice('PORT LOAD')));assert.equal(client.voices[0].name,'PORT LOAD');
    assert.equal(errors.length,0);
  }finally{client.dispose();host.stop();await bridge.dispose();await f.synth.close();}
});
