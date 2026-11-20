// SPDX-License-Identifier: BSD-3-Clause
// Exercise the actual Synth processor/instrument with native WASM, without an
// AudioContext, a copied processor implementation or physical output.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import factory from '../../tetorica_src/runtime/generated/gameboy_apu_wasm.js';
import {GameboyApu} from '../../tetorica_src/runtime/gameboyapu.js';
import {createProcessorPerformance} from '../../tetorica_src/runtime/playground_performance_processor.js';
import {createGameboyTimedProcessor,gameboyTimedCommandCost} from '../../tetorica_src/runtime/gameboy_timed_processor.js';
import {buildGameboyOperations as build,compileGameboyOperations as compile} from '../../tetorica_src/runtime/gameboy_operations.js';
import {attachGameboyTimedClient} from '../../tetorica_src/runtime/gameboy_timed_client.js';
import {validateGameboyTimedSnapshot} from '../../tetorica_src/runtime/gameboy_timed_state.js';
import {GameboyInstrument} from './instrument.js';
import {createDefaultPreset,readPreset,waveShape} from './preset.js';

const source=await readFile(new URL('./processor.js',import.meta.url),'utf8');
const wasmBinary=await readFile(new URL('../../tetorica_src/runtime/generated/gameboy_apu_wasm.wasm',import.meta.url));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const raw=rows=>rows.map(({register,value})=>({register,value}));
const fatals=fixture=>fixture.messages.filter(message=>message.fatal).map(({fatal,error})=>({fatal,error}));
async function fixture(t,{rate=44100}={}){
  let Constructor,processor,core,rendered=0,nextId=0;
  const messages=[],writes=[];
  class HostProcessor{constructor(){this.port={postMessage:value=>messages.push(value)};}}
  vm.runInNewContext(source.replace(/^import .*;\n/gm,''),{
    AudioWorkletProcessor:HostProcessor,GameboyInstrument,createProcessorPerformance,
    createGameboyTimedProcessor,gameboyTimedCommandCost,factory,sampleRate:rate,Set,
    GameboyApu:{async create(options){
      core=await GameboyApu.create(options);
      const write=core.writeRegister.bind(core),generate=core.generateStereo.bind(core);
      core.writeRegister=(register,value)=>{
        if(!processor?.instrument?.silentRegisterWrites)writes.push({frame:rendered,register,value});
        return write(register,value);
      };
      core.generateStereo=frames=>{const result=generate(frames);rendered+=frames;return result;};
      return core;
    }},
    registerProcessor(name,value){assert.equal(name,'tetorica-gameboy-synth');Constructor=value;},
  });
  processor=new Constructor({processorOptions:{wasmBinary}});await processor.ready;
  assert.equal(messages.find(message=>message.ready)?.ready,true,JSON.stringify(messages));
  t.after(()=>processor.dispose());
  const send=(method,args=[])=>{const id=++nextId;processor.receive({id,method,args});return id;};
  function reply(id){const result=messages.find(message=>message.id===id);assert(result,'Missing RPC response '+id);return result;}
  async function rpc(method,args=[]){const id=send(method,args);await processor.commands;const result=reply(id);
    if(result.error){const error=new Error(result.error);error.name=result.name??'Error';throw error;}return result.value;}
  const code=async(method,args=[])=>rpc('code',[session,method,args]);
  const timed=payload=>rpc('codeTimed',[session,payload]);
  const begin=await rpc('beginCode'),session=begin.session;writes.length=0;
  function render(frames,chunk=128){
    const left=new Float32Array(frames),right=new Float32Array(frames);
    for(let offset=0;offset<frames;offset+=chunk){const count=Math.min(chunk,frames-offset),out=[left.subarray(offset,offset+count),right.subarray(offset,offset+count)];
      assert.equal(processor.process([], [out]),true);}
    assert(left.every(Number.isFinite)&&right.every(Number.isFinite));return{left,right};
  }
  return {processor,messages,writes,session,begin,send,reply,rpc,code,timed,render,get core(){return core;},get frame(){return rendered;},
    state:()=>processor.instrument.synth._getState(),
    schedule:(operations,options={name:'pattern'})=>timed({action:'schedule',operations,options}),
  };
}

