import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {buildNesOperations as build,compileNesOperations as compile,createNesOperationResetState as reset} from '../../tetorica_src/runtime/nes_operations.js';
import {createNesTimedSnapshot} from '../../tetorica_src/runtime/nes_timed_state.js';
import {NesApuSynth} from '../../tetorica_src/runtime/nesapusynth.js';
import {attachNesTimedClient} from '../../tetorica_src/runtime/nes_timed_client.js';
const rows=w=>w.map(({register,value})=>[register,value]);
test('NES recorder is detached, validates at compile and preserves packed updates/shared enables/repeated triggers',()=>{
 let saved,calls=0;const patch={volume:7};const plan=build(b=>{calls++;saved=b;b.pulse.setVoice(0,patch);b.noteOn(0,'C4');b.keyOn(0);b.atSample(441).noteOff(0);});patch.volume=15;
 const state=reset();state.registers[0]=0x80;state.enabled=state.registers[0x15]=0x12;const before=structuredClone(state);
 const trace=compile(plan,state);assert.equal(trace[0].value,0xb7);assert.deepEqual(trace.filter(w=>w.register===0x4015).map(w=>w.value),[0x13,0x13,0x12]);assert.equal(trace.filter(w=>w.register===0x4003).length,3);assert.equal(trace.at(-1).offsetSeconds,.01);assert.deepEqual(state,before);assert.equal(calls,1);assert.throws(()=>saved.keyOn(0),/no longer/);
 for(const f of [b=>b.writeRegister(0x4010,0),b=>b.writeRegister(0x4015,0),b=>b.noteOff(4),b=>b.noteOn(5,'C4'),b=>b.pulse.setVoice(0,{volume:16}),b=>b.atSample(100).atSeconds(0)])assert.throws(()=>compile(build(f),state));
 assert.throws(()=>build(async b=>b.keyOn(0)),/synchronous/);assert.deepEqual(structuredClone(plan),plan);
});
test('NES current/client/reset/reused snapshots compile without changing live state',async()=>{
 const state=reset();state.registers[0]=0x80;let requests=0;
 const chip=new NesApuSynth({transport:{writeRegister(){}},initialize:false});chip.pulse.setVoice(0,{duty:.75,volume:4});
 chip._requestControl=async()=>{requests++;return createNesTimedSnapshot(state,{instanceId:'nes-test',clock:state.clock,frame:42,sampleRate:48000});};Object.defineProperties(chip,{_timedClientStateComplete:{value:true},_getTimedState:{value:()=>chip._getState()}});attachNesTimedClient(chip);
 const plan=chip.build(b=>b.pulse.setVoice(0,{volume:5}));assert.equal((await chip.compile(plan,{initialState:'client'}))[0].value,0xf5);assert.equal(requests,0);assert.equal((await chip.compile(plan,{initialState:'reset'}))[0].value,0x35);
 const snapshot=await chip.captureState(),before=structuredClone(snapshot);assert.equal((await chip.compile(plan,{initialState:snapshot}))[0].value,0xb5);assert.equal(requests,1);assert.deepEqual(snapshot,before);assert.equal((await chip.compile(plan))[0].value,0xb5);assert.equal(chip._getState().registers[0],0xf4);await assert.rejects(chip.compile(plan,{initialState:{...snapshot,instanceId:'other'}}),/Incompatible/);
});
async function setup(file,rate,sourceOverride){
 const root=new URL('../../tetorica_src/runtime/',import.meta.url);let Type,frame=0,eventFrame=null,lastRight=null;const messages=[];
 const context={console,sampleRate:rate,Uint8Array,Float32Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m)};}},registerProcessor(_name,type){Type=type;}};Object.defineProperty(context,'currentFrame',{get:()=>frame});
 const path=new URL(file,root),bindings=[];const source=(sourceOverride??await readFile(path,'utf8')).replace(/^import (.+) from ['"]([^'"]+)['"];?$/gm,(_l,b,s)=>{bindings.push([b,s]);return '';});
 for(const [binding,spec]of bindings){const m=await import(new URL(spec,path));if(binding.startsWith('{'))for(const name of binding.slice(1,-1).split(',')){const [a,b]=name.trim().split(/\s+as\s+/);context[b??a]=m[a];}else context[binding]=m.default;}
 if(context.createProcessorPerformance){const make=context.createProcessorPerformance;context.createProcessorPerformance=options=>make({...options,rate,nowFrame:()=>frame});}
 vm.runInNewContext(source,context);const wasmBinary=await readFile(new URL('generated/nesapu_wasm.wasm',root));const standalone=file.includes('docs/synth-2a03');const p=new Type({processorOptions:{wasmBinary,fds:true}});await (p.ready??p.initializing);let id=0,session;
 async function command(method,args=[]){const n=++id;if(standalone)p.receive({id:n,method,args});else p.receive({id:n,method,args},p.port);if(standalone)await p.commands;const response=messages.find(m=>m.id===n);assert(response,method+' acknowledged');if(response.error)throw Error(response.error);return response.value;}
 if(standalone)session=(await command('beginCode')).session;
 const rpc=payload=>command('nesTimed',standalone?[session,payload]:[payload]);
 const core=standalone?p.instrument.core:p.chip,writes=[];const original=core.writeRegister.bind(core);core.writeRegister=(register,value)=>{writes.push({frame:eventFrame??(standalone?p.renderFrame:frame),register,value});return original(register,value);};
 if(p.timed){const applyTimed=p.timed.apply.bind(p.timed);p.timed.apply=(operation,port,at,metadata)=>{eventFrame=at;try{return applyTimed(operation,port,at,metadata);}finally{eventFrame=null;}};}
 return{p,core,command,rpc,writes,lastRight:()=>lastRight,render(count){const l=new Float32Array(count),r=new Float32Array(count);for(let i=0;i<count;){const n=Math.min(128,count-i);p.process([],[[l.subarray(i,i+n),r.subarray(i,i+n)]]);frame+=n;i+=n;}assert(l.every(Number.isFinite));lastRight=r;return l;},close:()=>p.dispose()};
}
for(const file of ['playground_nes_worklet.js','../../docs/synth-2a03/processor.js'])for(const rate of [44100,48000])test(`${file} ${rate}: sample-clock Pulse/Triangle/Noise, compile parity, failed replacement and Stop`,async()=>{
 const p=await setup(file,rate);try{
 const plan=build(b=>{b.pulse.setVoice(0,{duty:.5,volume:8});b.noteOn(0,'C4');b.writeRegister(0x4008,255);b.atSeconds(.005).triangle.noteOn('C3');b.atSample(441).noise.setVoice({volume:5,period:6});b.noise.noteOn();b.atSeconds(.02).noteOff(0);b.triangle.noteOff();b.noise.noteOff();});
 const expected=compile(plan,await p.rpc({action:'capture'}));const accepted=await p.rpc({action:'schedule',operations:plan,options:{name:'notes',repeatSeconds:.05},owner:'notes'});const before=p.writes.length;const audio=p.render(accepted.startFrame+Math.round(.02*rate)+1);assert(audio.some(x=>Math.abs(x)>.001));assert.deepEqual(rows(p.writes.slice(before)),rows(expected));assert.deepEqual(p.writes.slice(before).map(w=>w.frame),expected.map(w=>accepted.startFrame+Math.round(w.offsetSeconds*rate)));
 await assert.rejects(p.rpc({action:'schedule',operations:build(b=>b.pulse.setVoice(0,{volume:16})),options:{name:'notes'},owner:'notes'}));p.render(Math.round(.06*rate));assert(p.writes.filter(w=>w.register===0x4003).length>=4);
 await p.rpc({action:'releaseOwner',owner:'notes'});assert.equal((await p.rpc({action:'capture'})).enabled&9,0);
 }finally{p.close();}
});

