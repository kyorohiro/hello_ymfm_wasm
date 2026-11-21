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
 for(const f of [b=>b.writeRegister(0x4012,0),b=>b.writeRegister(0x4015,0),b=>b.noteOff(5),b=>b.noteOn(5,'C4'),b=>b.pulse.setVoice(0,{volume:16}),b=>b.atSample(100).atSeconds(0)])assert.throws(()=>compile(build(f),state));
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

test('DMC compile uses detached prepared selection, preserves companion enables and repeated control/DAC writes',()=>{
 const state=reset();state.enabled=state.registers[0x15]=5;state.sample={address:0xc100,length:257};const before=structuredClone(state);
 const plan=build(b=>{b.dmc.play({rate:9,loop:true,level:63});b.dmc.play({rate:9,loop:true,level:63});b.atSample(441).writeRegister(0x4010,67);b.writeRegister(0x4011,80);b.atSeconds(.02).dmc.stop();});
 const trace=compile(plan,state);assert.deepEqual(rows(trace).slice(0,6),[[0x4015,5],[0x4010,73],[0x4011,63],[0x4012,4],[0x4013,16],[0x4015,21]]);assert.equal(trace.filter(w=>w.register===0x4011&&w.value===63).length,2);assert.equal(trace.at(-1).value,5);assert.deepEqual(state,before);
 for(const call of [b=>b.dmc.play({rate:16}),b=>b.dmc.play({level:128}),b=>b.dmc.play({loop:1})])assert.throws(()=>compile(build(call),state));
 assert.throws(()=>compile(build(b=>b.dmc.play()),reset()),/Load a DMC sample/);
 assert.throws(()=>build(b=>b.dmc.loadSample(new Uint8Array(1))));
 for(const sample of [{address:0xc001,length:17},{address:0xc000,length:16},{address:0xffc0,length:81}])assert.throws(()=>compile(build(b=>b.dmc.play()),{...state,sample}),/selection/);
 const snap=createNesTimedSnapshot(state,{instanceId:'dmc',clock:state.clock,frame:0,sampleRate:48000});assert(Object.isFrozen(snap.sample));assert.notEqual(snap.sample,state.sample);assert.deepEqual(rows(compile(plan,snap)),rows(trace));assert.deepEqual(state,before);
});
async function prepareDmc(p,file,{address=0xc000,length=257}={}){
 const bytes=new Uint8Array(length).fill(0x55);
 if(file.includes('docs/')){const session=(await p.command('read')).codeSession;await p.command('code',[session,'dmc.loadSample',[bytes,{address}]]);}
 else {await p.command('loadMemory',[bytes,address]);await p.command('nesSelectSample',[{address,length}]);}
}
for(const file of ['playground_nes_worklet.js','../../docs/synth-2a03/processor.js'])for(const rate of [44100,48000])test(`${file} ${rate}: prepared DMC compile/timing and owned Stop preserve Pulse/Triangle`,async()=>{
 const p=await setup(file,rate);try{
  await prepareDmc(p,file,{address:0xc100});const state=await p.rpc({action:'capture'});assert.deepEqual(state.sample,{address:0xc100,length:257});
  const plan=build(b=>{b.pulse.setVoice(0,{volume:6,duty:.5});b.noteOn(0,'C4');b.dmc.play({rate:15,loop:true,level:64});b.atSample(441).writeRegister(0x4010,78);b.atSeconds(.02).dmc.stop();});
  const expected=compile(plan,state),r=await p.rpc({action:'schedule',operations:plan,options:{name:'dmc'},owner:'dmc'});const n=p.writes.length;p.render(r.startFrame+Math.round(.02*rate)+1);assert.deepEqual(rows(p.writes.slice(n)),rows(expected));assert.deepEqual(p.writes.slice(n).map(w=>w.frame),expected.map(w=>r.startFrame+Math.round(w.offsetSeconds*rate)));assert.equal((await p.rpc({action:'capture'})).enabled&17,1);
  await p.rpc({action:'schedule',operations:build(b=>b.dmc.play({loop:true})),options:{name:'loop',repeatSeconds:.05},owner:'loop'});p.render(300);assert(p.core.getState().dmcRemaining>0);
  await assert.rejects(p.rpc({action:'schedule',operations:build(b=>b.dmc.play({rate:16})),options:{name:'loop'},owner:'loop'}));p.render(Math.round(.06*rate));assert(p.core.getState().dmcRemaining>0);
  await p.rpc({action:'releaseOwner',owner:'loop'});assert.equal(p.core.getState().dmcRemaining,0);assert((await p.rpc({action:'capture'})).enabled&1);
 }finally{p.close();}
});

