import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GameboyApu} from '../js/gameboyapu.js';
import {GameboySynth, GameboyDirectTransport} from '../js/gameboysynth.js';
import moduleFactory from '../generated/gameboy_apu_wasm.js';
import {ENVELOPE_DEFAULTS, WAVE_DEFAULTS, wavePreset, parseWave, validateSamples, lessonCode, renderLesson, amplitudeTrace} from './gameboy-lessons.js';
const moduleOptions = {wasmBinary: await readFile(new URL('../generated/gameboy_apu_wasm.wasm', import.meta.url))};
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
async function matched(kind, settings, sampleRate) {
  const actual = await renderLesson(kind, settings, {moduleOptions, sampleRate});
  assert.deepEqual(actual.left, actual.right);
  assert.ok(actual.left.every(Number.isFinite));
  const chip = await GameboyApu.create({moduleFactory, moduleOptions, sampleRate});
  const gb = new GameboySynth({transport: new GameboyDirectTransport(chip)});
  let expected;
  try {
    await new AsyncFunction('useSoundChip', 'sleep', lessonCode(kind, settings))(
      async name => { assert.equal(name, 'gameboy'); return gb; },
      async seconds => { expected = chip.generateStereo(Math.round(seconds * sampleRate)); });
    assert.deepEqual(actual.left, expected.left);
    assert.throws(() => gb.wave.keyOn(), /disposed/);
  } finally { gb.dispose(); chip.dispose(); }
  return actual;
}
for (const sampleRate of [44100, 48000]) {
  test(`Envelope matches copied code and measured amplitude rises/falls at ${sampleRate}`, async () => {
    for (const [volume, direction, period] of [[12, 'down', 2], [0, 'up', 2], [0, 'down', 2], [12, 'down', 0], [3, 'up', 7], [15, 'up', 1]]) {
      const pcm = await matched('envelope', {volume, direction, period}, sampleRate);
      const trace = amplitudeTrace(pcm.left, sampleRate);
      const beginning = trace[5], end = trace.at(-1);
      if (volume === 0 && direction === 'down') assert.ok(trace.every(value => value === 0));
      else if (period === 0 || volume === 15 && direction === 'up') assert.ok(Math.abs(end - beginning) < 1e-6);
      else if (direction === 'down') { assert.ok(beginning > .01); assert.equal(end, 0); }
      else assert.ok(end > beginning + .01);
    }
  });
  test(`Wave presets/levels match copied code at ${sampleRate}`, async () => {
    for (const preset of ['triangle', 'saw', 'pulse', 'double']) for (const level of [0, .25, .5, 1]) {
      const pcm = await matched('wave', {...WAVE_DEFAULTS, samples: wavePreset(preset), level}, sampleRate);
      const trace = amplitudeTrace(pcm.left, sampleRate);
      if (level === 0) assert.ok(trace.every(value => value === 0));
      else assert.ok(trace[10] > .005);
    }
  });
}
test('Wave cycle structure and note change each double audible pitch', async () => {
  function pitch(pcm) {
    const part = pcm.left.slice(4800, 28800);
    const center = (Math.max(...part) + Math.min(...part)) / 2;
    let n = 0;
    for (let i = 1; i < part.length; i++) if (part[i - 1] < center && part[i] >= center) n++;
    return n * 2;
  }
  for (const [preset, note, target] of [['triangle', 'A3', 220], ['triangle', 'A4', 440], ['double', 'A3', 440]]) {
    const pcm = await renderLesson('wave', {...WAVE_DEFAULTS, samples: wavePreset(preset), note}, {moduleOptions});
    assert.ok(Math.abs(pitch(pcm) - target) < 5);
  }
});
test('Wave JSON imports validate atomically and copy caller data', async () => {
  const samples = wavePreset('triangle');
  assert.deepEqual(parseWave(JSON.stringify(samples)), samples);
  const copy = validateSamples(samples); copy[0] = 15; assert.equal(samples[0], 0);
  for (const text of ['[]', JSON.stringify(Array(32).fill(16)), JSON.stringify(Array(32).fill(1.5)), JSON.stringify(Array(32).fill(null)), 'process.exit()', 'x'.repeat(2049)]) assert.throws(() => parseWave(text));
  assert.throws(() => validateSamples(Array(32)));
  await assert.rejects(renderLesson('wave', {...WAVE_DEFAULTS, samples: []}), RangeError);
  await assert.rejects(renderLesson('envelope', {...ENVELOPE_DEFAULTS, period: 8}), RangeError);
});