for(const file of ['playground_nes_worklet.js','../../docs/synth-2a03/processor.js'])test(`${file}: old Off/cancel preserves a newer manual Gate and a timed Gate retires stale key-up`,async()=>{
 const p=await setup(file,48000),standalone=file.includes('docs/');try{
  const receipt=await p.rpc({action:'schedule',operations:build(b=>{b.pulse.setVoice(0,{duty:.5,volume:8});b.noteOn(0,'C4');b.atSeconds(.02).noteOff(0);}),options:{name:'old'},owner:'old'});p.render(receipt.startFrame+1);
  if(standalone)await p.command('noteOn',['manual',64,0]);else p.p.inspector.invoke('auditionOn',[0,64,'manual']);
  p.render(1100);assert((await p.rpc({action:'capture'})).enabled&1);await p.rpc({action:'releaseOwner',owner:'old'});assert((await p.rpc({action:'capture'})).enabled&1);
  await p.rpc({action:'schedule',operations:build(b=>b.keyOn(0)),options:{name:'new'},owner:'new'});p.render(300);const n=p.writes.length;
  if(standalone)assert.equal(await p.command('noteOff',['manual']),false);else assert.equal(p.p.inspector.invoke('auditionOff',[0,'manual']),false);
  assert.equal(p.writes.length,n);assert((await p.rpc({action:'capture'})).enabled&1);await p.rpc({action:'releaseOwner',owner:'new'});assert.equal((await p.rpc({action:'capture'})).enabled&1,0);
 }finally{p.close();}
});

