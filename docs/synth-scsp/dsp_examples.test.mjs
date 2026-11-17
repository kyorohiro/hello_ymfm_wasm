// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../js/scsp.js';
import {ScspSynth} from '../js/scspsynth.js';
import {DspDelay, delayProgram, reserveDspRam} from './dsp.js';
import {assembleScspDsp} from './dsp_assembler.js';
import {checkScspDspDelaySource} from './dsp_program.js';
import {createScspDspExample, identifyScspDspExample, identifyScspDspProgram, listScspDspExamples} from './dsp_examples.js';

const binary = await readFile(new URL('../generated/scsp_wasm.wasm', import.meta.url));
const slot = 6;
let module;
async function setup(t, pcm, {codes = [4095, 2048, 2048], program, loop = false} = {}) {
  module ??= factory({wasmBinary: binary});
  const core = await Scsp.create({moduleFactory: () => module});
  t.after(() => core.dispose());
  const synth = new ScspSynth(core);
  reserveDspRam(synth);
  const effect = new DspDelay(core, {enabled: true, timeMs: 20, feedback: .5, send: 7, returnLevel: 7});
  effect.applyProgram(program ?? createScspDspExample('fir2-lowpass').words);
  effect.setCoefficients(Object.fromEntries(codes.map((value, index) => [index, value])));
  const sample = synth.loadPCM(pcm, {
    baseFrequencyHz: 44100 / pcm.length,
    ...(loop ? {loopStartSamples: 0} : {}),
  });
  synth.setPreset(slot, {sample, frequencyHz: sample.rootFrequencyHz, directLevel: 0});
  synth.keyOn(slot);
  effect.route([slot]);
  // Raw SDIR at unit source advance removes envelope and interpolation from
  // the independent stimulus. Send7 maps PCM to a 24-bit DSP input ×256.
  core.write(slot * 32 + 12, 0x100);
  return {core, synth, effect};
}

const sat24 = value => Math.max(-0x800000, Math.min(0x7fffff, value));
function reference(pcm, codes, initialHistory = 0) {
  let previous = initialHistory;
  return Int16Array.from(pcm, sample => {
    const input = sample * 256;
    const nextHistory = sat24(Math.floor(input * codes[0] / 4096));
    const sum = Math.floor(input * codes[2] / 4096) + Math.floor(previous * codes[1] / 4096);
    previous = nextHistory;
    return Math.floor(sat24(sum) / 256);
  });
}
const floatPcm = values => Float32Array.from(values, value => value / 32768);
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);