for(const file of ['playground_nes_worklet.js','../../docs/synth-2a03/processor.js'])test(`${file}: DMC timed retrigger takes ownership but stale Off/cancel and key-up cannot stop a newer Gate`,async()=>{
 const p=await setup(file,48000),standalone=file.includes('docs/');try{
  await prepareDmc(p,file);const r=await p.rpc({action:'schedule',operations:build(b=>{b.dmc.play({loop:true});b.atSeconds(.02).dmc.stop();}),options:{name:'old-dmc'},owner:'old-dmc'});p.render(r.startFrame+1);
  if(standalone){const {createDefaultPreset}=await import('../../docs/synth-2a03/preset.js');const preset=createDefaultPreset();preset.source='dmc';preset.dmc={...preset.dmc,data:Array(257).fill(0x55),loop:true};await p.command('applyPhysicalPreset',[4,preset]);await p.command('noteOn',['manual-dmc',60,4]);}
  else p.p.inspector.invoke('auditionOn',[4,60,'manual-dmc']);
  p.render(1100);assert(p.core.getState().dmcRemaining>0);await p.rpc({action:'releaseOwner',owner:'old-dmc'});assert(p.core.getState().dmcRemaining>0);
  await p.rpc({action:'schedule',operations:build(b=>b.dmc.play({loop:true,level:64})),options:{name:'new-dmc'},owner:'new-dmc'});p.render(300);const before=p.writes.length;
  if(standalone)assert.equal(await p.command('noteOff',['manual-dmc']),false);else assert.equal(p.p.inspector.invoke('auditionOff',[4,'manual-dmc']),false);
  assert.equal(p.writes.length,before);assert(p.core.getState().dmcRemaining>0);await p.rpc({action:'releaseOwner',owner:'new-dmc'});assert.equal(p.core.getState().dmcRemaining,0);
  if(standalone)assert.equal(p.p.clickGuard.read().phase,'release');
 }finally{p.close();}
});

test('standalone prepared DMC requires a sample, validates before replacing a pattern and retains software smoothing preference',async()=>{
 const file='../../docs/synth-2a03/processor.js',p=await setup(file,48000);try{
  await assert.rejects(p.rpc({action:'schedule',operations:build(b=>b.dmc.play()),options:{name:'missing'},owner:'missing'}),/Load a DMC sample/);
  await prepareDmc(p,file);await p.rpc({action:'schedule',operations:build(b=>b.dmc.play({loop:true})),options:{name:'dmc',repeatSeconds:.1},owner:'dmc'});p.render(300);assert.equal(p.p.clickGuard.read().phase,'attack');
  p.render(300);assert.equal(p.p.clickGuard.read().phase,'bypass');await p.rpc({action:'releaseOwner',owner:'dmc'});assert.equal(p.p.clickGuard.read().phase,'release');p.render(300);assert.equal(p.p.clickGuard.read().phase,'muted');
  await p.command('setClickGuard',[false]);await p.rpc({action:'schedule',operations:build(b=>b.dmc.play({loop:true})),options:{name:'raw'},owner:'raw'});p.render(300);assert.equal(p.p.clickGuard.read().phase,'bypass');await p.rpc({action:'releaseOwner',owner:'raw'});assert.equal(p.p.clickGuard.read().phase,'bypass');
 }finally{p.close();}
});

