// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {SidSynth, SID_PAL_CLOCK, SID_NTSC_CLOCK} from '../../tetorica_src/runtime/sidsynth.js';
import {
  buildSidOperations as build, validateSidOperations as validate,
  compileSidOperations as compile, createSidOperationResolver as resolver,
  createSidOperationResetState as reset, validateSidOperationState as validateState,
  sidOperationOffsetSeconds, SID_OPERATION_METHODS, MAX_SID_OPERATIONS,
} from '../../tetorica_src/runtime/sid_operations.js';
import {
  createSidTimedSnapshot as capture, validateSidTimedSnapshot as snapshot,
} from '../../tetorica_src/runtime/sid_timed_state.js';

function fixture({clock = SID_PAL_CLOCK, model = '6581'} = {}) {
  const writes = [], chip = new SidSynth({clock, model, transport:{
    writeRegister(register,value) { writes.push({register,value}); }, reset(){},
  }});
  chip.initialize(); writes.length = 0;
  return {chip, writes, state:chip._getState(), config:{clock,model}};
}
const bytes = rows => rows.map(({register,value}) => ({register,value}));

test('SID recorder runs once, stores detached data, and leaves register resolution to compile/execution', () => {
  let calls = 0, retained;
  const voice = {waveform:'saw',attack:4};
  const plan = build(b => { calls++; retained = b; b.setVoice(0,voice); b.atSeconds(.1).setFilter({cutoff:600}); });
  voice.attack = 15;
  assert.equal(calls,1); assert.equal(plan.operations[0].args[1].attack,4);
  assert.deepEqual(structuredClone(plan),plan);
  assert.throws(() => retained.keyOn(0), /no longer active/);
  assert.throws(() => build(async () => {}), /synchronous/);
  const invalid = build(b => b.noteOn(0,'not-a-note'));
  assert.equal(invalid.operations[0].args[1],'not-a-note'); assert.throws(() => validate(invalid));
  for (const method of ['initialize','reset','setClock','adoptRegisterState','dispose','getState','readRegister']) assert(!SID_OPERATION_METHODS.includes(method));
  assert.throws(() => build(b => b.reset()), TypeError);
});

for (const model of ['6581','8580']) test(`${model}: compiler uses immediate SidSynth formulas without changing live state`, () => {
  const {chip,writes,state,config} = fixture({model}), before = structuredClone(state);
  const plan = build(b => {
    b.writeRegister(3,0xa2).writeRegister(21,0xe5).writeRegister(23,0x58);
    b.setVoice(0,{waveform:'triangle+saw',pulseWidth:3456,attack:9,release:2,sync:true,ring:true});
    b.setVoice(1,{waveform:'noise',decay:3,sustain:6,test:false});
    b.setFilter({mode:'lowpass+bandpass',cutoff:876,resonance:11,routing:5,volume:12,voice3off:true});
    b.atSample(50).noteOn(0,'C4');
    b.atSeconds(.1).setFrequency(2,123.4).keyOn(2).setVoice(2,{pulseWidth:1234});
    b.atSample(5000).noteOff(0).keyOff(2).allNotesOff();
  });
  const result = compile(plan,state,config);
  assert.deepEqual(state,before); assert.deepEqual(chip._getState(),before); assert.deepEqual(writes,[]);
  for (const operation of plan.operations) chip[operation.method](...operation.args);
  assert.deepEqual(bytes(result),writes);
  assert.equal(result.at(-1).offsetSeconds,5000/44100);
  assert.equal(result.find(row => row.operationIndex === 3 && row.register === 3).value,0xad,'pulse width preserves the high reserved nibble');
  assert.equal(result.find(row => row.operationIndex === 5 && row.register === 21).value,0xe4,'cutoff preserves upper reserved bits');
  assert.equal(result.find(row => row.operationIndex === 5 && row.register === 23).value,0xbd,'routing and resonance preserve bit3');
});

test('SID partial packed-register updates use state at actual application time', () => {
  const {state} = fixture(); state.registers[4] = 0x91; state.registers[5] = 0xa3; state.registers[6] = 0xc8;
  state.registers[23] = 0xb9; state.registers[24] = 0xe7;
  const partial = build(b => b.setVoice(0,{sync:true,decay:5,release:2})).operations[0];
  assert.deepEqual(resolver().resolve(partial,state).writes,[{register:5,value:0xa5},{register:6,value:0xc2},{register:4,value:0x93}]);
  const changed = structuredClone(state); changed.registers[4] = 0x40; changed.registers[5] = 0x23; changed.registers[6] = 0x58;
  assert.deepEqual(resolver().resolve(partial,changed).writes,[{register:5,value:0x25},{register:6,value:0x52},{register:4,value:0x42}]);
  const filter = build(b => b.setFilter({routing:6}).setFilter({volume:3}));
  assert.deepEqual(bytes(compile(filter,state)),[{register:23,value:0xbe},{register:24,value:0xe3}]);
  assert.equal(state.registers[4],0x91); assert.equal(state.registers[23],0xb9);
});

