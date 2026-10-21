import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {RfInspectorState} from './playground_chip_inspector_state.js';
import {encodeRf5c164} from './rf5c164_pcm.js';
import {createPlaygroundRuntime} from './playground_runtime.js';

const deferred=()=>{let resolve;return {promise:new Promise(done=>{resolve=done;}),resolve};};
const pcm={sampleRate:16000,channels:[Float32Array.of(0,.5,-.5,0,.2,-.2)]};
function fixture({megaCD=true,decodeAudio,intercept}={}) {
  const calls=[],pending=[],voices=new Float64Array(8);let session=0,frame=0,clock=12500000;
  const applied=new RfInspectorState({writeRegister(){},loadMemory(){},reset(){}},{sampleRate:48000,clock:()=>clock});
  const status=()=>({session,sampleRate:48000,frame,ymClock:7670454,rf5c164Clock:clock,running:true});
  const apply=command=>{
    if(command.type==='rf5c164-write'){applied.auditionWriting=command.audition?1:0;applied.write(command.register,command.value);applied.auditionWriting=0;}
    if(command.type==='rf5c164-key-on'){voices[command.channel]=command.voice??0;applied.write(7,0xc0|command.channel);applied.write(8,applied.mask&~(1<<command.channel));}
    if(command.type==='rf5c164-key-off'&&(command.voice===undefined||voices[command.channel]===command.voice)){applied.write(8,applied.mask|(1<<command.channel));voices[command.channel]=0;}
    if(command.type==='rf5c164-reset')applied.reset();
    if(command.type==='rf5c164-clock')clock=command.hz;
  };
  const invoke=async(command,args)=>{
    calls.push({command,args});
    const intercepted=intercept?.(command,args);if(intercepted!==undefined)return await intercepted;
    if(command==='native_genesis_start'){session++;return status();}
    if(command==='native_genesis_commands')for(const c of args.commands){if(c.frame>frame)pending.push(c);else apply(c);}
    if(command==='native_genesis_stop'){applied.write(8,255);voices.fill(0);pending.length=0;return status();}
    if(command==='native_genesis_status')return status();
    if(command==='native_genesis_rf5c164_status'){const snapshot=applied.read();return {...snapshot,channels:snapshot.channels.map(channel=>({...channel,configuredStep:applied.configuredSteps[channel.channel]})),mask:applied.mask,frame};}
  };
  const synth=new NativeGenesisSynth({invoke,megaCD,decodeAudio,now:()=>frame/48});
  return {synth,calls,applied,commands:()=>calls.filter(c=>c.command==='native_genesis_commands').flatMap(c=>c.args.commands),advance(next){frame=next;for(let i=0;i<pending.length;)if(pending[i].frame<=frame)apply(pending.splice(i,1)[0]);else i++;}};
}

test('Native Mega-CD opts in, shares RF controls and mixer, and uploads only encoded RAM',async()=>{
  const f=fixture();assert.equal(f.synth.pcm.clock,12500000);assert.equal(f.calls.length,0);await f.synth.start();
  assert.deepEqual(f.calls[0],{command:'native_genesis_start',args:{mode:'mega-cd'}});
  assert.equal(f.synth.capabilities.pcm,true);assert.deepEqual(f.synth.chipInspector.list().map(c=>c.id),['ym2612','segapsg','rf5c164']);
  const sample=await f.synth.pcm.loadSample(pcm,{address:256,endGuardBytes:8});
  const load=f.commands().find(c=>c.type==='rf5c164-load-memory');
  assert.equal(load.offset,256);assert.equal(load.data.length,pcm.channels[0].length+8);assert(load.data.slice(pcm.channels[0].length).every(v=>v===255));
  assert.equal(load.data[1],191);assert.equal(load.data[2],63);
  await f.synth.pcm.setChannel(0,{start:sample.start,loopStart:sample.loopStart,step:sample.step,volume:100,pan:{left:15,right:12}});
  await f.synth.pcm.keyOn(0);assert.equal(f.commands().at(-1).type,'rf5c164-key-on');
  const read=await f.synth.chipInspector.read('rf5c164');assert.equal(read.channels[0].start,256);assert.equal(read.channels[0].active,true);assert.equal(read.samples.length,1);
  f.synth.mixer.set('rf5c164',{volume:.4,pan:-1});await f.synth.flush();assert.deepEqual(f.commands().at(-1),{type:'rf5c164-mix',left:.4,right:0,frame:0});
  f.synth.pcm.dispose();assert.equal(f.synth.isReady(),true);assert.equal(f.synth.node,null);assert.equal(f.synth.audioContext,null);await f.synth.close();
});

test('plain Native Genesis exposes no RF endpoint or control route',async()=>{
  const f=fixture({megaCD:false});await f.synth.start();assert.equal(f.calls[0].args,undefined);assert.equal(f.synth.pcm,null);assert.equal(f.synth.capabilities.pcm,false);
  await assert.rejects(f.synth.dispatchNativePcmCommand({method:'keyOn',args:[0]}),/requires Native Mega-CD/);
  assert(!f.synth.chipInspector.list().some(c=>c.id==='rf5c164'));await f.synth.close();
});

