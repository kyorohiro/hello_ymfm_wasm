import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthPcmAudio} from './synth_pcm_audio.js';
import {RF5C164Synth} from '../js/rf5c164synth.js?v=audio-stability-2';
import {SYNTH_SONG_MIX_DEFAULTS} from './synth_song_mix_defaults.js';
import {Worker} from 'node:worker_threads';
import {createSynthPcmRelease} from './synth_pcm_release.js';
import {createSynthCodeAudio} from './synth_code_audio.js';
import {createPcmBuiltinPreset} from './synth_pcm.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=()=>Promise.resolve();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const off={method:'writeRegister',args:[8,255]};
function host() {
  const gains=[],context={state:'running',closeCalls:0,close(){this.closeCalls++;},createGain(){
    const gain={context,gain:{value:1},output:null,disconnects:0,connect(output){this.output=output;},disconnect(){this.disconnects++;}};
    gains.push(gain);return gain;
  }};
  return {context,output:{context},gains};
}
function fixture(options={}) {
  const requests=[],errors=[];
  const audio=createSynthPcmAudio({...options,onError:error=>errors.push(error),createDevice:(context,destination,configuration)=>{
    const task=deferred(),writes=[],listeners=new Set(),port={postMessage:command=>writes.push(command),
      addEventListener(type,fn){if(type==='message')listeners.add(fn);},removeEventListener(type,fn){if(type==='message')listeners.delete(fn);},
      emit(data){for(const fn of listeners)fn({data});},start(){this.started=true;}};
    const device={port,disposeCalls:0,dispose(){this.disposeCalls++;}};
    requests.push({context,destination,options:configuration,task,writes,device,port,listeners});return task.promise;
  }});
  return {audio,requests,errors};
}
async function ready(f,h) {
  const pending=f.audio.prepare(h.context,h.output);await turn();const request=f.requests.at(-1);request.task.resolve(request.device);
  return {api:await pending,request};
}

test('physical PCM observation commits acknowledged absolute RAM and sparse edits preserve selectors and other channels',async()=>{
  const f=fixture(),h=host(),{api,request}=await ready(f,h);
  api.setChannel(6,{start:256,loopStart:4096,step:2048,volume:73,pan:{left:3,right:9}});
  api.writeRegister(7,0x81);const before=api.readWrittenState();
  assert(before.channels[6].configured);assert(!before.channels[2].configured);assert.equal(before.bank,4096);
  api.editWrittenChannel(6,{panLeft:7});const edited=api.readWrittenState();
  assert.equal(edited.selectedChannel,6);assert.equal(edited.bank,4096);assert.equal(edited.sourceControl,0x81);
  assert.equal(edited.channels[6].panLeft,7);assert.equal(edited.channels[6].panRight,9);
  assert.equal(edited.channels[6].step,2048);assert.equal(edited.channelMask,255);
  api.writeRegister(0,74);assert.equal(api.readWrittenState().channels[6].volume,74);
  const data=Uint8Array.of(128,129,255),loading=api.loadMemory(data,256),command=request.writes.at(-1);
  data[0]=250;assert.equal(api.readWrittenState().known[256],0,'unacknowledged samples are not reported as installed');
  request.port.emit({id:command.id,value:true});await loading;
  const loaded=api.readWrittenState();assert.equal(loaded.ram[256],128);assert.equal(loaded.known[256],1);
  assert.equal(loaded.known[4352],0,'absolute upload ignores the selected CPU RAM bank');
  const stable=loaded.ram;api.editWrittenChannel(6,{volume:76,step:2100});assert.equal(api.readWrittenState().ram,stable);
  f.audio.dispose();
});