test('public Web Audio sample upload selects its full padded DMC range after acknowledgement; raw upload/reset invalidate it',async()=>{
 const p=await setup('playground_nes_worklet.js',48000);const {createNesClient}=await import('../../tetorica_src/runtime/playground_nes.js');const sent=[];
 const port={start(){},close(){},postMessage(data){sent.push(data);p.p.receive(data,{postMessage:reply=>queueMicrotask(()=>port.onmessage({data:reply}))});}};
 const client=createNesClient(port,{fdsEnabled:true});try{
  assert.deepEqual(await client.dmc.loadSample(new Uint8Array(200).fill(0x55),{address:0xc100}),{address:0xc100,length:209});
  const snapshot=await client.captureState();assert.deepEqual(snapshot.sample,{address:0xc100,length:209});assert(sent.some(m=>m.method==='nesSelectSample'));
  const plan=client.build(b=>b.dmc.play({loop:true}));assert.equal((await client.compile(plan,{initialState:'client'})).find(w=>w.register===0x4013).value,13);
  await client.schedule(plan,{name:'public-dmc'});p.render(300);assert(p.core.getState().dmcRemaining>0);
  await client.loadMemory(Uint8Array.of(0xaa),0xc100);assert.equal((await client.captureState()).sample,null);await assert.rejects(client.schedule(plan,{name:'public-dmc'}),/Load a DMC sample/);
  await client.dmc.loadSample(Uint8Array.of(0x55));client.reset();assert.equal((await client.captureState()).sample,null);
 }finally{client.dispose();p.close();}
});

for(const file of ['playground_nes_worklet.js','../../docs/synth-2a03/processor.js'])test(`${file}: prepared sample selection resolves at execution; a raw upload invalidates it without a fatal engine error`,async()=>{
 const p=await setup(file,48000);try{
  await prepareDmc(p,file,{address:0xc100,length:257});const snapshot=await p.rpc({action:'capture'}),plan=build(b=>b.dmc.play({loop:true}));assert.equal(compile(plan,snapshot).find(w=>w.register===0x4012).value,4);
  await p.rpc({action:'schedule',operations:plan,options:{name:'switch'},owner:'switch'});await prepareDmc(p,file,{address:0xc200,length:513});p.render(300);assert.equal(p.writes.findLast(w=>w.register===0x4012).value,8);assert.equal(p.writes.findLast(w=>w.register===0x4013).value,32);assert.deepEqual(snapshot.sample,{address:0xc100,length:257});
  await p.rpc({action:'schedule',operations:plan,options:{name:'invalidated'},owner:'invalidated'});
  if(file.includes('docs/')){const session=(await p.command('read')).codeSession;await p.command('code',[session,'loadMemory',[Uint8Array.of(0xaa),0xc200]]);}else await p.command('loadMemory',[Uint8Array.of(0xaa),0xc200]);
  assert.equal((await p.rpc({action:'capture'})).sample,null);const count=p.writes.length;p.render(300);assert(!p.writes.slice(count).some(w=>w.register===0x4015&&(w.value&16)));assert(p.core.handle,'engine remains alive');
 }finally{p.close();}
});

test('superseded Web Audio DMC upload does not publish a stale prepared selection',async()=>{
 const {createNesClient}=await import('../../tetorica_src/runtime/playground_nes.js');const sent=[];const port={start(){},close(){},postMessage:data=>sent.push(data)};const client=createNesClient(port);
 try{const pending=client.dmc.loadSample(new Uint8Array(17));const upload=sent.find(m=>m.method==='loadMemory');assert(upload);client.reset();port.onmessage({data:{id:upload.id,value:true}});await assert.rejects(pending,/superseded|reset/);assert(!sent.some(m=>m.method==='nesSelectSample'));}finally{client.dispose();}
});

