import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../../docs/generated/scsp_wasm.js';
import {Scsp} from '../../tetorica_src/runtime/scsp.js';
import {ScspSynth} from '../../tetorica_src/runtime/scspsynth.js';
import {ScspDspProgram} from '../../tetorica_src/runtime/scsp_dsp.js';
import {assembleScspDsp} from '../../tetorica_src/runtime/scsp_dsp_assembler.js';
import {validateScspDspRegisterProgram} from '../../tetorica_src/runtime/scsp_dsp_program.js';

const binary = await readFile(new URL('../../docs/generated/scsp_wasm.wasm', import.meta.url));
let module;
const gainSource = '000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0\n001: EWT=1 ZERO=1\n';
const iirSource = '000: TRA=1 XSEL=0 YSEL=1 ZERO=1 COEF=1\n001: XSEL=1 YSEL=1 IRA=32 BSEL=1 COEF=2\n002: TWT=1 EWT=1 ZERO=1\n';
const gain = assembleScspDsp(gainSource);
const iir = assembleScspDsp(iirSource);
const coefficients = codes => ({coefficients: Object.fromEntries(codes.map((code, index) => [index, code]))});

async function hardware(t) {
  module ??= factory({wasmBinary: binary});
  const core = await Scsp.create({moduleFactory: () => module});
  t.after(() => core.dispose());
  return core;
}

async function voice(t, pcm, words = iir, codes = [0, 3840, 256]) {
  const core = await hardware(t), synth = new ScspSynth(core), owner = new ScspDspProgram(core);
  const sample = synth.loadPCM(pcm, {baseFrequencyHz: 44100 / pcm.length, loopStartSamples: 0});
  synth.setPreset(6, {sample, frequencyHz: sample.rootFrequencyHz, directLevel: 0});
  synth.keyOn(6);
  owner.applyProgram(words, coefficients(codes));
  owner.setReturn({level: 7});
  core.write(6 * 32 + 20, 7);
  // A unit sample advance and SDIR provide an independent integer stimulus.
  core.write(6 * 32 + 12, 0x100);
  return {core, synth, owner, sample};
}

const programWords = core => Array.from({length: 512}, (_, index) => core.read(0x800 + index * 2));
const coefficientWords = core => [0x700, 0x702, 0x704].map(offset => core.read(offset));
const tempWords = core => Array.from({length: 256}, (_, index) => core.read(0xc00 + index * 2));
const sat24 = value => Math.max(-0x800000, Math.min(0x7fffff, value));
const asFloat = pcm => Float32Array.from(pcm, value => value / 32768);
function referenceIir(pcm, codes, initial = 0) {
  let state = initial;
  const output = Int16Array.from(pcm, sample => {
    state = sat24(Math.floor(state * codes[1] / 4096) + Math.floor(sample * 256 * codes[2] / 4096));
    return Math.floor(state / 256);
  });
  return {output, state};
}

test('canonical and served DSP modules match and construction / readback perform no writes', async () => {
  for (const name of ['scsp_dsp', 'scsp_dsp_program', 'scsp_dsp_coefficients']) {
    assert.deepEqual(await readFile(new URL(`../../tetorica_src/runtime/${name}.js`, import.meta.url)),
      await readFile(new URL(`../../docs/js/${name}.js`, import.meta.url)));
  }
  const writes = [], owner = new ScspDspProgram({write: (...args) => writes.push(args)});
  const initial = owner.readProgram();
  assert.deepEqual(initial, {profile: 'ram-free', configured: false, words: Array(512).fill(0),
    revision: 0, coefficients: {codes: [0, 0, 0]}, return: {level: 0, pan: 0}});
  owner.restore();
  initial.words[0] = 1;
  initial.coefficients.codes[0] = 1;
  initial.return.level = 7;
  assert.equal(owner.readProgram().words[0], 0);
  assert.deepEqual(owner.readCoefficients(), {codes: [0, 0, 0]});
  assert.equal(owner.readProgram().return.level, 0);
  assert.deepEqual(writes, []);
});

