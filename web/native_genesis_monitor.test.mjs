import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGenesisMonitor} from './native_genesis_monitor.js';
import {NativeGenesisSynth} from './native_genesis_synth.js';

const gate=()=>{let resolve,reject;return {promise:new Promise((yes,no)=>{resolve=yes;reject=no;}),resolve,reject};};
const ticks=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const snapshot=(mode,session=1)=>({session,frame:10000,sampleRate:48000,frames:4096,rms:.25,peak:.5,
  ...(mode==='waveform'?{samples:Array(4096).fill(.25)}:{}),...(mode==='spectrum'?{bins:Array(2048).fill(-40)}:{})});
function fixture(override=()=>undefined) {
  const calls=[];let session=1,ready=true;
  const monitor=createNativeGenesisMonitor({getSession:()=>session,getSampleRate:()=>48000,isReady:()=>ready,
    invoke:async(command,args)=>{calls.push([command,args]);return override(command,args)??(args.mode==='off'?null:snapshot(args.mode,args.session));}});
  return {monitor,calls,setSession:value=>{session=value;},setReady:value=>{ready=value;}};
}

test('observation is opt-in and returns bounded mode-specific final-output snapshots',async()=>{
  const f=fixture();assert.equal(f.calls.length,0);
  f.setReady(false);assert.equal(await f.monitor.read({mode:'envelope',channel:0}),null);assert.equal(f.calls.length,0);
  f.setReady(true);
  for(const mode of ['envelope','waveform','spectrum']) {
    const result=await f.monitor.read({mode,channel:1});
    assert.deepEqual(f.calls.at(-1),['native_genesis_monitor',{session:1,mode,channel:1}]);
    assert.equal(result.rms,.25);assert.equal(result.peak,.5);
    if(mode==='waveform')assert(result.samples instanceof Float32Array&&result.samples.length===4096);
    if(mode==='spectrum')assert(result.bins instanceof Float32Array&&result.bins.length===2048);
    if(mode==='envelope')assert.deepEqual(Object.keys(result).sort(),['frame','frames','peak','rms','sampleRate','session']);
  }
  await f.monitor.pause();assert.equal(f.calls.at(-1)[1].mode,'off');
});

test('Pause invalidates a slow result immediately, serializes off, and prevents overlapping reads',async()=>{
  const reading=gate(),off=gate();let block=true;
  const f=fixture((_command,args)=>args.mode==='off'?off.promise:block?reading.promise:undefined);
  const old=f.monitor.read({mode:'waveform',channel:0});await ticks();
  assert.equal(await f.monitor.read({mode:'spectrum',channel:1}),null);assert.equal(f.calls.length,1);
  const pausing=f.monitor.pause();assert.equal(f.calls.length,1);
  reading.resolve(snapshot('waveform'));assert.equal(await old,null);await ticks();
  assert.equal(f.calls.length,2);assert.equal(f.calls[1][1].mode,'off');
  block=false;const next=f.monitor.read({mode:'spectrum',channel:1});await ticks();
  assert.equal(f.calls.length,2,'resume cannot overtake the queued off');
  off.resolve(null);await pausing;assert((await next).bins instanceof Float32Array);
  assert.equal(f.calls.length,3);await f.monitor.pause();
});

test('retired-session responses and delayed off requests cannot affect the replacement session',async()=>{
  const reading=gate();let block=true;
  const f=fixture((_command,args)=>args.mode!=='off'&&block?reading.promise:undefined);
  const old=f.monitor.read({mode:'envelope',channel:0});await ticks();const pausing=f.monitor.pause();
  f.setSession(2);reading.resolve(snapshot('envelope',1));assert.equal(await old,null);await pausing;
  assert.equal(f.calls.length,1,'old off must not target the replacement native stream');
  block=false;assert.equal((await f.monitor.read({mode:'envelope',channel:0})).session,2);await f.monitor.pause();
});

