import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, open, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {SID_TRACE_LIMITS, validateSidTrace, readSidTrace, encodeSidTraceCommands} from '../tetorica_src/cli/sid_trace.mjs';
import {SidCore} from '../tetorica_src/runtime/sid.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clock = 985248;
const trace = (overrides = {}) => ({format: 'tetorica-sid-trace', version: 1, clockHz: clock,
  model: '6581', cyclePhase: 'phi2', writeTiming: 'tick-then-commit', durationCycles: clock,
  sampleRate: 48000, engine: {name: 'self-authored test', settings: {revision: 'fixture', flags: [true, null, .5]}},
  input: {sha256: 'a'.repeat(64), subtune: 1}, writes: [], ...overrides});
const sha = value => createHash('sha256').update(value).digest('hex');
let work, executable, wasmBinary;
before(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'tetorica-sid-trace-'));
  executable = path.join(work, process.platform === 'win32' ? 'sid-trace-render.exe' : 'sid-trace-render');
  execFileSync(process.env.CXX || 'clang++', ['-std=c++17', '-O2', '-ffp-contract=off',
    path.join(root, 'test/helpers/sid_trace_render.cpp'), '-o', executable], {stdio: 'pipe'});
  wasmBinary = await readFile(path.join(root, 'tetorica_src/runtime/generated/sid/sid.wasm'));
});
after(async () => { if (work) await rm(work, {recursive: true, force: true}); });
function native(input, options) {
  const result = spawnSync(executable, [], {input: typeof input === 'string' ? input : encodeSidTraceCommands(input, options),
    maxBuffer: 32 * 1024 * 1024, timeout: 30000});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr.toString());
  return {bytes: result.stdout, metadata: JSON.parse(result.stderr.toString())};
}
function fromBytes(bytes) {
  const result = new Float32Array(bytes.length / 4);
  for (let i = 0; i < result.length; ++i) result[i] = bytes.readFloatLE(i * 4);
  return result;
}
function toBytes(samples) {
  const result = Buffer.alloc(samples.length * 4);
  for (let i = 0; i < samples.length; ++i) result.writeFloatLE(samples[i], i * 4);
  return result;
}
function soundingTrace(sampleRate = 48000, durationCycles = clock + 13) {
  // Includes adjacent bus writes, both sides of sample boundaries, ignored
  // slots, and a write on the last cycle whose effect has no future audio.
  const writes = [[0, 24, 15], [1, 0, 37], [2, 1, 20], [3, 5, 0], [4, 6, 0xf5],
    [5, 4, 0x21], [20, 2, 0x34], [21, 3, 8], [22, 31, 0xa5], [23, 27, 0x7f],
    [Math.floor(clock / 5), 4, 0x41], [Math.floor(clock * 2 / 5), 21, 3],
    [Math.floor(clock * 2 / 5) + 1, 22, 100], [Math.floor(clock * 2 / 5) + 2, 23, 0xc1],
    [Math.floor(clock * 2 / 5) + 3, 24, 0x1f], [Math.floor(clock * 3 / 5), 4, 0x11],
    [Math.floor(clock * 4 / 5), 4, 0x10], [durationCycles - 1, 24, 0]];
  return trace({sampleRate, durationCycles, writes: writes.map(([cycle, register, value]) => ({cycle, register, value}))});
}

test('SID trace validation returns detached JSON and preserves bus writes 0..31 without deduplication', () => {
  const original = trace({writes: [{cycle: 0, register: 31, value: 255}, {cycle: 1, register: 31, value: 255}]});
  const copy = validateSidTrace(original); assert.deepEqual(copy, original);
  copy.engine.settings.flags[0] = false; copy.input.sha256 = 'b'.repeat(64); copy.writes[0].value = 0;
  assert.equal(original.engine.settings.flags[0], true); assert.equal(original.input.sha256, 'a'.repeat(64));
  assert.equal(original.writes[0].value, 255); assert.equal(copy.writes.length, 2);
  assert.equal(validateSidTrace(trace({durationCycles: 1, writes: [{cycle: 0, register: 0, value: 0}]})).durationCycles, 1);
});

