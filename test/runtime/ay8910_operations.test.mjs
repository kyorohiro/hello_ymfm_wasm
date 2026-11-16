import test from 'node:test';
import assert from 'node:assert/strict';
import {AY8910Synth} from '../../tetorica_src/runtime/ay8910synth.js';
import {
  buildAyOperations, validateAyOperations, compileAyOperations,
  createAyOperationResolver, createAyOperationResetState,
  validateAyOperationState, ayOperationOffsetSeconds, MAX_AY_OPERATIONS,
} from '../../tetorica_src/runtime/ay8910_operations.js';

const baseline = (registers = {}, levels = [9, 9, 9]) => {
  const state = createAyOperationResetState();
  Object.assign(state.registers, registers);
  state.levels = levels;
  return state;
};

test('recording runs once, copies arguments and has no chip-state dependency', () => {
  let calls = 0, retained;
  const settings = {tone: true};
  const plan = buildAyOperations(b => {
    calls++;
    retained = b;
    assert.equal(b.getState, undefined);
    assert.equal(b.reset, undefined);
    assert.equal(b.initialize, undefined);
    assert.equal(b.atSample(0).setMixer(0, settings), b);
    b.atSeconds(0.1).setEnvelope({shape: 8});
  });
  settings.tone = false;
  assert.equal(calls, 1);
  assert.equal(plan.referenceSampleRate, 44100);
  assert.deepEqual(plan.operations[0], {time:{unit:'sample',value:0},order:0,method:'setMixer',args:[0,{tone:true}]});
  assert.deepEqual(structuredClone(plan), plan);
  assert.throws(() => retained.keyOn(0), /no longer active/);
  compileAyOperations(plan, baseline({7:0xff}));
  compileAyOperations(plan, baseline({7:0}));
  assert.equal(calls, 1, 'Neither compile evaluates authoring JavaScript again');
});

test('recording does not eagerly validate against a fabricated clock or resolve bytes', () => {
  // Validity depends on the execution clock, not a live/build-time state copy.
  const plan = buildAyOperations(b => b.setFrequency(0, 50));
  assert.deepEqual(plan.operations[0].args, [0,50]);
  assert(!Object.hasOwn(plan.operations[0], 'register'));
  assert.throws(() => validateAyOperations(plan, {clock:4000000}), /range/);
  assert.equal(validateAyOperations(plan, {clock:2000000}).operations.length, 1);
});

test('build rejects async callbacks, resources and data that cannot be safely copied', async () => {
  let continuationError;
  assert.throws(() => buildAyOperations(async b => {
    b.keyOn(0);
    await Promise.resolve();
    try { b.keyOff(0); } catch (error) { continuationError = error; }
  }), /synchronous/);
  await Promise.resolve();
  assert.match(continuationError.message, /no longer active/);
  for (const value of [() => {}, Promise.resolve(), new Uint8Array(1), Symbol('test'), NaN, Infinity]) {
    assert.throws(() => buildAyOperations(b => b.setNote(0, value)));
  }
  const cycle = {}; cycle.next = cycle;
  assert.throws(() => buildAyOperations(b => b.setVoice(0, cycle)), /acyclic/);
  let read = 0;
  const accessor = {get tone() { read++; return true; }};
  assert.throws(() => buildAyOperations(b => b.setMixer(0, accessor)), /accessors/);
  assert.equal(read, 0);
});

