// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../js/scsp.js';
import {ScspSynth} from '../js/scspsynth.js';
import {SynthInstrument} from './instrument.js';
import {DspDelay, reserveDspRam} from './dsp.js';
import {assembleScspDsp} from './dsp_assembler.js';
import {checkScspDspDelaySource} from './dsp_program.js';
import {createScspDspExample, identifyScspDspExample, identifyScspDspProgram} from './dsp_examples.js';

const binary = await readFile(new URL('../generated/scsp_wasm.wasm', import.meta.url));
const slot = 6;
let module;
async function hardware(t) {
  module ??= factory({wasmBinary: binary});
  const core = await Scsp.create({moduleFactory: () => module});
  t.after(() => core.dispose());
  return core;
}

async function setup(t, pcm, {codes = [4095, 3840, 256], program} = {}) {
  const core = await hardware(t);
  const synth = new ScspSynth(core);
  reserveDspRam(synth);
  const effect = new DspDelay(core, {enabled: true, timeMs: 20, feedback: .5, send: 7, returnLevel: 7});
  effect.applyProgram(program ?? createScspDspExample('iir1-lowpass').words, {
    coefficients: Object.fromEntries(codes.map((value, index) => [index, value])),
  });
  const sample = synth.loadPCM(pcm, {baseFrequencyHz: 44100 / pcm.length, loopStartSamples: 0});
  synth.setPreset(slot, {sample, frequencyHz: sample.rootFrequencyHz, directLevel: 0});
  synth.keyOn(slot);
  effect.route([slot]);
  // SDIR with unit sample advance supplies an independent integer stimulus.
  // Send7 maps the PCM16 sample to a 24-bit DSP input multiplied by 256.
  core.write(slot * 32 + 12, 0x100);
  return {core, synth, effect};
}

const sat24 = value => Math.max(-0x800000, Math.min(0x7fffff, value));
function reference(pcm, codes, initialOutput = 0) {
  let state = initialOutput;
  const history = [];
  const output = Int16Array.from(pcm, sample => {
    const feedback = Math.floor(state * codes[1] / 4096);
    const input = Math.floor(sample * 256 * codes[2] / 4096);
    state = sat24(feedback + input);
    history.push(state);
    return Math.floor(state / 256);
  });
  return {output, history};
}
const floatPcm = values => Float32Array.from(values, value => value / 32768);
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);

test('IIR source has an independent three-step vector and ignores unused COEF0 in named matching', async () => {
  const example = createScspDspExample('iir1-lowpass');
  assert.equal(example.source, await readFile(new URL('./examples/iir1-lowpass.scspasm', import.meta.url), 'utf8'));
  assert.deepEqual(Array.from(example.words.slice(0, 12)), [
    0x0100, 0x2000, 0x0002, 0x0200,
    0, 0xa800, 0x0001, 0x0400,
    0x0080, 0, 0x1002, 0,
  ]);
  assert(example.words.slice(12).every(value => value === 0));
  assert.deepEqual(checkScspDspDelaySource(example.source).words, example.words);
  assert.deepEqual(example.codes, [4095, 3840, 256]);
  assert.deepEqual(example.roles, ['Unused', 'Output feedback', 'Input']);
  assert.equal(example.filename, 'tetorica-scsp-iir1-lowpass.scspasm');
  assert.equal(identifyScspDspProgram(example.words), 'iir1');
  assert.equal(identifyScspDspExample(example.words), 'iir1-lowpass');
  assert.equal(identifyScspDspExample(example.words, [-4096, 3840, 256]), 'iir1-lowpass');
  assert.equal(identifyScspDspExample(example.words, [0, 3840, 256]), 'iir1-lowpass');
  assert.equal(identifyScspDspExample(example.words, [4095, 3072, 1024]), null);
  assert.equal(identifyScspDspExample(example.words, [4096, 3840, 256]), null);
  example.words[0] = 0;
  example.codes[1] = 0;
  example.roles[1] = 'changed';
  assert.deepEqual(createScspDspExample('iir1-lowpass').codes, [4095, 3840, 256]);
  assert.equal(identifyScspDspProgram(createScspDspExample('iir1-lowpass').words), 'iir1');
});

