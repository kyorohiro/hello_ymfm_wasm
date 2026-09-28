import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/ym2608_wasm.js';
import {renderRhythmVoice} from '../demos/opna-rhythm-render.js';
import {generateRhythmRom, VOICES, PARAMETERS, defaultParameters, bassDrumEnvelope, synthesizeVoice, snareResonance} from '../../assets/opna-rhythm/synthesis.mjs';

test('browser synthesis preserves defaults and edits only the selected voice region', async () => {
  const original = await readFile(new URL('../js/tetorica_ym2608_adpcm_rom.bin', import.meta.url));
  assert.deepEqual(Buffer.from(generateRhythmRom()), original);
  for (const voice of VOICES) {
    for (const key of Object.keys(PARAMETERS)) {
      if (PARAMETERS[key].voice && PARAMETERS[key].voice !== voice.name) continue;
      if (voice.name === 'tom' && key === 'noise') continue; // Tonal synthesis has no noise component.
      const values = {...defaultParameters(), [key]: key === 'attack' || key === 'noisePeaks' || key === 'snareSharpness' ? 2 : 0.5};
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
