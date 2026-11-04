// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/gameboy_apu_wasm.js';
import {GameboyApu} from '../js/gameboyapu.js';
import {GameboyInstrument} from './instrument.js';
import {waveShape} from './preset.js';

const wasmBinary = await readFile(new URL('../generated/gameboy_apu_wasm.wasm', import.meta.url));
async function fixture(t, sampleRate = 44100) {
  const core = await GameboyApu.create({moduleFactory: factory, moduleOptions: {wasmBinary}, sampleRate});
  const writes = [], write = core.writeRegister.bind(core);
  core.writeRegister = (offset, value) => { writes.push([offset, value]); return write(offset, value); };
  const instrument = new GameboyInstrument(core);
  t.after(() => instrument.dispose());
  return {core, instrument, writes};
}
const audible = pcm => {
  assert(pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite));
  assert(pcm.left.some(value => Math.abs(value) > 0.0001));
};

test('actual WASM pulse pool rotates two channels and steals safely before late releases', async t => {
  const {instrument, writes} = await fixture(t);
  assert.equal(instrument.read().capacity, 2);
  assert.deepEqual(instrument.noteOn('a', 60), {channel: 0, stolenId: null});
  assert.deepEqual(instrument.noteOn('b', 64), {channel: 1, stolenId: null});
  audible(instrument.generateStereo(4096));
  assert.deepEqual(instrument.noteOn('c', 67), {channel: 0, stolenId: 'a'});
  const before = instrument.read(), writeCount = writes.length;
  assert.equal(instrument.noteOff('a'), false); assert.equal(writes.length, writeCount);
  assert.deepEqual(instrument.read(), before);
  instrument.noteOff('b');
  assert.deepEqual(instrument.noteOn('d', 69), {channel: 1, stolenId: null});
  assert.deepEqual(instrument.read().voices.map(voice => voice.id), ['c', 'd']);
  assert.throws(() => instrument.noteOn('c', 72), /already active/);
  audible(instrument.generateStereo(4096));
});

test('invalid preset and frequency changes preserve actual held voices and register writes', async t => {
  const {instrument, writes} = await fixture(t);
  instrument.noteOn('low', 36); instrument.noteOn('high', 72);
  const before = instrument.read(), writeCount = writes.length;
  const invalid = structuredClone(before.preset); invalid.source = 'wave'; invalid.wave.samples[31] = 16;
  for (const apply of [value => instrument.setPreset(value), value => instrument.loadPreset(value)]) assert.throws(() => apply(invalid));
  assert.throws(() => instrument.noteOn('steal', 0), /frequency range/);
  assert.throws(() => instrument.setPitch(-24), /frequency range/);
  assert.equal(writes.length, writeCount); assert.deepEqual(instrument.read(), before);
  audible(instrument.generateStereo(4096));
});

test('live duty and pitch preserve owners and never retrigger hardware envelopes', async t => {
  const {instrument, writes} = await fixture(t, 48000);
  instrument.noteOn('one', 60); instrument.noteOn('two', 64);
  const owners = instrument.read().voices, preset = instrument.read().preset;
  writes.length = 0;
  preset.pulse.duty = 0.25; preset.pulse.volume = 6; preset.pulse.envelope = {direction: 'down', period: 3};
  instrument.setPreset(preset);
  assert.deepEqual(instrument.read().voices, owners);
  assert.deepEqual(writes.map(([offset]) => offset), [1, 6], 'held initial volume and envelope changes wait for the next key trigger');
  writes.length = 0; instrument.setPitch(2);
  assert.equal(instrument.read().pitch, 2); assert.deepEqual(instrument.read().voices, owners);
  assert(writes.every(([offset, value]) => [3, 4, 8, 9].includes(offset) && (![4, 9].includes(offset) || !(value & 0x80))));
  audible(instrument.generateStereo(4096));
  instrument.noteOff('one'); instrument.noteOn('three', 67);
  assert.equal(instrument.read().registers[2], (6 << 4) | 3, 'new key receives the changed initial volume/envelope');
});

