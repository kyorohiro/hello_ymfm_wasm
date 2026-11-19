import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Worker,MessageChannel} from 'node:worker_threads';
import vm from 'node:vm';
import {Huc6280Synth,HUC6280_CLOCK} from '../../tetorica_src/runtime/huc6280synth.js';
import {Huc6280AudioEngine} from '../../tetorica_src/runtime/huc6280audioengine.js';
import factory from '../../tetorica_src/runtime/generated/huc6280_wasm.js';
import {createHuc6280Client,createPrimaryHuc6280Api} from '../../tetorica_src/runtime/playground_huc6280.js';
import {createHuc6280TimedProcessor,huc6280TimedCommandCost} from '../../tetorica_src/runtime/huc6280_timed_processor.js';
import {validateHuc6280RegisterOnlyPlan} from '../../tetorica_src/runtime/huc6280_operations.js';
import {createProcessorPerformance} from '../../tetorica_src/runtime/playground_performance_processor.js';
import {Huc6280VoiceInspector} from '../../tetorica_src/runtime/playground_huc6280_inspector.js';
import {receiveChipInspector} from '../../tetorica_src/runtime/playground_chip_inspector_state.js';
import {ChipClockResampler,validateChipClock} from '../../tetorica_src/runtime/playground_chip_clock.js';
import {createPlaygroundRuntime} from '../../tetorica_src/runtime/playground_runtime.js';
const source=(await readFile(new URL('../../tetorica_src/runtime/playground_huc6280_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
const wasmBinary=await readFile(new URL('../../tetorica_src/runtime/generated/huc6280_wasm.wasm',import.meta.url));
async function until(predicate){for(let i=0;i<1000;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}assert.fail('Async boundary timed out');}
async function setup(rate=48000){
 let Processor,frame=0,ready;const messages=[],writes=[];
 const started=new Promise(resolve=>ready=resolve),port={postMessage(value){messages.push(value);if(value.ready||value.error)ready(value);}};
 vm.runInNewContext(source,{Huc6280Synth,HUC6280_CLOCK,Huc6280AudioEngine,factory,Huc6280VoiceInspector,receiveChipInspector,
  createHuc6280TimedProcessor,huc6280TimedCommandCost,validateHuc6280RegisterOnlyPlan,ChipClockResampler,validateChipClock,sampleRate:rate,
  createProcessorPerformance:options=>createProcessorPerformance({...options,rate,nowFrame:()=>frame}),
  AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor(_name,Type){Processor=Type;}});
 const processor=new Processor({processorOptions:{wasmBinary,instanceId:'huc-playground-test'}});assert.equal((await started).ready,true);
 let activeFrame=null;const apply=processor.timed.apply.bind(processor.timed),write=processor.write.bind(processor);
 processor.timed.apply=(op,p,f,m)=>{activeFrame=f;try{return apply(op,p,f,m);}finally{activeFrame=null;}};
 processor.write=(register,value)=>{if(activeFrame!==null)writes.push({frame:activeFrame,register,value});return write(register,value);};
 // Each mock port owns its own ACK/error channel, just as Main/Worker ports do.
 const link=()=>{const remote={start(){},close(){},postMessage(data){processor.receive(data,{postMessage:reply=>remote.onmessage?.({data:reply})});}};return remote;};
 const client=createHuc6280Client(link(),{instanceId:'huc-playground-test'});client.initialize();
 return {processor,client,messages,writes,link,rate,frame:()=>frame,
  render(count,partition=128){const left=new Float32Array(count),right=new Float32Array(count);for(let offset=0;offset<count;){const n=Math.min(partition,count-offset);processor.process([],[[left.subarray(offset,offset+n),right.subarray(offset,offset+n)]]);frame+=n;offset+=n;}assert(left.every(Number.isFinite));return left;},
  close(){client.dispose();processor.dispose();}};
}
for(const rate of [44100,48000])test(`Playground ${rate}: primary aliases, compile parity and repeated writes run on native WASM`,async()=>{
 const p=await setup(rate);try{
 const api=createPrimaryHuc6280Api(p.client);assert(api.build&&api._timedOperations);assert.equal(api.dispose,undefined);
 const plan=api.build(b=>{b.noteOn(0,'C4');b.atSample(2205).setVolume(0,8).setLfo({frequency:0,depth:0,reset:true}).setLfo({frequency:0,depth:0,reset:true});b.atSeconds(.1).noteOff(0);});
 const expected=await api.compile(plan),receipt=await api.schedule(plan,{name:'parity'});
 const pcm=p.render(Math.ceil(rate*.11)+128,37);assert(pcm.some(v=>v!==0));
 assert.deepEqual(p.writes,expected.map(({offsetSeconds,register,value})=>({frame:receipt.startFrame+Math.round(offsetSeconds*rate),register,value})));
 }finally{p.close();}
});

test('current/client/reset/reused baselines stay separate; captures do not advance sound or local state',async()=>{
 const p=await setup();try{
 p.client.setDda(0,true);p.client.setVolume(0,9);
 p.processor.inspector.invoke('setVoice',[0,{volume:19,dda:false}]);
 const plan=p.client.build(b=>b.setVolume(0,7)),before=p.client._getState(),frame=p.frame();
 const a=await p.client.compile(plan),b=await p.client.compile(plan,{initialState:'client'}),reset=await p.client.compile(plan,{initialState:'reset'}),snapshot=await p.client.captureState();
 assert.equal(a.at(-1).value,7);assert.equal(b.at(-1).value,64|7);assert.equal(reset.at(-1).value,7);
 assert.deepEqual(await p.client.compile(plan,{initialState:snapshot}),a);assert.deepEqual(p.client._getState(),before);assert.equal(p.frame(),frame);
 await p.client.setClock(4000000);await assert.rejects(p.client.compile(plan,{initialState:snapshot}),/clock/);
 const notes=p.client.build(b=>b.setNote(0,'C4')),rows=await p.client.compile(notes);const accepted=await p.client.schedule(notes,{name:'clock'});p.writes.length=0;p.render(129);
 assert.deepEqual(p.writes,rows.map(({register,value})=>({register,value,frame:accepted.startFrame})));
 }finally{p.close();}
});

test('live partial updates, invalid replacement, cancellation and execution-time DDA checks preserve other patterns',async()=>{
 const p=await setup();try{
 const plan=p.client.build(b=>b.setVolume(0,11));await p.client.schedule(plan,{name:'partial'});p.client.setDda(0,true);p.client.keyOn(0);p.render(129);assert.equal((await p.client.captureState()).state.registers[0][4],0xc0|11);
 const dac=p.client.build(b=>b.writeRegister(0,0).atSeconds(.01).writeRegister(6,21));
 await p.client.schedule(dac,{name:'dac',repeatSeconds:.02});await assert.rejects(p.client.schedule(p.client.build(b=>b.setVolume(0,40)),{name:'dac'}));
 p.client.setDda(0,false);const diagnostics=[];p.client._timedOperations.onError(error=>diagnostics.push(error));
 // Mock direct-port errors are delivered on the reservation's reply channel.
 p.render(1200);assert.equal(diagnostics.length,1);assert.match(diagnostics[0].message,/Wave RAM/);
 await p.client.schedule(plan,{name:'repeat',repeatSeconds:.01});assert.equal(await p.client.clearSchedule('repeat'),true);
 p.processor.receive({type:'performance-stop',session:p.processor.performance.getStats().activeSession});p.writes.length=0;p.render(1000);assert.equal(p.writes.length,0);
 }finally{p.close();}
});

test('Native refuses live scheduling/capture explicitly and retains offline build/client/reset compilation',async()=>{
 const sent=[],port={postMessage:data=>sent.push(data),close(){}};
 const client=createHuc6280Client(port,{native:true});try{
 const plan=client.build(b=>b.setVolume(0,7));await assert.rejects(client.compile(plan,{initialState:'client'}),/Incomplete/);
 client.initialize();const n=sent.length;assert((await client.compile(plan,{initialState:'client'})).length);assert((await client.compile(plan,{initialState:'reset'})).length);assert.equal(sent.length,n);
 await assert.rejects(client.schedule(plan,{name:'unsupported'}),/Native is not supported/);await assert.rejects(client.captureState(),/Native is not supported/);assert.equal(sent.length,n);
 }finally{client.dispose();}
});

test('Main Playground primary facade commits and aborts entry transactions through the shared lifecycle',async t=>{
 const p=await setup(),oldWindow=globalThis.window,media=()=>({stop(){},stopAll(){},pause(){},list:()=>[],unload(){}});
 globalThis.window={addEventListener(){},removeEventListener(){},setTimeout};
 const megaDrive={capabilities:{chip:'huc6280',fmChannels:0,dac:false,psg:false},state:'idle',audioContext:{currentTime:0},fm:{setPreset(){},noteOff(){}},psg:{},sample:media(),stream:media(),clearFXChain:()=>[],
 primaryEndpoints:[{name:'huc6280',globalName:'pce',client:p.client,node:{port:{postMessage(){}}}}],async start(){this.state='ready';},async resume(){},async close(){},stopAllNative(){}};
 const runtime=createPlaygroundRuntime({megaDrive,guardExecution:false});
 try{
 const code=level=>`const chip=await useSoundChip('huc6280');await chip.schedule(chip.build(b=>b.setVolume(0,${level}).keyOn(0)),{name:'entry',repeatSeconds:.02});`;
 await runtime.playSource(code(9));p.render(200);assert.equal(p.processor.applied._getState().registers[0][4],128|9);assert.equal(runtime.getState().playback,'running');
 await assert.rejects(runtime.playSource(code(19)+`throw Error('failed Apply');`),/failed Apply/);p.render(1200);assert.equal(p.processor.applied._getState().registers[0][4],128|9);
 await runtime.playSource(code(17));p.render(200);assert.equal(p.processor.applied._getState().registers[0][4],128|17);
 }finally{runtime.stop();globalThis.window=oldWindow;p.close();}
});

test('production Worker sends timed RPCs with performance context and keeps reservations on failed Apply',async t=>{
 const p=await setup(),messages=[],commands=[],channel=new MessageChannel();
 const workerUrl=new URL('../../tetorica_src/runtime/playground_logic_worker.js',import.meta.url).href;
 const worker=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=(m,t)=>parentPort.postMessage(m,t);import(${JSON.stringify(workerUrl)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({readyForTest:true});});`,{eval:true});
 t.after(async()=>{channel.port1.close();channel.port2.close();await worker.terminate();p.close();});
 worker.on('message',message=>messages.push(message));worker.on('error',error=>messages.push({error}));
 channel.port1.on('message',data=>{commands.push(data);p.processor.receive(data,{postMessage:reply=>channel.port1.postMessage(reply)});});
 await until(()=>messages.some(m=>m.readyForTest));
 p.processor.receive({type:'performance-start',session:1});
 worker.postMessage({type:'native-primary-ports',endpoints:[{id:'huc6280',name:'huc6280',globalName:'pce',clock:HUC6280_CLOCK,state:p.client._getState(),instanceId:'huc-playground-test',port:channel.port2}]},[channel.port2]);
 const run=async sourceCode=>{const start=messages.length;worker.postMessage({type:'run',sourceCode,capabilities:{chip:'huc6280',fmChannels:0,dac:false,psg:false},performance:{session:1,audioSeconds:p.frame()/p.rate,performanceEpochMs:performance.timeOrigin+performance.now(),lookaheadSeconds:.1}});await until(()=>messages.slice(start).some(m=>m.type==='complete'||m.type==='execution-error'||m.error));return messages.slice(start).find(m=>m.type==='complete'||m.type==='execution-error'||m.error);};
 const code=level=>`const chip=await useSoundChip('huc6280');await chip.schedule(chip.build(b=>b.setVolume(0,${level}).keyOn(0)),{name:'worker',repeatSeconds:.02});`;
 let result=await run(code(9));assert.equal(result.type,'complete',JSON.stringify(result));assert.equal(result.scheduledReservationCount,1);p.render(12000);assert.equal(p.processor.applied._getState().registers[0][4],128|9);
 result=await run(code(19)+`throw Error('failed Worker Apply');`);assert.equal(result.type,'execution-error');assert.equal(result.scheduledReservationCount,1);p.render(12000);assert.equal(p.processor.applied._getState().registers[0][4],128|9);
 assert(commands.filter(c=>c.method==='huc6280Timed').every(c=>c.timedPerformance?.owner==='script'));
 worker.postMessage({type:'stop'});await until(()=>messages.some(m=>m.type==='stopped'));p.render(12000);assert.equal(p.processor.applied._getState().registers[0][4]&128,0);assert.equal(p.processor.performance.getStats().patternCount,0);
});

test('served HuC6280 clients/worklets preserve generated-WASM paths and canonical runtime behavior',async()=>{
 const normalize=text=>text.replace(/\?v=[^'"\s)]+/g,'').replaceAll("'../generated/","'./generated/");
 for(const file of ['playground_huc6280.js','playground_huc6280_worklet.js','playground_performance_sender.js']){
 const [canonical,served]=await Promise.all(['tetorica_src/runtime/','docs/js/'].map(base=>readFile(new URL('../../'+base+file,import.meta.url),'utf8')));
 assert.equal(normalize(served),normalize(canonical),file);
 }
 const worklet=await readFile(new URL('../../docs/js/playground_huc6280_worklet.js',import.meta.url),'utf8');
 assert.match(worklet,/from '\.\.\/generated\/huc6280_wasm\.js'/);
});