test('SID waveform changes preserve Gate and modulation; subsequent partial operations see earlier changes', () => {
  const {state} = fixture(); state.registers[4] = 0x9f;
  const plan = build(b => b.setVoice(0,{waveform:'triangle+pulse'}).setVoice(0,{ring:false}).keyOff(0));
  assert.deepEqual(bytes(compile(plan,state)),[{register:4,value:0x5f},{register:4,value:0x5b},{register:4,value:0x5a}]);
  const result = resolver().resolve(build(b => b.setVoice(0,{waveform:'off'})).operations[0],state);
  assert.equal(result.state.registers[4],0x0f);
  assert.equal(state.registers[4],0x9f);
});

test('SID same-time Gate and raw event writes keep every write in authored order', () => {
  const {state} = fixture();
  const plan = build(b => b.keyOn(0).keyOn(0).writeRegister(4,0x21).writeRegister(4,0x21).noteOff(0).allNotesOff());
  const result = compile(plan,state);
  assert.deepEqual(bytes(result),[
    {register:4,value:0x21},{register:4,value:0x21},{register:4,value:0x21},{register:4,value:0x21},
    {register:4,value:0x20},{register:4,value:0x20},{register:11,value:0x20},{register:18,value:0x20},
  ]);
  assert(result.every(row => row.offsetSeconds === 0));
  assert.deepEqual(result.map(row => row.operationIndex),[0,1,2,3,4,5,5,5]);
  assert.deepEqual(result.slice(-3).map(row => row.writeIndex),[0,1,2]);
});