test('RAM-free gain uses the signed Q12 coefficient and leaves the complete PCM bank intact', async t => {
  const pcm = Int16Array.from({length: 512}, (_, index) => index < 7
    ? [-32768, -1, 0, 1, 32767, 10000, -10000][index] : (index * 7919) % 20001 - 10000);
  for (const code of [-4096, -2048, 0, 2048, 4095]) {
    const {core, synth, sample} = await voice(t, pcm, gain, [code, 0, 0]);
    const ram = core.readRam();
    assert.equal(sample.address, 0);
    assert.equal(core.read(0x402), 0);
    const expected = asFloat(Int16Array.from(pcm, value => Math.floor(sat24(Math.floor(value * 256 * code / 4096)) / 256)));
    const actual = synth.generateStereo(pcm.length);
    assert.deepEqual(actual.left, expected);
    assert.deepEqual(actual.right, expected);
    assert.deepEqual(core.readRam(), ram);
    assert.equal(synth.getState().ramUsedBytes, (pcm.length + 1) * 2);
  }
});

test('IIR impulse and live coefficient changes match independent sample history without retriggering', async t => {
  const pcm = new Int16Array(1024);
  pcm[1] = 16384;
  const {core, synth, owner} = await voice(t, pcm);
  const ram = core.readRam(), state = synth.getState();
  const first = referenceIir(pcm.slice(0, 37), [0, 3840, 256]);
  assert.deepEqual(Array.from(first.output.slice(0, 7)), [0, 1024, 960, 900, 843, 791, 741]);
  assert.deepEqual(synth.generateStereo(37).left, asFloat(first.output));
  const history = tempWords(core), frames = core.nativeFrames, program = programWords(core);
  assert.deepEqual(owner.setCoefficients({1: 3072, 2: 1024}), {codes: [0, 3072, 1024]});
  assert.equal(core.nativeFrames, frames);
  assert.deepEqual(tempWords(core), history);
  assert.deepEqual(programWords(core), program);
  assert.deepEqual(synth.getState(), state);
  const second = referenceIir(pcm.slice(37), [0, 3072, 1024], first.state);
  assert.deepEqual(synth.generateStereo(pcm.length - 37).left, asFloat(second.output));
  assert.deepEqual(core.readRam(), ram);
});

test('program Apply preserves running TEMP history, gates, sample phase and RAM', async t => {
  const pcm = new Int16Array(1024).fill(8192);
  const a = await voice(t, pcm), b = await voice(t, pcm);
  for (const owner of [a, b]) owner.synth.generateStereo(91);
  const before = a.owner.readProgram(), history = tempWords(a.core), ram = a.core.readRam(), slots = a.synth.getState().slots;
  const changed = iir.slice();
  changed[3] |= 2; // An unused address input bit is rejected below, so use a real arithmetic edit.
  assert.throws(() => a.owner.applyProgram(changed), /ADREB/);
  const withTrailingZero = iir.slice();
  withTrailingZero[40] = 0x80; // A later TEMP write makes a distinct executable image.
  a.owner.applyProgram(withTrailingZero);
  assert.equal(a.owner.readProgram().revision, before.revision + 1);
  assert.deepEqual(tempWords(a.core), history);
  assert.deepEqual(a.synth.getState().slots, slots);
  assert.deepEqual(a.core.readRam(), ram);
  assert.deepEqual(a.synth.generateStereo(128), b.synth.generateStereo(128));
});

test('first explicit empty configuration starts input clearing and same settings make no writes', async t => {
  const core = await hardware(t), owner = new ScspDspProgram(core);
  const write = core.write.bind(core), writes = [];
  core.write = (...args) => {writes.push(args); return write(...args);};
  owner.setReturn({level: 0, pan: 0});
  assert(owner.readProgram().configured);
  assert.equal(owner.readProgram().revision, 0);
  assert.deepEqual(writes.at(-2), [0xbf0, 0]);
  writes.length = 0;
  owner.ensureStarted();
  owner.setCoefficients({0: 0, 1: 0, 2: 0});
  owner.setReturn({level: 0});
  owner.applyProgram(new Uint16Array(512));
  assert.deepEqual(writes, []);
});

