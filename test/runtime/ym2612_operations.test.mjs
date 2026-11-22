import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreHistoricalYm2612TimedSynth, ym2612ImmediateCompatibilityTrace} from '../helpers/historical_ym2612_timed_synth.mjs';
import {YM2612Synth} from '../../tetorica_src/runtime/ym2612synth.js';
import {
  buildYm2612Operations, validateYm2612Operations, compileYm2612Operations,
  createYm2612OperationResolver, createYm2612OperationResetState,
  validateYm2612OperationState, observeYm2612OperationWrite,
  ym2612OperationOffsetSeconds, MAX_YM2612_OPERATIONS,
} from '../../tetorica_src/runtime/ym2612_operations.js';
import {adoptYm2612OperationState} from '../../tetorica_src/runtime/ym2612_operation_state.js';
import {createYm2612TimedSnapshot, validateYm2612TimedSnapshot} from '../../tetorica_src/runtime/ym2612_timed_state.js';

const writesOnly = rows => rows.map(({port, register, value}) => ({port, register, value}));
function baseline(writes = []) {
  const state = createYm2612OperationResetState();
  for (const [port, register, value] of writes) observeYm2612OperationWrite(state, port, register, value);
  return state;
}

test('recording is state-free, runs once, and copies serializable operation arguments', () => {
  let runs = 0, retained;
  const params = {multi: 2};
  const plan = buildYm2612Operations(b => {
    runs++;
    retained = b;
    assert.equal(b.getState, undefined);
    assert.equal(b.reset, undefined);
    assert.equal(b.dac, undefined);
    assert.equal(b.atSample(0).setOperator(0, 1, params), b);
    b.atSeconds(0.1).keyOn(0, [0, 2]);
  });
  params.multi = 12;
  assert.equal(plan.referenceSampleRate, 44100);
  assert.deepEqual(plan.operations[0], {time: {unit: 'sample', value: 0}, order: 0,
    method: 'setOperator', args: [0, 1, {multi: 2}]});
  assert.deepEqual(structuredClone(plan), plan);
  assert.throws(() => retained.noteOff(0), /no longer active/);
  compileYm2612Operations(plan, baseline());
  compileYm2612Operations(plan, baseline([[0, 0x38, 0x71]]));
  assert.equal(runs, 1);
});

test('recording defers chip validation and rejects async callbacks and unsafe data', async () => {
  const plan = buildYm2612Operations(b => b.setOperator(0, 0, {multi: 16}));
  assert.throws(() => validateYm2612Operations(plan), /multi/);
  assert.deepEqual(validateYm2612Operations(plan, {validateArguments: false}), plan);
  let afterAwait;
  assert.throws(() => buildYm2612Operations(async b => {
    b.keyOn(0);
    await Promise.resolve();
    try { b.keyOff(0); } catch (error) { afterAwait = error; }
  }), /synchronous/);
  await Promise.resolve();
  assert.match(afterAwait.message, /no longer active/);
  for (const value of [() => {}, Promise.resolve(), new Uint8Array(1), Symbol('test'), NaN, Infinity]) {
    assert.throws(() => buildYm2612Operations(b => b.setNote(0, value)));
  }
  const cycle = {}; cycle.next = cycle;
  assert.throws(() => buildYm2612Operations(b => b.setOperator(0, 0, cycle)), /acyclic/);
  let reads = 0;
  assert.throws(() => buildYm2612Operations(b => b.setOperator(0, 0, {get tl() { reads++; return 1; }})), /accessors/);
  assert.equal(reads, 0);
});

test('absolute seconds/reference samples preserve same-time authored order at either output rate', () => {
  const plan = buildYm2612Operations(b => {
    b.atSeconds(0.1).noteOn(0, 'C4');
    b.atSample(4410).noteOff(0);
    b.atSeconds(0.100001).keyOn(0);
  });
  const rows = compileYm2612Operations(plan, baseline());
  assert.deepEqual(rows.map(row => row.operationIndex), [0, 0, 0, 1, 2]);
  assert.equal(rows[0].offsetSeconds, 0.1);
  assert.equal(rows[3].offsetSeconds, 0.1);
  for (const rate of [44100, 48000]) assert.equal(Math.round(rows[0].offsetSeconds * rate), rate / 10);
  const custom = buildYm2612Operations(b => b.atSample(4800).keyOff(0), {referenceSampleRate: 48000});
  assert.equal(ym2612OperationOffsetSeconds(custom.operations[0], custom.referenceSampleRate), 0.1);
  assert.throws(() => buildYm2612Operations(b => b.atSeconds(0.2).atSample(4410)), /nondecreasing/);
  for (const offset of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => buildYm2612Operations(b => b.atSample(offset)));
});