test('example sources retain independent word vectors, profile validation and owned chooser data', async () => {
  const fir = createScspDspExample('fir2-lowpass');
  assert.equal(fir.source, await readFile(new URL('./examples/fir2-lowpass.scspasm', import.meta.url), 'utf8'));
  assert.deepEqual(Array.from(fir.words.slice(0, 16)), [
    0, 0xa800, 0x0002, 0,
    0x0180, 0x2000, 0x0002, 0x0200,
    0, 0xa800, 0x0001, 0x0400,
    0, 0, 0x1002, 0,
  ]);
  assert(fir.words.slice(16).every(value => value === 0));
  assert.deepEqual(checkScspDspDelaySource(fir.source).words, fir.words);
  assert.deepEqual(fir.codes, [4095, 2048, 2048]);
  assert.deepEqual(createScspDspExample('delay').words, delayProgram());
  const highpass = createScspDspExample('fir2-highpass');
  assert.equal(highpass.source, await readFile(new URL('./examples/fir2-highpass.scspasm', import.meta.url), 'utf8'));
  assert.deepEqual(highpass.words, fir.words);
  assert.deepEqual(checkScspDspDelaySource(highpass.source).words, fir.words);
  assert.deepEqual(highpass.codes, [4095, -2048, 2048]);
  assert.deepEqual(highpass.roles, fir.roles);
  assert.match(highpass.source, /small DC residual/);
  assert.equal(highpass.filename, 'tetorica-scsp-fir2-highpass.scspasm');
  assert.deepEqual(listScspDspExamples().map(value => value.id), ['delay', 'fir2-lowpass', 'fir2-highpass', 'iir1-lowpass', 'routing-gain-iir']);
  assert.equal(identifyScspDspExample(fir.words), 'fir2-lowpass');
  assert.equal(identifyScspDspProgram(highpass.words), 'fir2');
  assert.equal(identifyScspDspProgram(delayProgram()), 'delay');
  assert.equal(identifyScspDspExample(fir.words, fir.codes), 'fir2-lowpass');
  assert.equal(identifyScspDspExample(fir.words, highpass.codes), 'fir2-highpass');
  assert.equal(identifyScspDspExample(fir.words, [4095, -1024, 2048]), null);
  assert.equal(identifyScspDspExample(fir.words, [4095, 3840, 256]), null);
  const iir = createScspDspExample('iir1-lowpass');
  assert.equal(identifyScspDspExample(iir.words, fir.codes), null);
  assert.equal(identifyScspDspExample(iir.words, highpass.codes), null);
  assert.equal(identifyScspDspExample(delayProgram(), [2048, 0, -1024]), 'delay');
  for (const codes of [null, [], Array(3), [4095, 2048], [4095, 2048, NaN], [4095, 2048, Infinity],
    [4095, 2048, '2048'], [4095, 2048, 2048.5], [-4097, 2048, 2048], [4096, 2048, 2048]]) {
    assert.equal(identifyScspDspExample(fir.words, codes), null);
    assert.equal(identifyScspDspExample(delayProgram(), codes), null);
  }
  assert.equal(identifyScspDspExample(Array.from(delayProgram())), 'delay');
  for (const value of [null, {}, [], new Uint8Array(512), new Uint16Array(512)]) {
    assert.equal(identifyScspDspExample(value), null);
    assert.equal(identifyScspDspProgram(value), null);
  }
  assert.throws(() => createScspDspExample('missing'), /Unknown/);
  const expected = createScspDspExample('fir2-lowpass');
  fir.words[0] = 1;
  fir.codes[0] = 0;
  fir.roles[0] = 'changed';
  fir.source = '000:';
  const names = listScspDspExamples();
  names[0].name = 'changed';
  assert.deepEqual(createScspDspExample('fir2-lowpass'), expected);
  assert.equal(listScspDspExamples()[0].name, 'Built-in Delay');
});

test('shipped DSP emits exactly two adjacent impulse taps without a later echo or RAM writes', async t => {
  const pcm = new Int16Array(2048);
  pcm[1] = 4096;
  const {core, synth} = await setup(t, pcm);
  const ram = core.readRam();
  const output = synth.generateStereo(pcm.length);
  const expected = reference(pcm, [4095, 2048, 2048]);
  assert.deepEqual(Array.from(expected.entries()).filter(([, value]) => value !== 0), [[1, 2048], [2, 2047]]);
  assert.deepEqual(output.left, floatPcm(expected));
  assert.deepEqual(output.right, output.left);
  assert.deepEqual(core.readRam(), ram);
});

test('signed full-range stimuli and coefficient extremes match independent fixed-point arithmetic', async t => {
  const pcm = Int16Array.from({length: 1024}, (_, index) => index < 6
    ? [-32768, -30000, 32767, 0, 1, -1][index] : (index * 7919) % 60001 - 30000);
  for (const codes of [[4095, 2048, 2048], [4095, -2048, 2048], [-4096, -4096, 4095], [0, 0, -4096]]) {
    const {core, synth} = await setup(t, pcm, {codes, loop: true});
    const expected = reference(pcm, codes);
    for (let index = 0; index < pcm.length; index++) {
      const output = synth.generateStereo(1);
      const effectRegister = (core.read(0xec0) << 16) >> 16;
      assert.equal(effectRegister, expected[index], `EFREG0 frame ${index}, codes ${codes}`);
      assert.equal(output.left[0], expected[index] / 32768);
      assert.equal(output.right[0], output.left[0]);
    }
  }
});

