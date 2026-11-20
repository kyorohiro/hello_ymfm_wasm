// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {GameboySynth} from '../../tetorica_src/runtime/gameboysynth.js';
import {
  buildGameboyOperations as build, validateGameboyOperations as validate,
  compileGameboyOperations as compile, createGameboyOperationResolver as resolver,
  createGameboyOperationResetState as reset, validateGameboyOperationState as validateState,
  GAMEBOY_OPERATION_METHODS, MAX_GAMEBOY_OPERATIONS,
} from '../../tetorica_src/runtime/gameboy_operations.js';
import {
  createGameboyTimedSnapshot as capture, validateGameboyTimedSnapshot as snapshot,
} from '../../tetorica_src/runtime/gameboy_timed_state.js';

function fixture(clock=4194304){
  const writes=[],chip=new GameboySynth({clock,transport:{writeRegister(register,value){writes.push({register,value});},reset(){}}});
  chip.initialize();writes.length=0;return {chip,writes,state:chip._getState()};
}
const bytes=rows=>rows.map(({register,value})=>({register,value}));
function invoke(chip,operation){const[group,member]=operation.method.split('.');return member?chip[group][member](...operation.args):chip[group](...operation.args);}

test('recorder evaluates its callback once, copies serializable calls and never resolves register state',()=>{
  let calls=0,retained;const samples=new Uint8Array(32).fill(3);
  const plan=build(b=>{calls++;retained=b;b.atSample(0).pulse.setEnvelope(0,{volume:11});b.atSeconds(.1).wave.setWaveform(samples);});
  samples.fill(7);assert.equal(calls,1);assert.equal(plan.operations[1].args[0][0],3);
  assert.deepEqual(structuredClone(plan),plan);assert.throws(()=>retained.pulse.keyOn(0),/no longer active/);
  assert.throws(()=>build(async()=>{}),/synchronous/);
  const invalid=build(b=>b.noteOn(0,'unknown-note'));
  assert.equal(invalid.operations[0].args[1],'unknown-note');assert.throws(()=>validate(invalid));
  for(const method of ['initialize','reset','setClock','adoptRegisterState','dispose','allNotesOff'])assert(!GAMEBOY_OPERATION_METHODS.includes(method));
  assert.throws(()=>build(b=>b.reset()),TypeError);
});

test('compiler reuses immediate GameboySynth formulas and produces only the operations writes',()=>{
  const {chip,writes,state}=fixture(),before=structuredClone(state);
  const plan=build(b=>{
    b.writeRegister(4,0x40).writeRegister(20,0x88);
    b.pulse.setVoice(0,{duty:.25,volume:11,envelope:{direction:'up',period:3}});
    b.pulse.setEnvelope(1,{volume:5,direction:'down',period:7});
    b.pulse.setSweep({direction:'down',period:5,shift:3});
    b.setPan(1,false,true).setMasterVolume(2,6);
    b.atSample(50).noteOn(0,'C4');
    b.atSeconds(.1).noise.setVoice({volume:9,envelope:{period:2},divisor:6,shift:4,width:7});
    b.noise.keyOn().noise.keyOff();
    b.atSample(5000).wave.setLevel(.25).wave.setFrequency(700).wave.noteOn('E4');
  });
  const result=compile(plan,state);assert.deepEqual(state,before);assert.deepEqual(chip._getState(),before);assert.deepEqual(writes,[]);
  for(const operation of plan.operations)invoke(chip,operation);
  assert.deepEqual(bytes(result),writes);assert.equal(result.at(-1).offsetSeconds,5000/44100);
  assert.equal(result.find(row=>row.operationIndex===6).register,20);
  assert.equal(result.find(row=>row.operationIndex===6).value,0xae,'VIN bits accompany partial left/right master levels');
});

test('partial Envelope, Noise, Sweep and pan updates resolve against supplied application-time state',()=>{
  const {state}=fixture();state.voice[2]=state.registers[2]=0xb9;state.voice[18]=state.registers[18]=0x79;
  state.voice[0]=state.registers[0]=0x59;state.voice[21]=state.registers[21]=0xff;
  const op=build(b=>b.pulse.setEnvelope(0,{period:6})).operations[0];
  assert.deepEqual(resolver().resolve(op,state).writes,[{register:2,value:0xbe}]);
  const changed=structuredClone(state);changed.voice[2]=changed.registers[2]=0x40;
  assert.deepEqual(resolver().resolve(op,changed).writes,[{register:2,value:0x46}]);
  const plan=build(b=>{b.noise.setParameters({divisor:2});b.pulse.setSweep({shift:4});b.setPan(1,false,true);});
  assert.deepEqual(bytes(compile(plan,state)),[{register:18,value:0x7a},{register:0,value:0x5c},{register:21,value:0xdf}]);
  assert.equal(state.voice[2],0xb9);assert.equal(state.registers[18],0x79);
});

