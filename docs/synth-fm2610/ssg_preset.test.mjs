// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import {createDefaultSsgPreset, isSsgPresetPath, readSsgPreset, writeSsgPreset} from './ssg_preset.js';

test('SSG presets round-trip each voice and shared hardware settings', () => {
  const preset = createDefaultSsgPreset();
  Object.assign(preset, {noisePeriod: 0, envelopePeriod: 65535, envelopeShape: 15});
  Object.assign(preset.channels[0], {tone: false, noise: true, envelope: true, period: 4095});
  Object.assign(preset.channels[1], {tone: true, noise: true, level: 15, period: 1024});
  Object.assign(preset.channels[2], {tone: false, level: 0});
  const restored = readSsgPreset(writeSsgPreset(preset));
  assert.deepEqual(restored, preset);
  restored.channels[1].tone = false;
  assert.equal(preset.channels[1].tone, true);
  const captured = {...preset, channels: preset.channels.map(voice => ({...voice, gate: true, request: 42}))};
  assert.deepEqual(readSsgPreset(captured), preset);
  assert(isSsgPresetPath('/presets/Noise.SSG.JSON'));
  assert(!isSsgPresetPath('/presets/Noise.fm.json'));
  assert(!isSsgPresetPath(null));
});

test('invalid or incomplete SSG presets cannot replace a voice', () => {
  const preset = createDefaultSsgPreset();
  assert.throws(() => readSsgPreset({...preset, version: 2}), /FM2610 SSG preset/);
  assert.throws(() => readSsgPreset({...preset, channels: Array(3)}), /CH1 Tone/);
  assert.throws(() => readSsgPreset({...preset, channels: preset.channels.slice(0, 2)}), /three channels/);
  assert.throws(() => readSsgPreset({...preset, noisePeriod: 32}), /Noise period/);
  assert.throws(() => readSsgPreset({...preset, envelopePeriod: -1}), /Envelope period/);
  assert.throws(() => readSsgPreset({...preset, envelopeShape: 1.5}), /Envelope shape/);
  const channel = {...preset.channels[0], period: 4096};
  assert.throws(() => readSsgPreset({...preset, channels: [channel, ...preset.channels.slice(1)]}), /CH1 Tone period/);
});
