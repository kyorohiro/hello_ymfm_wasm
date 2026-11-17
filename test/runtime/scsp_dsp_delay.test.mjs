import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../../docs/generated/scsp_wasm.js';
import {Scsp} from '../../tetorica_src/runtime/scsp.js';
import {ScspSynth} from '../../tetorica_src/runtime/scspsynth.js';
import {ScspDspProgram} from '../../tetorica_src/runtime/scsp_dsp.js';
import {assembleScspDsp} from '../../tetorica_src/runtime/scsp_dsp_assembler.js';
import {SCSP_DSP_DELAY_RAM_BYTES, SCSP_DSP_DELAY_ALIGNMENT, createScspDspDelayProgram,
  createScspDspDelaySilence, resolveScspDspDelay, validateScspDspDelayRam} from '../../tetorica_src/runtime/scsp_dsp_delay.js';
import {DspDelay, delayProgram} from '../../docs/synth-scsp/dsp.js';

const binary = await readFile(new URL('../../docs/generated/scsp_wasm.wasm', import.meta.url));
const RAM = SCSP_DSP_DELAY_RAM_BYTES;
const reservation = address => ({address, byteLength: RAM});
const peak = values => values.reduce((value, next) => Math.max(value, Math.abs(next)), 0);
const gain = assembleScspDsp('000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0\n001: EWT=1 ZERO=1');
let module;

async function hardware(t) {
  module ??= factory({wasmBinary: binary});
  const core = await Scsp.create({moduleFactory: () => module});
  t.after(() => core.dispose());
  return core;
}

async function instrument(t, {address = 0, feedback = .5, reference = false} = {}) {
  const core = await hardware(t), synth = new ScspSynth(core);
  synth.loadPCM(new Int16Array((address + RAM) / 2 - 1), {rootNote: 69});
  if (address) core.loadRam(new Uint8Array(address).fill(0x5a), 0);
  const settings = {enabled: true, timeMs: 20, feedback};
  let owner;
  if (reference) {
    assert.equal(address, 0);
    owner = new DspDelay(core, {...settings, send: 7, returnLevel: 7});
  } else {
    owner = new ScspDspProgram(core);
    owner.setDelay(settings, reservation(address));
    owner.setReturn({level: 7});
  }
  const pcm = new Int16Array(64);
  pcm[8] = 4096;
  const sample = synth.loadPCM(pcm, {baseFrequencyHz: 44100 / 64});
  synth.setPreset(6, {sample, frequencyHz: sample.rootFrequencyHz, directLevel: 0});
  synth.keyOn(6);
  core.write(6 * 32 + 12, 0x100);
  core.write(6 * 32 + 20, 7);
  return {core, synth, owner, sample};
}

const programWords = core => Array.from({length: 512}, (_, index) => core.read(0x800 + index * 2));
const coefficientWords = core => [0x700, 0x702, 0x704].map(offset => core.read(offset));
const tempWords = core => Array.from({length: 256}, (_, index) => core.read(0xc00 + index * 2));
function snapshot({core, synth, owner}) {
  return {metadata: owner.readProgram(), program: programWords(core), coefficients: coefficientWords(core),
    addresses: [0x402, 0x780, 0x782].map(offset => core.read(offset)), outputReturn: core.read(22),
    ram: core.readRam(), history: tempWords(core), state: synth.getState(), frames: core.nativeFrames};
}

test('fixed program and packed silence reproduce the existing Synth and validate owned Delay settings', () => {
  assert.equal(SCSP_DSP_DELAY_ALIGNMENT, 8192);
  assert.deepEqual(createScspDspDelayProgram(), delayProgram());
  assert.deepEqual(resolveScspDspDelay({}), {enabled: false, timeMs: 240, feedback: 1433 / 4096});
  assert.deepEqual(resolveScspDspDelay({feedback: -.1}), {enabled: false, timeMs: 240, feedback: -410 / 4096});
  assert.deepEqual(validateScspDspDelayRam(reservation(458752)), reservation(458752));
  const silence = createScspDspDelaySilence();
  assert.equal(silence.length, RAM);
  assert(silence.every((value, index) => value === (index % 2 ? 0 : 0x60)));
  silence.fill(1);
  assert.equal(createScspDspDelaySilence()[0], 0x60);
  for (const patch of [null, [], {enabled: 1}, {timeMs: 19}, {timeMs: 701}, {timeMs: 20.5},
    {feedback: 1}, {feedback: -1.01}, {feedback: NaN}, {send: 7}, {[Symbol('enabled')]: true}]) {
    assert.throws(() => resolveScspDspDelay(patch));
  }
  for (const value of [null, {}, reservation(-8192), reservation(1), reservation(458753),
    reservation(524288), {address: 0, byteLength: RAM - 1}, {...reservation(0), extra: true}]) {
    assert.throws(() => validateScspDspDelayRam(value));
  }
});