test('actual IIR impulse recurses beyond two taps and matches independent fixed-point output', async t => {
  const pcm = new Int16Array(2048);
  pcm[1] = 16384;
  const {core, synth} = await setup(t, pcm);
  const ram = core.readRam();
  const expected = reference(pcm, [4095, 3840, 256]);
  const actual = synth.generateStereo(pcm.length);
  assert.deepEqual(Array.from(expected.output.slice(0, 7)), [0, 1024, 960, 900, 843, 791, 741]);
  assert(expected.output[64] > 0);
  assert(expected.output.slice(256).every(value => value === 0));
  assert.deepEqual(actual.left, floatPcm(expected.output));
  assert.deepEqual(actual.right, actual.left);
  assert.deepEqual(core.readRam(), ram);
});

test('actual IIR state and signed extreme coefficients match every recursive EFREG sample', async t => {
  const pcm = Int16Array.from({length: 1024}, (_, index) => index < 6
    ? [-32768, -30000, 32767, 0, 1, -1][index] : (index * 7919) % 60001 - 30000);
  for (const codes of [[4095, 3840, 256], [-4096, -4096, 4095], [0, 0, -4096], [4095, 3072, 1024]]) {
    const {core, synth} = await setup(t, pcm, {codes});
    const expected = reference(pcm, codes);
    for (let index = 0; index < pcm.length; index++) {
      const output = synth.generateStereo(1);
      const effectRegister = (core.read(0xec0) << 16) >> 16;
      assert.equal(effectRegister, expected.output[index], `EFREG0 frame ${index}, codes ${codes}`);
      assert.equal(output.left[0], expected.output[index] / 32768);
      assert.equal(output.right[0], output.left[0]);
    }
  }
});

test('IIR low-pass measured response follows recursive feedback and input gain', async t => {
  const feedback = 3840 / 4096, inputGain = 256 / 4096;
  const gains = [];
  for (const period of [512, 128, 4, 2]) {
    const omega = 2 * Math.PI / period;
    const pcm = Int16Array.from({length: 8192}, (_, index) => period === 2
      ? (index % 2 ? -8192 : 8192) : Math.round(8192 * Math.sin(omega * index)));
    const {synth} = await setup(t, pcm);
    const actual = synth.generateStereo(pcm.length).left;
    const measured = rms(actual.slice(1024)) / rms(Float32Array.from(pcm.slice(1024), value => value / 32768));
    const expected = inputGain / Math.hypot(1 - feedback * Math.cos(omega), feedback * Math.sin(omega));
    assert(Math.abs(measured - expected) < .0006, `${44100 / period} Hz gain ${measured}, expected ${expected}`);
    gains.push(measured);
  }
  assert(gains[0] > .98);
  assert(gains[1] > .79 && gains[1] < .81);
  assert(gains[2] < .046);
  assert(gains[3] > .032 && gains[3] < .033);

  const pcm = new Int16Array(4096).fill(8192);
  const {synth} = await setup(t, pcm);
  const output = synth.generateStereo(pcm.length).left;
  assert.deepEqual(output, floatPcm(reference(pcm, [4095, 3840, 256]).output));
  const gain = output.at(-1) / (8192 / 32768);
  assert(gain > .999 && gain <= 1);
});