test('Start preserves word504 and a later empty program replaces the entire prior image', async t => {
  const {core, synth, owner} = await voice(t, new Int16Array(256).fill(8192), gain, [2048, 0, 0]);
  const extended = gain.slice();
  extended[504] = 0x0081;
  owner.applyProgram(extended);
  assert.equal(core.read(0xbf0), 0x0081);
  assert.deepEqual(programWords(core), Array.from(extended));
  assert(synth.generateStereo(32).left.some(value => value !== 0));
  owner.applyProgram(new Uint16Array(512));
  assert.deepEqual(programWords(core), Array(512).fill(0));
  assert(synth.generateStereo(32).left.every(value => value === 0));
});

test('invalid programs, setup tables and partial settings are rejected before every core write', () => {
  const writes = [], owner = new ScspDspProgram({write: (...args) => writes.push(args)}), initial = owner.readProgram();
  const sources = ['000: RAW0=0x8000', '000: IRA=50', '000: YSEL=1 COEF=3', '000: EWT=1 EWA=2',
    '001: MRD=1', '001: MWT=1', '000: TABLE=1', '000: NOFL=1', '000: MASA=1', '000: ADREB=1', '000: NXADR=1'];
  for (const source of sources) assert.throws(() => owner.applyProgram(assembleScspDsp(source)), /Step/);
  for (const value of [null, [], new Uint8Array(512), Array(511).fill(0), [...Array(511).fill(0), -1]]) {
    assert.throws(() => owner.applyProgram(value));
  }
  for (const options of [null, {}, {coefficients: {0: 0, 1: 0}}, {coefficients: {0: 0, 1: 0, 2: 4096}},
    {coefficients: {0: 0, 1: 0, 2: 0}, extra: true}]) assert.throws(() => owner.applyProgram(gain, options));
  for (const patch of [null, [], {3: 0}, {0: 1, 2: NaN}, {1: .5}, {0: -4097}, {[Symbol('0')]: 0}]) {
    assert.throws(() => owner.setCoefficients(patch));
  }
  for (const patch of [null, [], {level: 8}, {pan: 32}, {level: 1, pan: -1}, {pan: 1.1}, {other: 1}]) {
    assert.throws(() => owner.setReturn(patch));
  }
  assert.deepEqual(owner.readProgram(), initial);
  assert.deepEqual(writes, []);
});

test('program and coefficient data are owned and independent per core', async t => {
  const a = await voice(t, new Int16Array(64).fill(8192)), b = await voice(t, new Int16Array(64).fill(8192));
  const words = gain.slice(), setup = coefficients([2048, 0, 0]);
  const read = a.owner.applyProgram(words, setup);
  words.fill(0);
  setup.coefficients[0] = 0;
  read.words.fill(0);
  read.coefficients.codes.fill(0);
  a.owner.setReturn({level: 4, pan: 15});
  assert.deepEqual(a.owner.readProgram().words, Array.from(gain));
  assert.deepEqual(a.owner.readCoefficients(), {codes: [2048, 0, 0]});
  assert.deepEqual(b.owner.readCoefficients(), {codes: [0, 3840, 256]});
  assert.deepEqual(b.owner.readProgram().return, {level: 7, pan: 0});
  assert.notDeepEqual(a.synth.generateStereo(64), b.synth.generateStereo(64));
});