test('physical PCM keys retain sample/loop/Pan, release softly and ignore later Code gate/pitch owners',async()=>{
  const f=fixture(),h=host(),{api,request}=await ready(f,h),memory=new Uint8Array(65536).fill(255);
  memory.set([128,160,192,160],256);memory.set([128,150,180,150],4096);
  const loading=api.loadMemory(memory,0),load=request.writes.at(-1);request.port.emit({id:load.id,value:true});await loading;
  api.setChannel(6,{start:256,loopStart:4096,step:2048,volume:73,pan:{left:3,right:9}});api.keyOn(2);
  const before=api.readWrittenState(),keys=api.channelKeyboard;
  keys.noteOn(6,4,1083);const playing=api.readWrittenState();
  for(const field of ['start','loopStart','volume','panLeft','panRight'])assert.equal(playing.channels[6][field],before.channels[6][field]);
  assert.equal(playing.ram,before.ram);assert.equal(playing.channels[2].keyOn,true);
  keys.setFrequency(6,4,1200);assert.notEqual(api.readWrittenState().channels[6].step,playing.channels[6].step);
  api.setPitch(6,1900);const count=request.writes.length;assert.equal(keys.setFrequency(6,4,1083),false);assert.equal(request.writes.length,count);
  assert(keys.noteOff(6));assert.deepEqual(request.writes.at(-1),{method:'releaseNote',args:[6]},'local keyboard retains the existing software release');
  keys.noteOn(6,4,1083);api.keyOn(6);const owned=request.writes.length;assert.equal(keys.noteOff(6),false);assert.equal(request.writes.length,owned);
  api.setPitch(6,0);assert.throws(()=>keys.noteOn(6,4,1083),/zero playback step/);f.audio.dispose();
});

test('PCM written masks distinguish untouched tuning from scalar edits and freeze overlays preserve unrelated fields/RAM',async()=>{
  const f=fixture(),h=host(),{api}=await ready(f,h);
  api.editWrittenChannel(4,{volume:80,panLeft:3});let ch=api.readWrittenState().channels[4];
  assert(ch.configured);assert.equal(ch.tuningConfigured,false);assert.equal(ch.writtenMask,3);
  api.writeRegister(7,0xc4);api.writeRegister(2,0);ch=api.readWrittenState().channels[4];
  assert(ch.tuningConfigured,'explicit zero Step differs from a completely untouched channel');assert.equal(ch.writtenMask,7);
  api.setChannel(6,{start:256,loopStart:4096,step:2048,volume:90,pan:{left:3,right:9}});
  const frozen=api.readWrittenState(),ram=frozen.ram;api.editWrittenChannel(6,{panLeft:7});api.setChannel(6,{volume:88});
  const projected=api.readWrittenSnapshot(frozen);
  assert.equal(projected.channels[6].panLeft,7);assert.equal(projected.channels[6].panRight,9);assert.equal(projected.channels[6].volume,90);
  assert.equal(projected.ram,ram);const current=api.readWrittenState();assert(current.frame>frozen.frame);
  assert.equal(api.readWrittenSnapshot(current).channels[6].volume,88);assert.equal(api.readWrittenSnapshot(current).channels[6].panLeft,7);
  api.editWrittenChannel(6,{step:1900});const next=api.readWrittenSnapshot(current);
  assert.equal(next.channels[6].step,1900);assert.equal(next.channels[6].volume,88);assert.equal(next.ram,ram);f.audio.dispose();
});

