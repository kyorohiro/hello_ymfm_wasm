import test from 'node:test';
import assert from 'node:assert/strict';
import {OPLSynth} from './opl_synth.js';
import {createOplRegisterClient} from './playground_opl.js';
import {attachY8950Adpcm,copyY8950AdpcmMemory} from './y8950_adpcm.js';
import {encodeAdpcmB} from './adpcm_b_sample.js';
const pcm=()=>({sampleRate:8000,channels:[Float32Array.from({length:400},(_,i)=>.5*Math.sin(i*Math.PI/10))]});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function setup(options={}){
 const writes=[],uploads=[],clears=[];const client=new OPLSynth({chip:'y8950',transport:{writeRegister:(r,v,b=0)=>writes.push([r,v,b])}});
 attachY8950Adpcm(client,{loadMemory:async(...args)=>uploads.push(args),clearMemory:async(...args)=>clears.push(args),...options});
 return {client,api:client.adpcm,writes,uploads,clears};
}
test('Y8950 mono ADPCM uses its own register map, 32-byte DRAM ranges and preserves shared FM bits',()=>{
 const {client,api,writes}=setup();client.writeRegister(8,0xc0);writes.length=0;
 api.setSample({start:0x12340,end:0x12400});api.setDeltaN(0x1234);api.setVolume(73);api.keyOn({repeat:true});api.keyOff();
 assert.deepEqual(writes,[[8,0xc2,0],[9,0x1a,0],[10,9,0],[11,0x1f,0],[12,9,0],[16,0x34,0],[17,0x12,0],[18,73,0],[7,0xb0,0],[7,1,0]]);
 assert.equal(api.setPan,undefined);assert.equal(client.getRegisterSnapshot()[8]&0xc0,0xc0);
 const rate=api.setPlaybackRate(8000),delta=Math.round(8000*72*65536/client.clock);assert.equal(rate,delta*client.clock/(72*65536));
 writes.length=0;api.reset();assert.equal(client.getRegisterSnapshot()[8],0xc0);assert(!writes.some(([r])=>[0x0f,0x13,0x14].includes(r)),'reset never writes CPU-data or unavailable limit registers');
 assert(writes.every(([r])=>[7,8,9,10,11,12,13,14,16,17,18,21,22,23].includes(r)));
});
test('invalid range, rate, level and repeat requests leave every register untouched',()=>{
 const {api,writes}=setup();for(const fn of [()=>api.setSample({start:1,end:32}),()=>api.setSample({start:0,end:31}),()=>api.setSample({start:32,end:32}),()=>api.setSample({start:0,end:0x200020}),()=>api.setDeltaN(0),()=>api.setDeltaN(65536),()=>api.setDeltaN(.5),()=>api.setPlaybackRate(0),()=>api.setPlaybackRate(Infinity),()=>api.setPlaybackRate(500000),()=>api.setVolume(-1),()=>api.setVolume(256),()=>api.keyOn({repeat:1})])assert.throws(fn);
 assert.deepEqual(writes,[]);
});
test('encoded memory uploads snapshot byte views, permit patches without alignment, and reject out-of-range data before transfer',async()=>{
 const {api,uploads}=setup();const bytes=new Uint8Array([1,2,3,4]),pending=api.loadMemory(bytes.subarray(1,3),17);bytes.fill(9);await pending;
 assert.deepEqual(uploads[0][0],Uint8Array.of(2,3));assert.equal(uploads[0][1],17);
 await api.loadMemory(new ArrayBuffer(0),0x200000);assert.equal(uploads[1][0].length,0);
 const buffer=Buffer.from([4,5]),bufferPending=api.loadMemory(buffer);buffer.fill(0);await bufferPending;assert.deepEqual(uploads[2][0],Uint8Array.of(4,5));
 for(const [bytes,address]of [[new Uint8Array(2),0x1fffff],[new Uint8Array(0),0x200001],[[],0],[new Uint8Array(0),-1]])await assert.rejects(api.loadMemory(bytes,address));
 assert.equal(uploads.length,3);assert.throws(()=>copyY8950AdpcmMemory('raw',0));
});
test('loadSample quantizes against clock/72, awaits memory and configures a range without playing',async()=>{
 const gate=deferred(),f=setup({loadMemory:async(bytes,address)=>{f.uploads.push([bytes,address]);await gate.promise;}}),source=pcm();
 const original=source.channels[0].slice(),options={address:64,sampleRate:6000};const pending=f.api.loadSample(source,options);source.channels[0].fill(0);options.address=0;options.sampleRate=2000;
 await Promise.resolve();assert.equal(f.uploads.length,1);assert.deepEqual(f.writes,[[7,1,0]],'stop the previous decoder before replacement; no range/rate writes until transfer acknowledgment');gate.resolve();const sample=await pending;
 const delta=Math.round(6000*72*65536/f.client.clock),actual=delta*f.client.clock/(72*65536),encoded=encodeAdpcmB({channels:[original],sampleRate:8000},actual);
 assert.deepEqual(f.uploads[0],[encoded.bytes,64]);assert.deepEqual(sample,{start:64,end:64+encoded.bytes.length,frames:encoded.frames,paddedFrames:encoded.paddedFrames,sampleRate:actual,deltaN:delta,duration:encoded.paddedFrames/actual});
 assert(f.writes.some(([r,v])=>r===7&&v===1));assert(!f.writes.some(([r,v])=>r===7&&(v&128)),'sample loading never triggers playback');
});
test('cancellation during decode or upload prevents later configuration and retains the original operation owner',async()=>{
 for(const phase of ['decode','upload']){
  const gate=deferred(),scope={id:'original'};let current=scope,stopped=false;const contexts=[];
  const f=setup({captureContext:()=>current,checkCurrent:value=>{if(stopped)throw new Error('Run stopped');if(value!==undefined)assert.equal(value,scope);},withContext(value,fn){assert.equal(value,scope);const previous=current;current=value;try{return fn();}finally{current=previous;}},decodeAudio:async()=>{await gate.promise;return pcm();},loadMemory:async(_bytes,_address,value)=>{contexts.push(value);if(phase==='upload')await gate.promise;}});
  const result=f.api.loadSample(phase==='decode'?Uint8Array.of(1):pcm(),{sampleRate:8000});current={id:'other'};await Promise.resolve();stopped=true;gate.resolve();await assert.rejects(result,/Run stopped/);
  assert.deepEqual(f.writes,phase==='decode'?[]:[[7,1,0]]);assert.equal(contexts.length,phase==='decode'?0:1);if(contexts.length)assert.equal(contexts[0],scope);
 }
});
test('successful asynchronous configure runs under the original owner without leaking it into the caller',async()=>{
 const scope={id:'first'},other={id:'second'},gate=deferred();let current=scope;const seen=[];
 const f=setup({captureContext:()=>current,checkCurrent(){},withContext(value,fn){const previous=current;current=value;try{seen.push(current);return fn();}finally{current=previous;}},loadMemory:async(_bytes,_address,value)=>{assert.equal(value,scope);await gate.promise;}});
 const result=f.api.loadSample(pcm(),{sampleRate:8000});current=other;await Promise.resolve();gate.resolve();await result;assert.equal(current,other);assert(seen.every(value=>value===scope));assert.equal(seen.length,2);
});
test('aborting after upload or rejecting upload cannot write a new sample range',async()=>{
 for(const fail of [true,false]){
  const controller=new AbortController(),f=setup({loadMemory:async()=>{if(fail)throw Error('upload failed');controller.abort();}});
  await assert.rejects(f.api.loadSample(pcm(),{sampleRate:8000,signal:controller.signal}),fail?/upload failed/:{name:'AbortError'});assert.deepEqual(f.writes,[[7,1,0]]);
 }
});