for(const rate of [44100,48000])test(`real Synth timed writes match compile with reference-sample timing at ${rate} Hz`,async t=>{
  const f=await fixture(t,{rate}),baseline=f.state();
  const plan=build(b=>{
    b.atSample(0).pulse.setEnvelope(0,{volume:11,period:0});
    b.pulse.noteOn(0,'A3').pulse.keyOn(0);
    b.atSample(137).pulse.setSweep({period:0,shift:0});
    b.atSeconds(.01).pulse.keyOff(0);
  });
  const expected=compile(plan,baseline),receipt=await f.schedule(plan);
  assert.equal(receipt.startFrame,128);assert.equal(f.writes.length,0,'admission produces no live writes');
  const pcm=f.render(1000);assert(pcm.left.some(value=>Math.abs(value)>1e-5));
  assert.deepEqual(raw(f.writes),raw(expected));
  for(const [index,write]of f.writes.entries())assert.equal(write.frame,receipt.startFrame+Math.round(expected[index].offsetSeconds*rate));
  assert.equal(f.state().registers[2],0);assert.equal(f.state().voice[2],0xb0,'Key Off preserves configured envelope');
  assert(!f.messages.some(message=>message.fatal||message.type==='gameboy-timed-error'));
});

test('Wave upload keeps one bounded DAC-off batch, then explicit scheduled retriggers preserve configured Wave level',async t=>{
  const f=await fixture(t,{rate:48000}),samples=Array.from({length:32},(_,index)=>index%16);
  await f.code('wave.noteOn',['C4']);f.render(200);f.writes.length=0;
  const baseline=f.state(),plan=build(b=>{b.wave.setWaveform(samples);b.wave.setLevel(.25);b.atSample(3).wave.noteOn('E4');b.wave.keyOn();b.atSample(80).wave.keyOff();});
  const expected=compile(plan,baseline),receipt=await f.schedule(plan);f.render(400);
  assert.deepEqual(raw(f.writes),raw(expected));assert.equal(f.writes[0].register,10);assert.equal(f.writes[0].value&128,0);
  assert(f.writes.slice(0,17).every(write=>write.frame===receipt.startFrame));
  assert.deepEqual(f.state().registers.slice(32),samples.filter((_,i)=>i%2===0).map((value,i)=>(value<<4)|samples[2*i+1]));
  assert.equal(f.state().registers[10]&128,0);assert.equal(f.state().voice[12]&0x60,0x60);
});

test('a later manual key owns its Gate and neither an old scheduled Off nor cancellation releases it',async t=>{
  for(const cancel of [false,true]){
    const f=await fixture(t),owner='loop:old';
    await f.timed({action:'schedule',owner,operations:build(b=>{b.pulse.noteOn(0,'A3');b.atSample(200).pulse.keyOff(0);}),options:{name:'old'}});
    f.render(129);assert(f.state().registers[2]);
    await f.rpc('noteOn',['manual-new',64,{channel:0}]);const held=f.processor.instrument.read().voices;
    f.writes.length=0;
    if(cancel)await f.timed({action:'cancelOwner',owner});
    const pcm=f.render(600);assert(pcm.left.some(value=>Math.abs(value)>1e-5));
    assert.equal(f.state().registers[2],0xa0);assert.deepEqual(f.processor.instrument.read().voices,held);
    assert(!f.writes.some(write=>write.register===2&&write.value===0));
    assert.equal(await f.rpc('noteOff',['manual-new']),true);
  }
});

test('virtual checkpoint preparation retains reservation Gate ownership while sparse live edits keep the next Off valid',async t=>{
  const f=await fixture(t);
  await f.schedule(build(b=>{b.pulse.noteOn(0,'A3');b.atSample(500).pulse.keyOff(0);}));
  f.render(129);assert(f.state().registers[2]);const owner=f.processor.codeOwner;
  const author=readPreset(f.processor.instrument.preset);author.name='Accepted live duty';author.pulse.duty=.25;
  f.writes.length=0;
  await f.rpc('applyCodePreset',[f.session,author,{replace:false}]);
  assert.equal(f.processor.codeOwner,owner);assert.deepEqual(raw(f.writes),[{register:1,value:0x40},{register:6,value:0x40}]);
  f.render(600);assert.equal(f.state().registers[2],0,'virtual Gate Offs used to prepare Stop must not discard the live reservation');
  assert.equal(f.processor.instrument.codeCheckpoint.synth.voice[1]>>6,1);
});