test('physical PCM and Code share coherent logical masks, target-only gate ownership and the real software release path',async()=>{
  const h=host(),registers=new Uint8Array(56),memory=new Uint8Array(65536),commands=[];
  let selected=0,physicalMask=255;const listeners=new Set();
  const raw=new RF5C164Synth({transport:{
    write(register,value){if(register===7&&value&64)selected=value&7;if(register<7)registers[selected*7+register]=value;if(register===8)physicalMask=value;},
    loadMemory(bytes,address){memory.set(bytes,address);},reset(){registers.fill(0);physicalMask=255;selected=0;},
  }});
  const release=createSynthPcmRelease({pcm:raw,sampleRate:48000,renderAudio:(left,right)=>{left.fill(.1);right.fill(.1);}});
  const port={
    addEventListener(type,listener){if(type==='message')listeners.add(listener);},removeEventListener(type,listener){listeners.delete(listener);},start(){},
    postMessage(command){
      commands.push(command);if(command.method==='dispose')return;
      const value=release.pcm[command.method](...command.args);
      if(command.id!==undefined)queueMicrotask(()=>{for(const listener of listeners)listener({data:{id:command.id,value}});});
    },
  };
  const endpoint=createSynthPcmAudio({createDevice:async()=>({port,dispose(){}})}),api=await endpoint.prepare(h.context,h.output);
  const bytes=new Uint8Array(65536).fill(255);bytes.set([128,150,180,150]);await api.loadMemory(bytes,0);
  const preset=createPcmBuiltinPreset('sine'),voice={getPreset:()=>preset,getSettings:()=>preset.settings,isReady:()=>true};
  const code=createSynthCodeAudio({getContext:()=>h.context,getInput:()=>h.output,getOutput:()=>h.output,getFm:()=>null,
    getPsg:()=>null,getPsgVoice:()=>null,getPcm:()=>api,getPcmVoice:()=>voice});
  try{
    const pcm=await code.useSoundChip('rf5c164'),keys=api.channelKeyboard;
    keys.noteOn(7,4,1083);code.claimKeyboard('rf5c164',7);
    assert.equal(api.channelMask,127);assert.equal(api.readWrittenState().channelMask,127);assert.equal(physicalMask,127);
    pcm.keyOn(0);assert.equal(api.channelMask,126);assert.equal(api.readWrittenState().channelMask,126);assert.equal(physicalMask,126);
    assert.equal(api.readWrittenState().selectedChannel,0,'semantic Worklet keyOn also selects and enables this CH');
    assert.equal(api.readWrittenState().sourceControl,0xc0);
    pcm.writeRegister(0,77);assert.equal(api.readWrittenState().channels[0].volume,77);assert.equal(registers[0],77);
    const prior=commands.length;assert.equal(pcm.noteOff(7),false);assert.equal(commands.length,prior,'old Code Off cannot release the claimed keyboard CH');
    assert(keys.noteOff(7));assert.equal(api.channelMask,254);assert.equal(api.readWrittenState().channelMask,254);
    assert.equal(physicalMask,126,'the released CH remains in the 4-ms hardware tail only');
    pcm.keyOn(1);assert.equal(api.channelMask,252);assert.equal(api.readWrittenState().channelMask,252);assert.equal(physicalMask,124,'Code keyOn preserves the other CH tail');
    release.render(new Float32Array(256),new Float32Array(256));assert.equal(physicalMask,252);assert.equal(api.channelMask,252);
    keys.noteOn(7,4,1083);code.claimKeyboard('rf5c164',7);assert.equal(api.channelMask,124);assert.equal(physicalMask,124);
    pcm.keyOn(7);const takeover=commands.length;assert.equal(keys.noteOff(7),false);assert.equal(commands.length,takeover);
    pcm.writeRegister(8,255);assert.equal(api.channelMask,255);assert.equal(api.readWrittenState().channelMask,255);assert.equal(physicalMask,255);
  }finally{await code.dispose();endpoint.dispose();}
});

test('shared PCM source volume replaces its System default and survives pending/new routes independently of Master',async()=>{
  const f=fixture(),h=host();f.audio.setEnabled(true);f.audio.setSourceVolume(1.6);f.audio.setVolume(2);
  const pending=f.audio.prepare(h.context,h.output);await turn();
  f.audio.setSourceVolume(.25);f.audio.setVolume(3.8);assert.equal(h.gains[0].gain.value,0);
  const first=f.requests[0];first.task.resolve(first.device);await pending;
  assert.equal(h.gains[0].gain.value,.25*3.8,'source volume is absolute, with no second calibrated multiplier');
  const writes=first.writes.length;
  f.audio.setSourceVolume(3.8);assert.equal(h.gains[0].gain.value,3.8*3.8);
  f.audio.setSourceVolume(0);assert.equal(h.gains[0].gain.value,0);
  f.audio.setSourceVolume(.5);f.audio.setVolume(.4);assert.equal(h.gains[0].gain.value,.5*.4);
  assert.equal(first.writes.length,writes,'gain changes do not reset or mask a held PCM channel');
  for(const value of [-1,3.81,NaN,Infinity,'1',null])assert.throws(()=>f.audio.setSourceVolume(value),/0\.\.3\.8/);
  assert.equal(h.gains[0].gain.value,.5*.4);
  const replacement=f.audio.prepare(h.context,{context:h.context});await turn();
  f.audio.setSourceVolume(.75);f.audio.setVolume(2);assert.equal(h.gains[0].gain.value,0);
  const next=f.requests[1];next.task.resolve(next.device);await replacement;assert.equal(h.gains[1].gain.value,1.5);
  f.audio.setEnabled(false);f.audio.setSourceVolume(1.25);assert.equal(h.gains[1].gain.value,0);
  f.audio.setEnabled(true);assert.equal(h.gains[1].gain.value,2.5);f.audio.dispose();
});