test('SID trace rejects noncanonical, unsupported, noninteger, out-of-order and unbounded inputs', () => {
  const invalid = [null, [], {...trace(), extra: 1}, {...trace(), engine: undefined},
    ...Object.entries({format: 'other', version: '1', model: '8580', clockHz: 1022727, cyclePhase: 'phi1', writeTiming: 'commit-then-tick',
      durationCycles: 0, sampleRate: 7999}).map(([key, value]) => trace({[key]: value})),
    trace({durationCycles: SID_TRACE_LIMITS.maximumDurationCycles + 1}), trace({sampleRate: 96001}), trace({sampleRate: '48000'}),
    trace({input: {sha256: 'x'.repeat(64), subtune: 1}}), trace({input: {sha256: 'a'.repeat(64), subtune: 257}}),
    trace({input: {sha256: 'a'.repeat(64), subtune: 1, unknown: true}}), trace({writes: new Array(SID_TRACE_LIMITS.maximumWrites + 1)}),
    trace({writes: [{cycle: 0, register: 0, value: 0}, {cycle: 0, register: 1, value: 1}]}),
    trace({writes: [{cycle: 1, register: 0, value: 0}, {cycle: 0, register: 1, value: 1}]}),
    trace({writes: [{cycle: clock, register: 0, value: 0}]}), trace({writes: [{cycle: -1, register: 0, value: 0}]}),
    trace({writes: [{cycle: 0, register: 32, value: 0}]}), trace({writes: [{cycle: 0, register: 0, value: 256}]}),
    trace({writes: [{cycle: .5, register: 0, value: 0}]}), trace({writes: [{cycle: 0, register: 0, value: NaN}]}),
    trace({writes: [{cycle: 0, register: 0, value: 0, address: 0xd400}]}), trace({writes: new Array(1)})];
  for (const value of invalid) assert.throws(() => validateSidTrace(value), /SID trace:/);
  const missing = trace(); delete missing.engine; assert.throws(() => validateSidTrace(missing), /missing/);
});

test('SID trace metadata is bounded JSON data and does not invoke accessors or custom conversion', () => {
  const cycle = {}; cycle.self = cycle;
  let deep = {}; for (let i = 0; i < 10; ++i) deep = {nested: deep};
  let getters = 0; const accessor = {}; Object.defineProperty(accessor, 'name', {enumerable: true, get() { ++getters; return 'unsafe'; }});
  const invalid = [new Date(), [], {nan: NaN}, {infinity: Infinity}, {big: 1n}, {missing: undefined}, {fn() {}},
    {value: Symbol('x')}, {sparse: new Array(1)}, {values: new Array(4097).fill(0)}, {large: 'x'.repeat(16385)},
    {large: Array(5).fill('x'.repeat(16384))}, cycle, deep, accessor];
  for (const engine of invalid) assert.throws(() => validateSidTrace(trace({engine})), /SID trace:/);
  assert.equal(getters, 0);
  const safe = JSON.parse('{"__proto__":{"polluted":true},"toJSON":"metadata only"}');
  const copy = validateSidTrace(trace({engine: safe})); assert.equal({}.polluted, undefined);
  assert.equal(Object.hasOwn(copy.engine, '__proto__'), true); assert.deepEqual(copy.engine, safe);
});

test('SID trace reads bounded strict UTF-8 JSON from bytes, file paths and file URLs', async () => {
  const original = trace(), bytes = Buffer.from(JSON.stringify(original));
  assert.deepEqual(await readSidTrace(bytes), original);
  const file = path.join(work, 'trace.json'); await writeFile(file, bytes);
  assert.deepEqual(await readSidTrace(file), original); assert.deepEqual(await readSidTrace(new URL('file://' + file)), original);
  await assert.rejects(readSidTrace(Buffer.from([0xff])), /UTF-8 JSON/);
  await assert.rejects(readSidTrace(Buffer.from('{')), /UTF-8 JSON/);
  await assert.rejects(readSidTrace(Buffer.alloc(SID_TRACE_LIMITS.maximumBytes + 1)), /32 MiB/);
  const huge = await open(path.join(work, 'too-large.json'), 'w');
  try { await huge.truncate(SID_TRACE_LIMITS.maximumBytes + 1); } finally { await huge.close(); }
  await assert.rejects(readSidTrace(path.join(work, 'too-large.json')), /32 MiB/);
});

test('SID trace command encoding has explicit buffering/DC options with no coercion', () => {
  const value = trace({durationCycles: 2, writes: [{cycle: 0, register: 31, value: 255}]});
  assert.equal(encodeSidTraceCommands(value), 'SIDTRACE 1 48000 985248 2 4096 1\n0 31 255\n');
  assert.equal(encodeSidTraceCommands(value, {chunkFrames: 1, dcBlock: false}), 'SIDTRACE 1 48000 985248 2 1 0\n0 31 255\n');
  for (const options of [{chunkFrames: 0}, {chunkFrames: 8193}, {chunkFrames: '1'}, {dcBlock: 0}, {dcBlock: undefined}, {other: true}])
    assert.throws(() => encodeSidTraceCommands(value, options), /SID trace:/);
});