test('failed partial Apply and coefficient / return writes restore registers and same-phase PCM', async t => {
  const pcm = Int16Array.from({length: 1024}, (_, index) => Math.round(6000 * Math.sin(index * .37)));
  const cases = [
    ...[1, 2, 133, 515, 516, 517, 518].map(at => ({at, invoke: owner => owner.applyProgram(gain, coefficients([2048, -2048, 1024]))})),
    {at: 2, invoke: owner => owner.setCoefficients({0: 2048, 1: -2048, 2: 1024})},
    {at: 1, invoke: owner => owner.setReturn({level: 2, pan: 31})},
  ];
  for (const {at, invoke} of cases) {
    const a = await voice(t, pcm), b = await voice(t, pcm);
    for (const instrument of [a, b]) instrument.synth.generateStereo(71);
    const before = {metadata: a.owner.readProgram(), program: programWords(a.core), codes: coefficientWords(a.core),
      outputReturn: a.core.read(22), ram: a.core.readRam(), history: tempWords(a.core), state: a.synth.getState()};
    const write = a.core.write.bind(a.core);
    let count = 0;
    a.core.write = (...args) => {
      const result = write(...args);
      if (++count === at) throw new Error('Injected post-write failure');
      return result;
    };
    assert.throws(() => invoke(a.owner), /Injected/);
    a.core.write = write;
    assert.deepEqual(a.owner.readProgram(), before.metadata);
    assert.deepEqual(programWords(a.core), before.program);
    assert.deepEqual(coefficientWords(a.core), before.codes);
    assert.equal(a.core.read(22), before.outputReturn);
    assert.deepEqual(a.core.readRam(), before.ram);
    assert.deepEqual(tempWords(a.core), before.history);
    assert.deepEqual(a.synth.getState(), before.state);
    assert.deepEqual(a.synth.generateStereo(128), b.synth.generateStereo(128));
  }
});

test('failed rollback marks the owner error fatal and retains the last acknowledged metadata', async t => {
  const {core, owner} = await voice(t, new Int16Array(64).fill(8192)), before = owner.readProgram();
  const write = core.write.bind(core);
  core.write = () => {throw new Error('Persistent register failure');};
  assert.throws(() => owner.applyProgram(gain), error => error.name === 'ScspDspRollbackError' && error.fatal === true);
  core.write = write;
  assert.deepEqual(owner.readProgram(), before);
});

test('restore reinstalls acknowledged program, coefficients and return after core reset', async t => {
  const {core, owner} = await voice(t, new Int16Array(64).fill(8192));
  owner.setReturn({level: 5, pan: 17});
  const before = owner.readProgram(), ram = core.readRam();
  core.reset();
  owner.restore();
  assert.deepEqual(owner.readProgram(), before);
  assert.deepEqual(programWords(core), before.words);
  assert.deepEqual(coefficientWords(core), before.coefficients.codes.map(code => (code & 0x1fff) << 3));
  assert.equal(core.read(22) & 0xff, (5 << 5) | 17);
  assert.deepEqual(core.readRam(), ram);
});

test('a failed post-reset restore is fatal even when the reset register image can be rolled back', async t => {
  const {core, owner} = await voice(t, new Int16Array(64).fill(8192));
  const before = owner.readProgram();
  core.reset();
  const write = core.write.bind(core);
  let count = 0;
  core.write = (...args) => {
    const result = write(...args);
    if (++count === 133) throw new Error('Injected restore failure');
    return result;
  };
  assert.throws(() => owner.restore(), error => error.name === 'ScspDspRestoreError' && error.fatal === true);
  core.write = write;
  assert.deepEqual(programWords(core), Array(512).fill(0));
  assert.deepEqual(owner.readProgram(), before);
});

test('transport snapshot adoption validates owned metadata without writes and rejects partial snapshots atomically', () => {
  const source = new ScspDspProgram({write() {}});
  source.applyProgram(iir, coefficients([0, 3840, 256]));
  source.setReturn({level: 7, pan: 31});
  const writes = [], target = new ScspDspProgram({write: (...args) => writes.push(args)}), snapshot = source.readProgram();
  target.adoptState(snapshot);
  const before = target.readProgram();
  snapshot.words.fill(0);
  snapshot.coefficients.codes.fill(0);
  snapshot.return.level = 0;
  assert.deepEqual(target.readProgram(), before);
  for (const patch of [{profile: 'delay'}, {configured: 'yes'}, {revision: -1}, {coefficients: {codes: [0, 1]}},
    {return: {level: 8, pan: 0}}, {words: assembleScspDsp('001: MWT=1')}, {extra: true}, {configured: false}]) {
    assert.throws(() => target.adoptState({...before, ...patch}));
    assert.deepEqual(target.readProgram(), before);
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(validateScspDspRegisterProgram(iir), iir);
});
