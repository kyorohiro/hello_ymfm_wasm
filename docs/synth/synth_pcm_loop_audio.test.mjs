import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthPcmLoopAudio} from './synth_pcm_loop_audio.js';
import {SYNTH_SONG_MIX_DEFAULTS} from './synth_song_mix_defaults.js';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const raw=(id='a',frames=400)=>({id,left:new Float32Array(frames).fill(.25),right:new Float32Array(frames).fill(-.125),offsetSeconds:0});
const configuration={loopLength:.05,startTime:1};
function host(){const gains=[],context={sampleRate:8000,state:'running',closeCalls:0,close(){this.closeCalls++;},createGain(){const gain={context,gain:{value:1},disconnects:0,connect(output){this.output=output;},disconnect(){this.disconnects++;}};gains.push(gain);return gain;}};return{context,output:{context},gains};}
function fixture({autoAck=true,timeoutMs=15000}={}) {
  const devices=[],errors=[],audio=createSynthPcmLoopAudio({timeoutMs,onError:error=>errors.push(error),createDevice:(context,destination,options)=>{
    const task=deferred(),listeners=new Set(),writes=[];
    const port={postMessage(message,transfers=[]){const value=structuredClone(message,{transfer:transfers});writes.push(value);if(autoAck&&message.id!==undefined)queueMicrotask(()=>this.emit({id:message.id,value:true}));},
      addEventListener(type,fn){if(type==='message')listeners.add(fn);},removeEventListener(type,fn){if(type==='message')listeners.delete(fn);},start(){},emit(data){for(const fn of listeners)fn({data});}};
    const device={port,disposeCalls:0,dispose(){this.disposeCalls++;}};devices.push({context,destination,options,task,port,writes,listeners,device});return task.promise;
  }});
  return{audio,devices,errors};
}
async function ready(f,h){const promise=f.audio.prepare(h.context,h.output);await Promise.resolve();const d=f.devices.at(-1);d.task.resolve(d.device);return{api:await promise,d};}
async function posted(d,method,after=0){for(let i=0;i<100;i++){const command=d.writes.filter(item=>item.method===method&&item.id>after).at(-1);if(command)return command;await pause(1);}throw Error('No posted '+method);}
const ack=(d,command,value=true)=>d.port.emit({id:command.id,value});

// All hosts/ports above are data-only stubs. No AudioContext is constructed.
test('PCM loop endpoint lazily prepares, applies System × Master once and never owns the shared context',async()=>{
  const f=fixture(),h=host();assert.equal(f.audio.getPcm(),null);assert.equal(h.gains.length,0);f.audio.setEnabled(true);f.audio.setVolume(2);
  const first=f.audio.prepare(h.context,h.output);assert.equal(f.audio.prepare(h.context,h.output),first);assert(f.audio.isPreparing());await Promise.resolve();
  const d=f.devices[0];assert.equal(d.destination,h.gains[0]);assert.equal(h.gains[0].gain.value,0);d.task.resolve(d.device);const api=await first;
  assert.equal(f.audio.getPcm(),api);assert.equal(h.gains[0].gain.value,SYNTH_SONG_MIX_DEFAULTS.pcm*2);assert(!f.audio.isPreparing());
  f.audio.setVolume(0);assert.equal(h.gains[0].gain.value,0);f.audio.setVolume(3.8);assert.equal(h.gains[0].gain.value,SYNTH_SONG_MIX_DEFAULTS.pcm*3.8);
  f.audio.dispose();assert.equal(h.gains[0].gain.value,0);assert.equal(d.device.disposeCalls,1);assert.equal(h.context.closeCalls,0);
});

test('Looper PCM source gain is absolute, follows pending/replaced owners, and never rebuilds an active loop',async()=>{
  const f=fixture(),h=host();f.audio.setEnabled(true);f.audio.setSourceVolume(1.6);f.audio.setVolume(2);
  const pending=f.audio.prepare(h.context,h.output);await Promise.resolve();
  f.audio.setSourceVolume(.25);f.audio.setVolume(3.8);assert.equal(h.gains[0].gain.value,0);
  const first=f.devices[0];first.task.resolve(first.device);const api=await pending;assert.equal(h.gains[0].gain.value,.25*3.8);
  const token=await api.prepareLooperUnit(raw(),{loopLength:.05});await api.startLooper(configuration,{units:[token]});
  const messages=first.writes.length;
  f.audio.setSourceVolume(3.8);assert.equal(h.gains[0].gain.value,3.8*3.8);
  f.audio.setSourceVolume(0);assert.equal(h.gains[0].gain.value,0);
  f.audio.setSourceVolume(.5);f.audio.setVolume(.4);assert.equal(h.gains[0].gain.value,.5*.4);
  assert.equal(first.writes.length,messages);assert(api.isLooperPlaybackActive(),'source mute keeps its stored layers and sample position');
  for(const value of [-1,3.81,NaN,Infinity,'1',null])assert.throws(()=>f.audio.setSourceVolume(value),/0\.\.3\.8/);
  const replacing=f.audio.prepare(h.context,{context:h.context});await Promise.resolve();f.audio.setSourceVolume(.75);f.audio.setVolume(2);
  assert.equal(h.gains[0].gain.value,0);const next=f.devices[1];next.task.resolve(next.device);await replacing;
  assert.equal(h.gains[1].gain.value,1.5);f.audio.setEnabled(false);f.audio.setSourceVolume(3.8);assert.equal(h.gains[1].gain.value,0);f.audio.dispose();
});

