import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {Worker,MessageChannel} from 'node:worker_threads';
import {createPlaygroundRuntime} from '../../tetorica_src/runtime/playground_runtime.js';
import {readFile} from 'node:fs/promises';
import {WonderSwan,WONDERSWAN_CLOCK} from '../../tetorica_src/runtime/wonderswan.js';
import factory from '../../tetorica_src/runtime/generated/wonderswan_wasm.js';
import {createWonderSwanClient,createPrimaryWonderSwanApi} from '../../tetorica_src/runtime/playground_wonderswan.js';
import {createWonderSwanTimedProcessor,wonderswanTimedCommandCost} from '../../tetorica_src/runtime/wonderswan_timed_processor.js';
import {createProcessorPerformance} from '../../tetorica_src/runtime/playground_performance_processor.js';
import {WonderSwanVoiceInspector} from '../../tetorica_src/runtime/playground_wonderswan_inspector.js';
import {ChipClockResampler,validateChipClock} from '../../tetorica_src/runtime/playground_chip_clock.js';
import {receiveChipInspector} from '../../tetorica_src/runtime/playground_chip_inspector_state.js';
import {prepareWonderSwanTimeline,createWonderSwanTimelineCursor} from '../../tetorica_src/runtime/wonderswan_timeline.js';
const source=(await readFile(new URL('../../tetorica_src/runtime/playground_wonderswan_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
const wasmBinary=await readFile(new URL('../../tetorica_src/runtime/generated/wonderswan_wasm.wasm',import.meta.url));
async function setup(t,rate=48000){
 let Processor,frame=0,resolveReady;const messages=[],writes=[];
 const ready=new Promise(resolve=>resolveReady=resolve),port={postMessage:message=>{messages.push(message);if(message.ready||message.error)resolveReady(message);}};
 const scope={WonderSwan,WONDERSWAN_CLOCK,factory,WonderSwanVoiceInspector,ChipClockResampler,validateChipClock,receiveChipInspector,
   prepareWonderSwanTimeline,createWonderSwanTimelineCursor,createWonderSwanTimedProcessor:options=>createWonderSwanTimedProcessor({...options,getState:()=>structuredClone(options.getState())}),wonderswanTimedCommandCost,sampleRate:rate,
   createProcessorPerformance:options=>createProcessorPerformance({...options,rate,nowFrame:()=>frame}),
   AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor(_name,Type){Processor=Type;}};
 Object.defineProperty(scope,'currentFrame',{get:()=>frame});vm.runInNewContext(source,scope);
 const processor=new Processor({processorOptions:{wasmBinary}});assert.equal((await ready).ready,true);
 let applying=false,activeFrame=null;const apply=processor.timed.apply.bind(processor.timed),write=processor.writeRegister.bind(processor);
 processor.timed.apply=(...args)=>{applying=true;activeFrame=args[2];try{return apply(...args);}finally{applying=false;}};
 processor.writeRegister=(register,value,mask,metadata)=>{const result=write(register,value,mask,metadata);if(applying)writes.push({frame:activeFrame,register,value:register===0x90?processor.inspector.registers[16]:value});return result;};
 const link=()=>{const clientPort={start(){},close(){},postMessage(data){processor.receive(data,{postMessage:value=>clientPort.onmessage?.({data:value})});}};return clientPort;};
 const client=createWonderSwanClient(link());client.initialize();
 t.after(()=>{client.dispose();processor.dispose();});
 return {client,processor,messages,writes,link,rate,frame:()=>frame,
   render(count){const left=new Float32Array(count),right=left.slice();for(let i=0;i<count;){const n=Math.min(128,count-i);processor.process([],[[left.subarray(i,i+n),right.subarray(i,i+n)]]);frame+=n;i+=n;}assert(left.every(Number.isFinite));return left;}};
}
for(const rate of [44100,48000])test(`WonderSwan public timed ${rate}: aliases, compile parity, same-time/repeated writes and sample offsets`,async t=>{
 const f=await setup(t,rate),api=createPrimaryWonderSwanApi(f.client);assert(api.build&&api._timedOperations);assert.equal(api.dispose,undefined);
 const plan=api.build(b=>{b.setNote(0,'C4').keyOn(0);b.atSample(441).setNoise({enabled:true,type:2,reset:true});b.setNoise({enabled:true,type:2,reset:true});b.setSweep({enabled:true,step:-1,time:2});b.atSeconds(.02).keyOff(0);});
 const expected=await api.compile(plan),receipt=await api.schedule(plan,{name:'test'});f.writes.length=0;
 f.render(receipt.startFrame+Math.round(rate*.02)+1);
 assert.deepEqual(f.writes.map(({register,value})=>({register,value})),expected.map(({register,value})=>({register,value})));
 const resets=f.writes.filter(row=>row.register===0x8e);assert.equal(resets.length,2);
 // The harness renders quanta; the shared queue splits at the requested frame.
 assert(resets.every(row=>row.value===26&&row.frame===receipt.startFrame+Math.round(rate*.01)));
 assert.equal(f.processor.inspector.registers[16]&1,0);
 assert.throws(()=>api.build(b=>b.noteOn(0,'C4')),/not a function/);
});
test('WonderSwan current/client/reset snapshots are detached; incomplete mirrors and incompatible snapshots reject',async t=>{
 const f=await setup(t),orphan=createWonderSwanClient(f.link());t.after(()=>orphan.dispose());
 const plan=f.client.build(b=>b.setNoise({enabled:true}));
 await assert.rejects(orphan.compile(plan,{initialState:'client'}),/Incomplete/);
 f.processor.inspector.invoke('setNoise',[{enabled:false,type:7}]);
 const snapshot=await f.client.captureState(),before=f.client._getState(),at=f.frame();
 assert.equal((await f.client.compile(plan)).find(w=>w.register===0x8e).value,23);
 assert.equal((await f.client.compile(plan,{initialState:'client'})).find(w=>w.register===0x8e).value,16);
 assert.equal((await f.client.compile(plan,{initialState:'reset'})).find(w=>w.register===0x8e).value,16);
 assert.deepEqual(await f.client.compile(plan,{initialState:snapshot}),await f.client.compile(plan));
 assert.deepEqual(f.client._getState(),before);assert.equal(f.frame(),at);
 f.client.setNoise({enabled:true,type:1});assert.equal(snapshot.state.registers[14],7);
 await assert.rejects(f.client.compile(plan,{initialState:{...snapshot,instanceId:'different'}}),/instance/);
});
test('WonderSwan current-time R90 merging preserves manual gates and invalid replacement is atomic',async t=>{
 const f=await setup(t),plan=f.client.build(b=>b.setNoise({enabled:true,type:3}));
 const receipt=await f.client.schedule(plan,{name:'partial',repeatSeconds:.1});
 f.client.keyOn(0);f.client.setSweep({enabled:true,step:1,time:4});
 await assert.rejects(f.client.schedule(f.client.build(b=>b.setVolume(0,16)),{name:'partial'}));
 assert.equal(f.processor.performance.getStats().patternCount,1);
 f.render(receipt.startFrame+1);assert.equal(f.processor.inspector.registers[16]&0xc1,0xc1);
 await f.client.clearSchedule('partial');assert.equal(f.processor.performance.getStats().patternCount,0);
});
test('WonderSwan raw Gate ownership protects newer Main/Worker notes; one-shot clear releases only its reservation',async t=>{
 const f=await setup(t),worker=createWonderSwanClient(f.link());worker._adoptState(f.client._getState());t.after(()=>worker.dispose());
 const old=f.client.build(b=>{b.keyOn(0);b.atSeconds(.02).keyOff(0);});
 const receipt=await f.client.schedule(old,{name:'old'});f.render(receipt.startFrame+1);
 worker.keyOn(0);f.render(1000);assert.equal(f.processor.inspector.registers[16]&1,1);
 await f.client.clearSchedule('old');assert.equal(f.processor.inspector.registers[16]&1,1);
 const next=await f.client.schedule(f.client.build(b=>b.keyOn(2)),{name:'held'});f.render(next.startFrame+1-f.frame());
 assert.equal(f.processor.performance.getStats().patternCount,0);
 assert.equal(await f.client.clearSchedule('held'),true);assert.equal(f.processor.inspector.registers[16]&4,0);
 assert.equal(f.processor.inspector.registers[16]&1,1);
});
test('WonderSwan timeline playback rejects scheduling; reset clears held one-shots and staged transactions',async t=>{
 const f=await setup(t),timed=f.client._timedOperations,plan=f.client.build(b=>b.keyOn(0));
 const trace=f.client.createTimeline();trace.initialize();trace.setVolume(0,9,9);trace.at(100).keyOn(0);const data=trace.finish(4410);
 await f.client.prepareTimeline(data);const play=f.client.playTimeline();play.catch(()=>{});f.render(128);
 await assert.rejects(f.client.schedule(plan,{name:'conflict'}),/timeline/);
 await f.client.stopTimeline();await assert.rejects(play);
 await timed.stage(1,'test-owner','schedule',[plan,{name:'staged'}]);
 f.client.reset();await timed.commit(1,'test-owner');assert.equal(f.processor.performance.getStats().patternCount,0);
});
test('Native WonderSwan timed adapter permits local authoring but rejects capture and scheduling explicitly',async()=>{
 const {attachWonderSwanTimedClient}=await import('../../tetorica_src/runtime/wonderswan_timed_client.js');
 const api=attachWonderSwanTimedClient({clock:3072000},{native:true});const plan=api.build(b=>b.keyOn(0));
 assert.equal((await api.compile(plan,{initialState:'reset'}))[0].register,0x90);
 await assert.rejects(api.captureState(),/Native/);await assert.rejects(api.schedule(plan,{name:'x'}),/Native/);
});

async function until(predicate){for(let i=0;i<1000;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}assert.fail("Async boundary timed out");}
test('Main Playground primary facade commits and aborts entry transactions through the shared lifecycle',async t=>{
 const p=await setup(t),oldWindow=globalThis.window,media=()=>({stop(){},stopAll(){},pause(){},list:()=>[],unload(){}});
 globalThis.window={addEventListener(){},removeEventListener(){},setTimeout};
 const megaDrive={capabilities:{chip:'wonderswan',fmChannels:0,dac:false,psg:false},state:'idle',audioContext:{currentTime:0},fm:{setPreset(){},noteOff(){}},psg:{},sample:media(),stream:media(),clearFXChain:()=>[],
 primaryEndpoints:[{name:'wonderswan',globalName:'ws',client:p.client,node:{port:{postMessage(){}}}}],async start(){this.state='ready';},async resume(){},async close(){},stopAllNative(){}};
 const runtime=createPlaygroundRuntime({megaDrive,guardExecution:false});
 try{
 const code=level=>`const chip=await useSoundChip('wonderswan');await chip.schedule(chip.build(b=>b.setVolume(0,${level}).keyOn(0)),{name:'entry',repeatSeconds:.02});`;
 await runtime.playSource(code(9));p.render(200);assert.equal(p.processor.inspector.registers[8],0x99);assert.equal(runtime.getState().playback,'running');
 await assert.rejects(runtime.playSource(code(5)+`throw Error('failed Apply');`),/failed Apply/);p.render(1200);assert.equal(p.processor.inspector.registers[8],0x99);
 await runtime.playSource(code(11));p.render(200);assert.equal(p.processor.inspector.registers[8],0xbb);
 }finally{runtime.stop();globalThis.window=oldWindow;p.processor.dispose();}
});

test('production Worker sends timed RPCs with performance context and keeps reservations on failed Apply',async t=>{
 const p=await setup(t),messages=[],commands=[],channel=new MessageChannel();
 const workerUrl=new URL('../../tetorica_src/runtime/playground_logic_worker.js',import.meta.url).href;
 const worker=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=(m,t)=>parentPort.postMessage(m,t);import(${JSON.stringify(workerUrl)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({readyForTest:true});});`,{eval:true});
 t.after(async()=>{channel.port1.close();channel.port2.close();await worker.terminate();p.processor.dispose();});
 worker.on('message',message=>messages.push(message));worker.on('error',error=>messages.push({error}));
 channel.port1.on('message',data=>{commands.push(data);p.processor.receive(data,{postMessage:reply=>channel.port1.postMessage(reply)});});
 await until(()=>messages.some(m=>m.readyForTest));
 p.processor.receive({type:'performance-start',session:1});
 worker.postMessage({type:'native-primary-ports',endpoints:[{id:'wonderswan',name:'wonderswan',globalName:'ws',clock:WONDERSWAN_CLOCK,state:p.client._getState(),instanceId:(await p.client.captureState()).instanceId,port:channel.port2}]},[channel.port2]);
 const run=async sourceCode=>{const start=messages.length;worker.postMessage({type:'run',sourceCode,capabilities:{chip:'wonderswan',fmChannels:0,dac:false,psg:false},performance:{session:1,audioSeconds:p.frame()/p.rate,performanceEpochMs:performance.timeOrigin+performance.now(),lookaheadSeconds:.1}});await until(()=>messages.slice(start).some(m=>m.type==='complete'||m.type==='execution-error'||m.error));return messages.slice(start).find(m=>m.type==='complete'||m.type==='execution-error'||m.error);};
 const code=level=>`const chip=await useSoundChip('wonderswan');await chip.schedule(chip.build(b=>b.setVolume(0,${level}).keyOn(0)),{name:'worker',repeatSeconds:.02});`;
 let result=await run(code(9));assert.equal(result.type,'complete',JSON.stringify(result));assert.equal(result.scheduledReservationCount,1);p.render(12000);assert.equal(p.processor.inspector.registers[8],0x99);
 result=await run(code(5)+`throw Error('failed Worker Apply');`);assert.equal(result.type,'execution-error');assert.equal(result.scheduledReservationCount,1);p.render(12000);assert.equal(p.processor.inspector.registers[8],0x99);
 assert(commands.filter(c=>c.method==='wonderswanTimed').every(c=>c.timedPerformance?.owner==='script'));
 worker.postMessage({type:'stop'});await until(()=>messages.some(m=>m.type==='stopped'));p.render(12000);assert.equal(p.processor.inspector.registers[16]&1,0);assert.equal(p.processor.performance.getStats().patternCount,0);
});


test('queued initialize/reset clears old patterns but retains ordinary following writes and later reservations',async t=>{
 const f=await setup(t);f.processor.receive({type:'performance-start',session:1});
 const old=await f.client.schedule(f.client.build(b=>b.keyOn(2)),{name:'old',repeatSeconds:.1});
 f.render(old.startFrame+1);assert.equal(f.processor.inspector.registers[16]&4,4);
 f.processor.receive({performance:{session:1,owner:'script',time:(f.frame()+128)/f.rate},commands:[
  {method:'reset',args:[]},{method:'writeRegister',args:[0x88,0x98]},
  {method:'writeRegister',args:[0x90,1],controlMask:1},
 ]});
 assert.equal(f.processor.performance.getStats().patternCount,0);
 const next=await f.client.schedule(f.client.build(b=>b.keyOn(2)),{name:'new'});
 f.render(next.startFrame+1-f.frame());
 assert.equal(f.processor.inspector.registers[8],0x98,'normal writes after reset were not discarded');
 assert.equal(f.processor.inspector.registers[16]&5,5,'a reservation admitted after the reset request survives');
 await f.client.clearSchedule('new');assert.equal(f.processor.inspector.registers[16]&5,1);
});
