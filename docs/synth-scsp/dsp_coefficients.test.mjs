// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../js/scsp.js';
import {ScspSynth} from '../js/scspsynth.js';
import {Pcm44100Resampler} from '../js/pcm_44100_resampler.js';
import {DspDelay, DSP_RAM_BYTES, DSP_FEEDBACK_MAX, effectSettings, reserveDspRam} from './dsp.js';
import {SynthInstrument} from './instrument.js';

const binary = await readFile(new URL('../generated/scsp_wasm.wasm', import.meta.url));
let module;
async function core(t) {
  module ??= factory({wasmBinary: binary});
  const result = await Scsp.create({moduleFactory: () => module});
  t.after(() => result.dispose());
  return result;
}
const coefficientWords = core => [0x700, 0x702, 0x704].map(offset => core.read(offset));
const programWords = core => Array.from({length: 512}, (_, index) => core.read(0x800 + index * 2));
function signedPeak(values) {
  return values.reduce((peak, value) => Math.abs(value) > Math.abs(peak) ? value : peak, 0);
}
async function impulse(t, coefficients = {}) {
  const hardware = await core(t), synth = new ScspSynth(hardware);
  reserveDspRam(synth);
  const effect = new DspDelay(hardware, {enabled: true, timeMs: 20, feedback: .5, send: 7, returnLevel: 7});
  effect.setCoefficients(coefficients);
  const pcm = new Int16Array(64);
  pcm[1] = 4096;
  const sample = synth.loadPCM(pcm, {baseFrequencyHz: 44100 / 64});
  synth.setPreset(6, {sample, directLevel: 0});
  synth.keyOn(6);
  effect.route([6]);
  return synth.generateStereo(882 * 5).left;
}

test('COEF codes use signed high 13 bits and COEF1 shares the exact Feedback value', async t => {
  const instrument = new SynthInstrument(await core(t));
  assert.deepEqual(instrument.readDspCoefficients(), {codes: [4095, 1433, 4095], feedback: .35});
  assert.deepEqual(coefficientWords(instrument.core), [0x7ff8, 1433 * 8, 0x7ff8]);
  const result = instrument.setDspCoefficients({0: -4096, 1: -2048, 2: 4095});
  assert.deepEqual(result, {codes: [-4096, -2048, 4095], feedback: -.5});
  assert.deepEqual(coefficientWords(instrument.core), [0x8000, 0xc000, 0x7ff8]);
  assert.equal(instrument.read().config.effect.feedback, -.5);
  assert.deepEqual(instrument.read().dspCoefficients, result.codes);
  result.codes[0] = 0;
  assert.equal(instrument.readDspCoefficients().codes[0], -4096);

  const {session} = instrument.beginCode();
  instrument.code(session, 'setEffect', [{feedback: DSP_FEEDBACK_MAX}]);
  assert.deepEqual(instrument.readDspCoefficients(), {codes: [-4096, 4095, 4095], feedback: DSP_FEEDBACK_MAX});
  assert.equal(instrument.core.read(0x702), 0x7ff8);
  instrument.code(session, 'setEffect', [{feedback: -1}]);
  assert.equal(instrument.core.read(0x702), 0x8000);
  assert.equal(instrument.readDspCoefficients().codes[1], -4096);
  instrument.setEffect({feedback: .35});
  assert.equal(instrument.readDspCoefficients().feedback, .35);
  assert.equal(instrument.readDspCoefficients().codes[1], 1433);
});

test('actual DSP input gain and negative Feedback change signed impulse echoes', async t => {
  const reference = await impulse(t);
  const halfInput = await impulse(t, {2: 2048});
  const halfReturn = await impulse(t, {0: 2048});
  const negative = await impulse(t, {1: -2048});
  const mutedInput = await impulse(t, {2: 0});
  assert(mutedInput.every(value => value === 0));
  for (let echo = 1; echo <= 4; echo++) {
    const window = values => values.slice(echo * 882, (echo + 1) * 882);
    const baseline = signedPeak(window(reference));
    assert(baseline > 0);
    for (const edited of [halfInput, halfReturn]) {
      assert(Math.abs(signedPeak(window(edited)) / baseline - .5) < .02);
    }
    const shifted = signedPeak(window(negative));
    assert.equal(Math.sign(shifted), echo % 2 ? 1 : -1);
    assert(Math.abs(Math.abs(shifted / baseline) - 1) < .02);
  }
});