test('configured voice survives Key Off while sent registers reflect silence',()=>{
  const {chip,state}=fixture();chip.pulse.keyOff(0);const silent=chip._getState();
  assert.equal(silent.registers[2],0);assert.equal(silent.voice[2],state.voice[2]);
  const result=resolver().resolve(build(b=>b.pulse.keyOn(0)).operations[0],silent);
  assert.equal(result.writes.find(write=>write.register===2).value,state.voice[2]);
  assert.equal(result.state.registers[2],state.voice[2]);
  assert.equal(result.state.voice[2],state.voice[2]);
  assert.equal(silent.registers[2],0);
});

test('same-time repeated hardware triggers retain every write and order without leaking trigger bits into metadata',()=>{
  const {state}=fixture();
  const plan=build(b=>{b.keyOn(0).keyOn(0).writeRegister(4,128).writeRegister(4,128);});
  const result=compile(plan,state);assert.equal(result.length,12);
  assert.deepEqual(bytes(result).slice(0,5),bytes(result).slice(5,10));
  assert.deepEqual(result.slice(-2).map(row=>[row.register,row.value]),[[4,128],[4,128]]);
  const r=resolver();r.start(state);for(const operation of plan.operations)r.apply(operation);
  const resolved=resolver().resolve(plan.operations.at(-1),state);
  assert.equal(resolved.state.registers[4]&128,0);assert.equal(resolved.state.voice[4]&128,0);
  assert(result.every(row=>row.offsetSeconds===0));
});

test('Wave RAM uploads preserve exact32nibble packing, stop DAC and require explicit retrigger',()=>{
  const {state}=fixture(),samples=Array.from({length:32},(_,i)=>i%16);
  state.registers[10]=state.voice[10]=128;
  const plan=build(b=>b.wave.stopAndSetWaveform(samples)),result=resolver().resolve(plan.operations[0],state);
  assert.equal(result.writes.length,17);assert.deepEqual(result.writes[0],{register:10,value:0});
  assert.deepEqual(result.writes.slice(1),Array.from({length:16},(_,i)=>({register:32+i,value:(samples[2*i]<<4)|samples[2*i+1]})));
  assert.equal(result.state.registers[10]&128,0);assert.equal(state.registers[10],128);
  const retrigger=compile(build(b=>b.wave.setWaveform(samples).wave.keyOn()),state);
  assert.deepEqual(bytes(retrigger).slice(0,17),result.writes);assert.equal(retrigger[17].register,10);assert(retrigger[17].value&128);
  for(const invalid of [Array(31).fill(0),Array(33).fill(0),Array(32).fill(16)])assert.throws(()=>validate(build(b=>b.wave.setWaveform(invalid))));
});

