import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {readHistoricalYm2608TimedWorklet} from '../../scripts/mixer_calibration_ym2608_timed_revision.mjs';
import {YM2608Synth} from '../../tetorica_src/runtime/ym2608synth.js';
import {createYm2608Client} from '../../tetorica_src/runtime/playground_ym2608.js';
import {buildYm2608Operations as build,compileYm2608Operations as compile,createYm2608OperationResetState as reset,YM2608_OPERATION_METHODS} from '../../tetorica_src/runtime/ym2608_operations.js';
import {createYm2608TimedSnapshot} from '../../tetorica_src/runtime/ym2608_timed_state.js';
import {createWorkerChip} from '../../tetorica_src/runtime/playground_worker_chip.js';
import {createPerformanceSender} from '../../tetorica_src/runtime/playground_performance_sender.js';
const runtime=new URL('../../tetorica_src/runtime/',import.meta.url);
const bytes=rows=>rows.map(({port,register,value})=>[port,register,value]);

test('record once, clone arguments, defer validation and never touch live state',()=>{
 let calls=0,retained;const value={multi:3};const plan=build(b=>{calls++;retained=b;b.setOperator(3,0,value);b.ssg.setMixer(1,{tone:true,noise:false});});value.multi=9;
 assert.deepEqual(structuredClone(plan),plan);const state=reset(),before=structuredClone(state);state.registers[1][0x30]=0x52;
 assert.equal(compile(plan,state)[0].value,0x53);assert.equal(calls,1);assert.equal(before.registers[1][0x30],0);
 assert.throws(()=>retained.keyOn(0),/no longer active/);
 assert.throws(()=>compile(build(b=>b.setOperator(0,0,{ar:32})),reset()),/ar/);
 assert.throws(()=>build(async b=>b.keyOn(0)),/synchronous/);
 assert.throws(()=>build(b=>b.atSeconds(.2).atSample(1)),/nondecreasing/);
 for(const [port,reg]of [[0,0x27],[0,0x2e],[1,0],[0,14]])assert.throws(()=>compile(build(b=>b.write(port,reg,0)),reset()),/only/);
 assert.throws(()=>compile(build(b=>b.ssg.write(14,0)),reset()),/I\/O/);
});

test('mixed FM/SSG partial fields, retained levels and repeated strobes compile without baseline writes',()=>{
 const state=reset();state.registers[0][7]=0xc0;state.registers[1][0x30]=0x52;state.ssgLevels[1]=13;
 const saved=structuredClone(state),plan=build(b=>{
  b.setOperator(3,0,{multi:7});b.ssg.setMixer(0,{tone:false,noise:true});
  b.ssg.setMixer(2,{tone:true,noise:false});b.ssg.keyOff(1);b.ssg.keyOn(1);
  b.ssg.setEnvelope({period:300,shape:8});b.ssg.setEnvelope({period:300,shape:8});
  b.keyOn(3,[0,2]);b.keyOn(3,[0,2]);b.keyOff(3);
 });
 const rows=bytes(compile(plan,state));assert.deepEqual(state,saved);
 assert.deepEqual(rows.slice(0,6),[[1,0x30,0x57],[0,7,0xc1],[0,7,0xe1],[0,9,0],[0,7,0xe1],[0,9,13]]);
 assert.deepEqual(rows.filter(row=>row[1]===13),[[0,13,8],[0,13,8]]);
 assert.deepEqual(rows.slice(-3),[[0,0x28,0x54],[0,0x28,0x54],[0,0x28,4]]);
});

