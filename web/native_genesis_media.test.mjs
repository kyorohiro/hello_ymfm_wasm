import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {encodeWav} from './wav.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {resolve,promise};};
const ticks=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
async function fixture(override=()=>undefined) {
  const calls=[],errors=[];let session=0;
  const status=()=>({session,sampleRate:48000,frame:0,running:true});
  const synth=new NativeGenesisSynth({invoke:async(command,args)=>{
    calls.push({command,args});const value=override(command,args);if(value!==undefined)return value;
    if(command==='native_genesis_start')session++;
    return status();
  },onError:error=>errors.push(error)});
  await synth.start();calls.length=0;
  return {synth,calls,errors,commands:()=>calls.filter(call=>call.command==='native_genesis_commands').flatMap(call=>call.args.commands)};
}

test('native DAC preserves the common public API, private bank copies, sample-clock ranges and channel pan',async t=>{
  const f=await fixture();t.after(()=>f.synth.close());
  const bytes=new Uint8Array([128,200,40,128]);
  const loading=f.synth.fm.dac.setSample('kick',bytes,{sampleRate:22050});bytes[1]=1;await loading;
  const upload=f.calls.find(call=>call.command==='native_genesis_media_load');
  assert.equal(upload.args.kind,'dac');assert.deepEqual(upload.args.channels,[[128,200,40,128]]);
  await f.synth.fm.dac.playFromSample('kick',{when:.25,offset:1,size:2,pan:'right'});
  assert.deepEqual(f.commands().at(-1),{type:'dac-play',frame:12000,name:'kick',offset:1,size:2,pan:'right'});
  await assert.rejects(f.synth.fm.dac.playFromSample('kick',{offset:3,size:2}),/outside sample/);
  await f.synth.fm.dac.stop();assert.equal(f.commands().at(-1).type,'dac-stop');
  await f.synth.fm.dac.removeSample('kick');await assert.rejects(f.synth.fm.dac.playFromSample('kick'),/Unknown PCM sample/);
  await f.synth.fm.dac.play([128,180,90],{sampleRate:8000});
  const privateName=f.commands().at(-1).name;
  assert.match(privateName,/^__native_dac_/);assert.equal(f.calls.at(-1).command,'native_genesis_media_remove');
  assert.equal(f.calls.at(-1).args.name,privateName);
});

test('decoded PCM and WAV sample loads need no AudioContext; native sample voices preserve options and stale-stop fencing',async t=>{
  const f=await fixture();t.after(()=>f.synth.close());
  const pcm={sampleRate:24000,channels:[new Float32Array([.5,-.5,.25,0])]};
  const wav=encodeWav(pcm);const buffer=await f.synth.sample.load('wave',wav);
  assert.equal(f.synth.audioContext,null);assert.equal(buffer.numberOfChannels,1);assert.equal(buffer.length,4);
  assert.deepEqual([...buffer.getChannelData(0)],[.5,-.5,.25,0]);assert.equal(f.synth.sample.get('wave'),buffer);
  assert.deepEqual(f.synth.sample.list(),['wave']);
  const voice=await f.synth.sample.play('wave',{playbackRate:-2,loop:true,loopStart:0,loopEnd:4/24000,pan:-.5,fadeIn:.1,fadeOut:.2});
  const play=f.commands().at(-1);assert.equal(play.type,'sample-play');assert.equal(play.playbackRate,-2);
  assert.equal(play.loop,true);assert.equal(play.pan,-.5);assert.equal(play.fadeIn,.1);assert.equal(play.fadeOut,.2);
  await f.synth.stopNativeAudio();f.calls.length=0;voice.stop();await ticks();assert.deepEqual(f.calls,[]);
  assert.equal(f.synth.sample.unload('wave'),true);await f.synth.serial;assert.equal(f.synth.sample.isLoaded('wave'),false);
  assert.equal(f.synth.sample.unload('missing'),false);await f.synth.serial;
});

test('Stop rejects a delayed media preparation and prevents its continuation from starting an old note',async t=>{
  const gate=deferred();let block=true;
  const f=await fixture(command=>command==='native_genesis_media_load'&&block?gate.promise:undefined);t.after(()=>f.synth.close());
  const old=f.synth.fm.dac.play([128,220,10],{sampleRate:8000});const rejected=assert.rejects(old,{name:'AbortError'});
  await ticks();const stopped=f.synth.stopNativeAudio();await ticks();
  assert.equal(f.calls.filter(call=>call.command==='native_genesis_stop').length,0);
  gate.resolve({});block=false;await rejected;await stopped;
  assert.equal(f.commands().filter(command=>command.type==='dac-play').length,0);assert.equal(f.errors.length,0);
  await f.synth.fm.dac.setSample('new',[128,129],{sampleRate:8000});await f.synth.fm.dac.playFromSample('new');
  assert.equal(f.commands().at(-1).name,'new');
});