test('actual low-pass response follows both quantized taps from passband through Nyquist', async t => {
  const c0 = 4095 / 4096, previousTap = .5 * c0, currentTap = .5;
  const gains = [];
  for (const period of [128, 4, 2]) {
    const omega = 2 * Math.PI / period;
    const pcm = Int16Array.from({length: 4096}, (_, index) => period === 2
      ? (index % 2 ? -8192 : 8192) : Math.round(8192 * Math.sin(omega * index)));
    const {synth} = await setup(t, pcm, {loop: true});
    const output = synth.generateStereo(pcm.length).left;
    const measured = rms(output.slice(128)) / rms(Float32Array.from(pcm.slice(128), value => value / 32768));
    const expected = Math.hypot(currentTap + previousTap * Math.cos(omega), previousTap * Math.sin(omega));
    assert(Math.abs(measured - expected) < .0005, `${44100 / period} Hz gain ${measured}, expected ${expected}`);
    gains.push(measured);
  }
  assert(gains[0] > .99);
  assert(gains[1] > .70 && gains[1] < .72);
  assert(gains[2] < .001);
});

test('high-pass impulse and frequency response follow the negative previous tap', async t => {
  const highpass = createScspDspExample('fir2-highpass');
  const impulse = new Int16Array(2048);
  impulse[1] = 4096;
  const {core, synth} = await setup(t, impulse, {codes: highpass.codes, program: highpass.words});
  const ram = core.readRam();
  const output = synth.generateStereo(impulse.length);
  const expectedImpulse = reference(impulse, highpass.codes);
  assert.deepEqual(Array.from(expectedImpulse.entries()).filter(([, value]) => value !== 0), [[1, 2048], [2, -2048]]);
  assert.deepEqual(output.left, floatPcm(expectedImpulse));
  assert.deepEqual(output.right, output.left);
  assert.deepEqual(core.readRam(), ram);

  const previousTap = -.5 * 4095 / 4096, currentTap = .5, gains = [];
  for (const period of [128, 4, 2]) {
    const omega = 2 * Math.PI / period;
    const pcm = Int16Array.from({length: 4096}, (_, index) => period === 2
      ? (index % 2 ? -8192 : 8192) : Math.round(8192 * Math.sin(omega * index)));
    const {synth} = await setup(t, pcm, {codes: highpass.codes, program: highpass.words, loop: true});
    const output = synth.generateStereo(pcm.length).left;
    const measured = rms(output.slice(128)) / rms(Float32Array.from(pcm.slice(128), value => value / 32768));
    const expected = Math.hypot(currentTap + previousTap * Math.cos(omega), previousTap * Math.sin(omega));
    assert(Math.abs(measured - expected) < .0005, `${44100 / period} Hz gain ${measured}, expected ${expected}`);
    gains.push(measured);
  }
  assert(gains[0] < .025);
  assert(gains[1] > .70 && gains[1] < .72);
  assert(gains[2] > .99);

  for (const amplitude of [-32768, -8192, 8192, 32767]) {
    const pcm = new Int16Array(512).fill(amplitude);
    const {synth} = await setup(t, pcm, {codes: highpass.codes, program: highpass.words, loop: true});
    const output = synth.generateStereo(pcm.length).left;
    const expected = reference(pcm, highpass.codes);
    assert.deepEqual(output, floatPcm(expected));
    const residual = Math.max(...output.slice(1).map(Math.abs));
    assert(residual > 0);
    assert(residual / (Math.abs(amplitude) / 32768) < .00025);
  }
});