test('invalid admission/stage leaves the existing repeating reservation and valid staged transaction intact',async t=>{
  const f=await fixture(t),owner='loop:atomic';
  await f.timed({action:'schedule',owner,operations:build(b=>b.pulse.noteOn(0,'A3')),options:{name:'motion',repeatSeconds:.01}});
  f.render(130);const before=f.processor.performance.getStats();
  const invalid=build(b=>b.pulse.setEnvelope(0,{volume:16}));
  await assert.rejects(f.timed({action:'schedule',owner,operations:invalid,options:{name:'motion',repeatSeconds:.01}}),/integer/);
  assert.equal(f.processor.performance.getStats().patternCount,before.patternCount);
  const good=build(b=>b.pulse.noteOn(1,'C4'));
  const staged=await f.timed({action:'stage',transactionId:9,owner,method:'schedule',args:[good,{name:'motion',repeatSeconds:.01}]});
  assert.equal(staged.staged,true);const stageWrites=f.writes.length;
  await assert.rejects(f.timed({action:'stage',transactionId:9,owner,method:'schedule',args:[invalid,{name:'motion',repeatSeconds:.01}]}),/integer/);
  assert.equal(f.writes.length,stageWrites,'staging performs no chip writes');
  const commit=await f.timed({action:'commit',transactionId:9,owner});assert(commit.reservations.some(reservation=>reservation.name==='motion'));
  f.writes.length=0;f.render(1400);
  assert(f.writes.some(write=>write.register===9&&(write.value&128)),'last valid staged CH2 program was committed');
  assert(!f.writes.some(write=>write.register===4&&(write.value&128)),'old CH1 repeating reservation was replaced');
  assert.equal(f.processor.performance.getStats().patternCount,1);
});

test('Stop preempts pending Code RPC, clears reservations and restores the latest accepted sound bank and Wave',async t=>{
  const f=await fixture(t),author=createDefaultPreset();author.name='Accepted triangle';author.pulse.duty=.25;author.wave.samples=waveShape('triangle');
  await f.rpc('applyCodePreset',[f.session,author,{replace:false}]);
  const acceptedBank=structuredClone(f.processor.instrument.channelPresets),acceptedWave=f.state().registers.slice(32);
  await f.schedule(build(b=>{b.wave.setWaveform(Array(32).fill(15));b.pulse.noteOn(0,'A3');b.atSeconds(.1).pulse.keyOn(0);}),{name:'retire',repeatSeconds:.2});
  f.render(129);assert.notDeepEqual(f.state().registers.slice(32),acceptedWave);
  const captured=await f.timed({action:'capture'}),original=f.processor.instrument.code.bind(f.processor.instrument);
  let finish;
  f.processor.instrument.code=(session,method,args)=>method==='pulse.setFrequency'?new Promise(resolve=>finish=resolve):original(session,method,args);
  const pending=f.send('code',[f.session,'pulse.setFrequency',[0,660]]);await tick();assert.equal(typeof finish,'function');
  const stopped=f.send('stop');assert.equal(f.processor.codeOwner,null);assert.equal(f.processor.performance.getStats().patternCount,0);
  assert.equal(f.processor.instrument.codeActive,false);assert.deepEqual(f.state().registers.slice(32),acceptedWave);
  assert.deepEqual(f.processor.instrument.channelPresets,acceptedBank);
  finish(660);await f.processor.commands;assert.equal(f.reply(pending).name,'AbortError');assert(!f.reply(stopped).error);
  f.writes.length=0;f.render(22050);assert.deepEqual(f.writes,[],'retired reservations cannot write after Stop');
  const newer=await f.rpc('beginCode');assert(newer.session>f.session);
  assert.throws(()=>validateGameboyTimedSnapshot(captured,{instanceId:newer.instanceId,clock:4194304}),/instance/);
  await assert.rejects(f.timed({action:'capture'}),{name:'AbortError'});
});