test('unloading an in-flight bank invalidates the load acknowledgement without restoring a ghost bank',async t=>{
  const gate=deferred();let block=true;
  const f=await fixture(command=>command==='native_genesis_media_load'&&block?gate.promise:undefined);t.after(()=>f.synth.close());
  const loading=f.synth.sample.load('old',{sampleRate:8000,channels:[Float32Array.of(.1,.2)]});
  const rejected=assert.rejects(loading,{name:'AbortError'});await ticks();assert.equal(f.synth.sample.unload('old'),true);
  gate.resolve({});block=false;await rejected;await f.synth.serial;
  assert.equal(f.synth.sample.isLoaded('old'),false);assert.equal(f.errors.length,0);
  assert.deepEqual(f.calls.map(call=>call.command),['native_genesis_media_load','native_genesis_commands','native_genesis_media_remove']);
  assert.deepEqual(f.commands(),[{type:'sample-stop',frame:0,name:'old'}]);
});

test('invalid media is rejected before native preparation, including multichannel WAV and non-finite or overflowing PCM',async t=>{
  const f=await fixture();t.after(()=>f.synth.close());
  for(const pcm of [
    {sampleRate:8000,channels:[Float32Array.of(NaN)]},
    {sampleRate:8000,channels:[[1e100]]},
    {sampleRate:8000,channels:[[],[]]},
    {sampleRate:8000,channels:[[0],[0],[0]]},
  ])await assert.rejects(f.synth.sample.load('bad',pcm),/PCM|finite|Float32/);
  const wav=encodeWav({sampleRate:8000,channels:[Float32Array.of(0)]});new DataView(wav.buffer).setUint16(22,3,true);
  await assert.rejects(f.synth.sample.load('bad',wav),/mono or stereo/);
  await assert.rejects(f.synth.sample.load('bad',new Uint8Array([1,2,3])),/WAV/);
  await assert.rejects(f.synth.fm.dac.setSample('bad',new Uint8Array(),{sampleRate:8000}),/64 MiB/);
  assert.deepEqual(f.calls,[]);
});

test('packed DAC stream upload is ordered before a single bounded native play and validates offsets',async t=>{
  const f=await fixture();t.after(()=>f.synth.close());
  const bytes=new Uint8Array(10),view=new DataView(bytes.buffer);view.setUint32(5,441,true);bytes[4]=128;bytes[9]=180;
  f.synth.fm.loadDacBank('stream',bytes);f.synth.fm.playDacBank('stream',.5);await ticks();await f.synth.serial;await ticks();
  assert.equal(f.calls[0].command,'native_genesis_media_load');assert.equal(f.calls[0].args.kind,'dac-stream');
  assert.deepEqual(f.commands(),[{type:'dac-stream-play',frame:24000,name:'stream'}]);
  view.setUint32(0,500,true);assert.throws(()=>f.synth.fm.loadDacBank('bad',bytes),/ordered/);
});

test('Worker command batches and media acknowledgements carry common frame and owner timing',async t=>{
  const f=await fixture();t.after(()=>f.synth.close());
  const timing={time:.5,performance:7,owner:9};
  await f.synth.dispatchNativeCommand([{type:'write',register:0x22,value:8},{type:'write',register:0x22,value:0}],timing);
  assert.equal(f.calls.length,1);assert.deepEqual(f.commands().map(command=>[command.frame,command.performance,command.owner]),[[24000,7,9],[24000,7,9]]);
  assert.deepEqual(await f.synth.dispatchNativeFxCommand({op:'sample',action:'load',id:1,name:'s',pcm:{sampleRate:8000,channels:[[.1,.2]]}},timing),{op:'sample-response',id:1,value:undefined});
  const response=await f.synth.dispatchNativeFxCommand({op:'sample',action:'play',id:2,name:'s',options:{loop:true}},timing);
  assert.equal(response.op,'sample-response');assert.ok(response.value>0);
  assert.deepEqual([f.commands().at(-1).frame,f.commands().at(-1).performance,f.commands().at(-1).owner],[24000,7,9]);
  await f.synth.setNativePerformance({op:'cancel-owner',performance:7,owner:9});
  assert.equal(f.calls.at(-1).command,'native_genesis_performance');
  const missing=await f.synth.dispatchNativeCommand({type:'pcm-dac',id:8,command:{action:'play',name:'missing'}},timing);
  assert.match(missing.error,/Unknown PCM sample/);assert.equal(missing.type,'pcm-dac-result');
});

