import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {GameboyApu} from '../../tetorica_src/runtime/gameboyapu.js';
import factory from '../../tetorica_src/runtime/generated/gameboy_apu_wasm.js';
import {createGameboyClient,createPrimaryGameboyApi} from '../../tetorica_src/runtime/playground_gameboy.js';
import {createGameboyTimedProcessor,gameboyTimedCommandCost} from '../../tetorica_src/runtime/gameboy_timed_processor.js';
import {createProcessorPerformance} from '../../tetorica_src/runtime/playground_performance_processor.js';
import {GameboyVoiceInspector} from '../../tetorica_src/runtime/playground_native_voice_inspector.js';
import {ChipClockResampler,CHIP_CLOCKS,validateChipClock} from '../../tetorica_src/runtime/playground_chip_clock.js';
import {receiveChipInspector} from '../../tetorica_src/runtime/playground_chip_inspector_state.js';
const source=(await readFile(new URL('../../tetorica_src/runtime/playground_gameboy_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
const wasmBinary=await readFile(new URL('../../tetorica_src/runtime/generated/gameboy_apu_wasm.wasm',import.meta.url));
const CLOCK=4194304;
async function setup(t,rate=48000){
  let Processor,frame=0,resolveReady;const messages=[],writes=[];
  const ready=new Promise(resolve=>resolveReady=resolve),port={postMessage:message=>{messages.push(message);if(message.ready||message.error)resolveReady(message);}};
  const scope={GameboyApu,factory,GameboyVoiceInspector,ChipClockResampler,CHIP_CLOCKS,validateChipClock,receiveChipInspector,
    createGameboyTimedProcessor:options=>createGameboyTimedProcessor({...options,getState:()=>structuredClone(options.getState())}),gameboyTimedCommandCost,sampleRate:rate,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate,nowFrame:()=>frame}),
    AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor(_name,Type){Processor=Type;}};
  Object.defineProperty(scope,'currentFrame',{get:()=>frame});vm.runInNewContext(source,scope);
  const processor=new Processor({processorOptions:{wasmBinary}});assert.equal((await ready).ready,true);
  let applying=false,activeFrame=null;const apply=processor.timed.apply.bind(processor.timed),write=processor.writeRegister.bind(processor);
  processor.timed.apply=(...args)=>{applying=true;activeFrame=args[2];try{return apply(...args);}finally{applying=false;}};
  processor.writeRegister=(register,value,...rest)=>{const result=write(register,value,...rest);if(applying)writes.push({frame:activeFrame,register,value});return result;};
  const link=()=>{const clientPort={start(){},close(){},postMessage(data){processor.receive(data,{postMessage:value=>clientPort.onmessage?.({data:value})});}};return clientPort;};
  const client=createGameboyClient(link());client.initialize();
  t.after(()=>{client.dispose();processor.dispose();});
  return {client,processor,messages,writes,link,rate,frame:()=>frame,
    render(count){assert(count>=0);const left=new Float32Array(count),right=left.slice();for(let i=0;i<count;){const n=Math.min(128,count-i);processor.process([],[[left.subarray(i,i+n),right.subarray(i,i+n)]]);frame+=n;i+=n;}assert(left.every(Number.isFinite));return left;}};
}
for(const rate of [44100,48000])test(`Game Boy public timed ${rate}: real APU writes match compile and sample offsets`,async t=>{
  const f=await setup(t,rate),api=createPrimaryGameboyApi(f.client);
  assert(api.build&&api.schedule&&api.captureState&&api._timedOperations);assert.equal(api.dispose,undefined);
  const wave=Array.from({length:32},(_,i)=>i&15);
  const plan=api.build(b=>{
    b.pulse.noteOn(0,'C4');
    b.atSample(441).pulse.keyOn(0);b.pulse.keyOn(0);
    b.atSample(600).wave.setWaveform(wave);
    b.atSample(610).wave.noteOn('C4');
    b.atSeconds(.02).pulse.keyOff(0);b.wave.keyOff();
  });
  const expected=await api.compile(plan),receipt=await api.schedule(plan,{name:'test'});f.writes.length=0;
  const pcm=f.render(receipt.startFrame+Math.round(rate*.02)+1);
  assert(pcm.some(value=>Math.abs(value)>1e-5));
  assert.deepEqual(f.writes.map(({register,value})=>({register,value})),expected.map(({register,value})=>({register,value})));
  const retriggers=f.writes.filter(row=>row.register===4&&(row.value&128)&&row.frame===receipt.startFrame+Math.round(rate*.01));
  assert.equal(retriggers.length,2,'same-value trigger writes are not deduplicated');
  const upload=f.writes.filter(row=>row.frame===receipt.startFrame+Math.round(rate*600/44100));
  assert.equal(upload.length,17);assert.equal(upload[0].register,10);assert.equal(upload[0].value&128,0);
  assert.equal(f.processor.inspector.registers[10]&128,0);assert.equal(f.processor.inspector.registers[2],0);
});
test('authoritative configured voice survives immediate keyOff and does not borrow stale client changes',async t=>{
  const f=await setup(t);f.client.pulse.setVoice(0,{volume:9,envelope:{period:3,direction:'up'}});f.client.pulse.noteOn(0,'C4');f.client.pulse.keyOff(0);
  const snapshot=await f.client.captureState();assert.equal(snapshot.state.registers[2],0);assert.equal(snapshot.state.voice[2],0x9b);
  const on=f.client.build(b=>b.pulse.keyOn(0));
  assert.equal((await f.client.compile(on,{initialState:snapshot})).find(row=>row.register===2).value,0x9b);
  f.processor.inspector.invoke('setVoice',[0,{volume:4}]);
  assert.equal((await f.client.compile(on)).find(row=>row.register===2).value,0x4b);
  assert.equal((await f.client.compile(on,{initialState:'client'})).find(row=>row.register===2).value,0x9b);
  assert.equal(snapshot.state.voice[2],0x9b);
  await assert.rejects(f.client.compile(on,{initialState:{...snapshot,instanceId:'other'}}),/instance/);
  await assert.rejects(f.client.compile(on,{initialState:'reset'}),/initialize/);
  const raw=f.client.build(b=>b.writeRegister(20,0x77));assert.equal((await f.client.compile(raw,{initialState:'reset'}))[0].value,0x77);
});
test('explicit raw power and register adoption reach current capture without rewriting registers',async t=>{
  const f=await setup(t);f.client.reset();f.client.writeRegister(22,128);
  assert.equal((await f.client.captureState()).state.initialized,false);
  f.client.adoptRegisterState();const state=await f.client.captureState();assert.equal(state.state.initialized,true);
  assert.equal(state.state.registers[22],128);
  assert.doesNotThrow(()=>f.client.build(b=>b.pulse.setDuty(0,.25)));
});
test('packed Envelope/routing/Sweep are resolved when applied, preserving interleaved manual fields',async t=>{
  const f=await setup(t);
  const plan=f.client.build(b=>{b.pulse.setEnvelope(0,{period:6});b.pulse.setSweep({shift:3});b.setPan(1,true,false);});
  const receipt=await f.client.schedule(plan,{name:'partial'});
  f.client.pulse.setEnvelope(0,{volume:7,direction:'up'});f.client.pulse.setSweep({period:5,direction:'down'});f.client.setPan(3,false,true);
  f.render(receipt.startFrame+1);
  assert.equal(f.processor.inspector.registers[2],0x7e);assert.equal(f.processor.inspector.registers[0],0x5b);
  assert.equal(f.processor.inspector.registers[21]&0x88,8);assert.equal(f.processor.inspector.registers[21]&0x22,0x20);
});
test('invalid named replacement and staged transactions retain the old compact reservation',async t=>{
  const f=await setup(t),valid=f.client.build(b=>b.pulse.noteOn(0,'C4'));
  const first=await f.client.schedule(valid,{name:'old',repeatSeconds:.1});
  const invalid=structuredClone(valid);invalid.operations[0].args[1]='invalid-note';
  await assert.rejects(f.client.schedule(invalid,{name:'old'}));assert.equal(f.processor.performance.getStats().patternCount,1);
  const capability=f.client._timedOperations;
  await capability.stage(1,'loop:1','schedule',[valid,{name:'staged',repeatSeconds:.2}]);assert.equal(f.processor.performance.getStats().patternCount,1);
  await capability.abort(1,'loop:1');assert.equal(f.processor.performance.getStats().patternCount,1);
  await capability.stage(2,'loop:1','schedule',[valid,{name:'staged',repeatSeconds:.2}]);await capability.commit(2,'loop:1');
  assert.equal(f.processor.performance.getStats().patternCount,2);f.render(first.startFrame+1);assert(f.processor.inspector.gates[0]);
  await capability.cancelOwner('loop:1');assert.equal(f.processor.performance.getStats().patternCount,1);
  await f.client.clearSchedule('old');assert.equal(f.processor.performance.getStats().patternCount,0);
});
test('later Main Gate owns CH1 and is not silenced by an old scheduled off or clear',async t=>{
  const f=await setup(t),later=createGameboyClient(f.link());later._adoptState(f.client._getState());t.after(()=>later.dispose());
  const plan=f.client.build(b=>{b.pulse.noteOn(0,'C4');b.atSample(882).pulse.keyOff(0);});
  const receipt=await f.client.schedule(plan,{name:'old'});f.render(receipt.startFrame+1);
  later.pulse.noteOn(0,'E4');f.render(1100);assert.equal(f.processor.inspector.gates[0],true);
  await f.client.clearSchedule('old');assert.equal(f.processor.inspector.gates[0],true);
  const held=await f.client.schedule(f.client.build(b=>b.noise.keyOn()),{name:'one-shot'});f.render(held.startFrame+1-f.frame());
  assert.equal(f.processor.performance.getStats().patternCount,0);assert.equal(f.processor.inspector.gates[3],true);
  await f.client.clearSchedule('one-shot');assert.equal(f.processor.inspector.gates[3],false);assert.equal(f.processor.inspector.gates[0],true);
});
test('timed parameter changes apply during manual audition but old off cannot retire the manual Gate',async t=>{
  const f=await setup(t),plan=f.client.build(b=>{b.pulse.noteOn(0,'C4');b.atSample(441).pulse.setDuty(0,.25);b.atSample(882).pulse.keyOff(0);});
  const receipt=await f.client.schedule(plan,{name:'manual'});f.render(receipt.startFrame+1);
  f.processor.inspector.invoke('auditionOn',[0,64,'manual']);f.render(1100);
  assert.equal(f.processor.inspector.registers[1]>>6,1);assert.equal(f.processor.inspector.gates[0],true);
  await f.client.clearSchedule('manual');assert.equal(f.processor.inspector.gates[0],true);
  f.processor.inspector.invoke('auditionOff',[0,'manual']);assert.equal(f.processor.inspector.gates[0],false);
});
test('Wave DAC-stop semantics retain configured bytes and other physical Gates',async t=>{
  const f=await setup(t);f.client.pulse.noteOn(0,'C4');f.client.noise.keyOn();f.client.wave.noteOn('C4');
  const plan=f.client.build(b=>b.wave.setWaveform(Array(32).fill(3))),receipt=await f.client.schedule(plan,{name:'wave'});
  f.render(receipt.startFrame+1);assert.equal(f.processor.inspector.gates[2],false);assert.equal(f.processor.inspector.gates[0],true);assert.equal(f.processor.inspector.gates[3],true);
  assert.deepEqual(Array.from(f.processor.inspector.registers.slice(32)),Array(16).fill(0x33));
});
test('reset, Stop and disposal clear staged/compact patterns without queued revival',async t=>{
  const f=await setup(t),plan=f.client.build(b=>b.pulse.noteOn(0,'C4'));
  const first=await f.client.schedule(plan,{name:'loop',repeatSeconds:.1});f.render(first.startFrame+1);assert(f.processor.inspector.gates[0]);
  const session=f.processor.performance.getStats().activeSession;
  f.processor.receive({type:'performance-stop',session});f.render(6000);
  assert.equal(f.processor.performance.getStats().patternCount,0);assert.equal(f.processor.inspector.gates[0],false);
  f.client.initialize();await f.client.schedule(plan,{name:'next',repeatSeconds:.1});f.client.reset();f.render(6000);
  assert.equal(f.processor.performance.getStats().patternCount,0);assert.equal(f.processor.initialized,false);assert.equal(f.processor.inspector.registers[22],0);
});
for(const rate of [44100,48000])test(`compact repeat ${rate} rounds each cycle without accumulated frame drift`,async t=>{
  const f=await setup(t,rate),period=1/110,plan=f.client.build(b=>b.pulse.keyOn(0));
  const receipt=await f.client.schedule(plan,{name:'buzzer',repeatSeconds:period});f.writes.length=0;
  f.render(receipt.startFrame+Math.round(rate*period*30)+1);
  const triggers=f.writes.filter(row=>row.register===4&&(row.value&128));assert.equal(triggers.length,31);
  assert.deepEqual(triggers.map(row=>row.frame),Array.from({length:31},(_,cycle)=>receipt.startFrame+Math.round(cycle*period*rate)));
  assert.equal(f.processor.performance.getStats().patternCount,1);await f.client.clearSchedule('buzzer');
});
test('runtime power loss reports recoverable timed error and clears only invalid reservation',async t=>{
  const f=await setup(t),errors=[];f.client._timedOperations.onError(value=>errors.push(value));
  const receipt=await f.client.schedule(f.client.build(b=>b.pulse.setDuty(0,.25)),{name:'unsafe',repeatSeconds:.1});
  f.client.writeRegister(22,0);f.render(receipt.startFrame+1);
  assert.equal(errors.length,1);assert.match(errors[0].message,/initialize/);assert.equal(f.processor.dead,false);
  assert.equal(f.processor.performance.getStats().patternCount,0);f.client.initialize();f.client.pulse.noteOn(0,'C4');
  assert(f.render(2048).some(value=>Math.abs(value)>1e-5));
});
test('malformed immediate write metadata cannot mutate native or author state',async t=>{
  const f=await setup(t),snapshot=await f.client.captureState(),messages=[];
  f.processor.receive({id:99,method:'writeRegister',args:[22,0],gameboyState:{voiceValue:0,initialized:true}},{postMessage:value=>messages.push(value)});
  assert.match(messages[0].error,/requires APU power/);assert.deepEqual((await f.client.captureState()).state,snapshot.state);
});

test('raw power-off trace preserves the actual sent byte while clearing configured sound metadata',async t=>{
  const f=await setup(t);f.client.writeRegister(22,3);const current=await f.client.captureState();
  assert.deepEqual(current.state,f.client._getState());assert.equal(current.state.registers[22],3);assert.equal(current.state.voice[22],0);
});
