// Fake contexts/ports only: this suite creates no AudioContext or audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthPcmRecordingAudio} from './synth_pcm_recording_audio.js';
import {createPcmBuiltinPreset} from './synth_pcm.js';
import {SYNTH_SONG_MIX_DEFAULTS} from './synth_song_mix_defaults.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>Promise.resolve(),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const recording=()=>({format:'tetorica-rf5c164-recording-v1',version:1,durationSeconds:.2,
  initialState:{preset:createPcmBuiltinPreset(),pitchClock:7670454},commands:[{time:0,type:'noteOn',channel:7,block:4,fnum:644},{time:.1,type:'noteOff',channel:7}]});
function host() {
  const gains=[],context={state:'running',sampleRate:48000,closeCalls:0,close(){this.closeCalls++;},createGain(){
    const value={context,gain:{value:1},output:null,disconnectCalls:0,connect(output){this.output=output;},disconnect(){this.disconnectCalls++;}};gains.push(value);return value;
  }};return {context,output:{context},gains};
}
function fixture(options={}) {
  const requests=[],errors=[];
  const endpoint=createSynthPcmRecordingAudio({...options,onError:error=>errors.push(error),createDevice:(context,output,config)=>{
    const task=deferred(),messages=[],listeners=new Set();
    const port={postMessage(message,transfers=[]){messages.push({message,transfers});},
      addEventListener(type,fn){if(type==='message')listeners.add(fn);},removeEventListener(type,fn){if(type==='message')listeners.delete(fn);},
      start(){this.started=true;},emit(data){for(const fn of listeners)fn({data});}};
    const device={port,disposed:0,dispose(){this.disposed++;}};
    requests.push({context,output,config,task,messages,listeners,port,device});return task.promise;
  }});
  return {endpoint,requests,errors};
}
async function ready(f,h) {
  const pending=f.endpoint.prepare(h.context,h.output);await tick();const request=f.requests.at(-1);request.task.resolve(request.device);return {api:await pending,request};
}
const lastPlay=request=>request.messages.map(row=>row.message).filter(message=>message.method==='playRecording').at(-1);
async function accepted(api,request,doc=recording(),options={}) {
  const task=api.playRecording(doc,options),message=lastPlay(request);request.port.emit({id:message.id,value:true});return task;
}

test('PCM Event Rec endpoint stays lazy, shares the host context and applies System × Master once',async()=>{
  const f=fixture(),h=host();assert.equal(f.endpoint.getPcm(),null);assert.equal(f.endpoint.isPreparing(),false);
  f.endpoint.setVolume(2);f.endpoint.setEnabled(true);assert.equal(f.requests.length,0);
  const pending=f.endpoint.prepare(h.context,h.output);assert.equal(f.endpoint.prepare(h.context,h.output),pending);assert(f.endpoint.isPreparing());
  await tick();const request=f.requests[0];assert.equal(h.gains[0].gain.value,0);request.task.resolve(request.device);const api=await pending;
  assert.equal(f.endpoint.getPcm(),api);assert.equal(h.gains[0].gain.value,SYNTH_SONG_MIX_DEFAULTS.pcm*2);assert.equal(h.gains[0].output,h.output);
  assert(!f.endpoint.isPreparing());assert.equal(request.port.started,true);assert.equal(await f.endpoint.prepare(h.context,h.output),api);
  f.endpoint.setVolume(3.8);assert.equal(h.gains[0].gain.value,SYNTH_SONG_MIX_DEFAULTS.pcm*3.8);
  f.endpoint.dispose();assert.equal(h.gains[0].gain.value,0);assert.equal(request.device.disposed,1);assert.equal(h.context.closeCalls,0);
});