test('live PCM channel mutes are endpoint policy and follow pending/replaced owners without changing key masks or author pan',async()=>{
  const f=fixture(),h=host();f.audio.setEnabled(true);f.audio.setChannelMuted(2,true);
  const pending=f.audio.prepare(h.context,h.output);await turn();f.audio.setChannelMuted(7,true);f.audio.setChannelMuted(2,false);
  const first=f.requests[0];first.task.resolve(first.device);const api=await pending;
  assert.deepEqual(first.writes,[off,{method:'setChannelMuted',args:[7,true]}]);assert.equal(api.setChannelMuted,undefined);
  api.setChannel(0,{pan:{left:15,right:3},volume:80});api.keyOn(0);const mask=api.channelMask,before=first.writes.length;
  f.audio.setChannelMuted(0,true);f.audio.setChannelMuted(0,true);
  assert.deepEqual(first.writes.slice(before),[{method:'setChannelMuted',args:[0,true]}]);assert.equal(api.channelMask,mask);
  api.setChannel(0,{pan:{left:2,right:9}});assert.deepEqual(first.writes.at(-1),{method:'writeRegister',args:[1,0x92]});
  f.audio.setChannelMuted(0,false);assert.deepEqual(first.writes.at(-1),{method:'setChannelMuted',args:[0,false]});assert.equal(api.channelMask,mask);
  const count=first.writes.length;
  for(const ch of [-1,8,1.5,'0'])assert.throws(()=>f.audio.setChannelMuted(ch,true));
  for(const value of [1,null,'false'])assert.throws(()=>f.audio.setChannelMuted(0,value));assert.equal(first.writes.length,count);
  const replacement=f.audio.prepare(h.context,{context:h.context});await turn();const next=f.requests[1];next.task.resolve(next.device);await replacement;
  assert.deepEqual(next.writes,[off,{method:'setChannelMuted',args:[7,true]}]);
  f.audio.dispose();const retired=next.writes.length;f.audio.setChannelMuted(1,true);assert.equal(next.writes.length,retired);
});

test('PCM endpoint is lazy, coalesces a route and applies System PCM gain and Master exactly once',async()=>{
  const f=fixture(),h=host();
  assert.equal(f.audio.getPcm(),null);assert.equal(f.audio.isPreparing(),false);assert.equal(h.gains.length,0);
  f.audio.setEnabled(true);f.audio.setVolume(2);assert.equal(f.requests.length,0);
  const pending=f.audio.prepare(h.context,h.output);assert.equal(f.audio.prepare(h.context,h.output),pending);
  assert(f.audio.isPreparing());assert.equal(h.gains[0].gain.value,0);await turn();
  const request=f.requests[0];assert.equal(request.destination,h.gains[0]);assert.equal(h.gains[0].output,h.output);
  assert(request.options.signal instanceof AbortSignal);
  request.task.resolve(request.device);const api=await pending;
  assert(api instanceof RF5C164Synth);assert.equal(f.audio.getPcm(),api);assert(!f.audio.isPreparing());
  assert.deepEqual(request.writes,[off]);assert.equal(h.gains[0].gain.value,2*SYNTH_SONG_MIX_DEFAULTS.pcm);
  api.setChannel(7,{start:256,loopStart:1234,step:2048,volume:192,pan:{left:15,right:3}});
  assert.deepEqual(request.writes.slice(1),[[7,199],[6,1],[4,210],[5,4],[2,0],[3,8],[0,192],[1,63]].map(args=>({method:'writeRegister',args})));
  api.keyOn(7);assert.deepEqual(request.writes.at(-1),{method:'keyOn',args:[7]});assert.equal(api.channelMask,127);
  f.audio.setVolume(3.8);assert.equal(h.gains[0].gain.value,3.8*SYNTH_SONG_MIX_DEFAULTS.pcm);
  assert.equal(await f.audio.prepare(h.context,h.output),api);
  f.audio.dispose();assert.equal(h.gains[0].gain.value,0);assert.equal(request.device.disposeCalls,1);
  assert.equal(h.context.closeCalls,0,'the shared host context remains owned by the app');
});

test('semantic release keeps its logical mask separate and cannot reactivate an old channel on the next note',async()=>{
  const f=fixture(),h=host(),{api,request}=await ready(f,h);
  api.keyOn(0);api.releaseNote(0);api.keyOn(1);
  assert.equal(api.channelMask,253);
  assert.deepEqual(request.writes.slice(1),[
    {method:'keyOn',args:[0]},{method:'releaseNote',args:[0]},{method:'keyOn',args:[1]},
  ],'the private renderer owns physical masks during the release tail');
  const before=request.writes.length;
  for(const value of [-1,8,NaN,'0'])for(const method of ['keyOn','keyOff','releaseNote'])assert.throws(()=>api[method](value));
  assert.equal(request.writes.length,before);assert.equal(api.channelMask,253);
  api.keyOff(1);assert.equal(api.channelMask,255);assert.deepEqual(request.writes.at(-1),{method:'keyOff',args:[1]});
  api.keyOn(2);api.allNotesOff();assert.equal(api.channelMask,255);assert.deepEqual(request.writes.at(-1),off);
  f.audio.dispose();const stopped=request.writes.length;api.releaseNote(2);assert.equal(request.writes.length,stopped);
});

