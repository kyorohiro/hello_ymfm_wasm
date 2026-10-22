import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeGenesisSynth} from './native_genesis_synth.js';

function fixture(){
  const calls=[];let held,release,statusError;
  const status={session:17,sampleRate:48000,frame:0,running:true,queued:0,lateCommands:0,queueOverflows:0,
    liveFx:{active:1,processCalls:12,underruns:2,overruns:3,latencyFrames:2048}};
  const synth=new NativeGenesisSynth({now:()=>10,invoke:async(command,args)=>{
    calls.push({command,args});
    if(command==='native_genesis_status'&&held){await held;held=null;}
    if(command==='native_genesis_status'&&statusError){const error=statusError;statusError=null;throw error;}
    return {...status,liveFx:{...status.liveFx}};
  }});
  return {synth,status,calls,hold(){held=new Promise(resolve=>{release=resolve;});},release(){release();},failNextStatus(){statusError=new Error('status unavailable');}};
}

test('Native diagnostics reads counters once without reanchoring time or emitting audio writes',async t=>{
  const f=fixture();t.after(()=>f.synth.close());await f.synth.start();f.calls.length=0;
  const anchor={seconds:f.synth.clock.anchorSeconds,ms:f.synth.clock.anchorMs};
  f.status.frame=48000;f.status.queued=10;f.status.lateCommands=5;f.status.queueOverflows=2;
  const snapshot=await f.synth.readAudioDiagnostics();
  assert.deepEqual(f.calls,[{command:'native_genesis_status',args:{session:17}}]);
  assert.equal(snapshot.mode,'genesis');assert.equal(snapshot.engine,'ymfm');assert.equal(snapshot.frame,48000);
  assert.equal(snapshot.queued,10);assert.equal(snapshot.lateCommands,5);assert.equal(snapshot.queueOverflows,2);
  assert.deepEqual(snapshot.liveFx,{active:1,processCalls:12,underruns:2,overruns:3,latencyFrames:2048});
  assert.deepEqual({seconds:f.synth.clock.anchorSeconds,ms:f.synth.clock.anchorMs},anchor);
  assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);
});

test('Native diagnostics cannot start an idle device and discards late snapshots after shutdown',async()=>{
  const f=fixture();await assert.rejects(f.synth.readAudioDiagnostics(),/not ready/);assert.equal(f.calls.length,0);
  await f.synth.start();f.hold();const reading=f.synth.readAudioDiagnostics();const rejected=assert.rejects(reading,{name:'AbortError'});
  await f.synth.close();f.release();await rejected;assert.equal(f.synth.state,'closed');
});

test('Native diagnostic counters reject invalid values without changing audio state',async t=>{
  const f=fixture();t.after(()=>f.synth.close());await f.synth.start();
  Object.assign(f.status,{queued:-1,lateCommands:NaN,queueOverflows:9007199254740992});
  const snapshot=await f.synth.readAudioDiagnostics();assert.equal(snapshot.queued,null);assert.equal(snapshot.lateCommands,null);assert.equal(snapshot.queueOverflows,null);
  f.status.frame=-1;await assert.rejects(f.synth.readAudioDiagnostics(),/invalid diagnostic/);
  f.status.frame=0;f.status.session=18;await assert.rejects(f.synth.readAudioDiagnostics(),/invalid diagnostic/);
  assert.equal(f.synth.state,'ready');assert.equal(f.synth.session,17);
});

test('Concurrent diagnostics share one IPC across Stop and reject snapshots from the previous Run',async t=>{
  const f=fixture();t.after(()=>f.synth.close());await f.synth.start();f.calls.length=0;f.hold();
  const first=assert.rejects(f.synth.readAudioDiagnostics(),{name:'AbortError'});
  const concurrent=assert.rejects(f.synth.readAudioDiagnostics(),{name:'AbortError'});
  await f.synth.stopNativeAudio();
  const afterStop=assert.rejects(f.synth.readAudioDiagnostics(),{name:'AbortError'});
  assert.equal(f.calls.filter(call=>call.command==='native_genesis_status').length,1);
  f.release();await Promise.all([first,concurrent,afterStop]);
  assert.equal(f.synth.diagnosticsReading,null);
  assert.equal((await f.synth.readAudioDiagnostics()).session,17);
  assert.equal(f.calls.filter(call=>call.command==='native_genesis_status').length,2);
});

test('A failed shared diagnostic read releases its IPC slot without interrupting audio',async t=>{
  const f=fixture();t.after(()=>f.synth.close());await f.synth.start();f.calls.length=0;f.failNextStatus();
  await Promise.all([assert.rejects(f.synth.readAudioDiagnostics(),/status unavailable/),assert.rejects(f.synth.readAudioDiagnostics(),/status unavailable/)]);
  assert.equal(f.calls.length,1);assert.equal(f.synth.state,'ready');
  assert.equal((await f.synth.readAudioDiagnostics()).session,17);assert.equal(f.calls.length,2);
});