test('operator partial updates preserve untouched fields and logical operator mapping on both ports', () => {
  const start = baseline([[1, 0x39, 0x72], [1, 0x59, 0xc3], [1, 0x69, 0x89], [1, 0x89, 0xa4]]);
  const plan = buildYm2612Operations(b => {
    b.setOperator(4, 1, {multi: 6, ar: 31, d1r: 13, rr: 8});
    b.setOperator(4, 1, {dt: 2, rs: 1, am: false, sl: 5});
    b.setOperator(0, 2, {tl: 44});
  });
  assert.deepEqual(writesOnly(compileYm2612Operations(plan, start)), [
    {port: 1, register: 0x39, value: 0x76}, {port: 1, register: 0x59, value: 0xdf},
    {port: 1, register: 0x69, value: 0x8d}, {port: 1, register: 0x89, value: 0xa8},
    {port: 1, register: 0x39, value: 0x26}, {port: 1, register: 0x59, value: 0x5f},
    {port: 1, register: 0x69, value: 13}, {port: 1, register: 0x89, value: 0x58},
    {port: 0, register: 0x44, value: 44},
  ]);
});

test('partial operations use state at application, including raw writes and intervening manual edits', () => {
  const plan = buildYm2612Operations(b => {
    b.setOperator(0, 0, {multi: 3});
    b.write(0, 0x30, 0x51);
    b.setOperator(0, 0, {multi: 7});
  });
  assert.deepEqual(compileYm2612Operations(plan, baseline([[0, 0x30, 0x62]])).map(row => row.value), [0x63, 0x51, 0x57]);
  const resolver = createYm2612OperationResolver();
  const first = resolver.resolve(plan.operations[0], baseline());
  observeYm2612OperationWrite(first.state, 0, 0x30, 0x41); // A manual edit actually applied between events.
  const final = resolver.resolve(plan.operations[2], first.state);
  assert.deepEqual(final.writes, [{port: 0, register: 0x30, value: 0x47}]);
});

test('same-value key writes and repeated operator entries are retained in order', () => {
  const plan = buildYm2612Operations(b => {
    b.keyOn(5, [0, 2]);
    b.keyOn(5, [0, 2]);
    b.keyOff(5);
    b.keyOff(5);
    b.setOperators(0, [[0, {tl: 4}], [0, {tl: 4}], [0, {tl: 5}]]);
  });
  const rows = compileYm2612Operations(plan, baseline());
  assert.deepEqual(rows.map(({register, value}) => [register, value]), [
    [0x28, 0x56], [0x28, 0x56], [0x28, 6], [0x28, 6], [0x40, 4], [0x40, 4], [0x40, 5],
  ]);
  assert.deepEqual(rows.map(row => row.writeIndex), [0, 0, 0, 0, 0, 1, 2]);
  const partial = buildYm2612Operations(b => b.keyOff(0, [1, 3]));
  assert.equal(compileYm2612Operations(partial, baseline())[0].value, 0, 'Partial release must never start another operator');
  assert.equal(compileYm2612Operations(partial, baseline([[0,0x28,0xf0]]))[0].value, 0x50);
  const immediate=[];
  const synth=new YM2612Synth({transport:{write:(port,register,value)=>immediate.push({port,register,value})}});
  synth.keyOn(0,[0]);synth.keyOff(0,[1,3]);
  assert.equal(immediate.at(-1).value,0x10,'preserves the active operator without starting another');
});