test('private live PCM Worklet imports in AudioWorklet scope without DOM, text, abort or base64 globals',async()=>{
  const result=await new Promise((resolve,reject)=>{
    const worker=new Worker(`
      const {parentPort,workerData}=require('node:worker_threads');
      for(const name of ['TextEncoder','TextDecoder','AbortController','btoa','atob'])delete globalThis[name];
      globalThis.AudioWorkletProcessor=class {};
      globalThis.registerProcessor=(name,processor)=>parentPort.postMessage({name,valid:typeof processor==='function'});
      import(workerData).catch(error=>parentPort.postMessage({error:error.stack}));
    `,{eval:true,workerData:new URL('./synth_pcm_worklet.js',import.meta.url).href});
    const timer=setTimeout(()=>{worker.terminate();reject(Error('PCM Worklet import timed out'));},10000);
    worker.once('message',message=>{clearTimeout(timer);worker.terminate();message.error?reject(Error(message.error)):resolve(message);});
    worker.once('error',error=>{clearTimeout(timer);reject(error);});
  });
  assert.deepEqual(result,{name:'tetorica-synth-pcm',valid:true});
});

test('memory upload waits for its own acknowledgement, copies bytes and preserves ordered register commands',async()=>{
  const f=fixture(),h=host(),{api,request}=await ready(f,h);
  const bytes=Uint8Array.from([128,254,0,255]),promise=api.loadMemory(bytes,256);let settled=false;promise.then(()=>{settled=true;});
  const command=request.writes.at(-1);assert.equal(command.method,'loadMemory');assert.equal(command.args[1],256);
  assert.notEqual(command.args[0],bytes);bytes.fill(1);assert.deepEqual(command.args[0],Uint8Array.from([128,254,0,255]));
  api.setPitch(0,4096);assert.deepEqual(request.writes.slice(-3),[[7,192],[2,0],[3,16]].map(args=>({method:'writeRegister',args})));
  request.port.emit({id:command.id+100,value:true});await turn();assert.equal(settled,false);
  request.port.emit({id:command.id,value:'copied'});assert.equal(await promise,'copied');
  const rejected=api.loadMemory(Uint8Array.of(128),0),rejectCommand=request.writes.at(-1);
  request.port.emit({id:rejectCommand.id,error:'RAM transfer refused'});await assert.rejects(rejected,/RAM transfer refused/);
  assert.equal(f.audio.getPcm(),api,'ordinary request rejection does not retire a healthy endpoint');assert.deepEqual(f.errors,[]);
  const count=request.writes.length;
  assert.throws(()=>api.loadMemory(Uint8Array.of(128),65536));assert.throws(()=>api.setChannel(0,{start:1}));
  assert.throws(()=>api.setChannel(8,{volume:0}));assert.equal(request.writes.length,count);
  f.audio.dispose();
});

test('disable masks all physical channels immediately and late preparation cannot reopen its output',async()=>{
  const f=fixture(),h=host();f.audio.setEnabled(true);
  const pending=f.audio.prepare(h.context,h.output);await turn();f.audio.setEnabled(false);
  const request=f.requests[0];request.task.resolve(request.device);const api=await pending;
  assert.equal(h.gains[0].gain.value,0);assert.deepEqual(request.writes,[off]);
  api.keyOn(0);assert.equal(h.gains[0].gain.value,0);
  f.audio.setEnabled(true);assert.deepEqual(request.writes.at(-1),off);assert.equal(api.channelMask,255);
  assert.equal(h.gains[0].gain.value,SYNTH_SONG_MIX_DEFAULTS.pcm);
  for(let channel=0;channel<8;channel++)api.keyOn(channel);assert.equal(api.channelMask,0);
  f.audio.setEnabled(false);assert.equal(api.channelMask,255);assert.deepEqual(request.writes.at(-1),off);
  assert.equal(h.gains[0].gain.value,0);f.audio.dispose();
});

