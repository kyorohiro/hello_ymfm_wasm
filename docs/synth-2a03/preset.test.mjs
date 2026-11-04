// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createDefaultPreset, readPreset, waveShape, presetToCode, createDemoDpcm, MAX_DPCM_BYTES} from './preset.js';
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
    p => {p.extra = 1;}, p => {delete p.noise;}, p => {p.format = 'nes';}, p => {p.version = 3;}, p => {p.source = 'sid';},
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

test('v2 owns DPCM bytes and strictly migrates original v1 presets without enabling DMC', () => {
  const original = createDefaultPreset(); delete original.dmc; original.version = 1;
  const migrated = readPreset(original);
  assert.equal(migrated.version, 2); assert.equal(migrated.source, 'pulse');
  assert.deepEqual(migrated.dmc, {data: [], rate: 15, loop: false, level: 64});
  assert.deepEqual(migrated.fds, original.fds);
  assert.throws(() => readPreset({...original, source:'dmc'}));
  assert.throws(() => readPreset({...original, dmc:migrated.dmc}));
  const preset = createDefaultPreset(); preset.source = 'dmc'; preset.dmc.data = createDemoDpcm();
  const restored = readPreset(JSON.parse(JSON.stringify(preset)));
  assert.deepEqual(restored, preset); restored.dmc.data[0] = 0; assert.equal(preset.dmc.data[0], 255);
  assert.equal(MAX_DPCM_BYTES, 4081); assert.equal(createDemoDpcm().length, 257);
  assert.equal(readPreset({...preset, dmc:{...preset.dmc, data:[]}}).dmc.data.length, 0, 'empty editable DMC draft is valid');
  for (const change of [
    p => {delete p.dmc;}, p => {p.dmc.extra = 1;}, p => {p.dmc.data = Array(4082).fill(0);},
    p => {p.dmc.data[0] = 256;}, p => {p.dmc.data[0] = -1;}, p => {p.dmc.data[0] = .5;},
    p => {p.dmc.data[0] = NaN;}, p => {delete p.dmc.data[0];}, p => {p.dmc.data.extra = 0;},
    p => {p.dmc.rate = 16;}, p => {p.dmc.loop = 1;}, p => {p.dmc.level = 128;},
  ]) {const invalid = structuredClone(preset); change(invalid); assert.throws(() => readPreset(invalid));}
  const inherited = structuredClone(preset); delete inherited.dmc.data[0]; inherited.dmc.data.extra = 0;
  Object.setPrototypeOf(inherited.dmc.data, {0:255}); assert.throws(() => readPreset(inherited));
});

test('DMC JavaScript export awaits encoded memory and empty drafts only explain how to load data', async () => {
  const preset = createDefaultPreset(); preset.source = 'dmc';
  const empty = presetToCode(preset); assert(!empty.includes('loadSample(')); assert(!empty.includes('dmc.play('));
  preset.dmc = {data:createDemoDpcm(), rate:5, loop:true, level:31};
  const writes = [], uploads = [];
  const nes = new NesApuSynth({transport:{writeRegister:(r,v)=>writes.push([r,v]), loadMemory:(bytes,address)=>{uploads.push({bytes,address});}}});
  writes.length = 0;
  const code = presetToCode(preset);
  await vm.runInNewContext(`(async () => {${code}\n})()`, {nes, Uint8Array});
  assert.equal(uploads.length, 1); assert.equal(uploads[0].address, 0xc000);
  assert.deepEqual(Array.from(uploads[0].bytes), preset.dmc.data);
  assert(writes.some(([r,v]) => r === 0x4010 && v === 69));
  assert(writes.some(([r,v]) => r === 0x4011 && v === 31));
  assert.match(code, /nes\.dmc\.stop\(\); nes\.writeRegister\(0x4011, 0\)/);
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