test('a clock change during transfer rejects stale tuning without configuring or starting the sample',async()=>{
 const gate=deferred(),f=setup({loadMemory:async()=>gate.promise});const pending=f.api.loadSample(pcm(),{sampleRate:8000});await Promise.resolve();
 assert.deepEqual(f.writes,[[7,1,0]]);f.client.clock*=2;gate.resolve();await assert.rejects(pending,/clock changed/);assert.deepEqual(f.writes,[[7,1,0]]);
});
test('runtime lifecycle replacement keeps both Native and runtime scopes of an older upload intact',async()=>{
 const nativeScope={native:1},runtimeScope={run:1},gate=deferred(),seen=[];let oldRunStopped=false;
 const f=setup({captureContext:()=>nativeScope,checkCurrent:scope=>{if(scope)assert.equal(scope,nativeScope);},withContext(scope,fn){assert.equal(scope,nativeScope);seen.push('native');return fn();},loadMemory:async(_bytes,_address,scope)=>{assert.equal(scope,nativeScope);await gate.promise;}});
 f.client._setAdpcmLifecycle({captureContext:()=>runtimeScope,checkCurrent:scope=>{if(scope)assert.equal(scope,runtimeScope);if(oldRunStopped)throw Error('old Run stopped');},withContext(scope,fn){assert.equal(scope,runtimeScope);seen.push('runtime');return fn();}});
 const pending=f.api.loadSample(pcm(),{sampleRate:8000});await Promise.resolve();oldRunStopped=true;
 f.client._setAdpcmLifecycle({captureContext:()=>({run:2}),checkCurrent(){assert.fail('new Run must not validate the old operation');}});
 gate.resolve();await assert.rejects(pending,/old Run stopped/);assert.deepEqual(seen,['native','runtime']);assert.deepEqual(f.writes,[[7,1,0]]);
});

