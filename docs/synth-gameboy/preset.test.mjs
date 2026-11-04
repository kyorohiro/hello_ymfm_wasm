// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createDefaultPreset, readPreset, waveShape, presetToCode} from './preset.js';

test('portable Game Boy preset retains all sources and owns nested values', () => {
  const source = createDefaultPreset();
  source.name = '  Bright GB  '; source.source = 'wave';
  source.pulse.duty = 0.125; source.pulse.sweep = {enabled: true, direction: 'down', period: 3, shift: 2};
  source.wave.samples = waveShape('saw'); source.wave.level = 0.25;
  source.noise.width = 7; source.noise.envelope = {direction: 'up', period: 5}; source.pan.right = false;
  const copy = readPreset(JSON.parse(JSON.stringify(source)));
  assert.equal(copy.name, 'Bright GB'); assert.equal(copy.source, 'wave');
  assert.deepEqual(copy, {...source, name: 'Bright GB'});
  copy.wave.samples[0] = 15; copy.noise.envelope.period = 1;
  assert.equal(source.wave.samples[0], 0); assert.equal(source.noise.envelope.period, 5);
});

test('malformed, sparse, oversized and ambiguous presets are rejected', () => {
  const changes = [
    p => { p.extra = 1; }, p => { delete p.pan; }, p => { p.version = 2; }, p => { p.source = 'psg'; },
    p => { p.pulse.duty = 0.4; }, p => { p.pulse.volume = 16; }, p => { p.pulse.envelope.period = 1.5; },
    p => { p.pulse.envelope.direction = 'hold'; }, p => { p.pulse.envelope.extra = true; },
    p => { p.pulse.sweep.enabled = 1; }, p => { p.pulse.sweep.shift = 8; },
    p => { p.wave.samples.pop(); }, p => { p.wave.samples[2] = 16; }, p => { p.wave.samples[5] = NaN; },
    p => { delete p.wave.samples[4]; }, p => { p.wave.samples.foo = 1; }, p => { p.wave.level = 0.3; },
    p => { p.noise.divisor = -1; }, p => { p.noise.shift = 16; }, p => { p.noise.width = 8; },
    p => { p.pan.left = 'true'; }, p => { p.name = 'x'.repeat(81); }, p => { p.name = 'bad\ncode'; },
    p => { p.name = 'bad\u2028code'; }, p => { Object.setPrototypeOf(p, {source: 'noise'}); },
  ];
  for (const change of changes) {
    const value = createDefaultPreset(); change(value);
    assert.throws(() => readPreset(value));
  }
});

test('software waveform preparation produces 32 four-bit samples and no aliases', () => {
  for (const name of ['sine', 'triangle', 'saw', 'square']) {
    const samples = waveShape(name);
    assert.equal(samples.length, 32); assert(samples.every(value => Number.isInteger(value) && value >= 0 && value <= 15));
    const again = waveShape(name); samples[0] = 4; assert.notEqual(again[0], 4);
  }
  assert.deepEqual(waveShape('square'), Array(16).fill(15).concat(Array(16).fill(0)));
  assert.throws(() => waveShape('imported'));
});

test('copied JavaScript configures the actual selected hardware source', () => {
  for (const source of ['pulse', 'wave', 'noise']) {
    const calls = [], preset = createDefaultPreset(); preset.source = source;
    preset.pan.left = false; preset.pan.right = true;
    preset.pulse.sweep = {enabled: true, direction: 'down', period: 3, shift: 2};
    const fn = name => (...args) => calls.push([name, ...args]);
    const gameboy = {pulse: {setVoice: fn('pulse voice'), setSweep: fn('sweep')}, wave: {stopAndSetWaveform: fn('wave'), setLevel: fn('level')},
      noise: {setVoice: fn('noise'), keyOn: fn('noise on')}, setPan: fn('pan'), noteOn: fn('note')};
    vm.runInNewContext(presetToCode(preset), {gameboy});
    const channel = source === 'pulse' ? 0 : source === 'wave' ? 2 : 3;
    assert.deepEqual(calls.find(call => call[0] === 'pan'), ['pan', channel, false, true]);
    if (source === 'pulse') {
      assert.equal(calls.filter(call => call[0] === 'pulse voice').length, 2);
      assert.deepEqual(JSON.parse(JSON.stringify(calls.find(call => call[0] === 'sweep')[1])), {direction: 'down', period: 3, shift: 2});
    }
    if (source === 'wave') assert.deepEqual(Array.from(calls.find(call => call[0] === 'wave')[1]), preset.wave.samples);
    assert.deepEqual(calls.at(-1), source === 'noise' ? ['noise on'] : ['note', channel, 'C4']);
  }
});
