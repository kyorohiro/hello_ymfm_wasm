// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../js/scsp.js';
import {SynthInstrument} from './instrument.js';
import {createScspCodeClient, SCSP_CODE_METHODS, validateScspCodeCall} from './code_endpoint.js';
import {createScspDspExample} from './dsp_examples.js';

const binary = await readFile(new URL('../generated/scsp_wasm.wasm', import.meta.url));
const metadata = {session: 1, channels: 32, operators: 6, sampleRate: 44100};
let module;
async function instrument(t) {
  module ??= factory({wasmBinary: binary});
  const result = new SynthInstrument(await Scsp.create({moduleFactory: () => module}));
  t.after(() => result.dispose());
  return result;
}
function borrowed(owner) {
  const metadata = owner.beginCode();
  return createScspCodeClient({
    metadata,
    isCurrent: () => owner.codeActive && owner.codeSession === metadata.session,
    invoke: async (method, args) => owner.code(metadata.session, method, args),
    dispose: async () => owner.endCode(metadata.session),
  });
}
const setup = example => ({coefficients: Object.fromEntries(example.codes.map((code, index) => [index, code]))});
const programWords = core => Array.from({length: 512}, (_, index) => core.read(0x800 + index * 2));
const coefficientWords = core => [0x700, 0x702, 0x704].map(address => core.read(address));

test('Code compileDsp is synchronous, owned and leaves the live instrument untouched', async t => {
  const owner = await instrument(t);
  owner.noteOn('keyboard', 60);
  const metadata = owner.beginCode();
  owner.code(metadata.session, 'noteOn', [0, 'A4']);
  const before = owner.read(), ram = owner.core.readRam(), frames = owner.core.nativeFrames;
  const program = owner.readDspProgram(), coefficients = owner.readDspCoefficients();
  let requests = 0;
  const client = createScspCodeClient({
    metadata, isCurrent: () => true,
    invoke: () => {requests++;}, dispose: () => {},
  });
  const example = createScspDspExample('iir1-lowpass');
  const words = client.compileDsp(example.source);
  assert(words instanceof Uint16Array);
  assert.equal(words.length, 512);
  assert.deepEqual(words, example.words);
  words[0] ^= 0xffff;
  assert.deepEqual(client.compileDsp(example.source), example.words);
  assert.equal(requests, 0);
  assert.equal(owner.core.nativeFrames, frames);
  assert.deepEqual(owner.read(), before);
  assert.deepEqual(owner.core.readRam(), ram);
  assert.deepEqual(owner.readDspProgram(), program);
  assert.deepEqual(owner.readDspCoefficients(), coefficients);
});

test('local compiler validates exact arity, source syntax and executable profile with line metadata', () => {
  const client = createScspCodeClient({metadata, isCurrent: () => true, invoke: () => assert.fail(), dispose: () => {}});
  assert.throws(() => client.compileDsp(), /takes 1 argument/);
  assert.throws(() => client.compileDsp('', {}), /takes 1 argument/);
  for (const value of [null, {}, [], 123]) assert.throws(() => client.compileDsp(value), /source must be a string/);
  assert.throws(() => client.compileDsp('; comment\n003: UNKNOWN=1'), error => {
    assert.equal(error.line, 2);
    assert.match(error.message, /^Line 2: unknown field UNKNOWN$/);
    return true;
  });
  assert.throws(() => client.compileDsp('; comment\n\n007: YSEL=1 COEF=3'), error => {
    assert.equal(error.line, 3);
    assert.equal(error.step, 7);
    assert.match(error.message, /Line 3: Step 007: COEF/);
    return true;
  });
  assert(!SCSP_CODE_METHODS.includes('compileDsp'));
  assert.equal(client.write, undefined);
  assert.throws(() => validateScspCodeCall('compileDsp', ['']), /Unknown SCSP Code method/);
});

