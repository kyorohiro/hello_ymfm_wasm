import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {buildSnesOperations as build,compileSnesOperations as compile,createSnesOperationResetState as reset} from '../../tetorica_src/runtime/snes_operations.js';
import {createSnesClient} from '../../tetorica_src/runtime/playground_snes.js';
import {attachSnesTimedClient} from '../../tetorica_src/runtime/snes_timed_client.js';
import {createSnesTimedSnapshot} from '../../tetorica_src/runtime/snes_timed_state.js';
import {readSnesTimedPredecessor} from '../../scripts/mixer_calibration_snes_timed_revision.mjs';
import {encodeBrr} from '../../tetorica_src/runtime/snes_brr_encoder.js';
import {createSnesCodeClient} from '../../docs/synth-snes/code_client.js';
const root=new URL('../../tetorica_src/runtime/',import.meta.url);
async function setup(file,rate,sourceOverride){
 let Type,frame=0,eventFrame,lastRight;const messages=[],context={sampleRate:rate,Float32Array,Uint8Array,console,AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m)};}},registerProcessor(_name,type){Type=type;}};Object.defineProperty(context,'currentFrame',{get:()=>frame});
 const path=new URL(file,root),bindings=[],source=(sourceOverride??await readFile(path,'utf8')).replace(/^import (.+) from ['"]([^'"]+)['"];?$/gm,(_l,b,s)=>{bindings.push([b,s]);return '';});
 for(const [binding,spec]of bindings){const m=await import(new URL(spec,path));if(binding.startsWith('{'))for(const name of binding.slice(1,-1).split(',')){const[a,b]=name.trim().split(/\s+as\s+/);context[b??a]=m[a];}else context[binding]=m.default;}
 if(context.createProcessorPerformance){const make=context.createProcessorPerformance;context.createProcessorPerformance=options=>make({...options,rate,nowFrame:()=>frame});}
 vm.runInNewContext(source.replace('export class','class'),context);const wasmBinary=await readFile(new URL('generated/spc_wasm.wasm',root)),p=new Type({processorOptions:{wasmBinary}});await p.ready;let id=0;const standalone=file.includes('docs/');
 async function command(method,args=[]){const n=++id;p.receive({id:n,method,args},p.port);await Promise.resolve();const response=messages.find(m=>m.id===n);assert(response,method+' acknowledged');if(response.error)throw Error(response.error);return response.value;}
 const synth=standalone?p.instrument.synth:p.synth;
 if(!standalone){const brr=encodeBrr(Float32Array.from({length:128},(_,i)=>Math.sin(i*Math.PI/64)),{loopStartSamples:0}).brr;const sample=await command('loadBRR',[brr,{rootNote:60,loopStartSamples:0}]);for(let ch=0;ch<2;ch++)await command('setPreset',[ch,{sample:sample.id,gain:127}]);}
 const writes=[],core=synth.core,original=core.writeDsp.bind(core);core.writeDsp=(register,value)=>{writes.push({frame:eventFrame??frame,register,value});return original(register,value);};if(p.timed){const apply=p.timed.apply.bind(p.timed);p.timed.apply=(operation,port,at,metadata)=>{eventFrame=at;try{return apply(operation,port,at,metadata);}finally{eventFrame=undefined;}};}
 return {p,core,command,writes,lastRight:()=>lastRight,rpc:payload=>command('snesTimed',[payload]),render(count){const l=new Float32Array(count),r=new Float32Array(count);for(let i=0;i<count;){const n=Math.min(128,count-i);p.process([],[[l.subarray(i,i+n),r.subarray(i,i+n)]]);frame+=n;i+=n;}assert(l.every(Number.isFinite));lastRight=r;return l;},close:()=>p.dispose()};
}
for(const file of ['playground_snes_worklet.js','../../docs/synth-snes/processor.js'])for(const rate of [44100,48000])test(`${file} ${rate}: actual DSP timed compile and execution parity`,async()=>{
 const p=await setup(file,rate);try{
 const plan=build(b=>{b.setChannel(0,{volumeLeft:70,volumeRight:-40,gain:127});b.noteOn(0,'C4');b.noteOn(1,'E4');b.atSample(441).setNote(0,'D4');b.atSeconds(.02).noteOff(0);b.noteOff(1);});
 const snap=await p.rpc({action:'capture'}),original=structuredClone(snap),expected=compile(plan,snap);assert.deepEqual(snap,original);
 const r=await p.rpc({action:'schedule',operations:plan,options:{name:'notes',repeatSeconds:.05},owner:'test'}),start=p.writes.length;
 const pcm=p.render(r.startFrame+Math.round(.02*rate)+1);assert(pcm.some(v=>Math.abs(v)>.00001));
 assert.deepEqual(p.writes.slice(start).map(({register,value})=>({register,value})),expected.map(({register,value})=>({register,value})));
 assert.deepEqual(p.writes.slice(start).map(w=>w.frame),expected.map(w=>r.startFrame+Math.round(w.offsetSeconds*rate)));
 await assert.rejects(p.rpc({action:'schedule',operations:build(b=>b.setPitch(0,16384)),options:{name:'notes'},owner:'test'}));p.render(Math.round(.06*rate));assert(p.writes.filter(w=>w.register===0x4c).length>=4);await p.rpc({action:'releaseOwner',owner:'test'});
 }finally{p.close();}
});
test('SNES reset compiler retains duplicate writes, validates raw scope and detaches patches',()=>{
 const patch={gain:17},p=build(b=>{b.setChannel(0,patch);b.writeDsp(0x3d,2);b.writeDsp(0x3d,2);});patch.gain=90;
 const rows=compile(p,reset());assert.equal(rows.find(w=>w.register===7).value,17);assert.equal(rows.filter(w=>w.register===0x3d).length,2);
 assert.throws(()=>compile(build(b=>b.writeDsp(0x6d,0)),reset()),/slice/);assert.throws(()=>compile(build(b=>b.writeDsp(0x6c,0)),reset()),/Echo/);assert.throws(()=>compile(build(b=>b.keyOn(0)),reset()),/BRR/);
});