test('borrowed-client current/snapshot compiles are detached while client shadow absence rejects without RPC',async t=>{
  const f=await fixture(t),calls=[];
  const api=attachGameboyTimedClient({clock:4194304,isCurrent:()=>f.processor.codeOwner?.session===f.session,
    _requestControl:async(method,args)=>{calls.push(method);assert.equal(method,'gameboyTimed');return f.timed(args[0]);}},
    {instanceId:f.begin.instanceId});
  const plan=api.build(b=>b.pulse.setEnvelope(0,{period:3}));
  await assert.rejects(api.compile(plan,{initialState:'client'}),/Incomplete/);assert.deepEqual(calls,[]);
  assert.deepEqual(raw(await api.compile(api.build(b=>b.writeRegister(20,7)),{initialState:'reset'})),[{register:20,value:7}]);assert.deepEqual(calls,[]);
  const shot=await api.captureState();assert.equal(calls.length,1);assert.equal(shot.frame,f.frame);
  const initial=await api.compile(plan,{initialState:shot});assert.equal(calls.length,1);assert.equal(initial[0].value,0xa3);
  await f.code('pulse.setEnvelope',[0,{volume:4}]);const current=await api.compile(plan);assert.equal(current[0].value,0x43);
  assert.equal(calls.length,2);assert.equal(shot.state.voice[2],0xa0);assert.equal(f.state().voice[2],0x40,'compilation leaves live period alone');
  assert.deepEqual(await api.compile(plan,{initialState:shot}),initial);assert.equal(calls.length,2);
});

test('Noise Envelope partial updates use the actual interleaved voice, preserve repeated writes and keep raw trigger order',async t=>{
  const f=await fixture(t),plan=build(b=>{
    b.noise.keyOn();
    b.atSample(100).noise.setEnvelope({period:2});b.noise.setEnvelope({period:2});
    b.atSample(150).noise.keyOn();b.noise.keyOn();
    b.atSample(300).noise.keyOff();
  });
  const prediction=compile(plan,f.state()),receipt=await f.schedule(plan);
  await f.code('noise.setEnvelope',[{volume:5}]);f.writes.length=0;
  const pcm=f.render(1000);assert(pcm.left.some(value=>Math.abs(value)>1e-5));
  const repeated=f.writes.filter(write=>write.frame===receipt.startFrame+100);
  assert.deepEqual(raw(repeated),[{register:17,value:0x52},{register:17,value:0x52}]);
  assert.equal(prediction.find(write=>write.operationIndex===1).value,0xa2,'compile is a baseline prediction, not an interleaved playback log');
  assert.equal(f.writes.filter(write=>write.frame===receipt.startFrame+150&&write.register===19&&(write.value&128)).length,2);
  assert.equal(f.state().registers[17],0);assert.equal(f.state().voice[17],0x52);
  assert(!f.messages.some(message=>message.fatal||message.type==='gameboy-timed-error'));
});

test('Stop catches a native timed release fault, retires every lease and disposes WASM despite repeated cleanup faults',async t=>{
  const f=await fixture(t),instrument=f.processor.instrument;
  await f.schedule(build(b=>b.pulse.noteOn(0,'A3')),{name:'held-one-shot'});f.render(129);
  await f.schedule(build(b=>b.atSample(1000).pulse.noteOn(1,'C4')),{name:'queued',repeatSeconds:.1});
  assert.equal(f.processor.performance.getStats().patternCount,1);assert(f.core.handle);
  const write=f.core.writeRegister.bind(f.core);let faults=0;
  f.core.writeRegister=(register,value)=>{
    if(register===2&&value===0){faults++;throw Error('native timed release fault');}
    return write(register,value);
  };
  f.core.loadState=()=>{throw Error('secondary checkpoint restore fault');};
  assert.doesNotThrow(()=>f.send('stop'));
  await f.processor.commands;
  assert(faults>1,'the cleanup path was also forced to fail');
  assert.equal(f.processor.dead,true);assert.equal(f.processor.codeOwner,null);assert.equal(f.processor.instrument,null);
  assert.equal(f.processor.performance.getStats().patternCount,0);assert.equal(f.processor.performance.getStats().queuedCommands,0);
  assert.equal(f.core.handle,0,'native disposal must run even if Instrument/Synth cleanup throws');
  assert.equal(instrument.disposed,true);
  assert.deepEqual(fatals(f),[{fatal:true,error:'native timed release fault'}]);
  const faultCount=faults;assert.doesNotThrow(()=>f.send('stop'));assert.doesNotThrow(()=>f.processor.dispose());
  assert.equal(faults,faultCount);assert.equal(f.messages.filter(message=>message.fatal).length,1);
});