test('DSP remote requests clone input words and coefficient objects before enqueueing', async () => {
  const requests = [];
  const client = createScspCodeClient({
    metadata, isCurrent: () => true,
    invoke: async (method, args) => {requests.push({method, args}); return true;}, dispose: () => {},
  });
  const example = createScspDspExample('fir2-lowpass'), options = setup(example);
  const original = example.words.slice();
  const apply = client.applyDspProgram(example.words, options);
  example.words[0] ^= 0xffff;
  options.coefficients[0] = 0;
  await apply;
  assert.equal(requests[0].method, 'applyDspProgram');
  assert.deepEqual(requests[0].args[0], original);
  assert.equal(requests[0].args[1].coefficients[0], 4095);
  const patch = {1: -2048}, update = client.setDspCoefficients(patch);
  patch[1] = 0;
  await update;
  assert.deepEqual(requests[1].args, [{1: -2048}]);
  for (const [method, args] of [
    ['getDspProgram', [0]], ['getDspCoefficients', [{}]],
    ['applyDspProgram', []], ['applyDspProgram', [original, {}, {}]],
    ['setDspCoefficients', []], ['setDspCoefficients', [{}, {}]],
  ]) assert.throws(() => client[method](...args), /takes/);
  assert.equal(requests.length, 2);
});

test('Code program apply returns complete owned setup snapshots while preserving held owners', async t => {
  const owner = await instrument(t), client = borrowed(owner);
  owner.noteOn('keyboard', 60);
  await client.noteOn(0, 'A4');
  const before = owner.read(), frames = owner.core.nativeFrames;
  const example = createScspDspExample('iir1-lowpass');
  const result = await client.applyDspProgram(client.compileDsp(example.source), setup(example));
  assert.deepEqual(result.words, Array.from(example.words));
  assert.equal(result.custom, true);
  assert.equal(result.revision, 1);
  assert.deepEqual(result.coefficients, {codes: example.codes, feedback: 3840 / 4096});
  const after = owner.read();
  assert.deepEqual({...after, config: before.config, dspCoefficients: before.dspCoefficients}, before);
  assert.equal(owner.core.nativeFrames, frames);
  assert.equal(after.config.effect.feedback, 3840 / 4096);
  assert.deepEqual(after.voiceGroups.map(group => group.owner.kind), ['keyboard', 'code']);
  result.words[0] ^= 0xffff;
  result.coefficients.codes[0] = 0;
  const read = await client.getDspProgram();
  assert.deepEqual(read.words, Array.from(example.words));
  assert.deepEqual(read.coefficients.codes, example.codes);
  read.words[0] ^= 0xffff;
  read.coefficients.codes[1] = 0;
  assert.deepEqual(await client.getDspCoefficients(), {codes: example.codes, feedback: 3840 / 4096});
  assert.deepEqual((await client.getDspProgram()).words, Array.from(example.words));

  const programOnly = await client.applyDspProgram(createScspDspExample('fir2-highpass').words);
  assert.equal(programOnly.revision, 2);
  assert.deepEqual(programOnly.coefficients, {codes: example.codes, feedback: 3840 / 4096});
  assert(!Object.hasOwn(owner.applyDspProgram(example.words), 'coefficients'));
});

test('Code same setup is a no-op and coefficient edits preserve ring, word revision and voices', async t => {
  const owner = await instrument(t), client = borrowed(owner), example = createScspDspExample('iir1-lowpass');
  await client.applyDspProgram(example.words, setup(example));
  await client.setEffect({enabled: true, timeMs: 20});
  owner.noteOn('keyboard', 60);
  await client.noteOn(0, 'A4');
  owner.synth.generateStereo(4096);
  const before = owner.read(), ram = owner.core.readRam(), frames = owner.core.nativeFrames;
  const program = await client.getDspProgram(), words = programWords(owner.core);
  const write = owner.core.write.bind(owner.core), load = owner.core.loadRam.bind(owner.core);
  let writes = 0, loads = 0;
  owner.core.write = (...args) => {writes++; return write(...args);};
  owner.core.loadRam = (...args) => {loads++; return load(...args);};
  assert.deepEqual(await client.applyDspProgram(example.words, setup(example)), program);
  await client.setDspCoefficients({});
  assert.equal(writes, 0);
  assert.equal(loads, 0);
  assert.deepEqual(await client.setDspCoefficients({1: -1024}), {codes: [4095, -1024, 256], feedback: -.25});
  assert.equal(writes, 1);
  assert.equal(loads, 0);
  const after = owner.read();
  assert.deepEqual({...after, config: before.config, dspCoefficients: before.dspCoefficients}, before);
  assert.equal(after.config.effect.feedback, -.25);
  assert.deepEqual(owner.core.readRam(), ram);
  assert.deepEqual(programWords(owner.core), words);
  assert.equal(owner.core.nativeFrames, frames);
  assert.equal((await client.getDspProgram()).revision, program.revision);
});

