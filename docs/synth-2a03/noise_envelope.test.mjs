// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/nesapu_wasm.js';
import {NesApuWasm} from '../js/nesapu_wasm.js';
import {NesInstrument} from './instrument.js';

const wasmBinary = await readFile(new URL('../generated/nesapu_wasm.wasm', import.meta.url));
async function fixture(t, sampleRate = 44100, {enabled = true, period = 2, loop = false} = {}) {
  const core = await NesApuWasm.create({moduleFactory:factory, moduleOptions:{wasmBinary}, sampleRate, fds:true});
  const writes = [], write = core.writeRegister.bind(core);
  core.writeRegister = (address,value) => {writes.push([address,value]); return write(address,value);};
  const instrument = new NesInstrument(core); t.after(() => instrument.dispose());
  const preset = instrument.read().preset; preset.source = 'noise';
  preset.noise.envelope = {enabled,period,loop}; instrument.loadPreset(preset); writes.length = 0;
  return {instrument,core,writes,render:seconds => instrument.generateStereo(Math.round(seconds * sampleRate))};
}
const rms = data => Math.sqrt(data.reduce((sum,value) => sum + value * value,0) / data.length);
const audible = pcm => {
  assert(pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite));
  assert(rms(pcm.left) > .0001,'actual PCM contains finite Noise output');
};

test('Noise hardware envelope decays at both host rates, retriggers and keeps mono owner / late release rules', async t => {
  for (const sampleRate of [44100,48000]) {
    const {instrument,core,render} = await fixture(t,sampleRate);
    assert.deepEqual(instrument.noteOn('old',36),{channel:3,stolenId:null});
    assert.equal(instrument.read().registers[0x0c],2,'the core receives envelope mode, not constant volume');
    audible(render(.02)); const initial = core.getState().volumes[3]; assert(initial >= 13 && initial <= 15);
    render(.4); assert.equal(core.getState().volumes[3],0,'hardware decay reaches zero without host gain automation');
    assert.deepEqual(instrument.read().voices,[{id:'old',midi:36,channel:3}],'a decayed note retains held-key ownership');
    assert.deepEqual(instrument.noteOn('new',84),{channel:3,stolenId:'old'});
    audible(render(.02)); assert(core.getState().volumes[3] >= 13,'a replacement attack restarts the hardware envelope');
    const before = instrument.read(); assert.equal(instrument.noteOff('old'),false); assert.deepEqual(instrument.read(),before);
    assert.equal(instrument.noteOff('new'),true); render(.3);
    assert(rms(render(.05).left) < .0001,'explicit release silences the physical Noise channel');
  }
});

test('Noise Envelope Period controls hardware decay speed and Loop revives it after zero', async t => {
  for (const sampleRate of [44100,48000]) {
    const fast = await fixture(t,sampleRate,{period:0}), slow = await fixture(t,sampleRate,{period:15});
    fast.instrument.noteOn('fast',60); slow.instrument.noteOn('slow',60);
    fast.render(.12); slow.render(.12);
    assert.equal(fast.core.getState().volumes[3],0,'the fastest divider has completed its decay');
    assert(slow.core.getState().volumes[3] >= 13,'the slowest divider is still near its starting level');
    const looping = await fixture(t,sampleRate,{period:0,loop:true});
    looping.instrument.noteOn('loop',60);
    const levels = [];
    for (let index=0;index<55;index++) {looping.render(.004); levels.push(looping.core.getState().volumes[3]);}
    const zero = levels.indexOf(0); assert(zero >= 0,'Loop still passes through zero');
    assert(levels.slice(zero + 1).some(value => value >= 13),'the hardware reloads the loop after reaching zero');
    assert.equal(looping.instrument.read().registers[0x0c],32,'the same hardware flag enables Envelope Loop / length halt');
    assert(looping.core.getState().lengths[3] > 0); audible(looping.render(.04));
  }
});