test('SID mixed seconds/sample times are absolute and independent of device rate', () => {
  const {state} = fixture();
  const plan = build(b => { b.atSeconds(.1).keyOn(0); b.atSample(4800).keyOff(0); b.atSample(9600).keyOn(1); },{referenceSampleRate:48000});
  const result = compile(plan,state);
  assert.deepEqual(result.map(row => row.offsetSeconds),[.1,.1,.2]);
  assert.equal(sidOperationOffsetSeconds(plan.operations[2],plan.referenceSampleRate),.2);
  assert.throws(() => build(b => b.atSeconds(.1).atSample(1)), /nondecreasing/);
  for (const rate of [0,-1,.5,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(() => build(() => {},{referenceSampleRate:rate}));
  for (const value of [-1,NaN,Infinity,.5]) assert.throws(() => build(b => b.atSample(value)));
});

test('SID invalid programs reject wholly; conversion never mutates a supplied/live baseline', () => {
  const {state} = fixture(), before = structuredClone(state);
  const plan = build(b => b.setFilter({volume:3}).setVoice(0,{attack:16}));
  assert.throws(() => compile(plan,state),RangeError); assert.deepEqual(state,before);
  const invalid = build(b => b.keyOn(0).keyOff(0)); invalid.operations[1].order = 0;
  assert.throws(() => compile(invalid,state), /order/);
  assert.throws(() => validate(build(b => b.setVoice(3,{waveform:'saw'}))));
  assert.throws(() => validate(build(b => b.setFilter({mode:'unsupported'}))));
  assert.throws(() => validate(build(b => b.setFrequency(0,0))));
  assert.throws(() => validateState({...state,initialized:undefined}), /initialized/);
  assert.throws(() => validateState({...state,registers:state.registers.slice(1)}), /32 register/);
  assert.throws(() => validateState({...state,extra:true}), /Unknown/);
});

test('SID recorder refuses getters, sparse arrays, symbols, cycles and oversized data without evaluating it', () => {
  let evaluated = 0;
  assert.throws(() => build(b => b.setVoice(0,{get attack(){ evaluated++; return 3; }})), /accessors/);
  assert.equal(evaluated,0);
  const plan = build(b => b.keyOn(0));
  Object.defineProperty(plan.operations,0,{get(){ evaluated++; return {}; }});
  assert.throws(() => validate(plan), /plain values/); assert.equal(evaluated,0);
  const extra = build(b => b.keyOn(0)); extra.operations.foo = 1;
  assert.throws(() => validate(extra), /ordinary array/);
  const hole = build(b => b.keyOn(0)); delete hole.operations[0]; assert.throws(() => validate(hole));
  const cycle = {}; cycle.waveform = cycle;
  assert.throws(() => build(b => b.setVoice(0,cycle)), /acyclic/);
  assert.throws(() => build(b => b.setVoice(0,{[Symbol('x')]:3})), /symbols/);
  assert.throws(() => build(b => b.writeRegister(0,new Uint8Array(1))), /plain object/);
  const oversized = build(() => {}); oversized.operations = Array(MAX_SID_OPERATIONS+1).fill({});
  assert.throws(() => validate(oversized), /at most/);
});

test('SID reset baseline remains uninitialized and contributes no initialization writes', () => {
  const state = reset(); assert.equal(state.initialized,false); assert(state.registers.every(value => value === 0));
  assert.deepEqual(bytes(compile(build(b => b.writeRegister(24,15).writeRegister(4,0x21)),state)),[{register:24,value:15},{register:4,value:0x21}]);
  assert(state.registers.every(value => value === 0));
  assert.throws(() => compile(build(b => b.keyOn(0)),state), /initialize/);
  assert.doesNotThrow(() => validate(build(b => b.keyOn(0))),'argument validation is separate from the reset baseline readiness');
  const off = compile(build(b => b.allNotesOff()),state);
  assert.deepEqual(bytes(off),[{register:4,value:0},{register:11,value:0},{register:18,value:0}]);
});

test('SID model and creation clock configure frequency conversion and incompatible baselines reject', () => {
  const {chip,writes,state,config} = fixture({clock:SID_NTSC_CLOCK});
  const plan = build(b => b.setNote(0,'C4').setFrequency(2,500));
  const trace = compile(plan,state,config);
  for (const operation of plan.operations) chip[operation.method](...operation.args);
  assert.deepEqual(bytes(trace),writes);
  assert.throws(() => compile(plan,state), /clock/);
  const other = fixture({model:'8580'}).state;
  assert.throws(() => compile(plan,other), /model/);
  assert.equal(reset({model:'8580'}).model,'8580');
  assert.throws(() => reset({model:'8580',clock:SID_NTSC_CLOCK}), /PAL/);
  for (const clock of [0,-1,.5,Infinity,1100001]) assert.throws(() => reset({clock}), /clock/);
});

test('SID captures detach immutable resolver state and allow repeated comparisons from one baseline', () => {
  const {chip,state} = fixture(), shot = capture(state,{instanceId:'sid-A',frame:900,sampleRate:48000});
  assert(Object.isFrozen(shot) && Object.isFrozen(shot.state) && Object.isFrozen(shot.state.registers));
  assert.deepEqual(Object.keys(shot.state),['clock','model','initialized','registers']);
  state.registers[5] = 0; chip.setVoice(0,{attack:15});
  assert.equal(shot.state.registers[5],0x26);
  const copy = snapshot(structuredClone(shot),{instanceId:'sid-A',clock:SID_PAL_CLOCK,model:'6581'});
  const a = compile(build(b => b.setVoice(0,{decay:3})),copy.state);
  const b = compile(build(b => b.setVoice(0,{attack:9})),copy.state);
  assert.equal(a[0].value,0x23); assert.equal(b[0].value,0x96); assert.equal(copy.state.registers[5],0x26);
  assert.throws(() => snapshot(shot,{instanceId:'sid-B'}), /instance/);
  assert.throws(() => snapshot(shot,{clock:SID_NTSC_CLOCK}), /clock/);
  assert.throws(() => snapshot(shot,{model:'8580'}), /model/);
  assert.throws(() => snapshot({...shot,format:'tetorica-gameboy-state'}), /format/);
  assert.throws(() => snapshot({...shot,version:2}), /format/);
  assert.throws(() => snapshot({...shot,extra:true}), /fields/);
  assert.throws(() => snapshot({...shot,state:{clock:SID_PAL_CLOCK,model:'6581',registers:Array(32).fill(0)}}));
  assert.throws(() => capture(state,{instanceId:'sid-A',frame:-1,sampleRate:48000}), /frame/);
});

test('SID snapshot validation rejects state getters without invoking them and does not retain live inspection data', () => {
  const {state} = fixture(); let calls = 0;
  const input = {...state}; Object.defineProperty(input,'registers',{get(){ calls++; return state.registers; }});
  assert.throws(() => capture(input,{instanceId:'sid-A',frame:0,sampleRate:44100}), /accessors/); assert.equal(calls,0);
  const bytes = state.registers.slice(); Object.defineProperty(bytes,0,{get(){ calls++; return 0; }});
  assert.throws(() => validateState({...state,registers:bytes}), /plain values/); assert.equal(calls,0);
  state.channels[0].phase = 123; state.channels[0].envelope = 33; state.cycles = 8;
  const shot = capture(state,{instanceId:'sid-A',frame:100,sampleRate:44100});
  assert.equal(shot.state.channels,undefined); assert.equal(shot.state.cycles,undefined);
});