test('inert upload clones source, waits for its ACK, and scheduled atomic start sends small token refs only',async()=>{
  const f=fixture({autoAck:false}),h=host(),{api,d}=await ready(f,h),source=raw();
  const task=api.prepareLooperUnit(source,{loopLength:.05});const upload=await posted(d,'prepareLooperUnit');let settled=false;task.then(()=>{settled=true;});
  assert.equal(upload.args[1].unit.frameCount,400);assert.equal(upload.args[1].unit.left.byteLength,1600);assert(source.left.every(x=>x===.25));assert.equal(source.left.byteLength,1600);
  d.port.emit({id:upload.id+99,value:true});await Promise.resolve();assert.equal(settled,false);ack(d,upload);const token=await task;
  assert(Object.isFrozen(token));assert.equal(token.id,'a');assert.equal(token.byteLength,3200);assert.equal(token.frameCount,400);
  f.audio.setEnabled(true);assert(!d.writes.some(m=>m.method==='stopLooper'),'enable preserves already-uploaded inert packets');
  const starting=api.startLooper(configuration,{units:[token]}),start=await posted(d,'startLooper');assert.deepEqual(start.args.slice(1),[configuration,[upload.args[0]]]);
  assert.equal(JSON.stringify(start).includes('left'),false);ack(d,start);const session=await starting;assert.equal(session,start.args[0]);assert(api.isLooperPlaybackActive());
  assert.throws(()=>f.audio.setVolume(4));await assert.rejects(api.startLooper({loopLength:121,startTime:1},{units:[]}),/length/);assert(api.isLooperPlaybackActive());
  await assert.rejects(api.addPreparedLooperUnit(session,token),/prepared/);f.audio.dispose();
});

test('adding and Undo use ACKs; canceled accepted add rolls back only that layer and preserves the backing loop',async()=>{
  const f=fixture(),h=host(),{api,d}=await ready(f,h);f.audio.setEnabled(true);
  const a=await api.prepareLooperUnit(raw('a'),{loopLength:.05}),session=await api.startLooper(configuration,{units:[a]});
  const b=await api.prepareLooperUnit(raw('b'),{loopLength:.05}),signal=new AbortController();
  // Disable only automatic replies while the staged packet is already owned.
  const original=d.port.postMessage;d.port.postMessage=function(message,transfers){if(message.method!=='addPreparedLooperUnit')return original.call(this,message,transfers);d.writes.push(structuredClone(message));};
  const adding=api.addPreparedLooperUnit(session,b,{signal:signal.signal}),add=await posted(d,'addPreparedLooperUnit');
  signal.abort(new DOMException('Undo pending add','AbortError'));await assert.rejects(adding,{name:'AbortError'});
  assert(d.writes.some(m=>m.method==='removeLooperUnit'&&m.args[0]===session&&m.args[1]==='b'));
  assert(d.writes.some(m=>m.method==='discardLooperUnit'));ack(d,add);assert(api.isLooperPlaybackActive());
  assert.equal(await api.removeLooperUnit(session,'b'),false);assert.equal(await api.removeLooperUnit(session,'a'),true);assert.equal(await api.removeLooperUnit(session,'a'),false);
  f.audio.dispose();assert.deepEqual(f.errors,[]);
});

test('abort upload discards inert RAM and Stop defeats pending start/add and late acknowledgements',async()=>{
  const f=fixture({autoAck:false}),h=host(),{api,d}=await ready(f,h),signal=new AbortController();
  const pending=api.prepareLooperUnit(raw('upload'),{loopLength:.05,signal:signal.signal}),upload=await posted(d,'prepareLooperUnit');signal.abort();await assert.rejects(pending,{name:'AbortError'});
  assert(d.writes.some(m=>m.method==='discardLooperUnit'&&m.args[0]===upload.args[0]));ack(d,upload);
  const p=api.prepareLooperUnit(raw('start'),{loopLength:.05}),up=await posted(d,'prepareLooperUnit',upload.id);ack(d,up);const token=await p;
  f.audio.setEnabled(true);const starting=api.startLooper(configuration,{units:[token]}),start=await posted(d,'startLooper'),rejected=assert.rejects(starting,{name:'AbortError'});
  f.audio.setEnabled(false);await rejected;ack(d,start);assert(!api.isLooperPlaybackActive());assert.equal(h.gains[0].gain.value,0);
  assert(d.writes.filter(m=>m.method==='stopLooper').at(-1).args[0]>start.args[0]);await assert.rejects(api.startLooper(configuration,{units:[token]}),/prepared/);
  f.audio.dispose();
});

