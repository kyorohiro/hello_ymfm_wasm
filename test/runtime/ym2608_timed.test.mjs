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
 for(const [port,reg]of [[0,0x27],[0,0x2e],[1,8],[0,14]])assert.throws(()=>compile(build(b=>b.write(port,reg,0)),reset()),/only/);
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
 let frame=0,Type,ready;const messages=[],writes=[],physical=[];
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
 const initialized=new Promise(resolve=>ready=resolve),wasmBinary=await readFile(new URL('generated/ym2608_wasm.wasm',runtime)),rom=new Uint8Array(await readFile(new URL('tetorica_ym2608_adpcm_rom.bin',runtime)));
 const generic=file==='playground_ym2608_worklet.js';
 const processor=new Type({processorOptions:{wasmBinary,rom}});
 if(!generic)processor.port.onmessage({data:{type:'initialize',wasmBinary,rhythmRom:rom}});
 const result=await initialized;assert(result.ready||result.type==='ready',JSON.stringify(result));
 const chip=generic?processor.engine.ym2608:processor.chip;
 let address=0,eventFrame=null;
 chip.hooks.onWrite=({offset,data})=>{if(!(offset&1))address=((offset&2)<<7)|data;else if(address>>8===offset>>1){const row={frame:eventFrame??frame,port:address>>8,register:address&255,value:data};physical.push(row);if(eventFrame!==null)writes.push(row);}};
 if(processor.timed){const apply=processor.timed.apply.bind(processor.timed);processor.timed.apply=(op,p,f,m)=>{eventFrame=f;try{return apply(op,p,f,m);}finally{eventFrame=null;}};}
 const send=data=>generic?processor.receive(data,port):port.onmessage({data});let id=0;
 const rpc=payload=>{const n=++id;send({method:'ym2608Timed',id:n,args:[payload]});const reply=messages.find(x=>x.id===n);assert(reply,'immediate control acknowledgement');if(reply.error)throw Error(reply.error);return reply.value;};
 const synth=new YM2608Synth({transport:{write:(port,register,value)=>send(generic?{method:'write',args:[port,register,value]}:{type:'write',port,register,value}),reset:()=>send(generic?{method:'reset'}:{type:'reset'})}});
 return {processor,synth,send,rpc,writes,physical,messages,chip,frame:()=>frame,
 render(count){const left=new Float32Array(count),right=new Float32Array(count);for(let i=0;i<count;){const size=Math.min(113,count-i);processor.process([],[[left.subarray(i,i+size),right.subarray(i,i+size)]]);i+=size;frame+=size;}assert(left.every(Number.isFinite));return {left,right};},
 close(){chip.dispose();}};
}