test('S-DSP Code clears only the named scheduled gates, and allNotesOff can release the remaining gates without the keyboard',async()=>{
 const p=await setup('../../docs/synth-snes/processor.js',48000);try{
  const manual=await p.command('noteOn',['keyboard',65]);assert.equal(manual.channel,0);
  const code=createSnesCodeClient({command:p.command,timedPort:p.p.port});
  const {channel}=await code.noteOn(0,'E4');assert.equal(channel,1);
  const schedule=(name,voice)=>code.schedule(build(b=>b.noteOn(voice,'C4').atSeconds(.5).noteOff(voice)),{name,repeatSeconds:1});
  await schedule('first',2);const second=await schedule('second',3);
  assert(p.render(second.startFrame+512).some(value=>Math.abs(value)>.001));
  assert.equal((await code.getState()).timedGateMask,12);
  await code.clearSchedule('first');
  assert.equal((await code.getState()).timedGateMask,8);
  assert.equal(p.core.readDsp(0x5c)&15,4,'the second reservation and other notes remain gated');
  await code.allNotesOff();
  assert.equal((await code.getState()).timedGateMask,0);
  assert.deepEqual((await code.getState()).voices.map(voice=>voice.id),['keyboard']);
  assert.equal(p.core.readDsp(0x5c)&15,14,'explicit release preserves the keyboard Gate');
  assert(p.render(2048).some(value=>Math.abs(value)>.001),'the keyboard remains audible');
  p.render(50000);
  assert.equal((await code.getState()).timedGateMask,8,'the remaining reservation plays its next repeat');
 }finally{p.close();}
});

test('Playground S-DSP clears its scheduled Gate and preserves newer immediate gates',async()=>{
 const p=await setup('playground_snes_worklet.js',48000);try{
  const scheduled=(name)=>p.rpc({action:'schedule',operations:build(b=>b.noteOn(1,'C4').atSeconds(.5).noteOff(1)),options:{name},owner:'code'});
  const clear=(name)=>p.rpc({action:'clear',name,owner:'code'});
  await p.command('noteOn',[0,'G4']);
  const first=await scheduled('first');p.render(first.startFrame+128);
  assert.equal(p.core.readDsp(0x5c)&3,0);
  await clear('first');assert.equal(p.core.readDsp(0x5c)&3,2);
  await scheduled('second');p.render(300);
  await p.command('noteOn',[1,'E4']);
  await clear('second');assert.equal(p.core.readDsp(0x5c)&3,0);
 }finally{p.close();}
});

for(const file of ['playground_snes_worklet.js','../../docs/synth-snes/processor.js'])test(`${file}: prior-frame KON, snapshot reuse and manual Gate ownership`,async()=>{
 const p=await setup(file,48000),standalone=file.includes('docs/');try{
 if(standalone)await p.command('noteOn',['prior',64]);else await p.command('noteOn',[0,'E4']);
 const snapshot=await p.rpc({action:'capture'}),plan=build(b=>{b.noteOn(1,'G4');b.atSeconds(.01).noteOff(1);}),expected=compile(plan,snapshot),r=await p.rpc({action:'schedule',operations:plan,options:{name:'prior'},owner:'prior'}),start=p.writes.length;p.render(r.startFrame+481);assert.deepEqual(p.writes.slice(start).map(({register,value})=>({register,value})),expected.map(({register,value})=>({register,value})));assert.deepEqual(compile(plan,snapshot),expected);
 const old=await p.rpc({action:'schedule',operations:build(b=>{b.noteOn(0,'C4');b.atSeconds(.02).noteOff(0);}),options:{name:'old'},owner:'old'});p.render(300);
 if(standalone){p.p.instrument.cursor=0;const manual=await p.command('noteOn',['manual',64]);p.render(1100);assert.equal(p.core.readDsp(0x5c)&(1<<manual.channel),0);await p.rpc({action:'releaseOwner',owner:'old'});assert.equal(p.core.readDsp(0x5c)&(1<<manual.channel),0);}
 else {p.p.inspector.invoke('auditionOn',[0,64,'manual']);p.render(1100);assert.equal(p.core.readDsp(0x5c)&1,0);await p.rpc({action:'releaseOwner',owner:'old'});assert.equal(p.core.readDsp(0x5c)&1,0);}
 const newer=await p.rpc({action:'schedule',operations:build(b=>b.keyOn(0)),options:{name:'new'},owner:'new'});p.render(300);if(standalone)assert.equal(await p.command('noteOff',['manual']),false);else assert.equal(p.p.inspector.invoke('auditionOff',[0,'manual']),false);
 }finally{p.close();}
});

