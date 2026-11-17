// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../js/scsp.js';
import {Pcm44100Resampler} from '../js/pcm_44100_resampler.js';
import {DSP_RAM_BYTES, delayProgram, validateScspDspProgramOptions} from './dsp.js';
import {SynthInstrument} from './instrument.js';

const binary = await readFile(new URL('../generated/scsp_wasm.wasm', import.meta.url));
let module;
async function core(t) {
  module ??= factory({wasmBinary: binary});
  const value = await Scsp.create({moduleFactory: () => module});
  t.after(() => value.dispose());
  return value;
}
const mpro = hardware => Array.from({length: 512}, (_, index) => hardware.read(0x800 + index * 2));
const coefficientWords = hardware => [0x700, 0x702, 0x704].map(offset => hardware.read(offset));
const coefficients = {0: 2048, 1: -1024, 2: 3072};
function changedProgram() {
  const words = delayProgram();
  words[3 * 4 + 3] = 0; // Parallel feedback calculation uses COEF0.
  words[504] = 0x0081; // Start must preserve step126's TWT / TWA fields.
  return words;
}
function snapshot(instrument) {
  return {state: instrument.read(), program: instrument.readDspProgram(),
    coefficients: instrument.readDspCoefficients(), settings: {...instrument.effect.settings},
    ram: instrument.core.readRam(), mpro: mpro(instrument.core),
    coefficientWords: coefficientWords(instrument.core), outputReturn: instrument.core.read(22)};
}
async function playing(t) {
  const instrument = new SynthInstrument(await core(t));
  instrument.setEffect({enabled: true, timeMs: 20, feedback: .7, returnLevel: 7});
  const {session} = instrument.beginCode();
  instrument.code(session, 'noteOn', [0, 'A4']);
  instrument.noteOn('keyboard', 60);
  instrument.synth.generateStereo(4096);
  return instrument;
}

test('pure setup options validation returns owned complete coefficients for cold migration', () => {
  assert.equal(validateScspDspProgramOptions(), undefined);
  const input = {coefficients: {0: 4095, 1: 2048, 2: -2048}};
  const first = validateScspDspProgramOptions(input), second = validateScspDspProgramOptions(input);
  assert.deepEqual(first, input);
  assert.notEqual(first, input);
  assert.notEqual(first.coefficients, input.coefficients);
  first.coefficients[0] = 0;
  assert.equal(second.coefficients[0], 4095);
  assert.equal(input.coefficients[0], 4095);
  for (const value of [null, [], {}, {coefficients: {}}, {coefficients: {0: 1, 1: 2}},
    {coefficients: {0: 1, 1: 2, 2: 4096}}, {coefficients: {0: 1, 1: 2, 2: 3}, extra: 1}]) {
    assert.throws(() => validateScspDspProgramOptions(value));
  }
});

test('combined setup applies copied words and coefficients while retaining keyboard / Code and outside-ring PCM', async t => {
  const first = await playing(t), reference = await playing(t);
  const before = first.read(), outside = first.core.readRam(DSP_RAM_BYTES);
  const words = changedProgram(), patch = {...coefficients};
  const result = first.applyDspProgram(words, {coefficients: patch});
  reference.setDspCoefficients(patch);
  reference.applyDspProgram(words);
  assert.deepEqual(result, {words: Array.from(words), custom: true, revision: 1,
    coefficients: {codes: [2048, -1024, 3072], feedback: -.25}});
  const after = first.read();
  assert.deepEqual({...after, config: before.config, dspCoefficients: before.dspCoefficients}, before);
  assert.equal(after.config.effect.feedback, -.25);
  assert.deepEqual(first.core.readRam(DSP_RAM_BYTES), outside);
  assert.deepEqual(coefficientWords(first.core), [0x4000, 0xe000, 0x6000]);
  assert.deepEqual(mpro(first.core), Array.from(words));
  assert.deepEqual(first.synth.generateStereo(8192), reference.synth.generateStereo(8192));
  words[0] = 123;
  patch[0] = -4096;
  result.words[0] = 456;
  result.coefficients.codes[0] = 999;
  assert.equal(first.readDspProgram().words[0], 0);
  assert.equal(first.readDspCoefficients().codes[0], 2048);
});