test('mixed seconds and samples are absolute offsets and source-rate independent',()=>{
  const {state}=fixture(),plan=build(b=>{b.atSeconds(.1).pulse.keyOn(0);b.atSample(4800).pulse.keyOff(0);b.atSample(9600).noise.keyOn();},{referenceSampleRate:48000});
  const result=compile(plan,state);assert(result.filter(row=>row.operationIndex<2).every(row=>row.offsetSeconds===.1));
  assert(result.filter(row=>row.operationIndex===2).every(row=>row.offsetSeconds===.2));
  assert.throws(()=>build(b=>b.atSeconds(.1).atSample(1)),/nondecreasing/);
  for(const rate of [0,-1,.5,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>build(()=>{}, {referenceSampleRate:rate}));
});

test('complete invalid programs reject without mutating state or returning a partial trace',()=>{
  const {state}=fixture(),before=structuredClone(state),plan=build(b=>b.setPan(0,false,true).pulse.setVoice(0,{volume:16}));
  assert.throws(()=>compile(plan,state),RangeError);assert.deepEqual(state,before);
  const bad=build(b=>b.keyOn(0).keyOff(0));bad.operations[1].order=0;assert.throws(()=>compile(bad,state),/order/);
  assert.throws(()=>validateState({...state,voice:[]}));
  assert.throws(()=>compile(build(b=>b.keyOn(0)),{...state,clock:4000000}),/Incompatible/);
  assert.throws(()=>validateState({...state,initialized:true,registers:Array(48).fill(0)}),/power/);
  assert.throws(()=>validateState({...state,extra:true}));
  assert.throws(()=>validateState({...state,voice:state.voice.map((v,i)=>i===4?128:v)}),/trigger/);
});

test('operation data is bounded and refuses getters, holes, symbols, cycles or extra properties',()=>{
  const {state}=fixture();let evaluated=0;
  const voice={get volume(){evaluated++;return 8;}};
  assert.throws(()=>build(b=>b.pulse.setVoice(0,voice)),/accessors/);assert.equal(evaluated,0);
  const plan=build(b=>b.keyOn(0));Object.defineProperty(plan.operations,0,{get(){evaluated++;return {};}});
  assert.throws(()=>compile(plan,state),/plain values/);assert.equal(evaluated,0);
  const extra=build(b=>b.keyOn(0));extra.operations.foo=1;assert.throws(()=>validate(extra),/ordinary array/);
  const sparse=build(b=>b.keyOn(0));delete sparse.operations[0];assert.throws(()=>validate(sparse));
  const cyclic={};cyclic.envelope=cyclic;assert.throws(()=>build(b=>b.pulse.setVoice(0,cyclic)),/acyclic/);
  assert.throws(()=>build(b=>b.pulse.setVoice(0,{[Symbol('x')]:3})),/symbols/);
  const samples=Array(32).fill(0);samples['4294967295']=1;assert.throws(()=>build(b=>b.wave.setWaveform(samples)),/extra properties|too large/);
  const oversized=build(()=>{});oversized.operations=Array(MAX_GAMEBOY_OPERATIONS+1).fill({});assert.throws(()=>validate(oversized),/at most/);
});

test('hardware reset baseline stays powered off and compilation never initializes the live chip',()=>{
  const state=reset();assert.equal(state.initialized,false);assert.equal(state.registers[22],0);
  const plan=build(b=>b.writeRegister(22,128).writeRegister(20,0x77));
  assert.deepEqual(bytes(compile(plan,state)),[{register:22,value:128},{register:20,value:0x77}]);
  assert.equal(state.registers[22],0);assert.throws(()=>compile(build(b=>b.keyOn(0)),state),/initialize/);
  assert.doesNotThrow(()=>validate(build(b=>b.keyOn(0))),'structural/argument validation is independent from a supplied powered-off state');
});

test('raw power-off clears configured controls while preserving Wave RAM and refuses later high-level operations',()=>{
  const {state}=fixture(),plan=build(b=>b.writeRegister(22,0));
  const next=resolver().resolve(plan.operations[0],state).state;
  assert.equal(next.initialized,false);assert(next.registers.slice(0,23).every(value=>value===0));
  assert(next.voice.slice(0,23).every(value=>value===0));assert.deepEqual(next.registers.slice(32),state.registers.slice(32));
  assert.deepEqual(next.voice.slice(32),state.voice.slice(32));
  assert.throws(()=>compile(build(b=>b.writeRegister(22,0).pulse.keyOn(0)),state),/initialize/);
  assert.equal(state.initialized,true);
});

test('the supplied chip clock controls shared frequency conversion and rejects incompatible baselines',()=>{
  const {chip,writes,state}=fixture(4000000),plan=build(b=>b.setNote(0,'C4').wave.setFrequency(500));
  const trace=compile(plan,state,{clock:4000000});for(const operation of plan.operations)invoke(chip,operation);
  assert.deepEqual(bytes(trace),writes);assert.equal(resolver({clock:4000000}).resolve(plan.operations[0],state).state.clock,4000000);
  assert.throws(()=>compile(plan,state),/clock/);
  for(const clock of [0,-1,.5,Infinity,0x40000000])assert.throws(()=>reset({clock}),/clock/);
});

test('captured snapshots are detached, immutable and reusable across compilations',()=>{
  const {chip,state}=fixture(),shot=capture(state,{instanceId:'apu-A',frame:900,sampleRate:48000});
  assert(Object.isFrozen(shot)&&Object.isFrozen(shot.state)&&Object.isFrozen(shot.state.voice));
  state.voice[2]=0;chip.pulse.setEnvelope(0,{volume:2});assert.equal(shot.state.voice[2],0xa0);
  const copy=snapshot(structuredClone(shot),{instanceId:'apu-A',clock:4194304});
  const a=compile(build(b=>b.pulse.setEnvelope(0,{period:3})),copy.state),b=compile(build(b=>b.pulse.setEnvelope(0,{direction:'up'})),copy.state);
  assert.equal(a[0].value,0xa3);assert.equal(b[0].value,0xa8);assert.equal(copy.state.voice[2],0xa0);
  assert.throws(()=>snapshot(shot,{instanceId:'apu-B'}),/instance/);assert.throws(()=>snapshot(shot,{clock:4000000}),/clock/);
  assert.throws(()=>snapshot({...shot,format:'tetorica-ym2612-state'}),/format/);
  assert.throws(()=>snapshot({...shot,version:2}),/format/);
  assert.throws(()=>snapshot({...shot,extra:true}),/fields/);
  assert.throws(()=>snapshot({...shot,state:{clock:4194304,initialized:true,registers:Array(48).fill(0)}}));
});