test('cycle-addressed Native output matches the existing WASM SidCore and exact frame clock at 44.1/48/96kHz', async () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    const value = soundingTrace(sampleRate), rendered = native(value), frames = Math.floor(value.durationCycles * sampleRate / clock);
    assert.equal(rendered.bytes.length, frames * 4); assert.equal(rendered.metadata.frames, frames);
    assert.equal(rendered.metadata.cycles, value.durationCycles); assert.equal(rendered.metadata.writeCount, value.writes.length);
    const core = await SidCore.create({sampleRate, clockHz: clock, wasmBinary});
    const pcm = new Float32Array(frames), one = new Float32Array(1); let event = 0, output = 0;
    try {
      // Reserved read31 has no audio-state side effects in the current pinned
      // core. It supplies one idle tick without changing the existing API.
      for (let cycle = 0; cycle < value.durationCycles; ++cycle) {
        if (event < value.writes.length && value.writes[event].cycle === cycle) {
          const {register, value: byte} = value.writes[event++]; core.writeRegister(register, byte);
        } else core.readRegister(31);
        const ready = Math.floor((cycle + 1) * sampleRate / clock);
        if (ready > output) { core.renderInto(one); pcm[output++] = one[0]; }
      }
      assert.equal(output, frames); assert.equal(core.getState().cycles, value.durationCycles, 'queue drain must not advance an extra tick');
      assert.equal(sha(rendered.bytes), sha(toBytes(pcm)), 'write-cycle samples and DC output must match byte for byte');
      assert.deepEqual(rendered.metadata.registers, core.getState().registers);
      assert.deepEqual(rendered.metadata.envelopes, core.getState().voices.map(voice => voice.envelope));
      assert.deepEqual(rendered.metadata.phases, core.getState().voices.map(voice => voice.phase));
      assert(pcm.some(sample => Math.abs(sample) > .01), 'comparison must include sounding PCM');
    } finally { core.dispose(); }
  }
});

test('Native output is chunk invariant and raw/DC paths differ only by the documented software stage', () => {
  const value = soundingTrace(), expected = native(value, {chunkFrames: 1});
  for (const chunkFrames of [17, 128, 4096, 8192]) {
    const current = native(value, {chunkFrames});
    assert.equal(sha(current.bytes), sha(expected.bytes));
    for (const key of ['frames', 'cycles', 'registers', 'envelopes', 'phases', 'dc']) assert.deepEqual(current.metadata[key], expected.metadata[key]);
  }
  const raw = native(value, {dcBlock: false}), samples = fromBytes(raw.bytes), dc = fromBytes(expected.bytes);
  assert.equal(raw.metadata.dc.enabled, false); assert.equal(raw.metadata.dc.previousInput, 0); assert.equal(raw.metadata.dc.previousOutput, 0);
  let previousInput = 0, previousOutput = 0, maximumDifference = 0;
  const pole = Math.exp(-2 * Math.PI * 12 / value.sampleRate);
  for (let i = 0; i < samples.length; ++i) {
    const output = samples[i] - previousInput + pole * previousOutput;
    previousInput = samples[i]; previousOutput = output;
    maximumDifference = Math.max(maximumDifference, Math.abs(Math.fround(output) - dc[i]));
  }
  assert(maximumDifference < 1e-7); assert.notEqual(sha(raw.bytes), sha(expected.bytes));
});

test('Native duration endpoint is exclusive, including cycle0 and a last-cycle write with zero output frames', () => {
  const rendered = native(trace({durationCycles: 1, writes: [{cycle: 0, register: 24, value: 15}]}));
  assert.equal(rendered.bytes.length, 0); assert.equal(rendered.metadata.frames, 0); assert.equal(rendered.metadata.cycles, 1);
  assert.equal(rendered.metadata.registers[24], 15);
  const silent = native(trace({durationCycles: clock}));
  assert.equal(silent.bytes.length, 48000 * 4); assert(silent.bytes.every(byte => byte === 0));
});

test('Native parser rejects invalid streams before writing any PCM', () => {
  const header = 'SIDTRACE 1 48000 985248 100 4096 1\n';
  const inputs = ['', 'OTHER 1 48000 985248 100 4096 1\n', 'SIDTRACE 2 48000 985248 100 4096 1\n',
    'SIDTRACE 1 7999 985248 100 4096 1\n', 'SIDTRACE 1 48000 1022727 100 4096 1\n',
    'SIDTRACE 1 48000 985248 0 4096 1\n', `SIDTRACE 1 48000 985248 ${SID_TRACE_LIMITS.maximumDurationCycles + 1} 4096 1\n`,
    'SIDTRACE 1 48000 985248 100 0 1\n', 'SIDTRACE 1 48000 985248 100 8193 1\n',
    'SIDTRACE 1 48000 985248 100 4096 2\n', header.trimEnd() + ' extra\n',
    ...['0 32 0', '0 0 256', '100 0 0', '-1 0 0', '0.5 0 0', 'NaN 0 0', '0 0 Infinity',
      '0 0 0 extra', '0 0', '0 0 0\n0 1 1', '1 0 0\n0 1 1', '\0', '\n', '9'.repeat(129) + ' 0 0'].map(line => header + line + '\n')];
  for (const input of inputs) {
    const result = spawnSync(executable, [], {input, maxBuffer: 1024 * 1024, timeout: 5000});
    assert.equal(result.status, 1, input); assert.equal(result.stdout.length, 0, input);
    assert.match(result.stderr.toString(), /SID trace renderer failed:/);
  }
});