test('actual fixed Delay matches existing-Synth stereo PCM at zero and nonzero ring bases', async t => {
  for (const feedback of [0, .35, .5, -.5]) {
    for (const address of [0, 8192]) {
      const actual = await instrument(t, {address, feedback}), reference = await instrument(t, {feedback, reference: true});
      const protectedPrefix = actual.core.readRam(0, address);
      const pcm = actual.core.readRam(address + RAM, 130);
      assert.deepEqual(actual.owner.readProgram().words, Array.from(delayProgram()));
      assert.equal(actual.core.read(0x402) & 0x1bf, (2 << 7) | address / 8192);
      const output = actual.synth.generateStereo(882 * 7), expected = reference.synth.generateStereo(882 * 7);
      assert.deepEqual(output, expected);
      assert(output.left.slice(0, 882).every(value => value === 0));
      assert(peak(output.left.slice(882, 1764)) > .001);
      if (feedback === 0) assert(output.left.slice(1764).every(value => value === 0));
      if (feedback === .5) {
        for (let echo = 2; echo <= 6; echo++) {
          const ratio = peak(output.left.slice(882 * echo, 882 * (echo + 1))) /
            peak(output.left.slice(882 * (echo - 1), 882 * echo));
          assert(Math.abs(ratio - .5) < .01);
        }
      }
      assert.deepEqual(actual.core.readRam(0, address), protectedPrefix);
      assert.deepEqual(actual.core.readRam(address + RAM, 130), pcm);
    }
  }
});

test('render partitioning preserves the fixed Delay and live edits retain held voices and ring history', async t => {
  const a = await instrument(t, {address: 8192}), b = await instrument(t, {address: 8192});
  const whole = a.synth.generateStereo(7000), parts = [13, 121, 2531, 7, 4328];
  const partitioned = {left: new Float32Array(7000), right: new Float32Array(7000)};
  let offset = 0;
  for (const frames of parts) {
    const output = b.synth.generateStereo(frames);
    partitioned.left.set(output.left, offset);partitioned.right.set(output.right, offset);offset += frames;
  }
  assert.deepEqual(partitioned, whole);
  const before = snapshot(a);
  a.owner.setDelay({feedback: -.5}, reservation(8192));
  assert.deepEqual(a.core.readRam(), before.ram);
  assert.deepEqual(tempWords(a.core), before.history);
  assert.deepEqual(a.synth.getState(), before.state);
  assert.equal(a.core.nativeFrames, before.frames);
  assert.equal(a.owner.readProgram().delay.feedback, -.5);
  a.owner.setCoefficients({1: 1024, 0: 2048});
  assert.equal(a.owner.readProgram().delay.feedback, .25);
  assert.deepEqual(a.owner.readCoefficients(), {codes: [2048, 1024, 4095]});
  a.owner.setReturn({level: 4, pan: 31});
  assert.deepEqual(a.core.readRam(), before.ram);
  assert.equal(a.core.read(22) & 0xff, (4 << 5) | 31);
});

test('Time and Enable clear the reserved ring, retain PCM / voices and restore the logical return', async t => {
  const a = await instrument(t, {address: 8192});
  a.synth.generateStereo(1200);
  const before = snapshot(a), pcm = a.core.readRam(8192 + RAM, 130);
  a.owner.setDelay({timeMs: 30}, reservation(8192));
  assert.equal(a.core.read(0x780), 1323);
  assert.deepEqual(a.core.readRam(8192, RAM), createScspDspDelaySilence());
  assert.deepEqual(a.core.readRam(0, 8192), before.ram.slice(0, 8192));
  assert.deepEqual(a.core.readRam(8192 + RAM, 130), pcm);
  assert.deepEqual(a.synth.getState(), before.state);
  a.owner.setDelay({enabled: false}, reservation(8192));
  assert.equal(a.core.read(22) & 0xff, 0);
  assert.deepEqual(a.owner.setReturn({level: 5, pan: 15}), {level: 5, pan: 15});
  assert.equal(a.core.read(22) & 0xff, 0);
  a.owner.setDelay({enabled: true}, reservation(8192));
  assert.equal(a.core.read(22) & 0xff, (5 << 5) | 15);
  assert.deepEqual(a.owner.readProgram().return, {level: 5, pan: 15});
  assert(a.synth.generateStereo(2000).left.every(value => value === 0));
});

test('Delay program replacement and reset restoration keep bounded RAM ownership and snapshot metadata', async t => {
  const a = await instrument(t, {address: 8192});
  a.synth.generateStereo(1200);
  const before = a.owner.readProgram(), pcm = a.core.readRam(8192 + RAM, 130);
  a.core.reset();a.owner.restore();
  assert.deepEqual(a.owner.readProgram(), before);
  assert.deepEqual(a.core.readRam(8192, RAM), createScspDspDelaySilence());
  assert.deepEqual(a.core.readRam(8192 + RAM, 130), pcm);
  assert.equal(a.core.read(0x402) & 0x1bf, (2 << 7) | 1);
  assert.deepEqual(programWords(a.core), before.words);
  assert.deepEqual(coefficientWords(a.core), before.coefficients.codes.map(code => (code & 0x1fff) << 3));
  assert.equal(a.core.read(22) & 0xff, 7 << 5);
  const ram = a.core.readRam();
  const free = a.owner.applyProgram(gain, {coefficients: {0: 2048, 1: 0, 2: 0}});
  assert.equal(free.profile, 'ram-free');
  assert(!Object.hasOwn(free, 'delay'));assert(!Object.hasOwn(free, 'ram'));
  assert.deepEqual(a.core.readRam(), ram);
  a.owner.setDelay({enabled: true, timeMs: 20}, reservation(8192));
  assert.equal(a.owner.readProgram().profile, 'delay-ring');
  assert.deepEqual(a.owner.readCoefficients().codes, [4095, 1433, 4095]);
});