test('partial coefficient edits preserve other codes, ring, program, voices and Code ownership', async t => {
  const instrument = new SynthInstrument(await core(t));
  instrument.setEffect({enabled: true, timeMs: 20});
  const {session} = instrument.beginCode();
  instrument.code(session, 'noteOn', [0, 'A4']);
  instrument.noteOn('keyboard', 60);
  instrument.synth.generateStereo(4096);
  const before = instrument.read(), ram = instrument.core.readRam(), words = programWords(instrument.core);
  const frames = instrument.core.nativeFrames;
  instrument.setDspCoefficients({0: 2048});
  instrument.code(session, 'setEffect', [{feedback: -.25}]);
  instrument.setDspCoefficients({2: -1024});
  const after = instrument.read();
  assert.deepEqual(after.dspCoefficients, [2048, -1024, -1024]);
  assert.deepEqual({...after, dspCoefficients: before.dspCoefficients, config: before.config}, before);
  assert.equal(instrument.core.nativeFrames, frames);
  assert.deepEqual(instrument.core.readRam(), ram);
  assert.deepEqual(programWords(instrument.core), words);
  assert(instrument.synth.generateStereo(4096).left.some(value => value !== 0));
  assert(instrument.code(session, 'setNote', [0, 'C5']) > 0);
});

test('invalid patches are atomic and unchanged codes write no registers or RAM', async t => {
  const instrument = new SynthInstrument(await core(t));
  const before = instrument.read(), ram = instrument.core.readRam(), words = coefficientWords(instrument.core);
  let writes = 0, loads = 0;
  const write = instrument.core.write.bind(instrument.core), load = instrument.core.loadRam.bind(instrument.core);
  instrument.core.write = (...args) => {writes++; return write(...args);};
  instrument.core.loadRam = (...args) => {loads++; return load(...args);};
  for (const patch of [null, [], [1, 2, 3], new Int16Array(3), {3: 0}, {foo: 1},
    {0: 0, 2: 4096}, {0: -4097}, {1: .5}, {2: NaN}, {1: '1'}, {[Symbol('0')]: 0}]) {
    assert.throws(() => instrument.setDspCoefficients(patch));
    assert.deepEqual(instrument.read(), before);
  }
  assert.deepEqual(instrument.setDspCoefficients({0: 4095, 2: 4095}), instrument.readDspCoefficients());
  assert.deepEqual(instrument.setDspCoefficients({}), instrument.readDspCoefficients());
  assert.equal(writes, 0);
  assert.equal(loads, 0);
  assert.deepEqual(coefficientWords(instrument.core), words);
  assert.deepEqual(instrument.core.readRam(), ram);
  const quantized = instrument.setDspCoefficients({1: 1433});
  assert.equal(quantized.feedback, 1433 / 4096);
  assert.equal(writes, 0);
  assert.equal(loads, 0);
  instrument.setDspCoefficients({2: 2048});
  assert.equal(writes, 1);
  assert.equal(loads, 0);
});

test('one-shot coefficient write failure after mutation restores exact state and subsequent PCM', async t => {
  const first = new SynthInstrument(await core(t)), reference = new SynthInstrument(await core(t));
  for (const instrument of [first, reference]) {
    instrument.setEffect({enabled: true, timeMs: 20, feedback: .7});
    instrument.noteOn('held', 69);
    instrument.synth.generateStereo(4096);
  }
  const state = first.read(), ram = first.core.readRam(), coefficients = coefficientWords(first.core);
  const write = first.core.write.bind(first.core);
  let count = 0;
  first.core.write = (...args) => {
    const result = write(...args);
    if (++count === 2) throw new Error('Injected coefficient transfer failure after mutation');
    return result;
  };
  assert.throws(() => first.setDspCoefficients({0: -1024, 1: -2048, 2: 1536}), /Injected/);
  first.core.write = write;
  assert.deepEqual(first.read(), state);
  assert.deepEqual(coefficientWords(first.core), coefficients);
  assert.deepEqual(first.core.readRam(), ram);
  assert.deepEqual(first.synth.generateStereo(8192), reference.synth.generateStereo(8192));
});