test('Event Rec shares absolute PCM source gain through pending allocation and active playback without stopping the take',async()=>{
  const f=fixture(),h=host();f.endpoint.setEnabled(true);f.endpoint.setSourceVolume(1.6);f.endpoint.setVolume(2);
  const pending=f.endpoint.prepare(h.context,h.output);await tick();
  f.endpoint.setSourceVolume(.25);f.endpoint.setVolume(3.8);assert.equal(h.gains[0].gain.value,0);
  const first=f.requests[0];first.task.resolve(first.device);const api=await pending;assert.equal(h.gains[0].gain.value,.25*3.8);
  await accepted(api,first);assert(api.isRecordingPlaybackActive());const messages=first.messages.length;
  f.endpoint.setSourceVolume(3.8);assert.equal(h.gains[0].gain.value,3.8*3.8);
  f.endpoint.setSourceVolume(0);assert.equal(h.gains[0].gain.value,0);
  f.endpoint.setSourceVolume(.5);f.endpoint.setVolume(.4);assert.equal(h.gains[0].gain.value,.5*.4);
  assert.equal(first.messages.length,messages);assert(api.isRecordingPlaybackActive(),'mix changes preserve the same sample-clock take');
  for(const value of [-1,3.81,NaN,Infinity,'1',null])assert.throws(()=>f.endpoint.setSourceVolume(value),/0\.\.3\.8/);
  const replacing=f.endpoint.prepare(h.context,{context:h.context});await tick();f.endpoint.setSourceVolume(.75);f.endpoint.setVolume(2);
  assert.equal(h.gains[0].gain.value,0);const next=f.requests[1];next.task.resolve(next.device);await replacing;
  assert.equal(h.gains[1].gain.value,1.5);f.endpoint.setEnabled(false);f.endpoint.setSourceVolume(3.8);assert.equal(h.gains[1].gain.value,0);f.endpoint.dispose();
});

test('play transfers prepared guarded banks and waits for its own ACK without mutating source JSON',async()=>{
  const f=fixture(),h=host(),{api,request}=await ready(f,h),doc=recording(),original=structuredClone(doc);
  const promise=api.playRecording(doc,{loop:true});let finished=false;promise.then(()=>{finished=true;});
  const message=lastPlay(request),row=request.messages.at(-1),prepared=message.args[1];
  assert.equal(message.method,'playRecording');assert.equal(prepared.banks.length,1);assert.equal(prepared.banks[0].length,65536);
  assert(prepared.banks[0].subarray(256).every(value=>value===255));assert.equal(row.transfers[0],prepared.banks[0].buffer);
  assert.equal(prepared.events[1].frame,4800);assert.equal(prepared.events[0].channel,7);assert.equal(prepared.initial.settings.volume,64);
  assert.equal(prepared.initial.sample,undefined,'source base64 does not reach the rendering protocol');assert.deepEqual(doc,original);
  request.port.emit({id:message.id+1,value:true});await tick();assert.equal(finished,false);
  request.port.emit({id:message.id,value:true});assert.equal(await promise,message.args[0]);assert(api.isRecordingPlaybackActive());
  f.endpoint.dispose();
});

test('stop, signal abort and late ACK cannot revive a take or end a newer owner',async()=>{
  const f=fixture(),h=host(),{api,request}=await ready(f,h),controller=new AbortController();
  const pending=api.playRecording(recording(),{signal:controller.signal}),old=lastPlay(request),rejected=assert.rejects(pending,{name:'AbortError'});
  controller.abort();await rejected;assert(!api.isRecordingPlaybackActive());
  const stop=request.messages.at(-1).message;assert.equal(stop.method,'stopRecording');assert(stop.args[0]>old.args[0]);
  const ended=[],next=api.playRecording(recording(),{onEnded:()=>ended.push('new')}),fresh=lastPlay(request);
  request.port.emit({id:old.id,value:true});request.port.emit({type:'pcm-recording-ended',session:old.args[0]});assert.deepEqual(ended,[]);assert(api.isRecordingPlaybackActive());
  request.port.emit({id:fresh.id,value:true});await next;
  request.port.emit({type:'pcm-recording-ended',session:fresh.args[0]});assert.deepEqual(ended,['new']);assert(!api.isRecordingPlaybackActive());
  request.port.emit({type:'pcm-recording-ended',session:fresh.args[0]});assert.deepEqual(ended,['new']);
  const task=api.playRecording(recording()),last=lastPlay(request),cancelled=assert.rejects(task,{name:'AbortError'});assert(api.stopRecordingPlayback());await cancelled;
  request.port.emit({id:last.id,value:true});assert(!api.isRecordingPlaybackActive());f.endpoint.dispose();
});