for(const rate of [44100,48000])test(`standalone ${rate}: unchanged immediate keyboard PCM against authenticated predecessor`,async()=>{
 const file='../../docs/synth-snes/processor.js',source=readSnesTimedPredecessor('docs/synth-snes/processor.js'),a=await setup(file,rate),b=await setup(file,rate,source);try{await a.command('noteOn',['key',60]);await b.command('noteOn',['key',60]);assert.deepEqual(a.render(2048),b.render(2048));assert.deepEqual(a.lastRight(),b.lastRight());await a.command('noteOff',['key']);await b.command('noteOff',['key']);assert.deepEqual(a.render(2048),b.render(2048));assert.deepEqual(a.lastRight(),b.lastRight());}finally{a.close();b.close();}
});
test('public SNES compiler: reset/current/reused state; incomplete client and Native reject explicitly',async()=>{
 let requests=0;const snapshot=createSnesTimedSnapshot(reset(),{instanceId:'one',clock:32000,frame:0,sampleRate:48000});
 const client=attachSnesTimedClient({_requestControl:async()=>{requests++;return snapshot;},dispose(){}},{}),plan=build(b=>b.setPitch(0,4096));
 const a=await client.compile(plan);assert.equal(requests,1);assert.deepEqual(await client.compile(plan,{initialState:snapshot}),a);assert.equal(requests,1);assert.deepEqual(await client.compile(plan,{initialState:'reset'}),a);assert.equal(requests,1);
 await assert.rejects(client.compile(plan,{initialState:'client'}),/Incomplete/);await assert.rejects(client.compile(plan,{initialState:{...snapshot,instanceId:'other'}}),/instanceId/);
 assert(Object.isFrozen(snapshot.channels[0]));assert(Object.isFrozen(snapshot.echo.fir));
 const native=attachSnesTimedClient({dispose(){}},{native:true});await assert.rejects(native.captureState(),/AudioWorklet/);assert.equal((await native.compile(plan,{initialState:'reset'})).length,2);client.dispose();native.dispose();
});
for(const file of ['playground_snes_worklet.js','../../docs/synth-snes/processor.js'])test(`${file}: reserved Echo partial updates and raw voice patches share converter state`,async()=>{
 const p=await setup(file,48000);try{
 const synth=p.p.instrument?.synth??p.p.synth;synth.setEcho({enabled:true});const state=await p.rpc({action:'capture'});
 const plan=build(b=>{b.writeDsp(7,90);b.setChannel(0,{volumeLeft:-12});b.setEcho({feedback:17,fir:[100,0,0,0,0,0,0,0]});});const rows=compile(plan,state);assert.equal(rows.filter(w=>w.register===7).at(-1).value,90);
 const r=await p.rpc({action:'schedule',operations:plan,options:{name:'echo'},owner:'echo'}),start=p.writes.length;p.render(r.startFrame+1);assert.deepEqual(p.writes.slice(start).map(({register,value})=>({register,value})),rows.map(({register,value})=>({register,value})));assert.equal(synth.getEcho().feedback,17);
 }finally{p.close();}
});

for(const primaryWorker of [false,true])test(`public ${primaryWorker?'primary Worker':'logic Worker/Main'} MessagePort: authoritative snapshots and timed scheduling`,async()=>{
 const p=await setup('playground_snes_worklet.js',48000),ports=new MessageChannel();let client;try{
 p.p.port.onmessage({data:primaryWorker?{primaryWorker:true,port:ports.port2}:{port:ports.port2}});
 client=createSnesClient(ports.port1,{state:p.p.synth.getState(),sampleRate:48000});
 const plan=client.build(b=>{b.noteOn(0,'C4');b.atSample(441).noteOff(0);}),state=await client.captureState(),rows=await client.compile(plan,{initialState:state}),r=await client.schedule(plan,{name:'public',repeatSeconds:.03});
 const start=p.writes.length;p.render(r.startFrame+481);assert.deepEqual(p.writes.slice(start).map(({register,value})=>({register,value})),rows.map(({register,value})=>({register,value})));
 await assert.rejects(client.compile(plan,{initialState:'client'}),/Incomplete/);await client._timedOperations.releaseOwner('snes-timed:client');
 }finally{client?.dispose();ports.port1.close();ports.port2.close();p.close();}
});