test('future Worker note gates preserve independently played Keyboard channels and applied snapshots',async()=>{
  const f=fixture();await f.synth.start();await f.synth.pcm.loadMemory(new Uint8Array(64));
  for(const ch of [0,1])await f.synth.pcm.setChannel(ch,{start:0,loopStart:0,step:100,volume:100,pan:{left:15,right:15}});
  await f.synth.dispatchNativePcmCommand({id:1,method:'keyOn',args:[0]},{time:1,performance:7,owner:3});
  let snapshot=await f.synth.chipInspector.read('rf5c164');assert.equal(snapshot.channels[0].active,false,'scheduled author shadow must not appear applied');
  await f.synth.chipInspector.invoke('rf5c164','auditionOn',[1,60,'now']);snapshot=await f.synth.chipInspector.read('rf5c164');assert.equal(snapshot.channels[1].active,true);
  f.advance(48000);snapshot=await f.synth.chipInspector.read('rf5c164');assert(snapshot.channels[0].active&&snapshot.channels[1].active);
  const future=f.commands().filter(c=>c.frame===48000);assert(future.every(c=>c.performance===7&&c.owner===3));assert(!future.some(c=>c.register===8));
  await f.synth.dispatchNativePcmCommand({method:'keyOff',args:[0]},{performance:7,owner:3});snapshot=await f.synth.chipInspector.read('rf5c164');assert.equal(snapshot.channels[0].active,false);assert.equal(snapshot.channels[1].active,true);
  await f.synth.chipInspector.invoke('rf5c164','auditionOff',[1,'old']);assert.equal(f.applied.channels[1].step,100);assert.equal(f.applied.mask&2,0);
  await f.synth.chipInspector.invoke('rf5c164','auditionOff',[1,'now']);assert.equal(f.applied.mask&2,2);await f.synth.close();
});

test('compressed decoder and Stop fence prevent an old upload from overwriting the next performance',async()=>{
  const decoding=deferred();let decodes=0;const f=fixture({decodeAudio:async bytes=>{decodes++;assert.equal(bytes.byteLength,2);return decoding.promise;}});await f.synth.start();
  const loading=f.synth.pcm.loadSample(Uint8Array.of(1,2));await f.synth.stopNativeAudio();
  await f.synth.pcm.loadSample(pcm,{address:256});decoding.resolve(pcm);await assert.rejects(loading,{name:'AbortError'});assert.equal(decodes,1);
  assert.deepEqual(f.commands().filter(c=>c.type==='rf5c164-load-memory').map(c=>c.offset),[256]);await f.synth.close();
});

test('RF URL loading captures the trusted file fetch before the user execution guard replaces globals',async t=>{
  const previous=globalThis.fetch,urls=[];globalThis.fetch=async url=>{urls.push(url);return {ok:true,headers:{get:()=>null},arrayBuffer:async()=>Uint8Array.of(1,2).buffer};};
  const f=fixture({decodeAudio:async()=>pcm});t.after(async()=>{globalThis.fetch=previous;await f.synth.close();});
  globalThis.fetch=()=>{throw new Error('Network access disabled');};await f.synth.start();await f.synth.pcm.loadSample('./voice.flac');
  assert.deepEqual(urls,['./voice.flac']);assert.equal(f.commands().filter(c=>c.type==='rf5c164-load-memory').length,1);
});

test('Keyboard release checks its applied voice lease across a future Worker replacement on the same channel',async()=>{
  const f=fixture();await f.synth.start();await f.synth.pcm.loadMemory(new Uint8Array(32));await f.synth.pcm.setChannel(0,{start:0,step:100,volume:100,pan:{left:15,right:15}});
  await f.synth.chipInspector.invoke('rf5c164','auditionOn',[0,60,'before']);
  await f.synth.dispatchNativePcmCommand({method:'keyOn',args:[0]},{time:1,performance:1,owner:1});
  await f.synth.chipInspector.invoke('rf5c164','auditionOff',[0,'before']);assert.equal(f.applied.mask&1,1,'manual voice releases before the future note is due');
  f.advance(48000);assert.equal(f.applied.mask&1,0);
  await f.synth.chipInspector.invoke('rf5c164','auditionOn',[0,60,'after']);
  await f.synth.dispatchNativePcmCommand({method:'keyOn',args:[0]},{time:2,performance:1,owner:1});f.advance(96000);
  await f.synth.chipInspector.invoke('rf5c164','auditionOff',[0,'after']);assert.equal(f.applied.mask&1,0,'an old key release does not stop the applied Worker replacement');
  const releases=f.commands().filter(c=>c.type==='rf5c164-key-off');assert(releases.every(c=>Number.isSafeInteger(c.voice)&&c.voice>0));
  await f.synth.stopNativeAudio();await f.synth.chipInspector.invoke('rf5c164','auditionOn',[0,60,'retained']);assert.equal(f.applied.mask&1,0,'Stop retains the loaded sample and applied channel patch');await f.synth.close();
});

