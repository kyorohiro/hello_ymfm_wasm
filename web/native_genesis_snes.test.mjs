import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MessageChannel} from 'node:worker_threads';
import factory from '../docs/generated/spc_wasm.js';
import {SnesDspCore} from './spc.js';
import {SnesSynth} from './snessynth.js';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createNativeGenesisWorkerBridge} from './native_genesis_worker.js';
import {createSnesClient} from './playground_snes.js';
import {createPerformanceHost} from './playground_performance_host.js';
import {createPerformanceSender} from './playground_performance_sender.js';

const wasmBinary=await readFile(new URL('../docs/generated/spc_wasm.wasm',import.meta.url)),module=await factory({wasmBinary});
const wave=()=>new Uint8Array([0x83,0x12,0x34,0x56,0x76,0x54,0x32,0x10,0xef]);
async function fixture(t){
  const core=await SnesDspCore.create({moduleFactory:async()=>module}),validation=new SnesSynth({core});
  let session=0,frame=0,enabled=0,kon=0,koff=255,timeline={loaded:false,playing:false,positionFrames:0,totalFrames:0,ended:false};
  const calls=[],queued=[],errors=[],held=new Map();
  const status=()=>({session,frame,sampleRate:48000,running:true}),snapshot=args=>({registers:Array.from(core.snapshot().dsp),nativeFrames:core.nativeFrames,enabled,timeline,pendingCommands:queued.map(entry=>entry.message.id).filter(Number.isSafeInteger),...(args?.ram?{ram:Array.from(core.snapshot().ram)}:{})});
  function apply(message,bypass=false){
    if(message.method==='batch'){
      if(message.audition&&message.action==='off'&&held.get(message.channel)!==message.voice)return;
      if(!message.audition&&held.has(message.channel))return;
      if(message.audition&&message.action==='on')held.set(message.channel,message.voice);
      message.commands.forEach(command=>apply(command,true));if(message.audition&&message.action==='off')held.delete(message.channel);return;
    }
    if(!bypass&&message.channel!==undefined&&held.has(message.channel))return;
    if(message.method==='write')core.writeDsp(message.register,message.value);
    else if(message.method==='load-memory')core.loadRam(Uint8Array.from(message.data),message.address);
    else if(message.method==='key-on'){koff&=~(1<<message.channel);kon|=1<<message.channel;core.writeDsp(0x5c,koff);core.writeDsp(0x4c,kon);enabled|=1<<message.channel;}
    else if(message.method==='key-off'){koff|=1<<message.channel;kon&=~(1<<message.channel);core.writeDsp(0x4c,kon);core.writeDsp(0x5c,koff);enabled&=~(1<<message.channel);}
    else if(message.method==='reset'){core.reset();held.clear();enabled=0;kon=0;koff=255;timeline={loaded:false,playing:false,positionFrames:0,totalFrames:0,ended:false};}
    else if(message.method==='stop-voices'){enabled=0;held.clear();kon=0;koff=255;core.writeDsp(0x4c,0);core.writeDsp(0x5c,255);timeline.playing=false;}
    else if(message.method==='prepare-timeline'){core.loadTimeline({version:1,clockRate:1024000,durationClocks:message.durationClocks,initialState:{ram:Uint8Array.from(message.ram),dsp:Uint8Array.from(message.dsp),outputDelayFrames:4},events:Uint32Array.from(message.events)});timeline={loaded:true,playing:false,positionFrames:0,totalFrames:message.durationClocks/32,ended:false};}
    else if(message.method==='play-timeline'){timeline.playing=true;timeline.ended=false;timeline.positionFrames=0;}
    else if(message.method==='stop-timeline')timeline.playing=false;
  }
  const invoke=async(command,args={})=>{
    calls.push({command,args});
    if(command==='native_genesis_start'){session++;return status();}
    if(command==='native_genesis_status'||command==='native_genesis_performance')return status();
    if(command==='native_genesis_snes_status')return snapshot(args);
    if(command==='native_genesis_stop'){queued.length=0;apply({method:'stop-voices'});return status();}
    if(command==='native_genesis_commands'){for(const entry of args.commands)if(entry.type==='snes'){if(entry.frame>frame)queued.push(entry);else apply(entry.message);}return status();}
  };
  const synth=new NativeGenesisSynth({mode:'snes',invoke,now:()=>frame/48,onError:error=>errors.push(error)});
  t.after(async()=>{await synth.close();core.dispose();});await synth.start();
  return {synth,core,calls,errors,commands:()=>calls.filter(call=>call.command==='native_genesis_commands').flatMap(call=>call.args.commands),
    end(){timeline={...timeline,playing:false,ended:true,positionFrames:timeline.totalFrames};},
    advance(value){frame=value;for(let i=0;i<queued.length;)if(queued[i].frame<=value)apply(queued.splice(i,1)[0].message);else i++;},
  };
}
test('Native SNES uploads real BRR/directory, generates DSP writes and physical key actions without Web Audio',async t=>{
  const f=await fixture(t),{synth}=f,snes=synth.snes;
  assert.equal(synth.node,null);assert.equal(synth.audioContext,null);assert.equal(synth.fm,null);assert.equal(synth.psg,null);
  assert.deepEqual(f.calls[0],{command:'native_genesis_start',args:{mode:'snes'}});
  assert.deepEqual(synth.primaryEndpoints,[{name:'snes',globalName:'snes',client:snes}]);
  const sample=await snes.loadBRR(wave(),{rootNote:'A4',loopStartSamples:0});
  snes.setPreset(0,{sample,volumeLeft:110,volumeRight:90});snes.noteOn(0,'A4');snes.setPreset(1,{sample});snes.noteOn(1,'C5');await synth.flush();
  assert.deepEqual((await snes.snapshot()).ram.slice(sample.startAddress,sample.startAddress+9),wave());
  const keys=f.commands().filter(entry=>entry.message.method==='key-on');assert.deepEqual(keys.map(entry=>entry.message.channel),[0,1]);
  const state=await synth.chipInspector.read('snes');assert.equal(state.channels[0].active,true);assert.equal(state.channels[1].active,true);assert.equal(state.channels[0].volumeLeft,110);
  assert.equal((await snes.getPreset(0)).sample,0);assert.equal(await snes.readDsp(0),110);
  synth.mixer.set('snes',{muted:true});await synth.flush();assert.equal(f.commands().at(-1).message.volume,0);assert.deepEqual(f.errors,[]);
});
test('SNES applied reads, per-voice Keyboard leases and Stop retain samples without replacing future state',async t=>{
  const f=await fixture(t),snes=f.synth.snes,inspector=f.synth.chipInspector,sample=await snes.loadBRR(wave(),{rootNote:69,loopStartSamples:0});
  snes.setPreset(0,{sample});snes.setPreset(1,{sample});await f.synth.flush();
  await f.synth.dispatchNativeSnesCommand({method:'setPitch',args:[1,6000]},{time:1,performance:2,owner:3});
  assert.equal(snes._getState().channels[1].pitch,6000);assert.equal((await inspector.read('snes')).channels[1].pitch,4096);
  await inspector.invoke('snes','auditionOn',[0,69,'old']);await inspector.invoke('snes','auditionOn',[0,72,'new']);
  assert.equal(await inspector.invoke('snes','auditionOff',[0,'old']),false);assert.equal(snes._getState().channels[1].pitch,6000);
  const batch=f.commands().filter(entry=>entry.message.method==='batch').at(-1).message;assert.equal(batch.action,'on');assert(batch.audition);assert(batch.voice);assert(batch.commands.some(command=>command.method==='key-on'));
  await inspector.invoke('snes','auditionOff',[0,'new']);assert.equal((await inspector.read('snes')).channels[0].active,false);
  f.advance(48000);assert.equal((await inspector.read('snes')).channels[1].pitch,6000);
  await f.synth.stopNativeAudio();assert.equal(snes._getState().samples.length,1);assert.equal((await snes.snapshot()).ram[sample.startAddress],wave()[0]);
  await inspector.invoke('snes','auditionOn',[0,69,'after-stop']);assert.equal((await inspector.read('snes')).channels[0].active,true);
});
test('Native SNES timeline retains ordered resources and resolves at end, while Stop rejects completion',async t=>{
  const f=await fixture(t),snes=f.synth.snes;
  const trace={version:1,clockRate:1024000,durationClocks:320,initialState:{ram:new Uint8Array(65536),dsp:new Uint8Array(128),outputDelayFrames:4},events:new Uint32Array()};
  const prepared=await snes.prepareTimeline(trace);assert.equal(prepared.totalFrames,10);assert.equal(snes._getState().timeline.loaded,true);
  assert.throws(()=>snes.setPitch(0,1000),/timeline mode is exclusive/);
  const playing=snes.playTimeline();await f.synth.flush();f.end();assert.equal((await playing).ended,true);
  const stopped=snes.playTimeline();const rejection=assert.rejects(stopped,{name:'AbortError'});await f.synth.flush();await snes.stopTimeline();await rejection;
  snes.reset();await f.synth.flush();snes.setPitch(0,3000);await f.synth.flush();assert.equal(await snes.readDsp(2),3000&255);
});
test('Native SNES Worker ports handle BRR RPC, scheduled notes and asynchronous timeline completion without blocking Stop',async t=>{
  const f=await fixture(t),bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:error=>f.errors.push(error)});
  const host=createPerformanceHost({getContext:()=>f.synth.clock}),sender=createPerformanceSender({leaseUntimed:true});
  let snes;try{
    sender.configure(await host.start([bridge.port],.1));
    snes=createSnesClient(sender.port(bridge.snesPort,'independent'));
    const sample=await snes.loadBRR(wave(),{rootNote:'A4',loopStartSamples:0});snes.setPreset(0,{sample});snes.keyOn(0);
    // A same-port RPC acknowledges the preceding fire-and-forget writes after
    // the bridge's FIFO has admitted them. Its existing request deadline bounds
    // the wait without guessing how quickly concurrent tests dispatch messages.
    await snes.readDsp(0);assert(f.commands().some(entry=>entry.message.method==='key-on'));
    const trace={version:1,clockRate:1024000,durationClocks:32000,initialState:{ram:new Uint8Array(65536),dsp:new Uint8Array(128),outputDelayFrames:4},events:new Uint32Array()};
    await snes.prepareTimeline(trace);const playback=snes.playTimeline(),rejection=assert.rejects(playback,{name:'AbortError'});await snes.stopTimeline();await rejection;
    assert.deepEqual(f.errors,[]);
  }finally{snes?.dispose();sender.stop();host.stop();await bridge.dispose();}
});
test('Native SNES timeline keeps its scheduled Worker frame and waits while the callback still has play queued',async t=>{
  const f=await fixture(t),snes=f.synth.snes;
  await snes.prepareTimeline({version:1,clockRate:1024000,durationClocks:320,initialState:{ram:new Uint8Array(65536),dsp:new Uint8Array(128),outputDelayFrames:4},events:new Uint32Array()});
  let completed=false;
  const result=await f.synth.dispatchNativeSnesCommand({method:'playTimeline',id:91},{time:.02,performance:7,owner:3});
  const completion=result.deferred.then(reply=>{completed=true;return reply;});await f.synth.flush();
  const command=f.commands().find(entry=>entry.message.method==='play-timeline');assert.equal(command.frame,960);assert.equal(command.performance,7);assert.equal(command.owner,3);assert(command.message.id);
  await new Promise(resolve=>setTimeout(resolve,35));assert.equal(completed,false,'a not-yet-applied play must not abort or end');
  f.advance(960);f.end();assert.deepEqual(await completion,{id:91,value:{loaded:true,playing:false,positionFrames:10,totalFrames:10,ended:true}});
});
