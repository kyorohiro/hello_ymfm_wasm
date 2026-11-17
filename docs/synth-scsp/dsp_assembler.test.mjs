// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {assembleScspDsp, disassembleScspDsp} from './dsp_assembler.js';
import {delayProgram, DspDelay, reserveDspRam, DSP_RAM_BYTES} from './dsp.js';
import {Scsp} from '../js/scsp.js';
import {ScspSynth} from '../js/scspsynth.js';
import factory from '../generated/scsp_wasm.js';

// Independent transcription of the pinned core's decode in
// third_party/tetorica-soundchip-native/vendor/mame-scsp/scspdsp.cpp.
// These vectors also catch matching encode/decode mistakes in the codec.
const fields = [
  ['TRA', 0, 8, 127], ['TWT', 0, 7, 1], ['TWA', 0, 0, 127],
  ['XSEL', 1, 15, 1], ['YSEL', 1, 13, 3], ['IRA', 1, 6, 63],
  ['IWT', 1, 5, 1], ['IWA', 1, 0, 31],
  ['TABLE', 2, 15, 1], ['MWT', 2, 14, 1], ['MRD', 2, 13, 1],
  ['EWT', 2, 12, 1], ['EWA', 2, 8, 15], ['ADRL', 2, 7, 1],
  ['FRCL', 2, 6, 1], ['SHIFT', 2, 4, 3], ['YRL', 2, 3, 1],
  ['NEGB', 2, 2, 1], ['ZERO', 2, 1, 1], ['BSEL', 2, 0, 1],
  ['NOFL', 3, 15, 1], ['COEF', 3, 9, 63], ['MASA', 3, 2, 31],
  ['ADREB', 3, 1, 1], ['NXADR', 3, 0, 1],
];
const opaqueMasks = [0x8000, 0x1000, 0, 0x0180];
const fixtureUrl = new URL('./examples/delay.scspasm', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');

function fieldValue(source, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(0x[0-9a-f]+|[0-9]+)\\b`, 'i').exec(source);
  assert(match, `Decoded text must expose ${name}`);
  return Number(match[1]);
}

test('all 25 DSP fields match independent pinned-core bit positions', () => {
  for (const [name, word, shift, maximum] of fields) {
    for (const value of new Set([1, maximum])) {
      const expected = new Uint16Array(512);
      expected[7 * 4 + word] = value * 2 ** shift;
      const source = `007: ${name}=0x${value.toString(16)}`;
      assert.deepEqual(assembleScspDsp(source), expected, `${name}=${value}`);
      assert.equal(fieldValue(disassembleScspDsp(expected), name), value);
    }
    assert.throws(() => assembleScspDsp(`007: ${name}=${maximum + 1}`),
      new RegExp(name, 'i'), `${name} must reject overflowing its bit field`);
  }
});

test('every instruction bit round-trips through its named field or opaque word bits', () => {
  for (let word = 0; word < 4; word++) {
    for (let bit = 0; bit < 16; bit++) {
      const value = 2 ** bit, expected = new Uint16Array(512);
      expected[19 * 4 + word] = value;
      const source = disassembleScspDsp(expected);
      assert.deepEqual(assembleScspDsp(source), expected, `word ${word}, bit ${bit}`);
      if (opaqueMasks[word] & value) {
        assert.equal(fieldValue(source, `RAW${word}`), value);
      } else {
        const field = fields.find(([, position, shift, maximum]) =>
          position === word && value >= 2 ** shift && value <= maximum * 2 ** shift);
        assert(field, `Independent layout accounts for word ${word}, bit ${bit}`);
        assert.equal(fieldValue(source, field[0]), value / 2 ** field[2]);
      }
    }
  }

  const opaqueSource = '000: RAW0=0x8000 RAW1=0x1000 RAW3=0x180';
  assert.deepEqual(Array.from(assembleScspDsp(opaqueSource).slice(0, 4)), opaqueMasks);
  for (const source of ['000: RAW0=1', '000: RAW1=1', '000: RAW2=1', '000: RAW3=1']) {
    assert.throws(() => assembleScspDsp(source), /RAW/i,
      'opaque fields must reject bits already represented by named controls');
  }
});

test('physical steps, zero gaps and full arbitrary program images retain all words', () => {
  const empty = assembleScspDsp('; zero program\n\n');
  assert(empty instanceof Uint16Array);
  assert.equal(empty.length, 512);
  assert(empty.every(word => word === 0));
  assert.deepEqual(assembleScspDsp(disassembleScspDsp(empty)), empty);
  const fullZeroSource = disassembleScspDsp(empty, {includeTrailingZeros: true});
  const numberedLines = fullZeroSource.split('\n').filter(line => /^\s*\d+:/.test(line));
  assert.equal(numberedLines.length, 128);
  assert.match(numberedLines.at(-1), /^127:/);

  const source = '; field names ignore case\r\n 0: xsel = 1 ; first step\r\n 2: \r\n 127: nxadr=0x1';
  const expected = new Uint16Array(512);
  expected[1] = 0x8000;
  expected[511] = 1;
  assert.deepEqual(assembleScspDsp(source), expected);
  assert.deepEqual(assembleScspDsp(disassembleScspDsp(expected)), expected);
  const short = new Uint16Array(512);
  short[3 * 4] = 0x100;
  const compactSteps = disassembleScspDsp(short).split('\n').filter(line => /^\s*\d+:/.test(line));
  assert.equal(compactSteps.length, 4, 'only trailing zero steps are compacted');
  assert.match(compactSteps[2], /^002:\s*$/, 'an internal zero step keeps its physical position');

  let randomState = 0x2149cafe;
  for (let program = 0; program < 32; program++) {
    const words = new Uint16Array(512);
    for (let index = 0; index < words.length; index++) {
      randomState ^= randomState << 13;
      randomState ^= randomState >>> 17;
      randomState ^= randomState << 5;
      words[index] = randomState & 0xffff;
    }
    assert.deepEqual(assembleScspDsp(disassembleScspDsp(words)), words);
  }
});

test('a readable field edit preserves opaque bits and the other instruction fields', () => {
  const original = new Uint16Array(512);
  original.set([0xffff, 0xffff, 0xffff, 0xffff], 9 * 4);
  const source = disassembleScspDsp(original);
  assert.equal(fieldValue(source, 'TRA'), 127);
  const editedSource = source.replace(/\bTRA\s*=\s*127\b/, 'TRA=5');
  assert.notEqual(editedSource, source);
  const edited = assembleScspDsp(editedSource), expected = original.slice();
  expected[9 * 4] = 0x85ff;
  assert.deepEqual(edited, expected);
  assert.equal(edited[9 * 4] & 0x8000, 0x8000);
  assert.deepEqual(Array.from(edited.slice(9 * 4 + 1, 9 * 4 + 4)), [0xffff, 0xffff, 0xffff]);
});

test('invalid source has line diagnostics and cannot silently truncate or reorder instructions', () => {
  const invalid = [
    '128:', '-1:', '0x1:', 'label:', '000: NOP', '000: UNKNOWN=1',
    '000: XSEL', '000: XSEL=', '000: XSEL=1,', '000: XSEL=-1',
    '000: XSEL=+1', '000: XSEL=1.0', '000: XSEL=1e0', '000: XSEL=true',
    '000: XSEL=0x', '000: XSEL=0b1', '000: XSEL=NaN', '000: XSEL=Infinity',
    '000: XSEL=1 XSEL=0', '000: XSEL=1 xsel=0',
    '000: RAW0=0x8000 RAW0=0', '000: RAW4=0',
    '000:\n000:', '002:\n001:',
  ];
  for (const source of invalid) {
    assert.throws(() => assembleScspDsp(source), /line\s+\d+/i, source);
  }
  assert.throws(() => assembleScspDsp('\n; source location\n000: TRA=128'),
    /line\s+3.*TRA|TRA.*line\s+3/i);
  for (const value of [undefined, null, 1, {}, [], new String('000:')]) {
    assert.throws(() => assembleScspDsp(value), TypeError);
  }
});

test('program validation is strict, accepts readonly arrays and leaves inputs untouched', () => {
  for (const value of [null, {}, '', new Uint8Array(512), new Int16Array(512),
    new Float32Array(512), [], new Uint16Array(511), new Uint16Array(513)]) {
    assert.throws(() => disassembleScspDsp(value));
  }
  for (const value of [-1, 65536, 0.5, NaN, Infinity, '0', true, 1n, undefined]) {
    const invalid = new Array(512).fill(0);
    invalid[9] = value;
    const before = invalid.slice();
    assert.throws(() => disassembleScspDsp(invalid));
    assert.deepEqual(invalid, before);
  }
  assert.throws(() => disassembleScspDsp(new Array(512)), 'sparse input must not become zero');
  const input = new Uint16Array(512);
  input.set([0x8012, 0x1234, 0x5678, 0x9abc], 17 * 4);
  const before = input.slice();
  const text = disassembleScspDsp(input);
  assert.deepEqual(input, before);
  assert.equal(disassembleScspDsp(Object.freeze(Array.from(input))), text);
  const first = assembleScspDsp(text), second = assembleScspDsp(text);
  first[0] = 0xffff;
  assert.equal(second[0], 0);
  for (const options of [null, [], true, 'full', {unknown: true}, {includeTrailingZeros: 1}]) {
    assert.throws(() => disassembleScspDsp(input, options));
  }
  assert.deepEqual(input, before);
});

test('disassembly options ignore inherited values and do not invoke option getters', () => {
  const words = new Uint16Array(512),
    previous = Object.getOwnPropertyDescriptor(Object.prototype, 'includeTrailingZeros');
  let inheritedReads = 0, ownReads = 0;
  try {
    Object.defineProperty(Object.prototype, 'includeTrailingZeros', {
      configurable: true,
      get() { inheritedReads++; return true; },
    });
    assert.equal(disassembleScspDsp(words, {}), '');
    assert.equal(inheritedReads, 0);
    const ownGetter = Object.defineProperty({}, 'includeTrailingZeros', {
      enumerable: true,
      get() { ownReads++; return true; },
    });
    assert.throws(() => disassembleScspDsp(words, ownGetter), TypeError);
    assert.equal(ownReads, 0);
  } finally {
    if (previous) Object.defineProperty(Object.prototype, 'includeTrailingZeros', previous);
    else delete Object.prototype.includeTrailingZeros;
  }
});

test('the authored Delay fixture assembles to every word of the legacy DSP image', async () => {
  const source = await readFile(fixtureUrl, 'utf8');
  const actual = assembleScspDsp(source), legacy = delayProgram();
  assert.deepEqual(actual, legacy);
  assert.deepEqual(assembleScspDsp(disassembleScspDsp(actual)), legacy);
  assert.equal(actual.length, 512);
  assert(actual.slice(6 * 4).every(word => word === 0));
});

let modulePromise;
async function createCore(t) {
  modulePromise ??= readFile(new URL('../generated/scsp_wasm.wasm', import.meta.url))
    .then(wasmBinary => factory({wasmBinary}));
  const core = await Scsp.create({moduleFactory: () => modulePromise});
  t.after(() => core.dispose());
  return core;
}

function installProgramForTest(core, words) {
  core.write(22, 0, 0xff);
  for (let index = 0; index < words.length; index++) {
    if (index !== 504) core.write(0x800 + index * 2, words[index]);
  }
  // A write at 0xbf0 starts the DSP. Preserve that instruction's first word.
  core.write(0xbf0, words[504]);
}

async function renderDelay(t, feedback, program, partitioned = false) {
  const core = await createCore(t), synth = new ScspSynth(core);
  reserveDspRam(synth);
  const delay = new DspDelay(core, {enabled: true, timeMs: 20, feedback, send: 7, returnLevel: 7});
  if (program) installProgramForTest(core, program);
  const impulse = new Int16Array(64);
  impulse[1] = 4096;
  const sample = synth.loadPCM(impulse, {baseFrequencyHz: 44100 / 64});
  synth.setPreset(6, {sample, directLevel: 0});
  synth.keyOn(6);
  delay.route([6]);
  const protectedPcm = core.readRam(DSP_RAM_BYTES, 256);
  const frames = 882 * 7, output = {left: new Float32Array(frames), right: new Float32Array(frames)};
  const sizes = partitioned ? [1, 127, 128, 17, 2048, 255] : [frames];
  let frame = 0, block = 0;
  while (frame < frames) {
    const count = Math.min(sizes[block++ % sizes.length], frames - frame);
    const pcm = synth.generateStereo(count);
    output.left.set(pcm.left, frame);
    output.right.set(pcm.right, frame);
    frame += count;
  }
  assert.deepEqual(core.readRam(DSP_RAM_BYTES, 256), protectedPcm);
  assert(output.left.every(Number.isFinite) && output.right.every(Number.isFinite));
  return output;
}

function peak(values) {
  return values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
}

test('assembled Delay preserves real shipped-WASM PCM and an EWT edit changes the effect', async t => {
  const source = await readFile(fixtureUrl, 'utf8'), assembled = assembleScspDsp(source);
  const observations = [];
  for (const feedback of [0, 0.5]) {
    const baseline = await renderDelay(t, feedback);
    const compiled = await renderDelay(t, feedback, assembled);
    const partitioned = await renderDelay(t, feedback, assembled, true);
    assert.deepEqual(compiled, baseline, `feedback ${feedback} matches both stereo channels exactly`);
    assert.deepEqual(partitioned, baseline, 'render partitions retain the DSP result');
    assert(baseline.left.slice(0, 882).every(value => value === 0));
    const echoes = Array.from({length: 6}, (_, index) =>
      peak(baseline.left.slice(882 * (index + 1), 882 * (index + 2))));
    assert(echoes[0] > 0.001, 'the baseline contains the actual wet impulse');
    if (feedback === 0) {
      assert(echoes.slice(1).every(value => value === 0));
    } else {
      for (let index = 1; index < echoes.length; index++) {
        assert(echoes[index] > 0);
        assert(Math.abs(echoes[index] / echoes[index - 1] - 0.5) < 0.01);
      }
    }
    observations.push({feedback, frames: baseline.left.length, exactStereoPcm: true,
      partitionedRenderExact: true, echoPeaks: echoes,
      leftPcmSha256: hash(baseline.left), rightPcmSha256: hash(baseline.right)});
  }

  const lines = source.split('\n');
  const outputLine = lines.findIndex(line => /^\s*\d+\s*:/.test(line) &&
    /\bEWT\s*=\s*1\b/.test(line.split(';')[0]));
  assert(outputLine >= 0, 'the authored fixture exposes the effect write field');
  lines[outputLine] = lines[outputLine].replace(/\bEWT\s*=\s*1\b/, 'EWT=0');
  const edited = assembleScspDsp(lines.join('\n')), expected = assembled.slice();
  expected[3 * 4 + 2] &= ~0x1000;
  assert.deepEqual(edited, expected, 'the edit changes only step 3 effect-write enable');
  const muted = await renderDelay(t, 0.5, edited);
  assert(muted.left.every(value => value === 0) && muted.right.every(value => value === 0));

  if (process.env.SCSP_DSP_ASSEMBLER_REPORT) {
    await writeFile(process.env.SCSP_DSP_ASSEMBLER_REPORT, JSON.stringify({
      passed: true, scope: 'shipped SCSP DSP Delay PCM comparison', physicalAudioUsed: false,
      sampleRate: 44100, programWords: assembled.length,
      programSha256: hash(assembled), fixtureSha256: hash(source), observations,
      editedEwtOnly: true, editedWetOutputSilent: true, pcmRamProtected: true,
    }, null, 2) + '\n');
  }
});