test('invalid files, options and pre-aborted plays preserve the current private playback',async()=>{
  const f=fixture(),h=host(),{api,request}=await ready(f,h);await accepted(api,request);
  const before=request.messages.length,controller=new AbortController();controller.abort();
  for(const [doc,options]of [[{...recording(),format:'megasynth-recording-v1'},{}],[recording(),{loop:1}],
    [recording(),{ignorePatch:1}],[recording(),{onEnded:1}],[recording(),{signal:1}],
    [recording(),{signal:controller.signal}],[recording(),{ignorePatch:true,preset:{},pitchClock:7670454}]]) {
    await assert.rejects(api.playRecording(doc,options));assert.equal(request.messages.length,before);assert(api.isRecordingPlaybackActive());
  }
  for(const value of [-1,4,NaN,'1'])assert.throws(()=>f.endpoint.setVolume(value));assert.throws(()=>f.endpoint.setEnabled(1));
  await assert.rejects(f.endpoint.prepare(h.context,{context:host().context}),/belong/);assert.equal(f.endpoint.getPcm(),api);f.endpoint.dispose();
});

test('disable masks immediately, cancels pending transfers and rejects late creation on a retired route',async()=>{
  const f=fixture(),h=host();f.endpoint.setEnabled(true);const {api,request}=await ready(f,h);
  const task=api.playRecording(recording()),old=lastPlay(request),rejected=assert.rejects(task,{name:'AbortError'});
  f.endpoint.setEnabled(false);assert.equal(h.gains[0].gain.value,0);await rejected;
  request.port.emit({id:old.id,value:true});assert(!api.isRecordingPlaybackActive());assert.equal(h.gains[0].gain.value,0);
  const other={context:h.context},pending=f.endpoint.prepare(h.context,other);await tick();const fresh=f.requests.at(-1);
  assert.equal(request.device.disposed,1);assert.equal(request.listeners.size,0);assert.equal(h.gains[0].gain.value,0);
  fresh.task.resolve(fresh.device);const next=await pending;assert.equal(f.endpoint.getPcm(),next);assert.equal(h.gains[1].gain.value,0);
  request.config.onError(Error('obsolete'));assert.deepEqual(f.errors,[]);assert.equal(f.endpoint.getPcm(),next);
  f.endpoint.setEnabled(true);assert.equal(h.gains[1].gain.value,SYNTH_SONG_MIX_DEFAULTS.pcm);f.endpoint.dispose();assert.equal(h.context.closeCalls,0);
});

test('creation / transfer timeouts and post-ready failures retire owners and cancel all pending callbacks',async()=>{
  const f=fixture({timeoutMs:10}),h=host();f.endpoint.setEnabled(true);
  const preparing=f.endpoint.prepare(h.context,h.output),creationError=assert.rejects(preparing,/initialization timed out/);
  await pause(25);await creationError;assert.equal(f.endpoint.getPcm(),null);const late=f.requests[0];late.task.resolve(late.device);await tick();await tick();assert.equal(late.device.disposed,1);
  const {api,request}=await ready(f,h),playing=api.playRecording(recording()),playError=assert.rejects(playing,/transfer timed out/);
  await pause(25);await playError;assert.equal(f.endpoint.getPcm(),null);assert.equal(h.gains[1].gain.value,0);assert.equal(request.listeners.size,0);
  const third=await ready(f,h),pending=third.api.playRecording(recording()),renderError=assert.rejects(pending,/render failed/);
  third.request.config.onError(Error('render failed'));await renderError;assert.equal(third.request.device.disposed,1);assert.equal(f.errors.length,3);
  f.endpoint.dispose();await assert.rejects(f.endpoint.prepare(h.context,h.output),/disposed/);assert.equal(h.context.closeCalls,0);
});