test('invalid Delay settings and reservations reject before writes and preserve live history', async t => {
  const a = await instrument(t, {address: 8192});a.synth.generateStereo(1000);
  const before = snapshot(a), write = a.core.write.bind(a.core), loadRam = a.core.loadRam.bind(a.core);
  let writes = 0;a.core.write = (...args) => {writes++;return write(...args);};
  a.core.loadRam = (...args) => {writes++;return loadRam(...args);};
  for (const patch of [{timeMs: 0}, {feedback: 1}, {enabled: 1}, {send: 7}, null]) {
    assert.throws(() => a.owner.setDelay(patch, reservation(8192)));
  }
  for (const ram of [reservation(2), reservation(524288), {address: 0, byteLength: 1}, null]) {
    assert.throws(() => a.owner.setDelay({enabled: true}, ram));
  }
  assert.equal(writes, 0);a.core.write = write;a.core.loadRam = loadRam;
  assert.deepEqual(snapshot(a), before);
});

test('failed Delay setup restores program, address registers, coefficients, return, ring and same-phase PCM', async t => {
  for (const point of [2, 23, 519, 'ram']) {
    const a = await instrument(t, {address: 8192}), b = await instrument(t, {address: 8192});
    for (const item of [a, b]) {
      item.owner.applyProgram(gain, {coefficients: {0: 2048, 1: 0, 2: 0}});
      item.synth.generateStereo(73);
    }
    const before = snapshot(a), write = a.core.write.bind(a.core), loadRam = a.core.loadRam.bind(a.core);
    let writes = 0, injected = false;
    a.core.write = (...args) => {
      const result = write(...args);
      if (++writes === point) {injected = true;throw new Error('Injected register failure');}
      return result;
    };
    a.core.loadRam = (...args) => {
      const result = loadRam(...args);
      if (point === 'ram' && !injected) {injected = true;throw new Error('Injected RAM failure');}
      return result;
    };
    assert.throws(() => a.owner.setDelay({enabled: true, timeMs: 30, feedback: .5}, reservation(8192)), /Injected/);
    a.core.write = write;a.core.loadRam = loadRam;
    assert(injected);assert.deepEqual(snapshot(a), before);
    assert.deepEqual(a.synth.generateStereo(128), b.synth.generateStereo(128));
  }
});

test('failed ring rollback and post-reset restore report fatal ownership errors', async t => {
  const a = await instrument(t, {address: 8192}), before = a.owner.readProgram();
  const loadRam = a.core.loadRam.bind(a.core);
  a.core.loadRam = () => {throw new Error('Persistent RAM failure');};
  assert.throws(() => a.owner.setDelay({timeMs: 30}, reservation(8192)),
    error => error.name === 'ScspDspRollbackError' && error.fatal === true);
  a.core.loadRam = loadRam;assert.deepEqual(a.owner.readProgram(), before);
  a.core.reset();
  const write = a.core.write.bind(a.core);let writes = 0;
  a.core.write = (...args) => {const result = write(...args);if (++writes === 23) throw new Error('Injected restore');return result;};
  assert.throws(() => a.owner.restore(), error => error.name === 'ScspDspRestoreError' && error.fatal === true);
  a.core.write = write;assert.deepEqual(a.owner.readProgram(), before);
});

test('Delay snapshots are detached, adopt without writes and reject inconsistent metadata atomically', async t => {
  const a = await instrument(t, {address: 8192}), writes = [];
  const target = new ScspDspProgram({write: (...args) => writes.push(args)});
  const value = a.owner.readProgram();target.adoptState(value);
  const before = target.readProgram();
  value.words.fill(0);value.coefficients.codes.fill(0);value.delay.enabled = false;value.ram.address = 0;value.return.level = 0;
  assert.deepEqual(target.readProgram(), before);
  const patches = [{profile: 'unknown'}, {configured: false}, {revision: -1}, {words: gain},
    {delay: {enabled: true, timeMs: 20}}, {delay: {enabled: true, timeMs: 20, feedback: .1}},
    {delay: {...before.delay, other: true}}, {ram: reservation(1)}, {ram: {...before.ram, extra: true}},
    {coefficients: {codes: [4095, 0, 4095]}}, {return: {level: 8, pan: 0}}];
  for (const patch of patches) {
    assert.throws(() => target.adoptState({...before, ...patch}));
    assert.deepEqual(target.readProgram(), before);
  }
  assert.deepEqual(writes, []);
});