test('Code coefficients change actual native wet PCM without replacing the program or session', async t => {
  const audible = await instrument(t), muted = await instrument(t);
  const example = createScspDspExample('iir1-lowpass');
  for (const owner of [audible, muted]) {
    const client = borrowed(owner);
    await client.applyDspProgram(example.words, setup(example));
    await client.setMix(0, {directLevel: 0, totalLevel: 0});
    await client.setEffect({enabled: true, timeMs: 20, send: 7, returnLevel: 7});
    if (owner === muted) await client.setDspCoefficients({2: 0});
    await client.noteOn(0, 'A4');
  }
  const expected = audible.synth.generateStereo(8192), actual = muted.synth.generateStereo(8192);
  assert(expected.left.some(value => value !== 0));
  assert(actual.left.every(value => value === 0));
  assert(actual.right.every(value => value === 0));
  assert(audible.codeActive && muted.codeActive);
  assert.deepEqual(audible.readDspProgram(), muted.readDspProgram());
});

test('invalid Code DSP programs and complete or partial coefficient requests are atomic', async t => {
  const owner = await instrument(t), client = borrowed(owner), example = createScspDspExample('iir1-lowpass');
  await client.applyDspProgram(example.words, setup(example));
  await client.noteOn(0, 'A4');
  owner.noteOn('keyboard', 60);
  owner.synth.generateStereo(4096);
  const before = owner.read(), ram = owner.core.readRam(), program = await client.getDspProgram();
  const words = programWords(owner.core), codes = coefficientWords(owner.core);
  const unsafe = example.words.slice();
  unsafe[0] |= 0x8000;
  for (const args of [
    [unsafe], [Array(511).fill(0)], [example.words, {}], [example.words, {coefficients: {0: 0}}],
    [example.words, {coefficients: {0: 0, 1: 0, 2: 4096}}],
    [example.words, {coefficients: {0: 0, 1: 0, 2: 0}, other: true}],
  ]) await assert.rejects(client.applyDspProgram(...args));
  for (const patch of [null, [], {3: 0}, {0: 0, 2: 4096}, {1: .5}, {2: '1'}]) {
    await assert.rejects(client.setDspCoefficients(patch));
  }
  assert.throws(() => owner.code(owner.codeSession, 'compileDsp', ['']), /Unknown SCSP Code method/);
  assert.deepEqual(owner.read(), before);
  assert.deepEqual(owner.core.readRam(), ram);
  assert.deepEqual(await client.getDspProgram(), program);
  assert.deepEqual(programWords(owner.core), words);
  assert.deepEqual(coefficientWords(owner.core), codes);
});

test('Stop and new Run fence DSP writes, local compile and pending reply completion', async t => {
  for (const transition of ['stop', 'run']) {
    const owner = await instrument(t), metadata = owner.beginCode();
    let complete;
    const client = createScspCodeClient({
      metadata,
      isCurrent: () => owner.codeActive && owner.codeSession === metadata.session,
      invoke: (method, args) => {
        const result = owner.code(metadata.session, method, args);
        return new Promise(resolve => {complete = () => resolve(result);});
      },
      dispose: () => owner.endCode(metadata.session),
    });
    const request = client.getDspProgram();
    if (transition === 'stop') owner.endCode(metadata.session);
    else owner.beginCode();
    const before = owner.readDspProgram(), coefficients = owner.readDspCoefficients();
    complete();
    await assert.rejects(request, {name: 'AbortError'});
    assert.throws(() => client.compileDsp(''), {name: 'AbortError'});
    assert.throws(() => client.setDspCoefficients({2: 0}), {name: 'AbortError'});
    for (const [method, args] of [['applyDspProgram', [new Uint16Array(512)]], ['setDspCoefficients', [{2: 0}]]]) {
      assert.throws(() => owner.code(metadata.session, method, args), {name: 'AbortError'});
    }
    assert.deepEqual(owner.readDspProgram(), before);
    assert.deepEqual(owner.readDspCoefficients(), coefficients);
  }
});