test('client/current/reset/reusable snapshots differ without changing the live chip',async()=>{
 const sent=[],state=reset();state.registers[0][0x30]=0x72;
 let client;const port={start(){},close(){},postMessage(data){sent.push(data);if(data.id)queueMicrotask(()=>port.onmessage({data:{id:data.id,value:createYm2608TimedSnapshot(state,{instanceId:'test',clock:8000000,frame:1,sampleRate:48000})}}));}};
 client=createYm2608Client(port);client.setOperator(0,0,{dt:3,multi:1});
 const plan=client.build(b=>b.setOperator(0,0,{multi:5}));sent.length=0;
 assert.equal((await client.compile(plan,{initialState:'client'}))[0].value,0x35);assert.equal(sent.length,0);
 assert.equal((await client.compile(plan,{initialState:'reset'}))[0].value,5);assert.equal(sent.length,0);
 const snapshot=await client.captureState(),copy=structuredClone(snapshot);assert.equal(sent.length,1);
 client.setOperator(0,0,{dt:1});sent.length=0;
 assert.equal((await client.compile(plan,{initialState:snapshot}))[0].value,0x75);assert.equal(sent.length,0);assert.deepEqual(snapshot,copy);
 assert.equal((await client.compile(plan))[0].value,0x75);assert.equal(sent.length,1);
 await assert.rejects(client.compile(plan,{initialState:{...snapshot,instanceId:'other'}}),/Incompatible/);
 client.dispose();await assert.rejects(client.compile(plan),/disposed/);
});

test('primary Worker exposes timed capability and rejects incomplete optimistic state',async()=>{
 const sent=[],seed=new YM2608Synth({transport:{write(){},reset(){}}});
 const state={...seed.getState(),ssg:seed.ssg._getState(),clock:8000000,timedState:seed._getTimedState()};
 const worker=createWorkerChip({port:{postMessage:command=>sent.push(command),start(){}},capabilities:{chip:'ym2608'},state});
 const plan=worker.fm.build(b=>b.ssg.setVolume(0,8));assert.equal(worker.fm._timedOperations,worker.raw._timedOperations);
 assert.equal((await worker.fm.compile(plan,{initialState:'client'}))[0].value,8);
 worker.adoptState({...state,timedState:undefined});await assert.rejects(worker.fm.compile(plan,{initialState:'client'}),/Incomplete/);
 worker.raw.dispose();
 const sender=createPerformanceSender({now:()=>0});sender.configure({session:1,audioSeconds:0,performanceEpochMs:0,lookaheadSeconds:.1});
 const port=sender.port({postMessage:command=>sent.push(command)},'ym2608');port.postMessage({method:'ym2608Timed',args:[{action:'capture'}]});
 assert.equal(sent.at(-1).timedPerformance.session,1);
});

async function setup(file,rate,sourceOverride){
 let frame=0,Type,ready;const messages=[],writes=[];
 const port={postMessage(message){messages.push(message);if(message.ready||message.type==='ready'||message.error||message.type==='error')ready?.(message);}};
 const context={sampleRate:rate,console,Uint8Array,Float32Array,AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor(_n,type){Type=type;}};
 Object.defineProperty(context,'currentFrame',{get:()=>frame});
 const source=(sourceOverride??await readFile(new URL(file,runtime),'utf8')).replace(/^import (.+) from ["']([^"']+)["'];?$/gm,(_line,binding,specifier)=>{
  writes.push([binding,specifier]);return '';
 });
 for(const [binding,specifier]of writes.splice(0)){
  const module=await import(new URL(specifier.split('?')[0],new URL(file,runtime)));
  if(binding.startsWith('{'))for(const field of binding.slice(1,-1).split(',')){const [a,b]=field.trim().split(/\s+as\s+/);context[b??a]=module[a];}
  else context[binding]=module.default;
 }
 if(context.createProcessorPerformance){const make=context.createProcessorPerformance;context.createProcessorPerformance=opts=>make({...opts,rate,nowFrame:()=>frame});}
 vm.runInNewContext(source,context);
 const initialized=new Promise(resolve=>ready=resolve),wasmBinary=await readFile(new URL('generated/ym2608_wasm.wasm',runtime)),rom=new Uint8Array(8192);
 const generic=file==='playground_ym2608_worklet.js';
 const processor=new Type({processorOptions:{wasmBinary,rom}});
 if(!generic)processor.port.onmessage({data:{type:'initialize',wasmBinary,rhythmRom:rom}});
 const result=await initialized;assert(result.ready||result.type==='ready',JSON.stringify(result));
 const chip=generic?processor.engine.ym2608:processor.chip;
 let address=0,eventFrame=null;
 chip.hooks.onWrite=({offset,data})=>{if(!(offset&1))address=((offset&2)<<7)|data;else if(eventFrame!==null&&address>>8===offset>>1)writes.push({frame:eventFrame,port:address>>8,register:address&255,value:data});};
 if(processor.timed){const apply=processor.timed.apply.bind(processor.timed);processor.timed.apply=(op,p,f,m)=>{eventFrame=f;try{return apply(op,p,f,m);}finally{eventFrame=null;}};}
 const send=data=>generic?processor.receive(data,port):port.onmessage({data});let id=0;
 const rpc=payload=>{const n=++id;send({method:'ym2608Timed',id:n,args:[payload]});const reply=messages.find(x=>x.id===n);assert(reply,'immediate control acknowledgement');if(reply.error)throw Error(reply.error);return reply.value;};
 const synth=new YM2608Synth({transport:{write:(port,register,value)=>send(generic?{method:'write',args:[port,register,value]}:{type:'write',port,register,value}),reset:()=>send(generic?{method:'reset'}:{type:'reset'})}});
 return {processor,synth,send,rpc,writes,messages,chip,frame:()=>frame,
 render(count){const left=new Float32Array(count),right=new Float32Array(count);for(let i=0;i<count;){const size=Math.min(113,count-i);processor.process([],[[left.subarray(i,i+size),right.subarray(i,i+size)]]);i+=size;frame+=size;}assert(left.every(Number.isFinite));return {left,right};},
 close(){chip.dispose();}};
}

