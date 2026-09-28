import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/ym2608_wasm.js';
import {renderRhythmVoice} from '../demos/opna-rhythm-render.js';
import {generateRhythmRom, VOICES, PARAMETERS, defaultParameters, bassDrumEnvelope, synthesizeVoice, snareResonance, rimPeakBoost} from '../../assets/opna-rhythm/synthesis.mjs';

test('browser synthesis preserves defaults and edits only the selected voice region', async () => {
  const original = await readFile(new URL('../js/tetorica_ym2608_adpcm_rom.bin', import.meta.url));
  assert.deepEqual(Buffer.from(generateRhythmRom()), original);
  for (const voice of VOICES) {
    for (const key of Object.keys(PARAMETERS)) {
      if (PARAMETERS[key].voice && PARAMETERS[key].voice !== voice.name) continue;
      const values = {...defaultParameters(), [key]: ['attack', 'noisePeaks', 'snareSharpness', 'tomNoisePeaks', 'rimGain', 'rimPeaks'].includes(key) ? 2 : 0.5};
      const changed = generateRhythmRom({[voice.name]: values});
      assert.equal(changed.length, 8192);
      assert.notDeepEqual(changed.slice(voice.start, voice.start + voice.length), new Uint8Array(original.slice(voice.start, voice.start + voice.length)));
      assert.deepEqual(Buffer.from(changed.slice(0, voice.start)), original.slice(0, voice.start));
      assert.deepEqual(Buffer.from(changed.slice(voice.start + voice.length)), original.slice(voice.start + voice.length));
    }
  }
  assert.throws(() => generateRhythmRom({bassDrum: {level: NaN}}), /parameter/);
  assert.throws(() => generateRhythmRom({snare: {pitch: 20}}), /parameter/);
});

test('rim shot boosts only larger early excursions and retains an independently controlled tail', async () => {
  for (const x of [-0.2, -0.1, 0, 0.1, 0.2]) assert.equal(rimPeakBoost(x, 1, 1.8, 0.2, 6), x);
  assert.ok(rimPeakBoost(0.8, 1, 1.8, 0.2, 6) > 0.8);
  assert.ok(rimPeakBoost(-0.8, 1, 1.8, 0.2, 6) < -0.8);
  assert.equal(rimPeakBoost(0.8, 6, 1.8, 0.2, 6), 0.8);
  const options = {wasmBinary: await readFile(new URL('../generated/ym2608_wasm.wasm', import.meta.url))};
  const render = settings => renderRhythmVoice(generateRhythmRom({rimShot: settings}), 5, factory, options);
  const dry = await render({rimGain: 1, rimTail: 0});
  const wet = await render({});
  const energy = pcm => pcm.left.subarray(720, 1200).reduce((sum, x) => sum + x*x, 0); // 15–25 ms.
  assert.ok(energy(wet) > energy(dry) * 2);
  assert.ok(wet.left.subarray(1536).every(x => x === 0));
  assert.ok(wet.left.every(x => Number.isFinite(x) && Math.abs(x) < 1));
});

test('Tom softens its first crest, limits noise to six crests and retains a late tonal tail', async () => {
  const quiet = synthesizeVoice(VOICES[4], {noise: 0});
  const noisy = synthesizeVoice(VOICES[4]);
  const peaks = []; let peak = 0;
  for (const x of quiet) {
    if (x > 0) peak = Math.max(peak, x);
    else if (peak) { peaks.push(peak); peak = 0; }
  }
  assert.ok(peaks[0] < peaks[1]);
  // Compare shapes after removing the independently applied peak normalization.
  const ratio = noisy[800] / quiet[800];
  let earlyDifference = 0;
  for (let i = 0; i < 1200; i++) {
    const t = i * 864 / 8000000;
    const cycles = 125*t + 95*0.018*(1-Math.exp(-t/0.018));
    const difference = Math.abs(noisy[i] - quiet[i] * ratio);
    if (cycles >= 5.5) assert.ok(difference < 4, 'noise ends after sixth positive crest');
    else earlyDifference = Math.max(earlyDifference, difference);
  }
  assert.ok(earlyDifference > 10);
  const options = {wasmBinary: await readFile(new URL('../generated/ym2608_wasm.wasm', import.meta.url))};
  const render = settings => renderRhythmVoice(generateRhythmRom({tom: settings}), 4, factory, options);
  const short = await render({tomDecayMs: 33, tomTail: 0});
  const long = await render({});
  const energy = pcm => pcm.left.subarray(4320, 5760).reduce((s, x) => s + x*x, 0); // 90–120 ms.
  assert.ok(energy(long) > energy(short));
  assert.ok(long.left.subarray(6960).every(x => x === 0)); // 145 ms onward.
});