test('Sweep restricts Pulse to CH1 and source changes clear previous owners', async t => {
  const {instrument} = await fixture(t);
  instrument.noteOn('one', 60); instrument.noteOn('two', 64);
  const preset = instrument.read().preset; preset.pulse.sweep = {enabled: true, direction: 'down', period: 2, shift: 2};
  instrument.setPreset(preset);
  assert.equal(instrument.read().capacity, 1); assert.deepEqual(instrument.read().voices, []);
  assert.equal(instrument.noteOff('two'), false);
  assert.deepEqual(instrument.noteOn('sweep-a', 60), {channel: 0, stolenId: null});
  assert.deepEqual(instrument.noteOn('sweep-b', 64), {channel: 0, stolenId: 'sweep-a'});
  audible(instrument.generateStereo(1024));
  preset.source = 'wave'; instrument.setPreset(preset);
  assert.deepEqual(instrument.read().voices, []); assert.equal(instrument.read().capacity, 1);
  assert.deepEqual(instrument.noteOn('wave', 60), {channel: 2, stolenId: null});
  audible(instrument.generateStereo(4096));
  assert.deepEqual(instrument.noteOn('wave-new', 64), {channel: 2, stolenId: 'wave'});
  assert.equal(instrument.noteOff('wave'), false);
  assert.equal(instrument.read().voices[0].id, 'wave-new');
  preset.wave.samples = waveShape('square'); instrument.setPreset(preset);
  assert.deepEqual(instrument.read().voices, []); assert.equal(instrument.noteOff('wave-new'), false);
  assert.deepEqual(instrument.noteOn('square', 60), {channel: 2, stolenId: null});
  audible(instrument.generateStereo(4096));
});

test('enabling the default Sweep audibly lowers pitch while its disabled version stays steady', async t => {
  const steady = await fixture(t), swept = await fixture(t);
  const preset = swept.instrument.read().preset;
  assert.equal(preset.pulse.sweep.enabled, false);
  preset.pulse.sweep.enabled = true;
  swept.instrument.setPreset(preset);
  steady.instrument.noteOn('steady', 60); swept.instrument.noteOn('swept', 60);
  const constant = steady.instrument.generateStereo(14000).left, falling = swept.instrument.generateStereo(14000).left;
  const estimate = (samples, start, end) => {
    const crossings = [];
    for (let index = start + 1; index < end; index++) {
      if (samples[index - 1] <= 0 && samples[index] > 0) crossings.push(index);
    }
    assert(crossings.length >= 3, 'enough cycles to estimate the generated pitch');
    return (crossings.length - 1) * 44100 / (crossings.at(-1) - crossings[0]);
  };
  const earlySteady = estimate(constant, 100, 950), lateSteady = estimate(constant, 6600, 12500);
  const earlySweep = estimate(falling, 100, 950), lateSweep = estimate(falling, 6600, 12500);
  assert(Math.abs(earlySteady - lateSteady) / earlySteady < 0.02, 'disabled Sweep retains the original pitch');
  assert(Math.abs(earlySweep - earlySteady) / earlySteady < 0.04, 'Sweep begins at the requested note');
  assert(lateSweep < earlySweep * 0.65, `enabled default Sweep falls: ${earlySweep.toFixed(1)} to ${lateSweep.toFixed(1)} Hz`);
});

test('Noise keys retrigger the sole noise voice without MIDI or pitch-wheel tuning', async t => {
  const a = await fixture(t), b = await fixture(t);
  const preset = a.instrument.read().preset; preset.source = 'noise';
  a.instrument.loadPreset(preset); b.instrument.loadPreset(preset);
  a.instrument.noteOn('noise-low', 12); b.instrument.noteOn('noise-high', 100);
  a.writes.length = 0; a.instrument.setPitch(2); assert.deepEqual(a.writes, []);
  const first = a.instrument.generateStereo(4096), second = b.instrument.generateStereo(4096);
  audible(first); assert.deepEqual(first, second, 'keyboard note and pitch wheel do not tune the noise generator');
  assert.deepEqual(a.instrument.noteOn('noise-new', 80), {channel: 3, stolenId: 'noise-low'});
  assert.equal(a.instrument.noteOff('noise-low'), false);
  const live = a.instrument.read().preset; live.noise.width = 7; live.noise.shift = 2;
  a.writes.length = 0; a.instrument.setPreset(live);
  assert.deepEqual(a.writes.map(([offset]) => offset), [18]);
  assert.equal(a.instrument.read().voices[0].id, 'noise-new'); audible(a.instrument.generateStereo(4096));
});

test('preset reload stops held notes, restores all sources and detaches exported data', async t => {
  const {instrument, core} = await fixture(t);
  instrument.noteOn('held', 60); instrument.setPitch(1);
  const preset = instrument.read().preset; preset.wave.samples = waveShape('triangle'); preset.noise.width = 7;
  instrument.loadPreset(preset); preset.wave.samples[0] = 15;
  const state = instrument.read(); assert.deepEqual(state.voices, []); assert.equal(state.pitch, 0); assert.equal(state.preset.wave.samples[0], 0);
  state.preset.wave.samples[0] = 8; assert.equal(instrument.read().preset.wave.samples[0], 0);
  instrument.noteOn('new', 60); audible(instrument.generateStereo(4096)); instrument.stop();
  assert.deepEqual(instrument.read().voices, []);
  instrument.generateStereo(44100);
  const tail = instrument.generateStereo(2048); assert(tail.left.every(value => Math.abs(value) < 0.0001));
  instrument.dispose(); assert.equal(core.handle, 0); assert.throws(() => instrument.read(), /disposed/);
});
