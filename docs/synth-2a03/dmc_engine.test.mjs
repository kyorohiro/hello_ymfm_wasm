// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/nesapu_wasm.js';
import {NesApuWasm} from '../js/nesapu_wasm.js';
import {NesInstrument} from './instrument.js';
import {createDemoDpcm} from './preset.js';

const wasmBinary = await readFile(new URL('../generated/nesapu_wasm.wasm', import.meta.url));
async function fixture(t, sampleRate = 48000) {
  const core = await NesApuWasm.create({moduleFactory:factory, moduleOptions:{wasmBinary}, sampleRate, fds:true});
  const writes = [], write = core.writeRegister.bind(core);
  core.writeRegister = (register, value) => {writes.push([register,value]); return write(register,value);};
  const instrument = new NesInstrument(core); t.after(() => instrument.dispose());
  const preset = instrument.read().preset; preset.source = 'dmc'; preset.dmc.data = createDemoDpcm();
  return {core, instrument, writes, preset};
}
const audible = pcm => {
  assert(pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite));
  assert(pcm.left.some(value => Math.abs(value) > .0001));
};
const rms = samples => Math.sqrt(samples.reduce((total, value) => total + value * value, 0) / samples.length);

test('DMC uploads owned bytes with neutral hardware padding and sounds at both host sample rates', async t => {
  for (const sampleRate of [44100,48000]) {
    const {core, instrument, preset} = await fixture(t, sampleRate);
    preset.dmc.data = createDemoDpcm().slice(0,32); preset.dmc.loop = true;
    const expected = [...preset.dmc.data]; instrument.loadPreset(preset); preset.dmc.data.fill(0);
    assert.deepEqual(instrument.read().preset.dmc.data, expected);
    assert.deepEqual(Array.from({length:32}, (_, index) => core.readMemory(0xc000 + index)), expected);
    assert.equal(core.readMemory(0xc020), 0xaa);
    assert.deepEqual(instrument.noteOn('sample',60), {channel:4, stolenId:null});
    assert.equal(instrument.read().capacity, 1); assert.equal(core.getState().registers[0x13], 2);
    assert.equal(core.getState().dmcOutput, 64); audible(instrument.generateStereo(4096));
  }
});

test('DMC keyboard notes and Pitch leave its hardware playback rate unchanged', async t => {
  const low = await fixture(t), high = await fixture(t);
  low.preset.dmc.loop = true; high.preset.dmc.loop = true;
  low.instrument.loadPreset(low.preset); high.instrument.loadPreset(high.preset);
  low.instrument.noteOn('low',0); high.instrument.noteOn('high',127);
  low.writes.length = 0; low.instrument.setPitch(2);
  assert.deepEqual(low.writes, []); assert.equal(low.core.getState().dmcFrequency, high.core.getState().dmcFrequency);
  const a = low.instrument.generateStereo(4096), b = high.instrument.generateStereo(4096);
  audible(a); assert.deepEqual(a,b, 'fresh matching hardware states differ only in the ignored musical note');
});

test('DMC accepts both hardware length endpoints without truncation or address overflow', async t => {
  const {core, instrument, preset} = await fixture(t);
  for (const length of [1,4081]) {
    preset.dmc.data = Array(length).fill(0xaa); preset.dmc.data[length - 1] = 0x55;
    instrument.loadPreset(preset); instrument.noteOn(`length-${length}`,60);
    assert.equal(core.getState().registers[0x13], (length - 1) / 16);
    assert.equal(core.readMemory(0xc000 + length - 1), 0x55);
    audible(instrument.generateStereo(2048)); instrument.stop();
  }
});

