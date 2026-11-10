import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthPcmAudio} from './synth_pcm_audio.js';
import {RF5C164Synth} from '../js/rf5c164synth.js?v=audio-stability-2';
import {SYNTH_SONG_MIX_DEFAULTS} from './synth_song_mix_defaults.js';
import {Worker} from 'node:worker_threads';

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