for(const file of ['ym2608-worklet.js','playground_ym2608_worklet.js','../../docs/synth-fm2608/audio_worklet.js'])for(const rate of [44100,48000])test(`${file} ${rate} real WASM executes mixed FM/SSG at exact frames with compile parity`,async()=>{
 const p=await setup(file,rate);try{
  p.synth.setOperator(3,0,{dt:5,multi:2});p.synth.ssg.write(7,0xc0);
  const plan=build(b=>{b.setOperator(3,0,{multi:7});b.keyOn(3);b.keyOn(3);b.ssg.setMixer(1,{tone:true,noise:false});b.ssg.setVolume(1,13);b.ssg.setEnvelope({period:300,shape:8});b.ssg.setEnvelope({period:200});b.ssg.setEnvelope({shape:8});b.atSeconds(.1).ssg.keyOff(1);b.atSample(4410).ssg.keyOn(1);b.keyOff(3);});
  const snapshot=p.rpc({action:'capture'}),expected=compile(plan,snapshot);
  const receipt=p.rpc({action:'schedule',operations:plan,options:{name:'test'}});assert.equal(receipt.startFrame,128);assert.equal(p.writes.length,0);
  p.render(receipt.startFrame+Math.round(.1*rate)+1);
  assert.deepEqual(bytes(p.writes),bytes(expected));assert.equal(p.writes.at(-1).frame,receipt.startFrame+Math.round(.1*rate));
  assert.deepEqual(p.writes.filter(row=>row.port===0&&row.register===13).map(row=>row.value),[8,8]);
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

test('standalone named cancellation releases only the current reservation’s SSG gate',async()=>{
 const p=await setup('../../docs/synth-fm2608/audio_worklet.js',48000);try{
  const owner='named-owner';
  const reserve=(name,program)=>p.rpc({action:'schedule',operations:build(program),options:{name},owner});
  const capture=()=>p.rpc({action:'capture'}).registers[0].slice(8,11);
  reserve('first',b=>{b.ssg.setVolume(0,6);b.ssg.setVolume(1,7);});p.render(256);
  reserve('second',b=>b.ssg.setVolume(0,10));p.render(256);
  p.synth.ssg.setVolume(2,12);assert.deepEqual(capture(),[10,7,12]);
  p.rpc({action:'clear',name:'first',owner});assert.deepEqual(capture(),[10,0,12]);
  p.rpc({action:'clear',name:'second',owner});assert.deepEqual(capture(),[0,0,12]);
 }finally{p.close();}
});

test('standalone OPNA allNotesOff releases held timed FM and SSG while retaining later events and manual sound',async()=>{
 const p=await setup('../../docs/synth-fm2608/audio_worklet.js',48000);try{
  const plan=build(b=>{b.keyOn(0);b.ssg.setVolume(0,9);b.ssg.setVolume(1,5);});
  const receipt=p.rpc({action:'schedule',operations:plan,options:{name:'repeat',repeatSeconds:.06}});
  p.render(receipt.startFrame+1);
  p.synth.ssg.setVolume(1,12);
  const read=()=>{const state=p.rpc({action:'capture'});return [state.keyMasks[0],...state.registers[0].slice(8,10)];};
  assert.deepEqual(read(),[15,9,12]);
  p.send({type:'release-timed-notes'});assert.deepEqual(read(),[0,0,12]);
  p.render(receipt.startFrame+2880-p.frame()+1);assert.deepEqual(read(),[15,9,5]);
 }finally{p.close();}
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

for(const rate of [44100,48000])test(`standalone ${rate}: timed and immediate levels share monitor state, Stop restores on exact Gate frame`,async()=>{
 const p=await setup('../../docs/synth-fm2608/audio_worklet.js',rate);try{
  p.synth.setAlgo(0,7);p.synth.setPan(0,true,true);
  for(let op=0;op<4;op++)p.synth.setOperator(0,op,{multi:1,tl:op?127:24,ar:31,d1r:0,d2r:0,sl:0,rr:8});
  const mute=(section,channel,value)=>p.send({type:'synth-fm-ssg-monitor',action:'mute',section,channel,value});
  mute('fm',0,true);mute('ssg',1,true);
  const phrase=build(b=>{b.setOperator(0,0,{tl:18});b.noteOn(0,'C4');b.ssg.setVolume(1,13);});
  p.rpc({action:'schedule',operations:phrase,options:{name:'level'},owner:'code'});p.render(400);
  assert.equal(p.physical.findLast(x=>x.port===0&&x.register===0x40).value,127);
  assert.equal(p.physical.findLast(x=>x.port===0&&x.register===9).value,0);
  assert.equal(p.rpc({action:'capture'}).registers[0][0x40],127,'current captures physical monitor output');
  assert.equal(p.rpc({action:'capture'}).registers[0][9],0);
  assert.equal(p.processor.fmSsgMonitor.getState().registers[0][0x40],18,'private monitor retains the authored level');
  mute('fm',0,false);mute('ssg',1,false);
  assert.equal(p.physical.findLast(x=>x.port===0&&x.register===0x40).value,18);assert.equal(p.physical.findLast(x=>x.port===0&&x.register===9).value,13);
  p.synth.setOperator(0,0,{tl:21});mute('fm',0,true);mute('fm',0,false);assert.equal(p.physical.findLast(x=>x.port===0&&x.register===0x40).value,21);
  p.rpc({action:'releaseOwner',owner:'code'});p.synth.keyOff(0);p.synth.ssg.keyOff(1);p.send({type:'synth-fm-ssg-monitor',action:'stop-fm'});
  mute('fm',0,false);assert.equal(p.physical.findLast(x=>x.port===0&&x.register===0x40).value,127,'unmute must not resume a stopped tail');
  const receipt=p.rpc({action:'schedule',operations:build(b=>{b.noteOn(0,'E3');b.ssg.keyOn(1);}),options:{name:'rerun'},owner:'next'});
  p.writes.length=0;p.render(receipt.startFrame-p.frame()+300);
  const levels=p.writes.filter(x=>x.register===0x40),gate=p.writes.find(x=>x.register===0x28);
  assert.equal(levels[0].value,21);assert.equal(levels[0].frame,receipt.startFrame);assert.equal(gate.frame,receipt.startFrame);
  assert.equal(p.rpc({action:'capture'}).registers[0][9],13,'SSG retained volume survives Stop and timed keyOn');
  assert(p.render(500).left.some(x=>Math.abs(x)>0),'a Key On-only rerun is audible');
 }finally{p.close();}
});

for(const rate of [44100,48000])test(`standalone ${rate}: default mixed FM/SSG/ADPCM PCM matches its authenticated pre-monitor processor`,async()=>{
 const {readFm2608MonitorPredecessor}=await import('../../scripts/mixer_calibration_fm2608_monitor_revision.mjs');
 const file='../../docs/synth-fm2608/audio_worklet.js';
 const old=await setup(file,rate,readFm2608MonitorPredecessor('docs/synth-fm2608/audio_worklet.js')),current=await setup(file,rate);
 try{
  for(const p of [old,current]){
   p.synth.reset();p.synth.setAlgo(0,7);p.synth.setPan(0,true,true);
   for(let op=0;op<4;op++)p.synth.setOperator(0,op,{multi:op+1,tl:op?127:24,ar:31,d1r:5,d2r:3,sl:7,rr:8});
   p.synth.noteOn(0,'C4');p.synth.ssg.tone(1,{frequency:330,volume:8});
   p.send({type:'loadAdpcmMemory',bytes:Uint8Array.from({length:64},(_,i)=>i*73&255),address:0});
   p.synth.adpcm.setSample({start:0,end:64});p.synth.adpcm.setVolume(192);p.synth.adpcm.setPan(true,true);p.synth.adpcm.setPlaybackRate(16000);p.synth.adpcm.keyOn({repeat:true});
  }
  const a=old.render(2048),b=current.render(2048);assert.deepEqual(b.left,a.left);assert.deepEqual(b.right,a.right);assert(b.left.some(x=>Math.abs(x)>.01));
 }finally{old.close();current.close();}
});


test('Rhythm build/compile preserves packed pan/volume, repeated triggers and mixed cursors without side effects',()=>{
 const state=reset();state.registers[0][0x19]=0xc7;state.rhythmLevels[1]=0xc7;
 const before=structuredClone(state);const plan=build(b=>{
  b.rhythm.setVolume(48);b.rhythm.setVoice('snare',{volume:13});b.rhythm.setVoice(1,{left:false});
  b.rhythm.keyOn(['bassDrum','snare']);b.rhythm.keyOn(['bassDrum','snare']);
  b.atSample(441).setOperator(3,0,{multi:2});b.ssg.setVolume(0,8);
  b.atSeconds(.02).rhythm.keyOff([0,1]);
 });
 const rows=bytes(compile(plan,state));assert.deepEqual(rows.slice(0,5),[[0,0x11,48],[0,0x19,0xcd],[0,0x19,0x4d],[0,0x10,3],[0,0x10,3]]);assert.deepEqual(rows.at(-1),[0,0x10,0x83]);assert.deepEqual(state,before);
 assert.equal(plan.operations.at(-1).time.value,.02);assert.equal(plan.operations[5].time.value,441);
 for(const operation of [b=>b.rhythm.setVolume(64),b=>b.rhythm.setVoice(6,{volume:1}),b=>b.rhythm.setVoice(0,{volume:32}),b=>b.rhythm.keyOn('unknown')])assert.throws(()=>compile(build(operation),state));
 const raw=compile(build(b=>{b.write(0,0x18,0xd2);b.rhythm.setVoice(0,{right:false});}),reset());assert.deepEqual(bytes(raw),[[0,0x18,0xd2],[0,0x18,0x92]]);
 const oldSnapshot=reset();delete oldSnapshot.rhythmLevels;oldSnapshot.registers[0][0x19]=0xc7;assert.equal(compile(build(b=>b.rhythm.setVoice(1,{volume:9})),oldSnapshot)[0].value,0xc9);
});
for(const file of ['ym2608-worklet.js','playground_ym2608_worklet.js','../../docs/synth-fm2608/audio_worklet.js'])for(const rate of [44100,48000])test(`${file} ${rate}: real ROM Rhythm timing, repeated triggers, mixed compile parity and owned Stop`,async()=>{
 const p=await setup(file,rate);try{
  p.synth.rhythm.setVoice('snare',{volume:7,left:true,right:true});
  const plan=build(b=>{b.rhythm.setVolume(48);b.rhythm.setVoice('snare',{volume:24});b.rhythm.keyOn(['bassDrum','snare']);b.rhythm.keyOn(['bassDrum','snare']);b.atSample(441).ssg.setVolume(0,5);b.atSeconds(.01).rhythm.setVoice(1,{left:false});b.atSeconds(.03).rhythm.keyOff([0,1]);});
  const expected=compile(plan,p.rpc({action:'capture'}));const receipt=p.rpc({action:'schedule',operations:plan,options:{name:'drums'},owner:'drummer'});
  p.render(receipt.startFrame+Math.round(.03*rate)+1);assert.deepEqual(bytes(p.writes),bytes(expected));
  assert.equal(p.writes.at(-1).frame,receipt.startFrame+Math.round(.03*rate));assert.equal(p.writes.filter(x=>x.register===0x10&&x.value===3).length,2);
  const repeat=build(b=>{b.rhythm.keyOn([0,1]);});p.rpc({action:'schedule',operations:repeat,options:{name:'repeat',repeatSeconds:.05},owner:'drummer2'});p.render(300);
  const n=p.physical.length;p.rpc({action:'releaseOwner',owner:'drummer2'});assert(p.physical.slice(n).some(x=>x.register===0x10&&(x.value&0x83)===0x83)||p.physical.slice(n).filter(x=>x.register===0x10&&(x.value&128)).length===2);
 }finally{p.close();}
});
for(const file of ['ym2608-worklet.js','playground_ym2608_worklet.js','../../docs/synth-fm2608/audio_worklet.js'])test(`${file}: per-drum stale Off filtering and inspector Gate ownership`,async()=>{
 const p=await setup(file,48000);try{
  p.synth.rhythm.setVolume(48);p.synth.rhythm.setVoice(0,{volume:24,left:true,right:true});p.synth.rhythm.setVoice(1,{volume:24,left:true,right:true});
  const plan=build(b=>{b.rhythm.keyOn([0,1]);b.atSeconds(.02).rhythm.keyOff([0,1]);});const original=structuredClone(plan);
  const receipt=p.rpc({action:'schedule',operations:plan,options:{name:'pair'},owner:'first'});p.render(receipt.startFrame+1);
  p.synth.rhythm.keyOn(1);p.render(1000);assert.equal(p.writes.findLast(x=>x.register===0x10).value,0x81,'stale snare Off excluded without dropping owned bass-drum Off');assert.deepEqual(plan,original);
  const next=p.rpc({action:'schedule',operations:build(b=>{b.rhythm.keyOn(1);b.atSeconds(.01).rhythm.keyOff(1);}),options:{name:'inspector'},owner:'next'});p.render(next.startFrame-p.frame()+1);
  p.processor.opnInspector.invoke('auditionOn',['rhythm:1',60,'manual']);const before=p.physical.length;p.render(700);assert(!p.physical.slice(before).some(x=>x.register===0x10&&(x.value&0x82)===0x82),'old scheduled Off cannot stop a new inspector key');
  p.rpc({action:'schedule',operations:build(b=>b.rhythm.keyOn(1)),options:{name:'claim'},owner:'new'});p.render(300);const count=p.physical.length;p.processor.opnInspector.invoke('auditionOff',['rhythm:1','manual']);assert.equal(p.physical.length,count,'new timed Gate retires old manual key-up token');
 }finally{p.close();}
});
for(const rate of [44100,48000])test(`standalone ${rate}: muted Rhythm keeps authored pan during partial edits and restores latest sound`,async()=>{
 const p=await setup('../../docs/synth-fm2608/audio_worklet.js',rate);try{
  p.synth.rhythm.setVolume(48);p.synth.rhythm.setVoice(1,{volume:24,left:true,right:true});
  p.send({type:'synth-fm-ssg-monitor',action:'mute',section:'rhythm',channel:1,value:true});
  const snapshot=p.rpc({action:'capture'});assert.equal(snapshot.registers[0][0x19],24);assert.equal(snapshot.rhythmLevels[1],0xd8);
  const plan=build(b=>{b.rhythm.setVoice(1,{volume:20});b.rhythm.keyOn(1);});assert.equal(compile(plan,snapshot)[0].value,0xd4);
  p.rpc({action:'schedule',operations:plan,options:{name:'muted',repeatSeconds:.05},owner:'drum'});const silent=p.render(2000);assert(silent.left.every(x=>x===0)&&silent.right.every(x=>x===0));
  p.send({type:'synth-fm-ssg-monitor',action:'mute',section:'rhythm',channel:1,value:false});assert.equal(p.physical.findLast(x=>x.register===0x19).value,0xd4);
  assert(p.render(4000).left.some(x=>Math.abs(x)>.001));
 }finally{p.close();}
});

for(const rate of [44100,48000])test(`standalone ${rate}: immediate Rhythm and mixed default PCM match the authenticated pre-Rhythm processor`,async()=>{
 const {readYm2608RhythmPredecessor}=await import('../../scripts/mixer_calibration_ym2608_rhythm_revision.mjs');
 const file='../../docs/synth-fm2608/audio_worklet.js';
 const old=await setup(file,rate,readYm2608RhythmPredecessor('docs/synth-fm2608/audio_worklet.js')),current=await setup(file,rate);
 try{
  for(const p of [old,current]){
   p.synth.setAlgo(0,7);p.synth.setPan(0,true,true);for(let op=0;op<4;op++)p.synth.setOperator(0,op,{multi:1,tl:op?127:24,ar:31,rr:8});p.synth.noteOn(0,'C4');p.synth.ssg.tone(1,{frequency:330,volume:8});
   p.synth.rhythm.setVolume(48);p.synth.rhythm.setVoice(0,{volume:24,left:true,right:true});p.synth.rhythm.setVoice(1,{volume:20,left:true,right:false});p.synth.rhythm.keyOn([0,1]);
  }
  const a=old.render(2048),b=current.render(2048);assert.deepEqual(b.left,a.left);assert.deepEqual(b.right,a.right);assert(b.left.some(x=>Math.abs(x)>.01));
 }finally{old.close();current.close();}
});

test('Rhythm reset compilation uses native pan defaults; client compilation retains its immediate helper state',async()=>{
 const {attachYm2608TimedClient}=await import('../../tetorica_src/runtime/ym2608_timed_client.js');
 const chip=attachYm2608TimedClient(new YM2608Synth({transport:{write(){},reset(){}}}));
 try{
  const plan=chip.build(b=>b.rhythm.setVoice(0,{volume:20}));
  assert.equal((await chip.compile(plan,{initialState:'reset'}))[0].value,0xd4);
  assert.equal((await chip.compile(plan,{initialState:'client'}))[0].value,0x14);
  const state=reset();state.rhythmLevels[0]=0x91;chip._adoptTimedState(state);
  assert.equal((await chip.compile(plan,{initialState:'client'}))[0].value,0x94);
  await assert.rejects(chip.compile(plan,{initialState:{}}));
  assert.throws(()=>compile(plan,{...reset(),rhythmLevels:null}),/six Rhythm/);
 }finally{chip.dispose();}
});

test('ADPCM-B compile uses detached packed state, repeated controls and aligned loaded ranges; transfers reject',async()=>{
 const s=reset();s.registers[1][1]=s.adpcmRegisters[1]=0x42;const before=structuredClone(s);
 const plan=build(b=>{b.adpcm.setSample({start:32,end:96});b.adpcm.setPan(true,false);b.adpcm.setPlaybackRate(16000);b.adpcm.setVolume(120);b.adpcm.keyOn({repeat:true});b.adpcm.keyOn({repeat:true});b.atSample(441).adpcm.setDeltaN(12345);b.atSeconds(.02).adpcm.keyOff();});
 const out=compile(plan,s);assert.deepEqual(bytes(out).slice(0,8),[[1,1,0x42],[1,2,1],[1,3,0],[1,4,2],[1,5,0],[1,12,255],[1,13,255],[1,1,0x82]]);
 assert.deepEqual(bytes(out).filter(x=>x[1]===0),[[1,0,0xb0],[1,0,0xb0],[1,0,1]]);assert.deepEqual(s,before);
 const older=structuredClone(s);delete older.adpcmRegisters;assert.equal(compile(build(b=>b.adpcm.setPan(true,true)),older)[0].value,0xc2);
 for(const call of [b=>b.adpcm.setSample({start:1,end:32}),b=>b.adpcm.setDeltaN(0),b=>b.adpcm.setVolume(256),b=>b.adpcm.setPan(1,true),b=>b.adpcm.keyOn({repeat:1}),b=>b.write(1,8,0),b=>b.write(1,0,0xe0),b=>b.write(1,1,0xc1)])assert.throws(()=>compile(build(call),s));
 assert.throws(()=>build(b=>b.adpcm.loadMemory(new Uint8Array(32))));
 const client=new YM2608Synth({transport:{write(){}}});const {attachYm2608TimedClient}=await import('../../tetorica_src/runtime/ym2608_timed_client.js');client._requestControl=async()=>createYm2608TimedSnapshot(s,{instanceId:'adpcm',clock:8000000,frame:0,sampleRate:48000});attachYm2608TimedClient(client);
 client.adpcm.setPan(false,true);const op=client.build(b=>b.adpcm.setSample({start:0,end:32}));assert.equal((await client.compile(op,{initialState:'client'}))[0].value,0x42);assert.equal((await client.compile(op,{initialState:'reset'}))[0].value,2);
 const snapshot=await client.captureState(),copy=structuredClone(snapshot);assert.equal((await client.compile(op,{initialState:snapshot}))[0].value,0x42);assert.deepEqual(snapshot,copy);
});
function loadTestAdpcm(p){p.chip.loadAdpcmBMemory(Uint8Array.from({length:64},(_,i)=>i*73&255),0);p.synth.adpcm.setSample({start:0,end:64});p.synth.adpcm.setPan(true,true);p.synth.adpcm.setPlaybackRate(16000);p.synth.adpcm.setVolume(160);}
for(const file of ['ym2608-worklet.js','playground_ym2608_worklet.js','../../docs/synth-fm2608/audio_worklet.js'])for(const rate of [44100,48000])test(`${file} ${rate}: loaded ADPCM timing, compile parity, atomic replacement and owned Stop`,async()=>{
 const p=await setup(file,rate);try{
  loadTestAdpcm(p);const plan=build(b=>{b.adpcm.keyOn({repeat:true});b.atSample(441).adpcm.setVolume(100);b.adpcm.setPan(false,true);b.atSeconds(.03).adpcm.keyOff();});
  const expected=compile(plan,p.rpc({action:'capture'}));const receipt=p.rpc({action:'schedule',operations:plan,options:{name:'sample'},owner:'sample'});
  const sound=p.render(receipt.startFrame+Math.round(.03*rate)+1);assert(sound.left.some(x=>Math.abs(x)>.001));assert.deepEqual(bytes(p.writes),bytes(expected));assert.equal(p.writes.at(-1).frame,receipt.startFrame+Math.round(.03*rate));
  p.rpc({action:'schedule',operations:build(b=>b.adpcm.keyOn({repeat:true})),options:{name:'repeat',repeatSeconds:.1},owner:'repeat'});p.render(300);
  const broken=build(b=>b.adpcm.setDeltaN(0));assert.throws(()=>p.rpc({action:'schedule',operations:broken,options:{name:'repeat',repeatSeconds:.1},owner:'repeat'}),/positive/);p.render(Math.round(.11*rate));assert(p.writes.filter(x=>x.port===1&&x.register===0&&x.value===0xb0).length>=3);
  p.rpc({action:'releaseOwner',owner:'repeat'});assert.equal(p.rpc({action:'capture'}).registers[1][0],1);
 }finally{p.close();}
});
for(const file of ['ym2608-worklet.js','playground_ym2608_worklet.js','../../docs/synth-fm2608/audio_worklet.js'])test(`${file}: ADPCM stale Off/cancel cannot stop newer manual or scheduled Gate`,async()=>{
 const p=await setup(file,48000);try{
  loadTestAdpcm(p);const r=p.rpc({action:'schedule',operations:build(b=>{b.adpcm.keyOn({repeat:true});b.atSeconds(.02).adpcm.keyOff();}),options:{name:'old'},owner:'old'});p.render(r.startFrame+1);
  p.synth.adpcm.keyOn({repeat:true});const n=p.physical.length;p.render(1100);assert(!p.physical.slice(n).some(x=>x.port===1&&x.register===0&&x.value===1));p.rpc({action:'releaseOwner',owner:'old'});assert.equal(p.rpc({action:'capture'}).registers[1][0],0xb0);
  const a=p.rpc({action:'schedule',operations:build(b=>{b.adpcm.keyOn({repeat:true});b.atSeconds(.01).adpcm.keyOff();}),options:{name:'audition'},owner:'audition'});p.render(a.startFrame-p.frame()+1);
  p.processor.opnInspector.invoke('auditionOn',['adpcm-b:0',60,'manual']);const k=p.physical.length;p.render(700);assert(!p.physical.slice(k).some(x=>x.port===1&&x.register===0&&x.value===1));
  p.rpc({action:'schedule',operations:build(b=>b.adpcm.keyOn({repeat:true})),options:{name:'claim'},owner:'new'});p.render(300);const count=p.physical.length;p.processor.opnInspector.invoke('auditionOff',['adpcm-b:0','manual']);assert.equal(p.physical.length,count);
  p.rpc({action:'releaseOwner',owner:'audition'});assert.equal(p.rpc({action:'capture'}).registers[1][0],0xb0);
 }finally{p.close();}
});
for(const rate of [44100,48000])test(`standalone ${rate}: ADPCM mute retains levels/pan, release stays software-only and a newer Gate cancels its tail`,async()=>{
 const p=await setup('../../docs/synth-fm2608/audio_worklet.js',rate);try{
  loadTestAdpcm(p);p.send({type:'synth-fm-ssg-monitor',action:'mute',section:'adpcm',channel:0,value:true});
  p.rpc({action:'schedule',operations:build(b=>{b.adpcm.setVolume(120);b.adpcm.setPan(false,true);b.adpcm.keyOn({repeat:true});}),options:{name:'sample'},owner:'sample'});assert(p.render(800).left.every(x=>x===0));
  let s=p.rpc({action:'capture'});assert.equal(s.registers[1][11],0);assert.equal(s.adpcmRegisters[11],120);assert.equal(s.adpcmRegisters[1],0x42);
  p.send({type:'synth-fm-ssg-monitor',action:'mute',section:'adpcm',channel:0,value:false});assert(p.render(300).right.some(x=>Math.abs(x)>.001));
  p.send({type:'synth-adpcm-release',action:'release',owner:'keyboard'});p.render(100);s=p.rpc({action:'capture'});assert(s.registers[1][11]<120);assert.equal(s.adpcmRegisters[11],120);
  p.rpc({action:'schedule',operations:build(b=>b.adpcm.keyOn({repeat:true})),options:{name:'new'},owner:'new'});p.render(900);s=p.rpc({action:'capture'});assert.equal(s.registers[1][0],0xb0);assert.equal(s.registers[1][11],120);assert.equal(p.processor.adpcmRelease.getState().active,false);
  p.rpc({action:'releaseOwner',owner:'sample'});assert.equal(p.rpc({action:'capture'}).registers[1][0],0xb0);p.rpc({action:'releaseOwner',owner:'new'});assert.equal(p.rpc({action:'capture'}).registers[1][0],1);
 }finally{p.close();}
});

for(const rate of [44100,48000])test(`standalone ${rate}: immediate ADPCM and keyboard release PCM match authenticated pre-ADPCM scheduling source`,async()=>{
 const {readYm2608AdpcmPredecessor}=await import('../../scripts/mixer_calibration_ym2608_adpcm_revision.mjs');
 const file='../../docs/synth-fm2608/audio_worklet.js';const old=await setup(file,rate,readYm2608AdpcmPredecessor('docs/synth-fm2608/audio_worklet.js')),current=await setup(file,rate);
 try{
  for(const p of [old,current]){loadTestAdpcm(p);p.synth.adpcm.keyOn({repeat:true});}
  let a=old.render(1024),b=current.render(1024);assert.deepEqual(a.left,b.left);assert.deepEqual(a.right,b.right);
  for(const p of [old,current])p.send({type:'synth-adpcm-release',action:'release',owner:'keyboard-parity'});
  a=old.render(1024);b=current.render(1024);assert.deepEqual(a.left,b.left);assert.deepEqual(a.right,b.right);assert.equal(current.rpc({action:'capture'}).registers[1][0],1);
 }finally{old.close();current.close();}
});