for(const file of ['ym2608-worklet.js','playground_ym2608_worklet.js','../../docs/synth-fm2608/audio_worklet.js'])for(const rate of [44100,48000])test(`${file} ${rate} real WASM executes mixed FM/SSG at exact frames with compile parity`,async()=>{
 const p=await setup(file,rate);try{
  p.synth.setOperator(3,0,{dt:5,multi:2});p.synth.ssg.write(7,0xc0);
  const plan=build(b=>{b.setOperator(3,0,{multi:7});b.keyOn(3);b.keyOn(3);b.ssg.setMixer(1,{tone:true,noise:false});b.ssg.setVolume(1,13);b.ssg.setEnvelope({period:300,shape:8});b.atSeconds(.1).ssg.keyOff(1);b.atSample(4410).ssg.keyOn(1);b.keyOff(3);});
  const snapshot=p.rpc({action:'capture'}),expected=compile(plan,snapshot);
  const receipt=p.rpc({action:'schedule',operations:plan,options:{name:'test'}});assert.equal(receipt.startFrame,128);assert.equal(p.writes.length,0);
  p.render(receipt.startFrame+Math.round(.1*rate)+1);
  assert.deepEqual(bytes(p.writes),bytes(expected));assert.equal(p.writes.at(-1).frame,receipt.startFrame+Math.round(.1*rate));
  assert.equal(p.rpc({action:'capture'}).ssgLevels[1],13);
 }finally{p.close();}
});
for(const file of ['ym2608-worklet.js','playground_ym2608_worklet.js','../../docs/synth-fm2608/audio_worklet.js'])test(`${file} partial updates use intervening edits; atomic replacement, staging, cancellation and SSG ownership`,async()=>{
 const p=await setup(file,48000);try{
  const plan=build(b=>{b.atSample(100).setOperator(0,0,{multi:7});b.ssg.setVolume(1,10);});
  p.rpc({action:'schedule',operations:plan,options:{name:'x',repeatSeconds:.01},owner:'code'});
  p.synth.setOperator(0,0,{dt:6,multi:1});
  assert.throws(()=>p.rpc({action:'schedule',operations:build(b=>b.setOperator(0,0,{multi:99})),options:{name:'x'},owner:'code'}),/multi/);
  p.render(800);assert.equal(p.writes[0].value,0x67);
  const next=build(b=>b.ssg.setVolume(1,5));
  p.rpc({action:'stage',transactionId:'a',owner:'code',method:'schedule',args:[next,{name:'x',repeatSeconds:.01}]});
  p.rpc({action:'abort',transactionId:'a',owner:'code'});let n=p.writes.length;p.render(500);assert(p.writes.slice(n).some(x=>x.value===10));
  p.rpc({action:'stage',transactionId:'b',owner:'code',method:'schedule',args:[next,{name:'x',repeatSeconds:.01}]});p.rpc({action:'commit',transactionId:'b',owner:'code'});
  n=p.writes.length;p.render(700);assert(p.writes.slice(n).some(x=>x.value===5));assert(!p.writes.slice(n).some(x=>x.register===0x30));
  p.rpc({action:'releaseOwner',owner:'code'});assert.equal(p.rpc({action:'capture'}).registers[0][9],0);n=p.writes.length;p.render(1000);assert.equal(p.writes.length,n);
  p.rpc({action:'schedule',operations:build(b=>b.ssg.setVolume(1,8)),options:{name:'manual'},owner:'code2'});p.render(200);p.synth.ssg.setVolume(1,12);p.rpc({action:'releaseOwner',owner:'code2'});assert.equal(p.rpc({action:'capture'}).registers[0][9],12);
 }finally{p.close();}
});