test('standalone stale endCode and invalid commands cannot clear a replacement reservation',async()=>{
 const p=await setup('../../docs/synth-2a03/processor.js',48000);try{
  await p.rpc({action:'schedule',operations:build(b=>b.noteOn(0,'C4')),options:{name:'keep',repeatSeconds:.02},owner:'keep'});p.render(300);
  assert.equal(await p.command('endCode',[0]),false);await assert.rejects(p.command('beginCode',[1]));p.render(1500);assert(p.writes.filter(w=>w.register===0x4003).length>=4);assert((await p.rpc({action:'capture'})).enabled&1);
 }finally{p.close();}
});

for(const rate of [44100,48000])test(`standalone ${rate}: default manual PCM is unchanged by timed integration`,async()=>{
 const {readNesTimedPredecessor}=await import('../../scripts/mixer_calibration_nes_timed_revision.mjs');
 const file='../../docs/synth-2a03/processor.js',old=await setup(file,rate,readNesTimedPredecessor('docs/synth-2a03/processor.js')),now=await setup(file,rate);
 try{
  for(const p of [old,now]){await p.command('noteOn',['pulse',60,0]);await p.command('noteOn',['triangle',55,2]);await p.command('noteOn',['noise',60,3]);}
  assert.deepEqual(now.render(1024),old.render(1024));assert.deepEqual(now.lastRight(),old.lastRight());for(const p of [old,now])await p.command('noteOff',['pulse']);assert.deepEqual(now.render(1024),old.render(1024));assert.deepEqual(now.lastRight(),old.lastRight());
 }finally{old.close();now.close();}
});

test('public NES Main/Worker client exposes timed data APIs, complete optimistic state and explicit Native rejection',async()=>{
 const {createNesClient}=await import('../../tetorica_src/runtime/playground_nes.js');const {createPerformanceSender}=await import('../../tetorica_src/runtime/playground_performance_sender.js');const state=reset(),messages=[];
 const port={start(){},close(){},postMessage(data){messages.push(data);if(data.id)queueMicrotask(()=>port.onmessage({data:{id:data.id,value:createNesTimedSnapshot(state,{instanceId:'public',clock:state.clock,frame:0,sampleRate:48000})}}));}};
 const client=createNesClient(port);client.pulse.setVoice(0,{duty:.75,volume:8});client.keyOn(1);const plan=client.build(b=>{b.pulse.setVoice(0,{volume:5});b.noteOff(0);});const n=messages.length;
 const trace=await client.compile(plan,{initialState:'client'});assert.equal(messages.length,n);assert.equal(trace[0].value,0xf5);assert.equal(trace.at(-1).value,2);await client.captureState();client.dispose();await assert.rejects(client.compile(plan),/disposed/);
 const native=createNesClient({postMessage(){},start(){},close(){}},{native:true});await assert.rejects(native.captureState(),/Native/);assert.equal((await native.compile(native.build(b=>b.pulse.setVoice(0,{volume:1})),{initialState:'reset'}))[0].value,0x31);native.dispose();
 const sender=createPerformanceSender({now:()=>0});sender.configure({session:1,audioSeconds:0,performanceEpochMs:0,lookaheadSeconds:.1});const routed=sender.port({postMessage:data=>messages.push(data)},'nes');routed.postMessage({method:'nesTimed',args:[{action:'capture'}]});assert.equal(messages.at(-1).timedPerformance.session,1);
});

test('separate active-enable metadata does not rewrite physical bytes or restart an ended DMC',()=>{
 const state=reset();state.registers[0x15]=16;state.enabled=0;const before=structuredClone(state);
 const snapshot=createNesTimedSnapshot(state,{instanceId:'ended',clock:state.clock,frame:0,sampleRate:48000});assert.equal(snapshot.registers[0x15],16);assert.equal(snapshot.enabled,0);
 const trace=compile(build(b=>b.keyOn(0)),snapshot);assert.equal(trace.find(w=>w.register===0x4015).value,1);assert.deepEqual(state,before);
});

for(const file of ['playground_nes_worklet.js','../../docs/synth-2a03/processor.js'])test(`${file}: actual completed DMC is not restarted by a timed Pulse gate`,async()=>{
 const p=await setup(file,48000);try{
  p.core.loadMemory(Uint8Array.of(0xaa),0xc000);for(const [r,v]of [[0x4010,15],[0x4012,0],[0x4013,0],[0x4015,16]])p.core.writeRegister(r,v);p.render(1000);assert.equal(p.core.getState().dmcRemaining,0);
  const snapshot=await p.rpc({action:'capture'});assert.equal(snapshot.enabled&16,0);
  await p.rpc({action:'schedule',operations:build(b=>{b.pulse.setVoice(0,{volume:8,duty:.5});b.noteOn(0,'C4');}),options:{name:'pulse'},owner:'pulse'});const before=p.writes.length;p.render(300);
  assert(p.writes.slice(before).filter(w=>w.register===0x4015).every(w=>!(w.value&16)));assert.equal(p.core.getState().dmcRemaining,0);
 }finally{p.close();}
});