test('route replacement and dispose reject pending banks, ignore old ports and leave fresh owners untouched',async()=>{
  const f=fixture(),h=host(),first=f.audio.prepare(h.context,h.output);await turn();
  const old=f.requests[0],rejected=assert.rejects(first,{name:'AbortError'}),otherOutput={context:h.context};
  const second=f.audio.prepare(h.context,otherOutput);await rejected;await turn();
  assert(old.options.signal.aborted);assert.equal(h.gains[0].gain.value,0);
  const fresh=f.requests[1];fresh.task.resolve(fresh.device);const api=await second;
  old.task.resolve(old.device);await turn();await turn();assert.equal(old.device.disposeCalls,1);
  old.options.onError(new Error('obsolete device failed'));assert.equal(f.audio.getPcm(),api);assert.deepEqual(f.errors,[]);
  const bank=api.loadMemory(Uint8Array.of(128,255),0),bankError=assert.rejects(bank,{name:'AbortError'});
  const posted=fresh.writes.at(-1),nextContext=host(),third=f.audio.prepare(nextContext.context,nextContext.output);
  await bankError;assert.equal(fresh.listeners.size,0);fresh.port.emit({id:posted.id,value:true});
  await turn();const newest=f.requests[2];newest.task.resolve(newest.device);const current=await third;
  const loading=current.loadMemory(Uint8Array.of(128),0),disposedBank=assert.rejects(loading,{name:'AbortError'});
  f.audio.dispose();await disposedBank;
  const count=newest.writes.length;current.keyOn(0);current.reset();assert.equal(newest.writes.length,count);
  await assert.rejects(current.loadMemory(Uint8Array.of(128),0),{name:'AbortError'});
  await assert.rejects(f.audio.prepare(nextContext.context,nextContext.output),/disposed/);
  assert.equal(nextContext.context.closeCalls,0);assert.equal(newest.device.disposeCalls,1);
});

test('allocation and memory timeouts retire the owner instead of leaving a partially updated bank audible',async()=>{
  const f=fixture({timeoutMs:10}),h=host();f.audio.setEnabled(true);
  const preparing=f.audio.prepare(h.context,h.output),rejected=assert.rejects(preparing,/initialization timed out/);
  await pause(25);await rejected;assert.equal(f.audio.getPcm(),null);assert.equal(h.gains[0].gain.value,0);
  const late=f.requests[0];late.task.resolve(late.device);await turn();await turn();assert.equal(late.device.disposeCalls,1);
  const {api,request}=await ready(f,h);const bank=api.loadMemory(Uint8Array.of(128,255),0),bankError=assert.rejects(bank,/memory transfer timed out/);
  await pause(25);await bankError;assert.equal(f.audio.getPcm(),null);assert.equal(h.gains.at(-1).gain.value,0);
  assert.equal(request.device.disposeCalls,1);assert.equal(request.listeners.size,0);assert.equal(f.errors.length,2);f.audio.dispose();
});

test('creation failure, post-ready errors and invalid host inputs do not damage a newer endpoint',async()=>{
  const f=fixture(),h=host();
  const pending=f.audio.prepare(h.context,h.output),failure=assert.rejects(pending,/initial failure/);await turn();
  f.requests[0].task.reject(new Error('initial failure'));await failure;assert.equal(f.errors.length,1);assert.equal(h.gains[0].gain.value,0);
  const {api,request}=await ready(f,h);f.audio.setEnabled(true);request.options.onError(new Error('render error'));
  assert.equal(f.audio.getPcm(),null);assert.equal(h.gains[1].gain.value,0);assert.equal(request.device.disposeCalls,1);
  const count=request.writes.length;api.keyOn(1);assert.equal(request.writes.length,count);
  const third=await ready(f,h);const gain=h.gains.at(-1).gain.value;
  for(const value of [-1,4,NaN,Infinity,'1'])assert.throws(()=>f.audio.setVolume(value));assert.throws(()=>f.audio.setEnabled(1));
  await assert.rejects(f.audio.prepare(h.context,{context:host().context}),/belong/);
  await assert.rejects(f.audio.prepare({...h.context,state:'closed'},h.output),/open AudioContext/);
  assert.equal(f.audio.getPcm(),third.api);assert.equal(h.gains.at(-1).gain.value,gain);f.audio.dispose();
  assert.throws(()=>createSynthPcmAudio({timeoutMs:0}));assert.throws(()=>createSynthPcmAudio({onError:1}));
});
