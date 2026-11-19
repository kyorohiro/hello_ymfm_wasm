import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../../docs/generated/ps1_spu_wasm.js';
import {Ps1Spu} from '../../tetorica_src/runtime/ps1_spu.js';
import {Ps1Synth,createPs1InitSample} from '../../tetorica_src/runtime/ps1synth.js';
import {buildPs1Operations as build,compilePs1Operations as compile,capturePs1OperationState as capture,createPs1OperationResetState} from '../../tetorica_src/runtime/ps1_operations.js';
import {createPs1TimedSnapshot,validatePs1TimedSnapshot} from '../../tetorica_src/runtime/ps1_timed_state.js';
import {attachPs1TimedClient} from '../../tetorica_src/runtime/ps1_timed_client.js';
import {createPs1TimedProcessor,ps1TimedCommandCost} from '../../tetorica_src/runtime/ps1_timed_processor.js';
import {createProcessorPerformance} from '../../tetorica_src/runtime/playground_performance_processor.js';
import {Ps1Resampler} from '../../tetorica_src/runtime/ps1_resampler.js';
const wasmBinary=await readFile(new URL('../../docs/generated/ps1_spu_wasm.wasm',import.meta.url));
async function setup(rate=44100){
 const core=await Ps1Spu.create({moduleFactory:factory,moduleOptions:{wasmBinary}}),synth=new Ps1Synth({core});
 const {adpcm,...tuning}=createPs1InitSample(),sample=synth.loadADPCM(adpcm,tuning);
 for(let ch=0;ch<24;ch++)synth.setPreset(ch,{sample});
 const writes=[],messages=[],write=core.write.bind(core);let frame=0,eventFrame=0,serial=0,timed;
 core.write=(register,value)=>{writes.push({frame:eventFrame,register,value});write(register,value);};
 const port={postMessage:data=>messages.push(data)};
 const performance=createProcessorPerformance({chip:'ps1',rate,nowFrame:()=>frame,patternCommandCost:ps1TimedCommandCost,
  apply:(command,p,at,metadata)=>{
   if(command.method==='applyPs1TimedOperation'){eventFrame=at??frame;return timed.apply(command.operation,p,at,metadata);}
   return synth[command.method](...command.args);
  }});
 timed=createPs1TimedProcessor({performance,getState:()=>capture(synth),getConfig:()=>({instanceId:'test'}),nowFrame:()=>frame,sampleRate:rate,
  dispatch:(command,p,_at,metadata)=>performance.applyImmediate(command,p,metadata)});
 const resampler=new Ps1Resampler(synth,rate);
 return {synth,core,writes,messages,performance,timed,port,
  request(payload){const id=++serial;timed.receive({id,method:'ps1Timed',args:[payload]},port);const reply=messages.find(row=>row.id===id);if(reply.error)throw Error(reply.error);return reply.value;},
  render(count){for(let offset=0;offset<count;){const n=Math.min(37,count-offset),l=new Float32Array(n),r=new Float32Array(n);performance.render(l,r,(l,r)=>resampler.render(l,r));assert(l.every(Number.isFinite));frame+=n;offset+=n;}},
  close(){performance.clear();synth.dispose();}};
}
for(const rate of [44100,48000])test(`${rate}: actual SPU writes preserve sample offsets, retriggers and compile order`,async t=>{
 const p=await setup(rate);t.after(()=>p.close());
 const plan=build(b=>{b.noteOn(0,'C4');b.atSample(441).setEnvelope(0,{releaseRate:7}).keyOn(0).keyOn(0);b.atSeconds(.02).keyOff(0);});
 const before=capture(p.synth),expected=compile(plan,before);assert.deepEqual(capture(p.synth),before);
 const receipt=p.request({action:'schedule',operations:plan,options:{name:'phrase'}});assert.equal(receipt.startFrame,128);assert.equal(p.writes.length,0);
 p.render(1300);
 assert.deepEqual(p.writes,expected.map(({offsetSeconds,register,value})=>({frame:128+Math.round(offsetSeconds*rate),register,value})));
});
test('partial voice and shared reverb updates preserve intervening manual edits',async t=>{
 const p=await setup();t.after(()=>p.close());
 p.request({action:'schedule',operations:build(b=>b.setEnvelope(0,{releaseRate:4}).setReverb({volumeLeft:.4})),options:{name:'edit'}});
 p.synth.setPreset(0,{volumeRight:.12,adsr1:123});p.synth.setReverb({volumeRight:.8});p.render(129);
 assert.equal(p.synth.channels[0].volumeRight,.12);assert.equal(p.synth.channels[0].adsr1,123);assert.equal(p.synth.reverb.volumeRight,.8);
});
test('invalid replacement is atomic; repeats stay compact and cancel by name',async t=>{
 const p=await setup();t.after(()=>p.close());
 const plan=build(b=>b.keyOn(0));p.request({action:'schedule',operations:plan,options:{name:'repeat',repeatSeconds:.01}});
 const before=p.performance.getStats();assert.throws(()=>p.request({action:'schedule',operations:build(b=>b.setPitch(0,99999)),options:{name:'repeat'}}));
 assert.equal(p.performance.getStats().patternCount,before.patternCount);p.render(1200);assert.equal(p.writes.filter(row=>row.register===0x188).length,3);
 assert.equal(p.request({action:'clear',name:'repeat'}),true);p.writes.length=0;p.render(1000);assert.equal(p.writes.length,0);
});
test('snapshot reuse is detached, instance checked; reset/client compile never use a transport',async t=>{
 const p=await setup();t.after(()=>p.close());let calls=0;
 const api=attachPs1TimedClient({_requestControl:async(_method,[payload])=>{calls++;return p.request(payload);}},{instanceId:'test'});
 const snapshot=await api.captureState(),old=structuredClone(snapshot),plan=api.build(b=>b.setPitch(0,512));
 p.synth.setPitch(0,128);const a=await api.compile(plan,{initialState:snapshot}),b=await api.compile(plan,{initialState:snapshot});
 assert.deepEqual(a,b);assert.deepEqual(snapshot,old);assert.equal(calls,1);
 assert.deepEqual(await api.compile(plan,{initialState:'reset'}),compile(plan,createPs1OperationResetState()));assert.equal(calls,1);
 await assert.rejects(api.compile(plan,{initialState:'client'}),/Incomplete/);assert.equal(calls,1);
 assert.throws(()=>validatePs1TimedSnapshot(snapshot,{instanceId:'other'}),/instance/);
 const current=await api.compile(plan);assert.deepEqual(current,a);assert.equal(calls,2);
});
test('build is synchronous, serializable, state-free and bounds methods/times',()=>{
 let calls=0;const plan=build(b=>{calls++;b.atSeconds(.1).setPitch(0,12);b.atSample(4410).keyOff(0);});
 assert.equal(calls,1);assert.deepEqual(structuredClone(plan),plan);
 assert.throws(()=>build(async b=>b.keyOff(0)),/synchronous/);assert.throws(()=>build(b=>b.atSample(2).atSample(1)),/nondecreasing/);
 assert.throws(()=>build(b=>b.loadADPCM(new Uint8Array(16),{})),TypeError);
});
test('staged schedules apply only at commit and owner cancellation retires repeats',async t=>{
 const p=await setup();t.after(()=>p.close());const args=[build(b=>b.keyOn(0)),{name:'stage',repeatSeconds:.01}];
 p.request({action:'stage',transactionId:'tx',owner:'run',method:'schedule',args});p.render(500);assert.equal(p.writes.length,0);
 p.request({action:'commit',transactionId:'tx',owner:'run'});p.render(600);assert(p.writes.length>0);
 p.request({action:'cancelOwner',owner:'run'});p.writes.length=0;p.render(600);assert.equal(p.writes.length,0);
});

test('Native exposes recording/local reset compilation but rejects unsupported audio scheduling explicitly',async()=>{
 const api=attachPs1TimedClient({}, {native:true});const plan=api.build(b=>b.setPitch(0,12));
 assert.equal((await api.compile(plan,{initialState:'reset'}))[0].value,12);
 await assert.rejects(api.schedule(plan,{name:'native'}),/AudioWorklet/);
 await assert.rejects(api.captureState(),/AudioWorklet/);
});

test('custom reference sample rate is independent of the output device rate',()=>{
 const plan=build(b=>{b.atSample(480).setPitch(0,12);b.atSeconds(.01).setPitch(0,13);},{referenceSampleRate:48000});
 assert.deepEqual(compile(plan,createPs1OperationResetState()).map(row=>row.offsetSeconds),[.01,.01]);
});