test('output recording is opt-in, bounded and retrieves planar PCM only once explicitly stopped',async t=>{
  const response={sampleRate:48000,channels:[[.25,-.25],[.5,-.5]],firstFrame:100,frames:2,complete:false};
  const f=await fixture(command=>command==='native_genesis_record_stop'?response:undefined);t.after(()=>f.synth.close());
  assert.equal(f.calls.length,0);await assert.rejects(f.synth.startOutputRecording({seconds:31}),/30 seconds/);
  await f.synth.startOutputRecording({seconds:5});assert.deepEqual(f.calls.map(call=>call.command),['native_genesis_record_start']);
  await assert.rejects(f.synth.startOutputRecording(),/already active/);
  const result=await f.synth.stopOutputRecording();assert.ok(result.channels[0] instanceof Float32Array);
  assert.deepEqual([...result.channels[1]],[.5,-.5]);assert.equal(result.firstFrame,100);
  await assert.rejects(f.synth.stopOutputRecording(),/not active/);
  await f.synth.startOutputRecording();response.channels[0][0]=Infinity;
  await assert.rejects(f.synth.stopOutputRecording(),/Invalid native recording PCM/);
});

test('recording cancellation racing Stop retires an accepted native capture and permits the next Run recording',async t=>{
  let active=false,startGate=null,stopGate=null;
  const empty={sampleRate:48000,channels:[[],[]],firstFrame:0,frames:0,complete:false};
  const f=await fixture(command=>{
    if(command==='native_genesis_record_start') {
      if(active)throw new Error('Native recording already active');active=true;return startGate?.promise??{};
    }
    if(command==='native_genesis_record_stop') {
      if(!active)throw new Error('Native recording not active');active=false;return empty;
    }
    if(command==='native_genesis_stop'&&stopGate)return stopGate.promise.then(()=>({session:1,sampleRate:48000,frame:0}));
  });t.after(()=>f.synth.close());
  await f.synth.startOutputRecording();assert.equal(active,true);
  const cancelled=f.synth.stopOutputRecording(),rejected=assert.rejects(cancelled,{name:'AbortError'});
  const stopped=f.synth.stopNativeAudio();await rejected;await stopped;assert.equal(active,false);
  await f.synth.startOutputRecording();await f.synth.stopOutputRecording();assert.equal(active,false);
  startGate=deferred();const preparing=f.synth.startOutputRecording(),preparedRejected=assert.rejects(preparing,{name:'AbortError'});
  await ticks();assert.equal(active,true);const stoppedAgain=f.synth.stopNativeAudio();startGate.resolve({});
  await preparedRejected;await stoppedAgain;assert.equal(active,false);startGate=null;
  await f.synth.startOutputRecording();assert.equal(active,true);await f.synth.stopOutputRecording();assert.equal(active,false);
  await f.synth.startOutputRecording();stopGate=deferred();const stoppingFirst=f.synth.stopNativeAudio();
  const cancelDuringStop=f.synth.stopOutputRecording();await ticks();assert.equal(active,true);
  stopGate.resolve();await stoppingFirst;await cancelDuringStop;assert.equal(active,false);stopGate=null;
  await f.synth.startOutputRecording();await f.synth.stopOutputRecording();assert.equal(active,false);
});

test('Worker DAC helpers retain one origin, 44100-Hz offsets and owner tags without double-counting performance lead',async t=>{
  const f=await fixture();t.after(()=>f.synth.close());
  const timing={time:.5,performance:3,owner:4};
  await f.synth.dispatchNativeCommand({type:'begin-sample-schedule',lookaheadSeconds:.25},timing);
  await f.synth.dispatchNativeCommand({type:'sample-writes',entries:[{sample:441,register:0x2a,value:180},{sample:882,type:'psg-write',value:0x9f}]},timing);
  assert.deepEqual(f.commands().map(command=>[command.frame,command.performance,command.owner]),[[36480,3,4],[36960,3,4]]);
  await f.synth.dispatchNativeCommand({type:'psg-reset'},timing);
  assert.deepEqual(f.commands().at(-1),{type:'psg-reset',frame:24000,performance:3,owner:4});
  await f.synth.dispatchNativeCommand({type:'reset-sample-schedule'},timing);
  await f.synth.dispatchNativeCommand({type:'begin-sample-schedule',lookaheadSeconds:0},{...timing,time:1});
  await f.synth.dispatchNativeCommand({type:'sample-writes',entries:[{sample:0,register:0x2a,value:128}]},{...timing,time:1});
  assert.equal(f.commands().at(-1).frame,48000);
});