test('prepared tokens belong to one route and length, bounds reject before damaging active layers',async()=>{
  const f=fixture(),h=host(),{api}=await ready(f,h);f.audio.setEnabled(true);
  const tokens=[];for(let index=0;index<16;index++)tokens.push(await api.prepareLooperUnit(raw('unit'+index),{loopLength:.05}));
  await assert.rejects(api.prepareLooperUnit(raw('extra'),{loopLength:.05}),/storage limit/);
  const session=await api.startLooper(configuration,{units:tokens});assert(api.isLooperPlaybackActive());
  const bad=raw('nan');bad.left[0]=NaN;await assert.rejects(api.prepareLooperUnit(bad,{loopLength:.05}),/sample/);assert(api.isLooperPlaybackActive());
  assert.equal(await api.removeLooperUnit(session,'unit0'),true);const token=await api.prepareLooperUnit(raw('replacement'),{loopLength:.05});
  await assert.rejects(api.startLooper({loopLength:.1,startTime:2},{units:[token]}),/prepared/);assert(api.isLooperPlaybackActive());
  const foreign=fixture(),other=await ready(foreign,h);await assert.rejects(other.api.startLooper(configuration,{units:[token]}),/prepared/);
  f.audio.dispose();foreign.audio.dispose();
});

test('output replacement, dispose and stale factory failures cannot revive old staging or close borrowed contexts',async()=>{
  const f=fixture(),h=host(),first=f.audio.prepare(h.context,h.output);await Promise.resolve();const old=f.devices[0],oldRejected=assert.rejects(first,{name:'AbortError'});
  const otherOutput={context:h.context},second=f.audio.prepare(h.context,otherOutput);await oldRejected;await Promise.resolve();const newer=f.devices[1];newer.task.resolve(newer.device);const api=await second;
  old.task.resolve(old.device);await Promise.resolve();await Promise.resolve();assert.equal(old.device.disposeCalls,1);old.options.onError(Error('obsolete'));assert.deepEqual(f.errors,[]);
  f.audio.setEnabled(true);const token=await api.prepareLooperUnit(raw(),{loopLength:.05});await api.startLooper(configuration,{units:[token]});
  const third=f.audio.prepare(host().context,{context:h.context});await assert.rejects(third,/belong/);assert(api.isLooperPlaybackActive());
  newer.options.onError(Error('render failed'));assert.equal(f.audio.getPcm(),null);assert.equal(h.gains.at(-1).gain.value,0);assert.equal(newer.device.disposeCalls,1);assert.equal(h.context.closeCalls,0);
  await assert.rejects(api.prepareLooperUnit(raw(),{loopLength:.05}));f.audio.dispose();await assert.rejects(f.audio.prepare(h.context,h.output),/disposed/);
});

test('timeouts retire and mute initialization or uncertain transfers instead of leaving ghost layers',async()=>{
  const f=fixture({autoAck:false,timeoutMs:10}),h=host();f.audio.setEnabled(true);
  const pending=f.audio.prepare(h.context,h.output),rejected=assert.rejects(pending,/initialization timed out/);await pause(25);await rejected;assert.equal(h.gains[0].gain.value,0);
  const old=f.devices[0];old.task.resolve(old.device);await Promise.resolve();await Promise.resolve();assert.equal(old.device.disposeCalls,1);
  const {api}=await ready(f,h),upload=api.prepareLooperUnit(raw(),{loopLength:.05}),uploadRejected=assert.rejects(upload,/transfer timed out/);await pause(25);await uploadRejected;
  assert.equal(f.audio.getPcm(),null);assert.equal(h.gains.at(-1).gain.value,0);assert.equal(f.errors.length,2);assert.equal(h.context.closeCalls,0);f.audio.dispose();
});


test('Undo after completed inert upload frees its cache token before any start/add is sent',async()=>{
  const f=fixture(),h=host(),{api,d}=await ready(f,h),signal=new AbortController();
  const token=await api.prepareLooperUnit(raw('canceled-ready'),{loopLength:.05,signal:signal.signal});
  const upload=d.writes.find(m=>m.method==='prepareLooperUnit');signal.abort();
  assert(d.writes.some(m=>m.method==='discardLooperUnit'&&m.args[0]===upload.args[0]));
  await assert.rejects(api.startLooper(configuration,{units:[token]}),/prepared/);
  assert(!d.writes.some(m=>m.method==='startLooper'));
  const fresh=await api.prepareLooperUnit(raw('canceled-ready'),{loopLength:.05});
  await api.startLooper(configuration,{units:[fresh]});assert(api.isLooperPlaybackActive());f.audio.dispose();
});