test('absolute seconds and reference samples preserve order without device quantization', () => {
  const plan = buildAyOperations(b => {
    b.atSeconds(0.1).noteOn(0, 'C4');
    b.atSample(4410).noteOff(0);
    b.atSeconds(0.100001).setEnvelope({shape:8});
  });
  const rows = compileAyOperations(plan, baseline(), {clock:2000000});
  assert.deepEqual(rows.map(row => row.operationIndex), [0,0,0,1,2]);
  assert.equal(rows[0].offsetSeconds, 0.1);
  assert.equal(rows[3].offsetSeconds, 0.1);
  assert.equal(rows[4].offsetSeconds, 0.100001);
  for (const rate of [44100,48000]) {
    assert.equal(Math.round(rows[0].offsetSeconds * rate), rate / 10);
    assert.equal(Math.round(rows[3].offsetSeconds * rate), rate / 10);
  }
  const alternate = buildAyOperations(b => b.atSample(4800).keyOff(0), {referenceSampleRate:48000});
  assert.equal(ayOperationOffsetSeconds(alternate.operations[0], alternate.referenceSampleRate), 0.1);
  assert.throws(() => buildAyOperations(b => b.atSeconds(0.2).atSample(4410)), /nondecreasing/);
  for (const offset of [-1,0.5,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(() => buildAyOperations(b => b.atSample(offset)));
  for (const rate of [0,-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(() => buildAyOperations(() => {}, {referenceSampleRate:rate}));
});

test('R7 partial operations resolve from each supplied state and preserve full-write order', () => {
  const plan = buildAyOperations(b => {
    b.setMixer(0, {tone:true});
    b.atSample(100).setMixer(1, {noise:false});
  });
  const current = baseline({7:0xc9}), copy = structuredClone(current);
  assert.deepEqual(compileAyOperations(plan, current).map(row => [row.register,row.value]), [[7,0xc8],[7,0xd8]]);
  assert.deepEqual(current, copy);

  const resolver = createAyOperationResolver();
  const first = resolver.resolve(plan.operations[0], current);
  first.state.registers[7] |= 4; // An actually applied manual CH3 Tone Off.
  const second = resolver.resolve(plan.operations[1], first.state);
  assert.deepEqual(second.writes, [{register:7,value:0xdc}]);

  const full = buildAyOperations(b => {
    b.setMixer(0, {tone:true});
    b.writeRegister(7, 0x01);
    b.setMixer(1, {noise:false});
  });
  assert.deepEqual(compileAyOperations(full, current).map(row => row.value), [0xc8,0x01,0x11]);
});

test('same-value R7 and R13 writes remain observable in authored order', () => {
  const plan = buildAyOperations(b => {
    b.setMixer(0, {tone:true});
    b.setMixer(0, {tone:true});
    b.setEnvelope({shape:8});
    b.setEnvelope({shape:8});
  });
  assert.deepEqual(compileAyOperations(plan, baseline({7:0,13:8})), [
    {offsetSeconds:0,register:7,value:0,operationIndex:0,writeIndex:0},
    {offsetSeconds:0,register:7,value:0,operationIndex:1,writeIndex:0},
    {offsetSeconds:0,register:13,value:8,operationIndex:2,writeIndex:0},
    {offsetSeconds:0,register:13,value:8,operationIndex:3,writeIndex:0},
  ]);
  const resolver = createAyOperationResolver();
  let state = baseline({13:8});
  for (let i = 0; i < 5; i++) {
    const result = resolver.resolve(plan.operations[2], state);
    assert.deepEqual(result.writes, [{register:13,value:8}]);
    state = result.state;
  }
});

test('retained levels and reserved bits match the existing immediate API', () => {
  const start = baseline({7:0xd3,6:0xe0,8:0xe0,13:0xf0}, [0,27,9]);
  const plan = buildAyOperations(b => {
    b.keyOn(0);
    b.noteOn(1, 'C4');
    b.keyOff(1);
    b.setVolume(1, 5);
    b.keyOn(1);
    b.noise(2, {period:6});
    b.setEnvelope({period:0x1234,shape:8});
    b.allNotesOff();
  });
  const immediate = [];
  const api = new AY8910Synth({clock:2000000, transport:{writeRegister:(register,value) => immediate.push({register,value})}});
  api._adoptState(start);
  for (const operation of plan.operations) api[operation.method](...operation.args);
  const before = structuredClone(start), planned = structuredClone(plan);
  const rows = compileAyOperations(plan, start, {clock:2000000});
  assert.deepEqual(rows.map(({register,value}) => ({register,value})), immediate);
  assert.deepEqual(start, before);
  assert.deepEqual(plan, planned);
  assert.equal(rows[0].value,0xe0,'Intentional configured zero is retained');
  const resolver = createAyOperationResolver({clock:2000000});
  let state = start;
  for (const operation of plan.operations) state = resolver.resolve(operation,state).state;
  assert.deepEqual(state, api._getState());
});

test('current and reset baselines produce only operation writes and can be reused', () => {
  const plan = buildAyOperations(b => {
    b.setMixer(0, {tone:true});
    b.setMixer(1, {noise:false});
  });
  const current = baseline({7:0xc9});
  assert.deepEqual(compileAyOperations(plan, current).map(row => row.value), [0xc8,0xd8]);
  assert.deepEqual(compileAyOperations(plan, createAyOperationResetState()).map(row => row.value), [0,0x10]);
  const off = buildAyOperations(b => b.setMixer(0, {tone:false}));
  assert.equal(compileAyOperations(off,current)[0].value,0xc9);
  assert.equal(compileAyOperations(plan,current)[0].value,0xc8);
  assert.equal(current.registers[7],0xc9);
});

test('incomplete state and invalid operations reject without mutating caller state', () => {
  const start = baseline({7:0xc9}), saved = structuredClone(start);
  for (const state of [{registers:start.registers},{...start,levels:[9,9]},baseline({},[9,32,9]),{...start,registers:Array(16).fill(undefined)}]) {
    assert.throws(() => validateAyOperationState(state));
    assert.throws(() => compileAyOperations(buildAyOperations(b => b.keyOn(0)),state));
  }
  const resolver = createAyOperationResolver();
  for (const [method,args] of [
    ['setMixer',[3,{tone:true}]], ['setVoice',[0,{volume:16}]],
    ['setEnvelope',[{period:2,shape:16}]], ['noteOn',[0,'invalid']],
    ['writeRegister',[16,1]], ['setMixer',[0,{tone:true,unknown:true}]],
  ]) {
    const plan = buildAyOperations(b => b[method](...args));
    assert.throws(() => validateAyOperations(plan));
    assert.throws(() => compileAyOperations(plan,start));
    assert.throws(() => resolver.resolve(plan.operations[0],start));
    assert.deepEqual(start,saved);
  }
  assert.deepEqual(resolver.resolve({method:'setMixer',args:[0,{tone:true}]},start).writes,[{register:7,value:0xc8}], 'A failed resolution does not poison scratch state');
});

test('program validation rejects forged methods, order, times and excessive capacity', () => {
  const valid = buildAyOperations(b => b.keyOn(0));
  for (const modify of [
    p => p.version = 2, p => p.chip = 'ym2612',
    p => p.operations[0].method = 'reset', p => p.operations[0].method = 'constructor',
    p => p.operations[0].order = 1, p => p.operations[0].time.unit = 'beat',
    p => p.operations[0].args = [0,1], p => p.operations[0].time.value = -1,
  ]) {
    const bad = structuredClone(valid); modify(bad);
    assert.throws(() => validateAyOperations(bad));
  }
  assert.throws(() => buildAyOperations(b => {for(let i=0;i<=MAX_AY_OPERATIONS;i++)b.keyOn(0);}), /at most/);
  const bounded = validateAyOperations(valid);
  bounded.operations[0].args[0] = 2;
  assert.equal(valid.operations[0].args[0],0);
});