test('DMC mono replacement ignores old releases and explicit release clears the latched DAC', async t => {
  const {core, instrument, preset, writes} = await fixture(t);
  preset.dmc.loop = true; instrument.loadPreset(preset); instrument.noteOn('old',60);
  instrument.generateStereo(31); // Replace while an output byte is still shifting.
  assert.deepEqual(instrument.noteOn('new',64), {channel:4, stolenId:'old'});
  const owners = instrument.read().voices; writes.length = 0;
  assert.equal(instrument.noteOff('old'), false); assert.deepEqual(writes, []);
  assert.deepEqual(instrument.read().voices, owners); audible(instrument.generateStereo(4096));
  assert.equal(instrument.noteOff('new'), true);
  assert.equal(core.getState().dmcRemaining, 0); assert.equal(core.getState().dmcOutput, 0);
  assert.equal(core.getState().enableMask & 16, 0);
  instrument.generateStereo(48000);
  assert(rms(instrument.generateStereo(2048).left) < .0001, 'release settles to silence after the output filter tail');
});

test('DMC one-shot completes, rate changes duration and Loop can stop live without losing ownership', async t => {
  const fast = await fixture(t), slow = await fixture(t), loop = await fixture(t);
  slow.preset.dmc.rate = 0; loop.preset.dmc.loop = true;
  for (const item of [fast, slow, loop]) {item.instrument.loadPreset(item.preset); item.instrument.noteOn('held',60); item.instrument.generateStereo(8000);}
  assert.equal(fast.core.getState().dmcRemaining, 0); assert(slow.core.getState().dmcRemaining > 0);
  assert(loop.core.getState().dmcRemaining > 0);
  assert.equal(fast.instrument.read().voices[0].id, 'held', 'held-key ownership does not truncate the final fetched byte');
  const preset = loop.instrument.read().preset; preset.dmc.loop = false; loop.instrument.setPreset(preset);
  loop.instrument.generateStereo(8000); assert.equal(loop.core.getState().dmcRemaining, 0);
  assert.equal(loop.instrument.read().voices[0].id, 'held');
  assert.deepEqual(fast.instrument.noteOn('again',67), {channel:4, stolenId:'held'});
  assert(fast.core.getState().dmcRemaining > 0, 'a new key explicitly triggers the finished sample');
});

test('DMC rate / Loop edit live; initial level waits for the next attack and sample edits stop held notes', async t => {
  const {core, instrument, preset, writes} = await fixture(t);
  preset.dmc.loop = true; instrument.loadPreset(preset); instrument.noteOn('held',60); instrument.generateStereo(4096);
  const before = instrument.read().voices, next = instrument.read().preset;
  next.dmc.rate = 7; next.dmc.loop = false; writes.length = 0; instrument.setPreset(next);
  assert.deepEqual(writes, [[0x4010,7]]); assert.deepEqual(instrument.read().voices, before);
  const output = core.getState().dmcOutput;
  next.dmc.level = 23; writes.length = 0; instrument.setPreset(next);
  assert.deepEqual(writes, []); assert.equal(core.getState().dmcOutput, output);
  instrument.noteOn('level',60); assert.equal(core.getState().dmcOutput, 23);
  next.dmc.data = Array(17).fill(0xaa); instrument.setPreset(next);
  assert.deepEqual(instrument.read().voices, []); assert.equal(core.getState().dmcOutput, 0);
  assert.equal(instrument.noteOff('level'), false); assert.equal(core.readMemory(0xc000), 0xaa);
});

test('empty DMC attacks and malformed samples fail before modifying the active instrument', async t => {
  const {instrument, preset, writes} = await fixture(t);
  const empty = instrument.read().preset; empty.source = 'dmc'; instrument.loadPreset(empty);
  const beforeEmpty = instrument.read(); writes.length = 0;
  assert.throws(() => instrument.noteOn('empty',60), /Load a DPCM/);
  assert.deepEqual(writes, []); assert.deepEqual(instrument.read(), beforeEmpty);
  preset.dmc.loop = true; instrument.loadPreset(preset); instrument.noteOn('held',60); instrument.generateStereo(4096);
  const before = instrument.read(); writes.length = 0;
  for (const bad of [Array(4082).fill(0), [256]]) {
    const invalid = instrument.read().preset; invalid.dmc.data = bad;
    assert.throws(() => instrument.setPreset(invalid)); assert.throws(() => instrument.loadPreset(invalid));
    assert.deepEqual(writes, []); assert.deepEqual(instrument.read(), before);
  }
});