test('clearTimed always clears the Performance Queue and preserves its first error if queue cleanup also throws',async t=>{
  const f=await fixture(t);
  await f.schedule(build(b=>b.atSample(1000).pulse.keyOn(0)),{name:'queued',repeatSeconds:.1});
  const timedClear=f.processor.timed.clear.bind(f.processor.timed),queueClear=f.processor.performance.clear.bind(f.processor.performance);
  let calls=0;
  f.processor.timed.clear=()=>{throw Error('first timed cleanup fault');};
  f.processor.performance.clear=()=>{calls++;queueClear();throw Error('secondary queue cleanup fault');};
  assert.throws(()=>f.processor.clearTimed(),/first timed cleanup fault/);assert.equal(calls,1);
  assert.equal(f.processor.performance.getStats().patternCount,0);
  f.processor.timed.clear=timedClear;f.processor.performance.clear=queueClear;
});

test('render failure silences its output and reports the original error once when teardown also faults',async t=>{
  const f=await fixture(t);
  await f.schedule(build(b=>b.pulse.noteOn(0,'A3')));f.render(129);
  const write=f.core.writeRegister.bind(f.core);
  f.core.writeRegister=(register,value)=>{if(register===2&&value===0)throw Error('secondary teardown write fault');return write(register,value);};
  f.core.generateStereo=()=>{throw Error('original native render fault');};
  const left=new Float32Array(128).fill(7),right=left.slice();
  assert.equal(f.processor.process([],[[left,right]]),false);
  assert(left.every(value=>value===0)&&right.every(value=>value===0));
  assert.equal(f.core.handle,0);assert.equal(f.processor.codeOwner,null);assert.equal(f.processor.instrument,null);
  assert.equal(f.processor.performance.getStats().patternCount,0);
  assert.deepEqual(fatals(f),[{fatal:true,error:'original native render fault'}]);
  assert.doesNotThrow(()=>f.processor.fail(Error('later error')));assert.equal(f.messages.filter(message=>message.fatal).length,1);
});

test('explicit disposal remains quiet and closes the native handle when checkpoint restore and Gate cleanup both fail',async t=>{
  const f=await fixture(t),instrument=f.processor.instrument;
  await f.schedule(build(b=>b.pulse.noteOn(0,'A3')),{name:'loop',repeatSeconds:.1});f.render(129);
  f.core.loadState=()=>{throw Error('checkpoint restore fault');};
  const write=f.core.writeRegister.bind(f.core);
  f.core.writeRegister=(register,value)=>{if(register===2&&value===0)throw Error('Gate cleanup fault');return write(register,value);};
  assert.doesNotThrow(()=>f.processor.dispose());assert.doesNotThrow(()=>f.processor.dispose());
  assert.equal(f.processor.dead,true);assert.equal(f.processor.codeOwner,null);assert.equal(f.processor.instrument,null);
  assert.equal(instrument.disposed,true);assert.equal(instrument.codeActive,false);assert.equal(f.core.handle,0);
  assert.equal(f.processor.performance.getStats().patternCount,0);assert.equal(f.messages.filter(message=>message.fatal).length,0);
});

test('a closed reply port cannot escape or replace the original fatal Stop error',async t=>{
  const f=await fixture(t);
  await f.schedule(build(b=>b.pulse.noteOn(0,'A3')));f.render(129);
  const write=f.core.writeRegister.bind(f.core),post=f.processor.port.postMessage;
  f.core.writeRegister=(register,value)=>{if(register===2&&value===0)throw Error('original Stop fault');return write(register,value);};
  f.processor.port.postMessage=message=>{post(message);if(message.fatal)throw Error('reply port closed');};
  assert.doesNotThrow(()=>f.send('stop'));assert.equal(f.core.handle,0);assert.equal(f.processor.codeOwner,null);
  assert.deepEqual(fatals(f),[{fatal:true,error:'original Stop fault'}]);
});