test('complete equal setup is a hardware no-op; program-only Apply retains its legacy result and coefficient state', async t => {
  const instrument = await playing(t), hardware = instrument.core;
  instrument.setEffect({feedback: .35});
  const ram = hardware.readRam(), program = instrument.readDspProgram();
  const write = hardware.write.bind(hardware), load = hardware.loadRam.bind(hardware);
  let writes = 0, loads = 0;
  hardware.write = (...args) => {writes++; return write(...args);};
  hardware.loadRam = (...args) => {loads++; return load(...args);};
  const equal = instrument.applyDspProgram(program.words, {coefficients: {0: 4095, 1: 1433, 2: 4095}});
  assert.equal(equal.revision, program.revision);
  assert.equal(equal.coefficients.feedback, 1433 / 4096);
  assert.equal(instrument.config.effect.feedback, 1433 / 4096);
  assert.deepEqual(hardware.readRam(), ram);
  assert.equal(writes, 0);
  assert.equal(loads, 0);
  const legacy = instrument.applyDspProgram(program.words);
  assert.deepEqual(Object.keys(legacy), ['words', 'custom', 'revision']);
  assert.deepEqual(instrument.readDspCoefficients(), equal.coefficients);
  assert.equal(writes, 0);
  assert.equal(loads, 0);
});

test('coefficient-only setup clears the ring once without rewriting MPRO or changing program revision', async t => {
  const instrument = await playing(t), hardware = instrument.core;
  const program = instrument.readDspProgram(), before = instrument.read();
  const write = hardware.write.bind(hardware), load = hardware.loadRam.bind(hardware);
  const written = [];
  let loads = 0;
  hardware.write = (...args) => {written.push(args[0]); return write(...args);};
  hardware.loadRam = (...args) => {loads++; return load(...args);};
  const result = instrument.applyDspProgram(program.words, {coefficients});
  assert.equal(result.revision, program.revision);
  assert.equal(written.filter(offset => offset >= 0x800).length, 0);
  assert.equal(loads, 1);
  assert.deepEqual(written.filter(offset => offset >= 0x700 && offset < 0x706), [0x700, 0x702, 0x704]);
  assert.deepEqual(mpro(hardware), program.words);
  assert(hardware.readRam(0, DSP_RAM_BYTES).every((value, index) => value === (index % 2 ? 0 : 0x60)));
  const after = instrument.read();
  assert.deepEqual({...after, config: before.config, dspCoefficients: before.dspCoefficients}, before);
});

test('malformed combined setup validates all words and coefficients before any mutation', async t => {
  const instrument = await playing(t), before = snapshot(instrument), hardware = instrument.core;
  const write = hardware.write.bind(hardware), load = hardware.loadRam.bind(hardware);
  let writes = 0, loads = 0;
  hardware.write = (...args) => {writes++; return write(...args);};
  hardware.loadRam = (...args) => {loads++; return load(...args);};
  for (const options of [null, [], {}, {coefficients}, {coefficients: null},
    {coefficients: [1, 2, 3]}, {coefficients: {0: 0, 1: 1}},
    {coefficients: {0: 0, 1: 1, 2: 4096}}, {coefficients: {0: 0, 1: -.5, 2: 1}},
    {coefficients: {0: 0, 1: 1, 2: 1, 3: 1}}, {coefficients, other: true},
    {[Symbol('coefficients')]: coefficients}]) {
    // A valid complete patch is exercised with an invalid program as well.
    const words = changedProgram();
    if (options?.coefficients === coefficients && Object.keys(options).length === 1) words[0] = 0x8000;
    assert.throws(() => instrument.applyDspProgram(words, options));
    assert.deepEqual(snapshot(instrument), before);
  }
  assert.equal(writes, 0);
  assert.equal(loads, 0);
});