for(const rate of [44100,48000])test(`standalone ${rate}: manual DMC and its click guard retain exact pre-DMC-timed PCM`,async()=>{
 const {readNesDmcPredecessor}=await import('../../scripts/mixer_calibration_nes_dmc_revision.mjs');const file='../../docs/synth-2a03/processor.js';const old=await setup(file,rate,readNesDmcPredecessor('docs/synth-2a03/processor.js')),now=await setup(file,rate);try{
  const {createDefaultPreset}=await import('../../docs/synth-2a03/preset.js');const preset=createDefaultPreset();preset.source='dmc';preset.dmc={...preset.dmc,data:Array(257).fill(0x55),loop:true};
  for(const p of [old,now]){await p.command('setPreset',[preset]);await p.command('noteOn',['dmc-parity',60,4]);}
  assert.deepEqual(now.render(1024),old.render(1024));assert.deepEqual(now.lastRight(),old.lastRight());for(const p of [old,now])await p.command('noteOff',['dmc-parity']);assert.deepEqual(now.render(1024),old.render(1024));assert.deepEqual(now.lastRight(),old.lastRight());
 }finally{old.close();now.close();}
});


test('prepared DMC metadata rejects accessors without running them',()=>{
 let reads=0;const sample={length:17};Object.defineProperty(sample,'address',{enumerable:true,get(){reads++;return 0xc000;}});
 assert.throws(()=>createNesTimedSnapshot({...reset(),sample},{instanceId:'bad',clock:reset().clock,frame:0,sampleRate:48000}),/selection/);assert.equal(reads,0);
});

for(const file of ['playground_nes_worklet.js','../../docs/synth-2a03/processor.js'])for(const rate of [44100,48000])test(`${file} ${rate}: FDS control compile/execution parity, gain and cancellation`,async()=>{
 const p=await setup(file,rate);try{
 const plan=build(b=>{b.fds.setVolume(17,2);b.fds.noteOn('C4');b.atSample(441).fds.setFrequency(330);b.writeRegister(0x4084,0x88);b.writeRegister(0x4086,20);b.writeRegister(0x4087,0);b.atSeconds(.02).fds.noteOff();});
 const state=await p.rpc({action:'capture'}),copy=structuredClone(state),expected=compile(plan,state,{fds:true});assert.deepEqual(state,copy);
 const accepted=await p.rpc({action:'schedule',operations:plan,options:{name:'fds'},owner:'fds'}),start=p.writes.length;p.render(accepted.startFrame+Math.round(.02*rate)+1);
 assert.deepEqual(rows(p.writes.slice(start)),rows(expected));assert.deepEqual(p.writes.slice(start).map(w=>w.frame),expected.map(w=>accepted.startFrame+Math.round(w.offsetSeconds*rate)));
 assert.equal((await p.rpc({action:'capture'})).fdsGain,17);
 const on=await p.rpc({action:'schedule',operations:build(b=>b.fds.keyOn()),options:{name:'fds'},owner:'fds'});p.render(on.startFrame+1);await p.rpc({action:'releaseOwner',owner:'fds'});assert.equal(p.core.getState().registers[0x83]&128,128);
 }finally{p.close();}
});
test('FDS rejects disabled hardware and unscoped raw RAM writes; retains same-value envelope writes',()=>{
 const plan=build(b=>{b.fds.setVolume(12);b.fds.keyOn();b.writeRegister(0x4080,1);b.writeRegister(0x4080,1);});
 assert.throws(()=>compile(plan,reset()),/FDS/);const writes=compile(plan,reset(),{fds:true});assert.equal(writes.filter(w=>w.register===0x4080&&w.value===1).length,2);
 assert.throws(()=>compile(build(b=>b.writeRegister(0x4088,1)),reset(),{fds:true}),/no RAM/);assert.throws(()=>compile(build(b=>b.writeRegister(0x4040,1)),reset(),{fds:true}),/no RAM/);
});