test('global normal/special frequency latches survive port changes and high-only writes', () => {
  const state = baseline([[0, 0xa4, 0x15], [1, 0xa1, 0x67],
    [1, 0xad, 0x2c], [0, 0xa9, 0x89], [0, 0xa5, 0x3f]]);
  assert.deepEqual(state.frequencyLatches, [0x3f, 0x2c]);
  assert.equal(state.pitches[4], 0x1567);
  assert.equal(state.specialPitches[1], 0x2c89);
  assert.equal(state.pitches[1], 0, 'A high-only write does not commit pitch');
  const resolver = createYm2612OperationResolver();
  const op = buildYm2612Operations(b => b.write(0, 0xa0, 0x12)).operations[0];
  const result = resolver.resolve(op, state);
  assert.equal(result.state.pitches[0], 0x3f12);
  assert.equal(state.pitches[0], 0, 'Input baseline is private and unchanged');
  const scratch = new YM2612Synth({transport: {write() {}}});
  adoptYm2612OperationState(scratch, state);
  assert.deepEqual(scratch.channels[2].specialFrequencies[0], {block: 5, fnum: 0x489});
});

test('compile uses the existing immediate high-level register conversion without live side effects', () => {
  const start = baseline([[0, 0x27, 0x85], [0, 0xb4, 0xd2]]), input = structuredClone(start);
  const plan = buildYm2612Operations(b => {
    b.setPreset(3, {algorithm: 4, feedback: 2, pan: {right: true}, operators: [{tl: 13, ar: 31, rr: 7}]});
    b.setOperators(0, [[0, {dt: 1, multi: 2}], [1, {ssg: 9}]]);
    b.setPan(0, true, true);
    b.setLfo(true, 3);
    b.setChannel3SpecialMode(true);
    b.setChannel3SpecialFrequency(1, 5, 1234);
    b.setFrequency(2, 220);
    b.noteOn(5, 3, 432);
    b.noteOff(5);
  });
  const immediate = [];
  const synth = new YM2612Synth({clock: 8000000, transport: {write: (port, register, value) => immediate.push({port, register, value})}});
  adoptYm2612OperationState(synth, start);
  for (const op of plan.operations) synth[op.method](...op.args);
  assert.deepEqual(writesOnly(compileYm2612Operations(plan, start, {clock: 8000000})), immediate);
  assert.deepEqual(start, input);
  assert.equal(synth.channels[0].ams, 1, 'Raw baseline supplies untouched pan sensitivity');
});

test('reset baseline contains hardware reset registers rather than convenience preset defaults', () => {
  const plan = buildYm2612Operations(b => b.setOperator(0, 0, {ar: 20, rr: 4}));
  assert.deepEqual(compileYm2612Operations(plan, baseline()).map(row => row.value), [20, 4]);
  assert.deepEqual(compileYm2612Operations(plan, baseline([[0, 0x50, 0x80], [0, 0x80, 0xa0]])).map(row => row.value), [0x94, 0xa4]);
});

test('invalid calls/metadata reject before any external write and incomplete states are explicit', () => {
  const invalid = buildYm2612Operations(b => b.setOperators(0, [[0, {tl: 5}], [2, {multi: 16}]]));
  const state = baseline(), copy = structuredClone(state);
  assert.throws(() => compileYm2612Operations(invalid, state), /multi/);
  assert.deepEqual(state, copy);
  assert.throws(() => validateYm2612OperationState({registers: state.registers}), /frequency latches/);
  assert.throws(() => validateYm2612Operations({...invalid, chip: 'ay8910'}), /chip/);
  assert.throws(() => validateYm2612Operations({...invalid, operations: [{...invalid.operations[0], order: 2}]}), /order/);
  assert.throws(() => buildYm2612Operations(b => { for (let i = 0; i <= MAX_YM2612_OPERATIONS; i++) b.keyOff(0); }), /at most/);
});