test('failure after coefficient, MPRO, Start, ring or return mutation restores complete setup and same-phase PCM', async t => {
  for (const phase of ['coefficient', 'program', 'start', 'ring', 'return']) {
    const first = await playing(t), reference = await playing(t);
    const before = snapshot(first), hardware = first.core;
    const method = phase === 'ring' ? 'loadRam' : 'write';
    const original = hardware[method].bind(hardware);
    let injected = false;
    hardware[method] = (...args) => {
      const value = original(...args);
      const matches = phase === 'ring' || phase === 'coefficient' && args[0] === 0x702 ||
        phase === 'program' && args[0] === 0x820 || phase === 'start' && args[0] === 0xbf0 ||
        phase === 'return' && args[0] === 22 && args[1] === before.outputReturn;
      if (!injected && matches) {injected = true; throw Error('Injected ' + phase + ' failure after mutation');}
      return value;
    };
    assert.throws(() => first.applyDspProgram(changedProgram(), {coefficients}), /Injected/);
    assert(injected, phase);
    hardware[method] = original;
    assert.deepEqual(snapshot(first), before, phase);
    assert.deepEqual(first.synth.generateStereo(8192), reference.synth.generateStereo(8192), phase);
  }
});

test('combined setup failure with unchanged MPRO restores coefficients and the old tail', async t => {
  const first = await playing(t), reference = await playing(t), before = snapshot(first);
  const load = first.core.loadRam.bind(first.core);
  let injected = false;
  first.core.loadRam = (...args) => {
    const result = load(...args);
    if (!injected) {injected = true; throw Error('Injected ring clear failure');}
    return result;
  };
  assert.throws(() => first.applyDspProgram(before.program.words, {coefficients}), /Injected/);
  first.core.loadRam = load;
  assert.deepEqual(snapshot(first), before);
  assert.deepEqual(first.synth.generateStereo(8192), reference.synth.generateStereo(8192));
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
    value.port.onmessage({data: {id: messages.length + 1, method, args}});
    await Promise.resolve();
    return messages.at(-1);
  }};
}

test('processor forwards complete setup only to primary and preserves its held Code / separate audition', async t => {
  const owner = await processor(t), primary = owner.value.instrument, audition = owner.value.audition;
  const untouched = snapshot(audition);
  const {session} = (await owner.command('beginCode')).value;
  assert(!(await owner.command('code', [session, 'noteOn', [0, 'A4']])).error);
  const response = await owner.command('applyDspProgram', [Array.from(changedProgram()), {coefficients}]);
  assert(!response.error);
  assert.equal(response.value.coefficients.feedback, -.25);
  assert.equal(primary.codeActive, true);
  assert.equal(primary.config.effect.feedback, -.25);
  assert.deepEqual(snapshot(audition), untouched);
  const codeResponse = await owner.command('code', [session, 'applyDspProgram', [Array.from(changedProgram()), {coefficients}]]);
  assert(!codeResponse.error);
  assert.deepEqual(codeResponse.value, response.value);
  assert.equal(primary.codeActive, true);
  assert.deepEqual(snapshot(audition), untouched);
});

test('failed setup restoration stops the owner and retains last acknowledged program / coefficient metadata', async t => {
  const owner = await processor(t), instrument = owner.value.instrument;
  const before = {program: instrument.readDspProgram(), coefficients: instrument.readDspCoefficients()};
  const write = instrument.core.write.bind(instrument.core);
  instrument.core.write = (...args) => {
    const result = write(...args);
    if (args[0] === 0x702) throw Error('Persistent coefficient transfer failure');
    return result;
  };
  const response = await owner.command('applyDspProgram', [Array.from(changedProgram()), {coefficients}]);
  assert.equal(response.name, 'ScspDspRollbackError');
  assert(owner.messages.some(message => message.fatal && /rollback/.test(message.error)));
  assert.equal(owner.value.dead, true);
  assert.equal(owner.value.process([], [[new Float32Array(128), new Float32Array(128)]]), false);
  assert.deepEqual(instrument.readDspProgram(), before.program);
  assert.deepEqual(instrument.readDspCoefficients(), before.coefficients);
});