test('low-pass to high-pass setup keeps the same program, sample phase and voice', async t => {
  const lowpass = createScspDspExample('fir2-lowpass');
  const highpass = createScspDspExample('fir2-highpass');
  const pcm = Int16Array.from({length: 4096}, (_, index) => Math.round(8192 * Math.sin(index * .43)));
  const switched = await setup(t, pcm, {loop: true});
  const continued = await setup(t, pcm, {codes: highpass.codes, program: highpass.words, loop: true});
  switched.synth.generateStereo(257);
  continued.synth.generateStereo(257);
  const before = switched.effect.readProgram(), voice = switched.synth.getState();
  const words = Array.from({length: 512}, (_, index) => switched.core.read(0x800 + index * 2));
  const sampleRam = switched.core.readRam(65536);
  const frames = switched.core.nativeFrames;
  const writes = [], write = switched.core.write.bind(switched.core);
  switched.core.write = (...args) => {writes.push(args[0]); return write(...args);};
  switched.effect.applyProgram(highpass.words, {coefficients: {0: 4095, 1: -2048, 2: 2048}});
  switched.core.write = write;
  assert(!writes.some(address => address >= 0x800 && address <= 0xbfe));
  assert.deepEqual(switched.effect.readProgram(), before);
  assert.deepEqual(switched.synth.getState(), voice);
  assert.equal(switched.core.nativeFrames, frames);
  assert.deepEqual(switched.core.readRam(65536), sampleRam);
  assert.deepEqual(Array.from({length: 512}, (_, index) => switched.core.read(0x800 + index * 2)), words);
  const expected = continued.synth.generateStereo(1024);
  const actual = {left: new Float32Array(1024), right: new Float32Array(1024)};
  let offset = 0;
  for (const frames of [1, 7, 31, 61, 128, 513, 283]) {
    const output = switched.synth.generateStereo(frames);
    actual.left.set(output.left, offset);
    actual.right.set(output.right, offset);
    offset += frames;
  }
  assert.equal(offset, 1024);
  assert.deepEqual(actual, expected);
  switched.effect.applyProgram(lowpass.words, {coefficients: {0: 4095, 1: 2048, 2: 2048}});
  assert.deepEqual(switched.effect.readProgram(), before);
});

test('native render partitions and Delay Time changes preserve the FIR sample sequence', async t => {
  const pcm = Int16Array.from({length: 4096}, (_, index) => Math.round(8192 * Math.sin(index * .43)));
  const whole = await setup(t, pcm, {loop: true}), partitioned = await setup(t, pcm, {loop: true});
  const expected = whole.synth.generateStereo(pcm.length);
  const actual = {left: new Float32Array(pcm.length), right: new Float32Array(pcm.length)};
  let offset = 0;
  for (const requested of [1, 7, 31, 61, 128, 513, 5, 1024, 2326]) {
    const count = Math.min(requested, pcm.length - offset);
    if (offset === 100) partitioned.effect.configure({timeMs: 600});
    const next = partitioned.synth.generateStereo(count);
    actual.left.set(next.left, offset);
    actual.right.set(next.right, offset);
    offset += count;
  }
  assert.equal(offset, pcm.length);
  assert.deepEqual(actual, expected);
});

test('a preceding TEMP history can affect one frame and is replaced by the first FIR input', async t => {
  const seedProgram = assembleScspDsp('000: XSEL=1 YSEL=1 IRA=32 ZERO=1\n001: TWT=1 ZERO=1\n');
  const pcm = Int16Array.from([4096, 4096, 4096, 4096]);
  const {synth, effect} = await setup(t, pcm, {codes: [-4096, 2048, 2048], program: seedProgram, loop: true});
  synth.generateStereo(128);
  effect.applyProgram(createScspDspExample('fir2-lowpass').words);
  effect.setCoefficients({0: 4095, 1: 2048, 2: 2048});
  const actual = synth.generateStereo(4).left;
  const expected = reference(pcm, [4095, 2048, 2048], -4096 * 256);
  assert.deepEqual(Array.from(expected), [0, 4095, 4095, 4095]);
  assert.deepEqual(actual, floatPcm(expected));
});