test('recursive TEMP history persists beyond one frame and Stop resets its fixed-point residual', async t => {
  const seedProgram = assembleScspDsp('000: XSEL=1 YSEL=1 IRA=32 ZERO=1\n001: TWT=1 ZERO=1\n');
  const seedPcm = new Int16Array(4).fill(-4096);
  const {core, synth, effect} = await setup(t, seedPcm, {codes: [-4096, 3840, 256], program: seedProgram});
  synth.generateStereo(128);
  const silent = synth.loadPCM(new Int16Array(4096), {baseFrequencyHz: 44100 / 4096, loopStartSamples: 0});
  synth.setPreset(slot, {sample: silent, frequencyHz: silent.rootFrequencyHz, directLevel: 0});
  synth.keyOn(slot);
  effect.route([slot]);
  core.write(slot * 32 + 12, 0x100);
  effect.applyProgram(createScspDspExample('iir1-lowpass').words, {coefficients: {0: 4095, 1: 3840, 2: 256}});
  const expected = reference(new Int16Array(4096), [4095, 3840, 256], 4096 * 256);
  const actual = synth.generateStereo(4096).left;
  assert.deepEqual(actual, floatPcm(expected.output));
  assert(actual[0] !== 0 && actual[64] !== 0);
  assert(actual.slice(256).every(value => value === 0));

  const negative = await setup(t, new Int16Array(4096), {codes: [4095, 3840, 256], program: seedProgram});
  // Seed negative state using the input before switching to the IIR silence source.
  const seed = negative.synth.loadPCM(seedPcm, {baseFrequencyHz: 44100 / seedPcm.length, loopStartSamples: 0});
  negative.synth.setPreset(slot, {sample: seed, frequencyHz: seed.rootFrequencyHz, directLevel: 0});
  negative.synth.keyOn(slot);
  negative.effect.route([slot]);
  negative.core.write(slot * 32 + 12, 0x100);
  negative.synth.generateStereo(128);
  const zeros = negative.synth.loadPCM(new Int16Array(4096), {baseFrequencyHz: 44100 / 4096, loopStartSamples: 0});
  negative.synth.setPreset(slot, {sample: zeros, frequencyHz: zeros.rootFrequencyHz, directLevel: 0});
  negative.synth.keyOn(slot);
  negative.effect.route([slot]);
  negative.core.write(slot * 32 + 12, 0x100);
  negative.effect.applyProgram(createScspDspExample('iir1-lowpass').words, {coefficients: {0: 4095, 1: 3840, 2: 256}});
  const negativeInitial = Math.floor(-4096 * 256 * 4095 / 4096);
  const expectedNegative = reference(new Int16Array(4096), [4095, 3840, 256], negativeInitial);
  const residual = negative.synth.generateStereo(4096).left;
  assert.deepEqual(residual, floatPcm(expectedNegative.output));
  assert.equal(expectedNegative.history.at(-1), -15);
  assert.equal(residual.at(-1), -1 / 32768);
  negative.synth.stopVoices();
  negative.effect.install();
  assert(negative.synth.generateStereo(1024).left.every(value => value === 0));
});

test('IIR partitioning and Delay Time changes preserve the native recursive sequence', async t => {
  const pcm = Int16Array.from({length: 4096}, (_, index) => Math.round(8192 * Math.sin(index * .43)));
  const whole = await setup(t, pcm), partitioned = await setup(t, pcm);
  const expected = whole.synth.generateStereo(pcm.length);
  const actual = {left: new Float32Array(pcm.length), right: new Float32Array(pcm.length)};
  let offset = 0;
  for (const count of [1, 7, 31, 61, 128, 513, 5, 1024, 2326]) {
    if (offset === 100) {
      partitioned.effect.configure({timeMs: 600});
      partitioned.effect.setCoefficients({0: -4096});
    }
    const next = partitioned.synth.generateStereo(count);
    actual.left.set(next.left, offset);
    actual.right.set(next.right, offset);
    offset += count;
  }
  assert.equal(offset, pcm.length);
  assert.deepEqual(actual, expected);
});

test('applying IIR retains keyboard and Code owners, sample phase and sample RAM', async t => {
  const core = await hardware(t);
  const instrument = new SynthInstrument(core);
  instrument.setEffect({enabled: true, timeMs: 20});
  const {session} = instrument.beginCode();
  instrument.code(session, 'noteOn', [0, 'A4']);
  instrument.noteOn('keyboard', 60);
  instrument.synth.generateStereo(257);
  const state = instrument.read(), sampleRam = core.readRam(65536), frames = core.nativeFrames;
  const example = createScspDspExample('iir1-lowpass');
  instrument.applyDspProgram(example.words, {coefficients: {0: 4095, 1: 3840, 2: 256}});
  const after = instrument.read();
  assert.deepEqual(after.voiceGroups, state.voiceGroups);
  assert.deepEqual(after.manualVoices, state.manualVoices);
  assert.deepEqual(after.slots, state.slots);
  assert.equal(after.codeSession, state.codeSession);
  assert.equal(after.codeActive, true);
  assert.equal(core.nativeFrames, frames);
  assert.deepEqual(core.readRam(65536), sampleRam);
  assert(instrument.synth.generateStereo(2048).left.some(value => value !== 0));
  assert(instrument.code(session, 'setNote', [0, 'C5']) > 0);
});