test('session coefficients survive Stop and mode reloads while presets and idle state supply Feedback', async t => {
  const instrument = new SynthInstrument(await core(t));
  instrument.setDspCoefficients({0: -1024, 1: -2048, 2: 2048});
  const patch = instrument.exportPatch();
  assert.equal(patch.version, 4);
  assert.equal(patch.effect.feedback, -.5);
  assert(!Object.hasOwn(patch, 'dspCoefficients'));
  for (const reload of [() => instrument.stopVoices(), () => instrument.setConfig({mode: 'fm2'}),
    () => instrument.loadPatch(patch), () => instrument.loadIdleState(instrument.exportIdleState())]) {
    reload();
    assert.deepEqual(instrument.readDspCoefficients(), {codes: [-1024, -2048, 2048], feedback: -.5});
    assert.deepEqual(coefficientWords(instrument.core), [0xe000, 0xc000, 0x4000]);
  }
  const oldPatch = structuredClone(patch);
  oldPatch.effect.feedback = .25;
  instrument.loadPatch(oldPatch);
  assert.deepEqual(instrument.readDspCoefficients(), {codes: [-1024, 1024, 2048], feedback: .25});
  assert.deepEqual(coefficientWords(instrument.core), [0xe000, 0x2000, 0x4000]);
  const fresh = new SynthInstrument(await core(t));
  fresh.loadPatch(patch);
  assert.deepEqual(fresh.readDspCoefficients(), {codes: [4095, -2048, 4095], feedback: -.5});
  assert.equal(effectSettings().feedback, .35);
  for (const value of [-1.001, 1, NaN, Infinity, '-0.5']) assert.throws(() => effectSettings({feedback: value}));
});

async function processor(t) {
  const source = await readFile(new URL('./processor.js', import.meta.url), 'utf8');
  let Class;
  const messages = [];
  vm.runInNewContext(source.replace(/^import .*;\n/gm, ''), {
    factory, Scsp, Pcm44100Resampler, SynthInstrument, Float32Array, sampleRate: 48000,
    AudioWorkletProcessor: class {constructor() {this.port = {postMessage: message => messages.push(message)};}},
    registerProcessor(_name, value) {Class = value;},
  });
  const value = new Class({processorOptions: {wasmBinary: binary}});
  await value.ready;
  t.after(() => {value.instrument.dispose(); value.audition.dispose();});
  return {value, messages, async command(method, args = []) {
    const id = messages.length + 1;
    value.port.onmessage({data: {id, method, args}});
    await Promise.resolve();
    return messages.at(-1);
  }};
}

test('processor coefficients target only primary Synth and revalidate before any write', async t => {
  const owner = await processor(t), primary = owner.value.instrument, audition = owner.value.audition;
  const before = {state: audition.read(), ram: audition.core.readRam(), words: coefficientWords(audition.core)};
  const {session} = (await owner.command('beginCode')).value;
  assert(!(await owner.command('code', [session, 'noteOn', [0, 'A4']])).error);
  assert.deepEqual((await owner.command('setDspCoefficients', [{0: -4096, 1: -2048}])).value,
    {codes: [-4096, -2048, 4095], feedback: -.5});
  assert.deepEqual((await owner.command('readDspCoefficients')).value, primary.readDspCoefficients());
  assert.deepEqual(audition.read(), before.state);
  assert.deepEqual(audition.core.readRam(), before.ram);
  assert.deepEqual(coefficientWords(audition.core), before.words);
  assert.equal(primary.codeActive, true);
  assert.deepEqual((await owner.command('code', [session, 'setDspCoefficients', [{0: 0}]])).value,
    {codes: [0, -2048, 4095], feedback: -.5});
  assert.equal(primary.readDspCoefficients().codes[0], 0);
  assert.deepEqual(audition.read(), before.state);
  assert.deepEqual(audition.core.readRam(), before.ram);
  assert.deepEqual(coefficientWords(audition.core), before.words);
  const saved = primary.readDspCoefficients();
  assert.match((await owner.command('setDspCoefficients', [{0: 0, 2: 4096}])).error, /COEF2/);
  assert.deepEqual(primary.readDspCoefficients(), saved);
});

test('persistent coefficient rollback failure stops the processor and preserves acknowledged metadata', async t => {
  const owner = await processor(t), instrument = owner.value.instrument;
  const before = instrument.readDspCoefficients(), write = instrument.core.write.bind(instrument.core);
  instrument.core.write = (...args) => {
    if (args[0] >= 0x700 && args[0] <= 0x704) throw new Error('Persistent coefficient write failure');
    return write(...args);
  };
  const result = await owner.command('setDspCoefficients', [{0: 0}]);
  assert.equal(result.name, 'ScspDspRollbackError');
  assert(owner.messages.some(message => message.fatal && /rollback/.test(message.error)));
  assert.equal(owner.value.dead, true);
  assert.equal(owner.value.process([], [[new Float32Array(128), new Float32Array(128)]]), false);
  assert.deepEqual(instrument.readDspCoefficients(), before);
});