test('Native capture/scheduling reject explicitly; detached local compile remains available',async()=>{
 const sent=[],port={postMessage:data=>sent.push(data),start(){},close(){}};
 const client=createYm2608Client(port,{native:true});const plan=client.build(b=>b.ssg.setVolume(0,7));
 assert.equal((await client.compile(plan,{initialState:'reset'}))[0].value,7);
 await assert.rejects(client.captureState(),/Native/);await assert.rejects(client.schedule(plan,{name:'n'}),/Native/);client.dispose();
});

for(const file of ['ym2608-worklet.js','../../docs/synth-fm2608/audio_worklet.js'])test(`${file} primary Worker port acknowledges direct timed RPC and preserves metadata`,async()=>{
 const p=await setup(file,48000);try{
  const messages=[],remote={postMessage:message=>messages.push(message),start(){},close(){}};
  p.send({type:'attach-chip-port',port:remote});
  remote.onmessage({data:{method:'ym2608Timed',id:99,args:[{action:'schedule',operations:build(b=>b.ssg.setVolume(0,12)),options:{name:'worker'}}]}});
  const accepted=messages.find(x=>x.id===99);assert(accepted?.value,JSON.stringify(messages));p.render(300);
  assert.equal(p.rpc({action:'capture'}).registers[0][8],12);
 }finally{p.close();}
});

for(const [file,path]of [['ym2608-worklet.js','tetorica_src/runtime/ym2608-worklet.js']])for(const rate of [44100,48000])test(`${file} ${rate} default FM/SSG PCM matches authenticated predecessor exactly`,async()=>{
 // Standalone app/raw parity separately covers ADPCM release.

 const old=await setup(file,rate,readHistoricalYm2608TimedWorklet(path)),current=await setup(file,rate);
 try{
  for(const p of [old,current]){
   p.synth.reset();p.synth.setAlgo(0,7);p.synth.setPan(0,true,true);
   for(let op=0;op<4;op++)p.synth.setOperator(0,op,{multi:op+1,tl:op?127:24,ar:31,d1r:5,d2r:3,sl:7,rr:8});
   p.synth.noteOn(0,'C4');p.synth.ssg.tone(1,{frequency:330,volume:8});
  }
  const a=old.render(2048),b=current.render(2048);assert.deepEqual(b.left,a.left);assert.deepEqual(b.right,a.right);assert(b.left.some(x=>Math.abs(x)>0));
 }finally{old.close();current.close();}
});

test('every advertised recorder method reuses a real immediate FM/SSG method',()=>{
 const synth=new YM2608Synth({transport:{write(){}}});
 for(const name of YM2608_OPERATION_METHODS){const [section,method]=name.split('.');assert.equal(typeof(method?synth[section][method]:synth[section]),'function',name);}
});