test('ADPCM shared-register mode edits do not steal ownership of an existing FM CSM timer',()=>{
 let owner='fm';const client=createOplRegisterClient(()=>{},{chip:'y8950',request:async()=>{},owner:()=>owner});
 client.writeRegister(4,1);client.writeRegister(8,0x80);owner='adpcm';client.adpcm.setSample({start:0x1fffe0,end:0x200000});
 assert.equal(client.getRegisterSnapshot()[9],255);assert.equal(client.getRegisterSnapshot()[10],255);assert.equal(client.getRegisterSnapshot()[11],255);assert.equal(client.getRegisterSnapshot()[12],255);
 client._cancelPerformanceOwner('adpcm');assert.equal(client.getRegisterSnapshot()[8]&128,128);assert.equal(client.getRegisterSnapshot()[4]&1,1);
 client._cancelPerformanceOwner('fm');assert.equal(client.getRegisterSnapshot()[8]&128,0);assert.equal(client.getRegisterSnapshot()[4]&1,0);
});

for(const cancelled of [false,true])test(`a decoder reached after asynchronous URL fetch retains the original owner${cancelled?' and rejects cancellation before requesting decode':''}`,async t=>{
 const originalFetch=globalThis.fetch,fetchGate=deferred(),scope={id:'original',stopped:false},other={id:'other'};let current=scope,decodes=0;
 globalThis.fetch=async()=>{await fetchGate.promise;return {ok:true,arrayBuffer:async()=>Uint8Array.of(1,2,3).buffer};};t.after(()=>{globalThis.fetch=originalFetch;});
 const f=setup({captureContext:()=>current,checkCurrent:value=>{if((value??current).stopped)throw new DOMException('Run stopped','AbortError');},withContext(value,callback){const previous=current;current=value;try{return callback();}finally{current=previous;}},
  decodeAudio:async bytes=>{decodes++;assert.equal(current,scope,'decode RPC captures the caller before fetch, rather than a different currently running loop');assert.deepEqual(new Uint8Array(bytes),Uint8Array.of(1,2,3));return pcm();}});
 const pending=f.api.loadSample('https://fixture.invalid/sample.bin');current=other;if(cancelled)scope.stopped=true;fetchGate.resolve();
 if(cancelled){await assert.rejects(pending,{name:'AbortError'});assert.equal(decodes,0);assert.deepEqual(f.uploads,[]);assert.deepEqual(f.writes,[]);}
 else{await pending;assert.equal(decodes,1);assert.equal(f.uploads[0][2],scope);assert(f.writes.some(([register])=>register===9));}
 assert.equal(current,other,'the trusted decode callback does not leak its owner');
});