test('invalid metadata, oversized or non-finite wave/FFT payloads fail without yielding drawable data',async()=>{
  for(const [mode,change] of [
    ['envelope',{session:2}],['envelope',{sampleRate:44100}],['envelope',{frames:4097}],
    ['envelope',{rms:NaN}],['envelope',{rms:.8,peak:.5}],['envelope',{samples:[]}],
    ['waveform',{samples:Array(4097).fill(0)}],['waveform',{samples:Array(4096).fill(Infinity)}],
    ['spectrum',{bins:Array(2048).fill(-101)}],['spectrum',{bins:Array(2048).fill(null)}],
  ]) {
    const f=fixture(()=>({...snapshot(mode),...change}));
    await assert.rejects(f.monitor.read({mode,channel:0}),/Invalid|Unexpected/);await f.monitor.pause();
  }
  const f=fixture();await assert.rejects(f.monitor.read({mode:'other',channel:0}),/Invalid/);
  await assert.rejects(f.monitor.read({mode:'envelope',channel:2}),/Invalid/);assert.equal(f.calls.length,0);
});

test('best-effort skipped snapshots and an empty just-enabled ring are normal results',async()=>{
  let skip=true;
  const monitor=createNativeGenesisMonitor({getSession:()=>1,getSampleRate:()=>48000,isReady:()=>true,
    invoke:async(_command,args)=>args.mode==='off'||skip?null:{session:1,frame:0,sampleRate:48000,frames:0,rms:0,peak:0}});
  assert.equal(await monitor.read({mode:'envelope',channel:0}),null);
  skip=false;const empty=await monitor.read({mode:'envelope',channel:0});assert.equal(empty.frames,0);assert.equal(empty.rms,0);
  await monitor.pause();
});

test('monitor failures are isolated from playback state, device clock and native command ordering',async()=>{
  const calls=[],errors=[];
  const synth=new NativeGenesisSynth({now:()=>0,onError:error=>errors.push(error),invoke:async(command,args)=>{
    calls.push([command,args]);if(command==='native_genesis_monitor')throw new Error('Monitor busy');
    return {session:1,sampleRate:48000,frame:0,running:true};
  }});
  try {
    await synth.start();const before=synth.clock.currentTime;
    await assert.rejects(synth.outputMonitor.read({mode:'spectrum',channel:0}),/Monitor busy/);
    assert.equal(synth.state,'ready');assert.equal(synth.clock.currentTime,before);assert.equal(synth.audioContext,null);assert.equal(synth.node,null);
    synth.fm.noteOn(0,4,1200);await synth.flush();assert(calls.some(([name])=>name==='native_genesis_commands'));
    assert.equal(errors.length,0);await synth.outputMonitor.pause().catch(()=>{});
  } finally {await synth.close();}
});

test('a stalled observation never blocks note commands or the native audio Stop barrier',async()=>{
  const reading=gate(),calls=[];
  const synth=new NativeGenesisSynth({now:()=>0,invoke:async(command,args)=>{
    calls.push([command,args]);
    if(command==='native_genesis_monitor')return args.mode==='off'?null:reading.promise;
    return {session:1,sampleRate:48000,frame:0,running:true};
  }});
  try {
    await synth.start();const old=synth.outputMonitor.read({mode:'envelope',channel:0});await ticks();
    synth.fm.noteOn(0,4,1200);await synth.flush();
    assert(calls.some(([command])=>command==='native_genesis_commands'));
    await synth.stopNativeAudio();assert(calls.some(([command])=>command==='native_genesis_stop'));
    assert(!calls.some(([command,args])=>command==='native_genesis_monitor'&&args.mode==='off'));
    reading.resolve(snapshot('envelope'));assert.equal(await old,null);await ticks();
    assert(calls.some(([command,args])=>command==='native_genesis_monitor'&&args.mode==='off'));
  } finally {reading.resolve(null);await synth.close();}
});