test('snapshots are detached, immutable and safely reusable across multiple compiles', () => {
  const state = baseline([[0, 0x30, 0x52]]);
  const config = {instanceId: 'fm-one', clock: 7670454, engine: 'ymfm', frame: 128, sampleRate: 48000};
  const snapshot = createYm2612TimedSnapshot(state, config);
  observeYm2612OperationWrite(state, 0, 0x30, 0x71);
  assert.equal(snapshot.registers[0][0x30], 0x52);
  assert(Object.isFrozen(snapshot.registers[0]));
  assert(Object.isFrozen(snapshot.frequencyLatches));
  const planA = buildYm2612Operations(b => b.setOperator(0, 0, {multi: 3}));
  const planB = buildYm2612Operations(b => b.setOperator(0, 0, {multi: 9}));
  assert.equal(compileYm2612Operations(planA, snapshot)[0].value, 0x53);
  assert.equal(compileYm2612Operations(planB, snapshot)[0].value, 0x59);
  assert.equal(snapshot.registers[0][0x30], 0x52);
  assert.deepEqual(validateYm2612TimedSnapshot(structuredClone(snapshot), config), snapshot);
  for (const expected of [{instanceId: 'fm-two'}, {clock: 8000000}, {engine: 'nuked'}]) {
    assert.throws(() => validateYm2612TimedSnapshot(snapshot, expected), /Incompatible/);
  }
  assert.throws(() => validateYm2612TimedSnapshot({...snapshot, version: 2}), /version/);
  assert.throws(() => validateYm2612TimedSnapshot({...snapshot, format: 'tetorica-ay8910-state'}), /format/);
});

test('private client shadow tracks writes/reset without changing ordinary getState shape', () => {
  const writes = [];
  const synth = new YM2612Synth({transport: {reset() {}, write: (port, register, value) => writes.push({port, register, value})}});
  assert(synth._timedClientStateComplete);
  const publicBefore = synth.getState();
  assert.equal(publicBefore.registers, undefined);
  synth.write(0, 0x30, 0x53);
  synth.setBlockFnum(4, 3, 456);
  synth.keyOn(4, [0, 3]);
  const shadow = synth._getTimedState();
  assert.equal(shadow.registers[0][0x30], 0x53);
  assert.equal(shadow.pitches[4], (3 << 11) | 456);
  assert.equal(shadow.keyMasks[4], 9);
  shadow.registers[0][0x30] = 0;
  assert.equal(synth._getTimedState().registers[0][0x30], 0x53);
  synth._invalidateTimedState();
  assert.equal(synth._timedClientStateComplete, false);
  synth._adoptTimedState(shadow);
  assert.equal(synth._timedClientStateComplete, true);
  synth.reset();
  assert.deepEqual(synth._getTimedState(), baseline());
  assert.equal(writes.length, 4, 'Shadow construction/reset produces no additional writes');
  const incomplete = new YM2612Synth({transport: {write() {}}});
  assert.equal(incomplete._timedClientStateComplete, false, 'Write-only transports have no guaranteed initial hardware baseline');
});

test('immediate API traces match the authenticated predecessor except for corrected operator release', async () => {
  const sourceUrl = new URL('../../tetorica_src/runtime/ym2612synth.js', import.meta.url);
  const source = readFileSync(sourceUrl, 'utf8');
  const historical = restoreHistoricalYm2612TimedSynth(source);
  const loadable = historical.replace(/from (['"])(\.\/[^'"]+)\1/g,
    (_, quote, path) => `from ${quote}${new URL(path, sourceUrl).href}${quote}`);
  const Old = (await import(`data:text/javascript;base64,${Buffer.from(loadable).toString('base64')}`)).YM2612Synth;
  const before = ym2612ImmediateCompatibilityTrace(Old);
  const after = ym2612ImmediateCompatibilityTrace(YM2612Synth);
  const expected=before.map(row=>row.register===0x28&&row.port===0&&(row.value&0xf0)===0xa0
    ? {...row,value:0x50|(row.value&7)} : row);
  assert.deepEqual(after, expected);
  assert.equal(before.length, 539);
  assert.equal(createHash('sha256').update(JSON.stringify(before)).digest('hex'),
    '6d6124e71aef5ebb371461ffb8da51f6c9e662f10c36f49fd19731daf8b07416');
  assert.throws(() => restoreHistoricalYm2612TimedSynth(source.replace('const CHANNEL_COUNT = 6;', 'const CHANNEL_COUNT = 5;')), /authentication/);
});
