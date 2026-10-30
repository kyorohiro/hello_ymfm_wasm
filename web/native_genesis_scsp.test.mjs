import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MessageChannel} from 'node:worker_threads';
import {Scsp} from './scsp.js';
import factory from '../docs/generated/scsp_wasm.js';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createNativeGenesisWorkerBridge} from './native_genesis_worker.js';
import {createScspClient} from './playground_scsp.js';
let module;
async function fixture(t){
 module??=factory({wasmBinary:await readFile(new URL('../docs/generated/scsp_wasm.wasm',import.meta.url))});
 const cores=new Map(),calls=[],errors=[],disposers=[];let revision=0;
 async function make(id){const core=await Scsp.create({moduleFactory:()=>module});cores.set(id,{core,held:new Map(),enabled:0});}await make(0);
 const status=()=>({session:1,mode:'scsp',frame:0,sampleRate:48000,running:true,ymClock:7670454,psgClock:3579545});
 const state=s=>({registers:Array.from({length:513},(_,i)=>s.core.read(i*2)),nativeFrames:s.core.nativeFrames,enabled:s.enabled>>>0,held:[...s.held.keys()],pendingCommands:[],revision:++revision,sampleRate:48000});
 function apply(s,m){
  if(m.method==='batch'){
   const held=s.held.get(m.channel);if(held!==undefined&&(!m.audition||m.action!=='on'&&held!==m.voice))return;
   if(m.action==='on'&&m.audition)s.held.set(m.channel,m.voice);
   for(const op of m.commands){assert.equal(op.method,'write');s.core.write(op.register,op.value,op.mask);}
   if(m.action==='on')s.enabled|=2**m.channel;if(m.action==='off'){s.enabled&=~(2**m.channel);s.held.delete(m.channel);}
  }else if(m.method==='reset'){s.core.reset({clearRam:m.clearRam});s.core.write(0x400,0x020f);s.enabled=0;s.held.clear();}
  else if(m.method==='load-memory')s.core.loadRam(Uint8Array.from(m.data),m.address);
  else if(m.method==='stop-voices'){s.core.reset();s.core.write(0x400,0x020f);s.enabled=0;s.held.clear();}
  else if(m.method==='all-notes-off'){for(let ch=0;ch<32;ch++)if(!s.held.has(ch)){s.core.write(ch*32,0x1000,0x1800);s.enabled&=~(2**ch);}}
 }
 const invoke=async(command,args={})=>{
  calls.push({command,args});
  if(command==='native_genesis_extra_scsp_create'){await make(args.instance);return {...status(),scsp:state(cores.get(args.instance))};}
  if(command==='native_genesis_extra_scsp_dispose'){cores.get(args.instance)?.core.dispose();cores.delete(args.instance);return;}
  if(command==='native_genesis_commands'){for(const c of args.commands)if(['scsp','extra-scsp'].includes(c.type))apply(cores.get(c.instance??0),c.message);}
  if(command==='native_genesis_scsp_status')return {...state(cores.get(0)),frame:0};
  if(command==='native_genesis_extra_scsp_status')return {...status(),revision:++revision,scsp:state(cores.get(args.instance))};
  if(command==='native_genesis_stop'||command==='native_genesis_reset')apply(cores.get(0),{method:'stop-voices'});
  return status();
 };
 const synth=new NativeGenesisSynth({mode:'scsp',invoke,now:()=>0,onError:e=>errors.push(e)});await synth.start();
 t.after(async()=>{for(const dispose of disposers)await dispose();await synth.close();for(const s of cores.values())s.core.dispose();});
 return {synth,calls,cores,errors,disposers};
}
const peak=a=>Math.max(...a.map(Math.abs));
for(const extra of [false,true])test(`Native SCSP ${extra?'extra':'primary'} PCM, 32-slot key, editor and Stop`,async t=>{
 const f=await fixture(t),device=extra?await f.synth.createExtraScsp({id:'saturn'}):null,client=device?.client??f.synth.scsp,endpoint=device?.endpoint??f.synth.nativeScsp;
 assert.equal(f.synth.node,null);assert.equal(f.synth.audioContext,null);
 const wave=await client.loadPCM(new Int16Array([0,8192,0,-8192]),{rootNote:69,loopStartSamples:0});client.setPreset(0,{sample:wave});client.setPreset(31,{sample:wave});client.noteOn(31,69);
 let state=await client.getState();assert.equal(state.slots[31].sample.id,wave.id);assert.equal(state.slots[31].gate,true);
 const core=f.cores.get(device?.nativeInstance??0).core,a=core.generateStereo(128);assert(peak(a.left)>0.1);
 await endpoint.invoke('auditionOn',[0,69,'held']);await endpoint.invoke('auditionOn',[31,69,'new']);assert.equal(await endpoint.invoke('auditionOff',[31,'stale']),false);await endpoint.invoke('auditionOff',[31,'new']);await endpoint.invoke('auditionAllOff');
 await client._stopVoices();const silence=core.generateStereo(64);assert.equal(peak(silence.left),0);
 const edited=await endpoint.invoke('applyPCM',[31,new Int8Array([0,64,0,-64]),{rootNote:69,loopStartSamples:0}]);
 assert.equal((await endpoint.read()).slots[31].sample.id,edited.id);assert.deepEqual((await endpoint.invoke('getPCM',[31])).pcm,new Int8Array([0,64,0,-64]));
 assert.deepEqual(f.errors,[]);
});
test('Native SCSP Worker ports upload PCM and acknowledge metadata on the same port',async t=>{
 const f=await fixture(t),bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:e=>f.errors.push(e)});f.disposers.push(()=>bridge.dispose());
 // Start protocol before using the console port.
 const wait=(port,message)=>new Promise((resolve,reject)=>{port.once('message',data=>data.error?reject(new Error(data.error)):resolve(data));port.postMessage(message);});
 await wait(bridge.chipPort,{type:'performance-start',session:1,id:10});
 const client=createScspClient(bridge.scspPort,{state:f.synth.scsp._getState(),native:true});f.disposers.unshift(()=>client.dispose());
 const wave=await client.loadPCM(new Int8Array([0,80,0,-80]),{rootNote:69,loopStartSamples:0});assert.equal(wave.bits,8);client.setPreset(0,{sample:wave});client.setPreset(31,{sample:wave});client.noteOn(31,69);
 client.setLfo(31,{frequencyCode:19,pitchDepth:3,amplitudeDepth:4});const state=await client.getState();assert.equal(state.slots[31].lfo.frequencyCode,19);assert.equal(state.slots[31].sample.id,wave.id);assert.equal(state.slots[31].gate,true);
 assert.deepEqual(f.errors,[]);
});
test('Native SCSP close/start retires old handles and preserves Mixer routes without Web Audio',async t=>{
 const f=await fixture(t),old=await f.synth.scsp.loadPCM(new Int8Array([0,64,0,-64]),{rootNote:69,loopStartSamples:0});
 const extra=await f.synth.createExtraScsp({id:'temporary'});await f.synth.close();assert.equal(f.synth.extraDevices.size,0);await f.synth.start();
 const state=await f.synth.scsp.getState();assert(!state.samples.some(s=>s.id===old.id));assert(state.samples[0].id>old.id);assert.equal(state.samples.length,1);assert.equal(state.slots.length,32);
 const request=f.synth.nativeScsp.dispatch({method:'setPreset',args:[31,{sample:old}]});await assert.rejects(request.deferred,/another bank|cleared/);
 const next=await f.synth.createExtraScsp({id:'temporary'});assert.notEqual(next.nativeInstance,extra.nativeInstance);
 assert.equal(f.synth.primaryEndpoints[0].name,'scsp');assert.deepEqual(f.errors,[]);
});
test('Native SCSP reset is immediate inside timed playback and clears handles before another upload',async t=>{
 const f=await fixture(t),endpoint=f.synth.nativeScsp,old=(await f.synth.scsp.getState()).samples[0];
 const result=endpoint.dispatch({method:'reset',args:[{clearRam:true}]},{time:10,performance:1,owner:1});await result.deferred;
 const commands=f.calls.filter(c=>c.command==='native_genesis_commands').flatMap(c=>c.args.commands),reset=commands.findLast(c=>c.type==='scsp'&&c.message.method==='reset');assert.equal(reset.frame,0);assert.equal(reset.performance,undefined);assert.equal(reset.owner,undefined);
 const next=await f.synth.scsp.loadPCM(new Int8Array([0,64,0,-64]),{rootNote:69,loopStartSamples:0});assert.equal(next.address,0);assert(next.id>old.id);
 f.synth.scsp.setPreset(31,{sample:next});f.synth.scsp.noteOn(31,69);assert((await f.synth.scsp.getState()).slots[31].gate);assert(peak(f.cores.get(0).core.generateStereo(128).left)>0.1);
});
for(const extra of [false,true])test(`Native LFO ${extra?'extra':'primary'} live masked fields, inspector and Stop`,async t=>{
 const f=await fixture(t),device=extra?await f.synth.createExtraScsp({id:'lfo'}):null,client=device?.client??f.synth.scsp,endpoint=device?.endpoint??f.synth.nativeScsp,core=f.cores.get(device?.nativeInstance??0).core;
 client.noteOn(0,69);await client.getState();client.setLfo(0,{frequencyCode:20,pitchWave:2,pitchDepth:4});await client.getState();const old=core.read(18);
 client.setLfo(0,{amplitudeDepth:7});let state=await client.getState();assert.equal(core.read(18)&~7,old&~7);assert.equal(state.slots[0].lfo.amplitudeDepth,7);assert.equal(state.slots[0].gate,true);
 await endpoint.invoke('auditionOn',[31,69,'lfo']);await endpoint.invoke('setLfo',[31,{frequencyCode:0,reset:true,amplitudeDepth:7}]);assert.equal(core.read(31*32+18)&0x8007,0x8007);
 assert.equal(await endpoint.invoke('auditionOff',[31,'stale']),false);await endpoint.invoke('setLfo',[31,{reset:false}]);assert.equal(core.read(31*32+18)&0x8000,0);
 await client._stopVoices();assert(core.generateStereo(128).left.every(v=>v===0));assert.equal((await client.getState()).slots[31].lfo.amplitudeDepth,7);assert.deepEqual(f.errors,[]);
});