test('RF Keyboard transposition keeps its applied base pitch across note releases, Stop, and future script pitch edits',async()=>{
  const f=fixture();await f.synth.start();await f.synth.pcm.loadMemory(new Uint8Array(32));await f.synth.pcm.setChannel(0,{start:0,step:100,volume:100,pan:{left:15,right:15}});
  const on=(midi,id)=>f.synth.chipInspector.invoke('rf5c164','auditionOn',[0,midi,id]),off=id=>f.synth.chipInspector.invoke('rf5c164','auditionOff',[0,id]);
  await on(72,'high');assert.equal(f.applied.channels[0].step,200);await off('high');
  await on(48,'low');assert.equal(f.applied.channels[0].step,50);await off('low');
  await on(72,'stop');await f.synth.stopNativeAudio();await on(60,'base');assert.equal(f.applied.channels[0].step,100);await off('base');
  await f.synth.dispatchNativePcmCommand({method:'setPitch',args:[0,200]},{time:1,performance:7,owner:1});
  await on(60,'before');assert.equal(f.applied.channels[0].step,100,'future author edits do not change the applied Keyboard base early');await off('before');
  f.advance(48000);await on(72,'after');assert.equal(f.applied.channels[0].step,400,'the applied script pitch becomes the new Keyboard base');
  assert(f.commands().some(command=>command.type==='rf5c164-write'&&command.register===2&&command.audition===true));await f.synth.close();
});

test('RF uploads retain byte bounds, validate whole edits, and split native batches by payload size',async()=>{
  const f=fixture();await f.synth.start();f.calls.length=0;
  const a=f.synth.pcm.loadMemory(new Uint8Array(40000)),b=f.synth.pcm.loadMemory(new Uint8Array(40000));await Promise.all([a,b]);
  assert.deepEqual(f.calls.filter(c=>c.command==='native_genesis_commands').map(c=>c.args.commands.reduce((n,x)=>n+(x.data?.length??0),0)),[40000,40000]);
  assert.equal(f.synth.acceptedPcmBytes,0);const count=f.commands().length;
  assert.throws(()=>f.synth.pcm.setChannel(0,{volume:20,pan:{left:16,right:15}}),/left/);assert.throws(()=>f.synth.pcm.loadMemory(new Uint8Array(65536),1),/64 KiB/);
  assert.equal(f.commands().length,count);await f.synth.pcm.setClock(10000000);assert.equal(f.synth.pcm.clock,10000000);assert.equal((await f.synth.chipInspector.read('rf5c164')).clock,10000000);
  assert.deepEqual(encodeRf5c164(pcm).bytes.subarray(0,3),Uint8Array.of(128,191,63));await f.synth.close();
});

test('Inspector sample loading allocates RAM and rejects overwriting occupied sample ranges',async()=>{
  const f=fixture();await f.synth.start();const first=await f.synth.chipInspector.loadSample('rf5c164',pcm,{name:'Voice'});
  const second=await f.synth.chipInspector.loadSample('rf5c164',pcm,{name:'Other'});assert.equal(first.start,0);assert.equal(second.start,256);
  await assert.rejects(f.synth.chipInspector.loadSample('rf5c164',pcm,{address:0}),/overwrite/);
  const snapshot=await f.synth.chipInspector.read('rf5c164');assert.deepEqual(snapshot.samples.map(s=>s.name),['Voice','Other']);await f.synth.close();
});

test('real Native Mega-CD Runtime Stop waits for its existing native barrier without issuing late PCM cleanup',async t=>{
  const previous=globalThis.window;globalThis.window={setTimeout,addEventListener(){},removeEventListener(){}};
  const gate=deferred();let hold=false,stopped=false;
  const f=fixture({intercept:command=>command==='native_genesis_stop'&&hold?gate.promise.then(()=>({session:f.synth.session,sampleRate:48000,frame:0,running:true})):undefined});
  const runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});
  t.after(async()=>{hold=false;gate.resolve();await runtime.finalize();globalThis.window=previous;});
  await runtime.playSource(`const pcm=await useSoundChip('rf5c164');await pcm.loadMemory(new Uint8Array([128,200,64,255]));await pcm.setChannel(0,{start:0,loopStart:0,step:200,volume:100,pan:{left:15,right:15}});await pcm.keyOn(0);`);
  hold=true;const stopping=runtime.stopWithFade().then(()=>{stopped=true;});
  for(let i=0;i<25;i++)await Promise.resolve();assert.equal(stopped,false);assert.equal(f.synth.pcm._stopVoices(),f.synth.stopping);
  const stopIndex=f.calls.findLastIndex(call=>call.command==='native_genesis_stop');assert(stopIndex>=0);
  gate.resolve();await stopping;hold=false;assert.equal(stopped,true);
  assert(!f.calls.slice(stopIndex+1).some(call=>call.command==='native_genesis_commands'&&call.args.commands.some(command=>command.type?.startsWith('rf5c164-'))));
});