test('hi-hat retains more late noise, but stops at its fixed ROM end', async () => {
  const options = {wasmBinary: await readFile(new URL('../generated/ym2608_wasm.wasm', import.meta.url))};
  const render = settings => renderRhythmVoice(generateRhythmRom({hiHat: settings}), 3, factory, options);
  const baseline = await render({hiHatDecayMs: 9, hiHatTail: 0});
  const longer = await render({hiHatDecayMs: 18, hiHatTail: 0});
  const tail = await render({hiHatDecayMs: 18, hiHatTail: 0.12});
  const lateRms = pcm => {
    const values = pcm.left.subarray(1200, 1776); // 25–37 ms, before the end fade.
    return Math.sqrt(values.reduce((sum, x) => sum + x*x, 0) / values.length);
  };
  assert.ok(lateRms(longer) > lateRms(baseline));
  assert.ok(lateRms(tail) > lateRms(longer));
  assert.ok(tail.left.subarray(2208).every(x => x === 0)); // 46 ms onward.
  assert.ok(tail.left.every(x => Number.isFinite(x) && Math.abs(x) < 1));
});

test('cymbal strike concentrates energy at the start without raising the sustained body', async () => {
  const options = {wasmBinary: await readFile(new URL('../generated/ym2608_wasm.wasm', import.meta.url))};
  const strike = await renderRhythmVoice(generateRhythmRom(), 2, factory, options);
  const plain = await renderRhythmVoice(generateRhythmRom({cymbal: {cymbalStrike: 0}}), 2, factory, options);
  const peak = pcm => pcm.reduce((p, x) => Math.max(p, Math.abs(x)), 0);
  const rms = pcm => Math.sqrt(pcm.reduce((s, x) => s + x*x, 0) / pcm.length);
  assert.ok(peak(strike.left.subarray(0, 240)) > peak(strike.left.subarray(480)), 'strong transient in first 5 ms');
  assert.ok(peak(strike.left) / rms(strike.left) > peak(plain.left) / rms(plain.left));
  assert.ok(rms(strike.left.subarray(480)) < rms(plain.left.subarray(480)), 'normalization keeps the tail quieter');
});

test('snare resonance has narrower peaks and an attenuated first crest', () => {
  const width = power => Array.from({length: 1000}, (_, i) => snareResonance(i / 2000, power)).filter(v => v > 0.8).length;
  assert.ok(width(1.8) < width(1));
  assert.equal(snareResonance(0.25, 1.8), 1);
  assert.equal(snareResonance(0.75, 1.8), -1);
  const pcm = synthesizeVoice(VOICES[1], {noise: 0});
  const peaks = []; let peak = 0;
  for (const sample of pcm) {
    if (sample > 0) peak = Math.max(peak, sample);
    else if (peak) { peaks.push(peak); peak = 0; }
  }
  assert.ok(peaks[0] < peaks[1]);
});

test('bass drum softens first crest and fades noise across the first four positive crests', () => {
  assert.equal(bassDrumEnvelope(0.25, 0.45, 4).tone, 0.45);
  assert.equal(bassDrumEnvelope(0.75, 0.45, 4).tone, 1);
  const levels = [0.25, 1.25, 2.25, 3.25, 3.5].map(c => bassDrumEnvelope(c, 0.45, 4).noise);
  assert.ok(levels.slice(1).every((n, i) => n < levels[i]));
  assert.equal(levels.at(-1), 0);
  assert.equal(bassDrumEnvelope(5, 0.45, 4).noise, 0);
  const tone = synthesizeVoice(VOICES[0], {noise: 0});
  const peaks = [];
  let peak = 0;
  for (const sample of tone) {
    if (sample > 0) peak = Math.max(peak, sample);
    else if (peak) { peaks.push(peak); peak = 0; }
  }
  assert.ok(peaks[0] < peaks[1], 'second positive crest is stronger than first');
});

test('comparison renders repeatable, audible stereo for all six voices', async () => {
  const rom = await readFile(new URL('../js/tetorica_ym2608_adpcm_rom.bin', import.meta.url));
  const options = {wasmBinary: await readFile(new URL('../generated/ym2608_wasm.wasm', import.meta.url))};
  for (let voice = 0; voice < 6; voice++) {
    const a = await renderRhythmVoice(rom, voice, factory, options);
    const b = await renderRhythmVoice(rom, voice, factory, options);
    assert.equal(a.left.length, 48000);
    assert.deepEqual(a, b, 'same ROM and voice must render identically');
    assert.deepEqual(a.left, a.right);
    assert.ok(a.left.every(Number.isFinite));
    assert.ok(a.left.some(v => Math.abs(v) > 0.001));
    assert.ok(a.left.subarray(40000).every(v => v === 0));
  }
  await assert.rejects(renderRhythmVoice(new Uint8Array(10), 0, factory, options), /8192/);
  await assert.rejects(renderRhythmVoice(rom, 6, factory, options), /voice/);
});
