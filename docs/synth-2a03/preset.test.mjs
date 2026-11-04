// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createDefaultPreset, readPreset, waveShape, presetToCode} from './preset.js';
import {NesApuSynth} from '../js/nesapusynth.js';

test('portable NES/FDS preset owns complete independent six-bit wave and modulation data', () => {
  const source = createDefaultPreset(); source.name = '  FDS flute  '; source.source = 'fds';
  source.fds.modulation.enabled = true; source.fds.modulation.bias = -24;
  source.pulse.envelope = {enabled: true, period: 4, loop: true};
  const copy = readPreset(JSON.parse(JSON.stringify(source)));
  assert.deepEqual(copy, {...source, name: 'FDS flute'});
  copy.fds.wave[0] = 63; copy.fds.modulation.table[0] = 4;
  assert.notEqual(source.fds.wave[0], 63); assert.equal(source.fds.modulation.table[0], 1);
});

test('strict presets reject ambiguous, sparse, non-finite, extra and out-of-hardware data', () => {
  const changes = [
    p => {p.extra = 1;}, p => {delete p.noise;}, p => {p.format = 'nes';}, p => {p.version = 2;}, p => {p.source = 'dmc';},
    p => {p.name = 'a\ncode';}, p => {p.name = 'a'.repeat(81);}, p => {p.name = 'bad\u2028code';},
    p => {p.pulse.duty = .4;}, p => {p.pulse.volume = 16;}, p => {p.pulse.envelope.enabled = 1;}, p => {p.pulse.envelope.period = -1;},
    p => {p.pulse.sweep.period = 8;}, p => {p.pulse.sweep.shift = 1.5;}, p => {p.pulse.sweep.negate = 'true';},
    p => {p.noise.period = 16;}, p => {p.noise.volume = -1;}, p => {p.noise.shortMode = 0;},
    p => {p.fds.wave.pop();}, p => {delete p.fds.wave[4];}, p => {p.fds.wave.foo = 1;}, p => {p.fds.wave[5] = 64;},
    p => {p.fds.volume = 33;}, p => {p.fds.master = 4;}, p => {p.fds.modulation.table[1] = 8;},
    p => {p.fds.modulation.table.length = 31;}, p => {p.fds.modulation.table.extra = 1;},
    p => {p.fds.modulation.rate = 4096;}, p => {p.fds.modulation.depth = NaN;}, p => {p.fds.modulation.bias = -65;},
    p => {Object.setPrototypeOf(p, {source: 'noise'});},
  ];
  for (const change of changes) {const preset = createDefaultPreset(); change(preset); assert.throws(() => readPreset(preset));}
});

test('software wave shapes produce detached 64-point six-bit cycles', () => {
  for (const name of ['sine', 'triangle', 'saw', 'square']) {
    const wave = waveShape(name); assert.equal(wave.length, 64);
    assert(wave.every(value => Number.isInteger(value) && value >= 0 && value <= 63));
    const before = wave[0]; wave[0] = 255; assert.equal(waveShape(name)[0], before);
  }
  assert.deepEqual(waveShape('square'), [...Array(32).fill(63), ...Array(32).fill(0)]);
  assert.throws(() => waveShape('imported'));
});

test('copied code configures the actual NES Synth API for every initial source', () => {
  for (const source of ['pulse', 'triangle', 'noise', 'fds']) {
    const writes = [], preset = createDefaultPreset(); preset.source = source;
    preset.pulse.envelope.enabled = true; preset.fds.modulation.enabled = true;
    const nes = new NesApuSynth({transport: {writeRegister:(r,v) => writes.push([r,v])}, fds: true});
    writes.length = 0; vm.runInNewContext(presetToCode(preset), {nes});
    if (source === 'pulse') {assert(writes.some(([r,v]) => r === 0x4000 && !(v & 16))); assert(writes.some(([r]) => r === 0x4004));}
    if (source === 'triangle') assert(writes.some(([r,v]) => r === 0x4008 && v === 255));
    if (source === 'noise') assert(writes.some(([r]) => r === 0x400e));
    if (source === 'fds') {assert.equal(writes.filter(([r]) => r >= 0x4040 && r <= 0x407f).length, 64); assert.equal(writes.filter(([r]) => r === 0x4088).length, 32);}
  }
});