for(const file of ['playground_nes_worklet.js','../../docs/synth-2a03/processor.js'])test(`${file}: FDS stale Off and cancellation preserve a newer manual Gate`,async()=>{
 const p=await setup(file,48000),standalone=file.includes('docs/');try{
 const r=await p.rpc({action:'schedule',operations:build(b=>{b.fds.noteOn('C4');b.atSeconds(.02).fds.noteOff();}),options:{name:'old'},owner:'old'});p.render(r.startFrame+1);
 if(standalone)await p.command('noteOn',['manual',64,5]);else p.p.inspector.invoke('auditionOn',[5,64,'manual']);
 const gain=p.core.getState().registers[0x80];p.render(1100);assert.equal(p.core.getState().registers[0x80],gain);assert.equal(p.core.getState().registers[0x83]&128,0);await p.rpc({action:'releaseOwner',owner:'old'});assert.equal(p.core.getState().registers[0x83]&128,0);
 const on=await p.rpc({action:'schedule',operations:build(b=>b.fds.keyOn()),options:{name:'new'},owner:'new'});p.render(on.startFrame+1);
 if(standalone)assert.equal(await p.command('noteOff',['manual']),false);else assert.equal(p.p.inspector.invoke('auditionOff',[5,'manual']),false);
 }finally{p.close();}
});

for(const file of ['playground_nes_worklet.js','../../docs/synth-2a03/processor.js'])for(const rate of [44100,48000])test(`${file} ${rate}: timed FDS full tables preserve ordered writes and live Gate`,async()=>{
 const p=await setup(file,rate);try{
 const wave=Array.from({length:64},(_,i)=>i),table=Array.from({length:32},(_,i)=>i%8);
 const plan=build(b=>{b.fds.setVolume(20);b.fds.noteOn('C4');b.atSample(441).fds.setWave(wave);b.fds.setModulation({table,rate:256,depth:8,bias:-3});});wave.fill(0);table.fill(0);
 const state=await p.rpc({action:'capture'}),expected=compile(plan,state,{fds:true});assert.equal(expected.filter(w=>w.register>=0x4040&&w.register<0x4080).length,64);assert.equal(expected.filter(w=>w.register===0x4088).length,32);
 const r=await p.rpc({action:'schedule',operations:plan,options:{name:'tables',repeatSeconds:.04},owner:'tables'}),start=p.writes.length;p.render(r.startFrame+Math.round(.01*rate)+1);
 assert.deepEqual(rows(p.writes.slice(start)),rows(expected));assert.deepEqual(p.writes.slice(start).map(w=>w.frame),expected.map(w=>r.startFrame+Math.round(w.offsetSeconds*rate)));
 assert.equal(p.core.getState().registers[0x83]&128,0);assert.deepEqual(p.core.getState().wave,Array.from({length:64},(_,i)=>i));assert.equal(p.core.getState().fdsModFrequency,256);if(p.p.instrument){assert.equal(p.p.instrument.assets.wave,null);assert.equal(p.p.instrument.assets.modulation,null);}
 await assert.rejects(p.rpc({action:'schedule',operations:build(b=>b.fds.setWave(Array(63).fill(0))),options:{name:'tables'},owner:'tables'}));p.render(Math.round(.04*rate));assert.equal(p.writes.slice(start).filter(w=>w.register===0x4040).length,2);
 await p.rpc({action:'releaseOwner',owner:'tables'});assert.equal(p.core.getState().registers[0x83]&128,128);
 }finally{p.close();}
});
test('FDS table recorder detaches byte arrays and rejects malformed data before compilation',()=>{
 const wave=new Uint8Array(64).fill(20),p=build(b=>b.fds.setWave(wave));wave.fill(0);assert.equal(compile(p,reset(),{fds:true}).find(w=>w.register===0x4040).value,20);
 for(const table of [Array(31).fill(0),Array(32).fill(8)])assert.throws(()=>compile(build(b=>b.fds.setModulation({table})),reset(),{fds:true}));
 assert.throws(()=>compile(build(b=>b.fds.setWave(Array(64).fill(64))),reset(),{fds:true}));
});
