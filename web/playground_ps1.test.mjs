import test from 'node:test';
import assert from 'node:assert/strict';
import {createPs1Client} from './playground_ps1.js';
import {createPs1Audio} from './playground_ps1_audio.js';
import {Ps1Synth,createPs1InitSample} from './ps1synth.js';
import {createPerformanceSender} from './playground_performance_sender.js';
const core=()=>({reset(){},loadRam(){},write(){},read(){return 0;},readRam(){return new Uint8Array(524288);},renderInto(){},dispose(){}});
function rpc(){const channel=new MessageChannel(),synth=new Ps1Synth({core:core()}),posts=[];channel.port1.onmessage=({data})=>{posts.push(data);if(data.method==='dispose')return;try{const value=synth[data.method](...data.args);if(data.id!==undefined)channel.port1.postMessage({id:data.id,value});}catch(error){channel.port1.postMessage({id:data.id,error:error.message,name:error.name});}};return{client:createPs1Client(channel.port2),synth,posts,remote:channel.port1,close(){this.client.dispose();channel.port1.close();}};}
test('PS1 client owns uploads, validates all24 voices and preserves sample reservations on reset',async t=>{
 const p=rpc();t.after(()=>p.close());const{adpcm,...options}=createPs1InitSample(),before=adpcm.slice();const sample=await p.client.loadADPCM(adpcm,options);assert.deepEqual(adpcm,before);assert.equal(sample.startAddress,0x1000);p.client.setPreset(23,{sample});p.client.noteOn(23,69);assert.equal((await p.client.getState()).channels[23].gate,true);assert.throws(()=>p.client.keyOn(24),/channel/);assert.throws(()=>p.client.setPitch(23,0x4000),/pitch/);p.client.reset();assert.equal((await p.client.getState()).samples.length,1);p.client.reset({clearRam:true});assert.equal((await p.client.getState()).samples.length,0);await assert.rejects(p.client.loadADPCM(adpcm,{rootNote:60}),/loopStartSamples/);assert.equal((await p.client.loadADPCM(adpcm,options)).id,0);
});
test('PS1 reset and disposal fence late upload replies without adopting stale sample metadata',async t=>{
 const p=rpc();t.after(()=>p.close());const{adpcm,...options}=createPs1InitSample();const stale=p.client.loadADPCM(adpcm,options);p.client.reset({clearRam:true});await assert.rejects(stale,{name:'AbortError'});assert.equal(p.client._getState().samples.length,0);assert.equal((await p.client.loadADPCM(adpcm,options)).id,0);const pending=p.client.snapshot();p.client.dispose();await assert.rejects(pending,{name:'AbortError'});assert.throws(()=>p.client.keyOn(0),/disposed/);
});
test('PS1 client message errors and timed-out RPC reject every waiter and dispose the port',async()=>{
 const old=globalThis.setTimeout,oldClear=globalThis.clearTimeout;let callback,closed=false;
 globalThis.setTimeout=fn=>{callback=fn;return{unref(){}};};globalThis.clearTimeout=()=>{};
 try{const port={postMessage(){},start(){},close(){closed=true;}},client=createPs1Client(port),a=client.snapshot(),b=client.getState();const rejectedA=assert.rejects(a,/did not respond/),rejectedB=assert.rejects(b,/did not respond/);callback();await rejectedA;await rejectedB;assert(closed);assert.throws(()=>client.keyOff(0),/disposed/);}
 finally{globalThis.setTimeout=old;globalThis.clearTimeout=oldClear;}
});
test('PS1 Worker upload/read resources bypass lookahead, voice controls retain reserved timing',()=>{
 const posts=[],port={postMessage:data=>posts.push(data)},sender=createPerformanceSender({now:()=>1000,getLoop:()=>({performanceOwner:'lead'})});sender.configure({session:1,audioSeconds:2,performanceEpochMs:1000,lookaheadSeconds:.5});const proxy=sender.port(port,'independent');const{adpcm,...options}=createPs1InitSample();proxy.postMessage({method:'loadADPCM',args:[adpcm,options],id:1});proxy.postMessage({method:'setPreset',args:[23,{sample:0}]});proxy.postMessage({method:'noteOn',args:[23,60]});proxy.postMessage({method:'snapshot',args:[],id:2});assert.equal(posts[0].method,'loadADPCM');assert.equal(posts[0].performance,undefined);assert.equal(posts[1].performance.time,2.5);assert.equal(posts[2].performance.time,2.5);assert.equal(posts[3].method,'snapshot');
});
function audioMock(t,{ready=true}={}){const original=globalThis.AudioWorkletNode,nodes=[],listeners=new Set();const context={sampleRate:48000,state:'running',audioWorklet:{async addModule(){}},addEventListener(_,fn){listeners.add(fn);},removeEventListener(_,fn){listeners.delete(fn);}};globalThis.AudioWorkletNode=class{constructor(_context,name){assert.equal(name,'tetorica-playground-ps1');this.disconnected=0;this.port={postMessage(){},close(){}};nodes.push(this);if(ready)queueMicrotask(()=>this.port.onmessage?.({data:{ready:true,sampleRate:48000,state:{samples:[{id:0}],channels:Array(24).fill({sample:0})}}}));}connect(){}disconnect(){this.disconnected++;}};t.after(()=>{globalThis.AudioWorkletNode=original;});return{context,nodes,listeners,options:{fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)})}};}
test('PS1 audio readiness carries authored metadata and late failure releases endpoint once',async t=>{
 const p=audioMock(t),device=await createPs1Audio(p.context,{},p.options);t.after(()=>{device.dispose();device.port.close();});assert.equal(device.nativeSampleRate,44100);assert.equal(device.state.channels.length,24);p.nodes[0].onprocessorerror();assert.equal(p.nodes[0].disconnected,1);assert.equal(p.listeners.size,0);device.dispose();assert.equal(p.nodes[0].disconnected,1);
});
test('PS1 audio abort releases pending initialization and no late ready can reconnect it',async t=>{
 const p=audioMock(t,{ready:false}),controller=new AbortController(),pending=createPs1Audio(p.context,{}, {...p.options,signal:controller.signal});await new Promise(resolve=>setImmediate(resolve));assert.equal(p.nodes.length,1);controller.abort(new Error('cancel creation'));await assert.rejects(pending,/cancel creation/);assert.equal(p.nodes[0].disconnected,1);assert.equal(p.listeners.size,0);assert.equal(p.nodes[0].port.onmessage,null);
});
test('PS1 closed AudioContext rejects pending readiness immediately',async t=>{
 const p=audioMock(t,{ready:false}),pending=createPs1Audio(p.context,{},p.options);await new Promise(resolve=>setImmediate(resolve));p.context.state='closed';for(const callback of [...p.listeners])callback();await assert.rejects(pending,/closed/);assert.equal(p.nodes[0].disconnected,1);assert.equal(p.listeners.size,0);
});
test('PS1 asynchronous Worker resources restore the caller loop and reject stopped continuations',async t=>{
 const p=rpc();t.after(()=>p.close());const a={id:'a',stopped:false},b={id:'b',stopped:false};let current=a;
 p.client._setLifecycle({captureContext:()=>current,restoreContext:loop=>{current=loop;},isStopped:loop=>loop?.stopped});
 const requested=p.client.getState();current=b;await requested;assert.equal(current,a,'resource continuations keep the originating logical loop');
 const pending=p.client.snapshot();a.stopped=true;current=b;await assert.rejects(pending,{name:'AbortError'});assert.equal(current,b,'a stopped resource cannot replace another loop context');assert.throws(()=>{current=a;p.client.keyOn(0);},{name:'AbortError'});
});

for(const seeded of [false,true])test(`PS1 pending upload across default reset keeps ${seeded?'seeded':'empty'} bank IDs aligned while cancelling its old continuation`,async t=>{
 const p=rpc();t.after(()=>p.close());const{adpcm,...options}=createPs1InitSample();if(seeded)await p.client.loadADPCM(adpcm,options);
 const pending=p.client.loadADPCM(adpcm,options);p.client.reset();await assert.rejects(pending,{name:'AbortError'});
 const retained=p.client._getState(),remote=await p.client.getState();assert.deepEqual(retained.samples,remote.samples);assert.equal(retained.nextAddress,remote.nextAddress);assert.equal(retained.samples.length,seeded?2:1);
 const next=await p.client.loadADPCM(adpcm,options);assert.equal(next.id,seeded?2:1);assert.equal(next.startAddress,retained.nextAddress);p.client.setPreset(23,{sample:next});p.client.noteOn(23,60);const played=await p.client.getState();assert.equal(played.channels[23].sample,next.id);assert.equal(played.channels[23].gate,true);assert.deepEqual(p.client._getState().samples,played.samples);
});