test('held Noise envelopes survive live clock edits and adopt pending envelope settings only on the next attack', async t => {
  const a = await fixture(t,48000,{period:5,loop:true}), b = await fixture(t,48000,{period:5,loop:true});
  a.instrument.noteOn('held',48); b.instrument.noteOn('comparison',48); a.render(.07); b.render(.07);
  const owners = a.instrument.read().voices, activeControl = a.instrument.read().registers[0x0c], beforeLevel = a.core.getState().volumes[3];
  const changed = a.instrument.read().preset;
  changed.noise.period = 2; changed.noise.shortMode = true;
  changed.noise.envelope = {enabled:true,period:0,loop:false};
  a.writes.length = 0; a.instrument.setPreset(changed);
  assert.deepEqual(a.writes,[[0x400e,130]],'clock / mode changes do not rewrite the held envelope or its trigger');
  assert.equal(a.instrument.read().registers[0x0c],activeControl); assert.equal(a.core.getState().volumes[3],beforeLevel);
  assert.deepEqual(a.instrument.read().voices,owners);
  a.render(.12); b.render(.12); assert.equal(a.core.getState().volumes[3],b.core.getState().volumes[3],'the Envelope keeps its existing phase and divider');
  a.writes.length = 0; a.instrument.setPitch(12); assert.deepEqual(a.writes,[],'performance Pitch leaves Noise clock and Envelope alone');
  a.instrument.noteOff('held'); a.instrument.noteOn('next',48);
  assert.equal(a.instrument.read().registers[0x0c],0,'the next trigger receives the authored Envelope settings');
  a.render(.12); assert.equal(a.core.getState().volumes[3],0);
  changed.noise.envelope.enabled = false; changed.noise.volume = 12; a.writes.length = 0; a.instrument.setPreset(changed);
  assert.deepEqual(a.writes,[[0x400e,130]],'switching off Envelope is also deferred while an Envelope note is held');
  assert.equal(a.instrument.read().registers[0x0c],0);
  a.instrument.noteOff('next'); a.instrument.noteOn('fixed',48);
  assert.equal(a.instrument.read().registers[0x0c],0x3c); a.render(.1); assert.equal(a.core.getState().volumes[3],12);
});

test('held fixed Noise volume remains live while pending Envelope enable waits for a fresh trigger', async t => {
  const {instrument,core,writes,render} = await fixture(t,44100,{enabled:false});
  instrument.noteOn('held',60); audible(render(.03)); const owners = instrument.read().voices;
  const preset = instrument.read().preset; preset.noise.volume = 11; writes.length = 0; instrument.setPreset(preset);
  assert.deepEqual(writes,[[0x400c,0x3b],[0x400e,6]]); assert.deepEqual(instrument.read().voices,owners);
  render(.02); assert.equal(core.getState().volumes[3],11);
  preset.noise.envelope = {enabled:true,period:3,loop:true}; writes.length = 0; instrument.setPreset(preset);
  assert.deepEqual(writes,[[0x400e,6]]); assert.equal(instrument.read().registers[0x0c],0x3b);
  render(.02); assert.equal(core.getState().volumes[3],11);
  instrument.noteOff('held'); instrument.noteOn('envelope',60);
  assert.equal(instrument.read().registers[0x0c],35); audible(render(.02)); assert(core.getState().volumes[3] >= 13);
});

test('invalid Noise Envelope presets cannot modify an active core or its held owner', async t => {
  const {instrument,writes,render} = await fixture(t,48000,{loop:true}); instrument.noteOn('held',60); audible(render(.02));
  const before = instrument.read(), count = writes.length;
  for (const mutate of [
    p => {p.noise.envelope.period = 16;}, p => {p.noise.envelope.period = -1;},
    p => {p.noise.envelope.enabled = 1;}, p => {p.noise.envelope.loop = 'yes';},
    p => {delete p.noise.envelope;}, p => {p.noise.envelope.extra = 1;},
  ]) {
    const invalid = instrument.read().preset; mutate(invalid);
    assert.throws(() => instrument.setPreset(invalid)); assert.throws(() => instrument.loadPreset(invalid));
    assert.equal(writes.length,count); assert.deepEqual(instrument.read(),before);
  }
});
