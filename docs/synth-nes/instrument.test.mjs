// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/nesapu_wasm.js';
import {NesApuWasm} from '../js/nesapu_wasm.js';
import {NesInstrument} from './instrument.js';
import {waveShape} from './preset.js';

const wasmBinary = await readFile(new URL('../generated/nesapu_wasm.wasm', import.meta.url));
async function fixture(t, sampleRate = 44100) {
  const core = await NesApuWasm.create({moduleFactory: factory, moduleOptions: {wasmBinary}, sampleRate, fds: true});
  const writes = [], write = core.writeRegister.bind(core);
  core.writeRegister = (register, value) => {writes.push([register,value]); return write(register,value);};
  const instrument = new NesInstrument(core); t.after(() => instrument.dispose());
  return {core, instrument, writes};
}
const audible = pcm => {
  assert(pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite));
  assert(pcm.left.some(value => Math.abs(value) > .0001));
};
const rms = samples => Math.sqrt(samples.reduce((total, value) => total + value * value, 0) / samples.length);

test('actual WASM uses two round-robin Pulse channels and safe oldest stealing / late releases', async t => {
  const {instrument, writes} = await fixture(t);
  assert.equal(instrument.read().capacity, 2);
  assert.deepEqual(instrument.noteOn('a',60), {channel:0, stolenId:null});
  assert.deepEqual(instrument.noteOn('b',64), {channel:1, stolenId:null}); audible(instrument.generateStereo(4096));
  assert.deepEqual(instrument.noteOn('c',67), {channel:0, stolenId:'a'});
  const before = instrument.read(), count = writes.length;
  assert.equal(instrument.noteOff('a'), false); assert.equal(writes.length, count); assert.deepEqual(instrument.read(), before);
  instrument.noteOff('b'); assert.deepEqual(instrument.noteOn('d',69), {channel:1, stolenId:null});
  assert.throws(() => instrument.noteOn('d',70), /already active/);
  const preset = instrument.read().preset; preset.pulse.sweep.enabled = true; instrument.setPreset(preset);
  assert.equal(instrument.read().capacity, 2, 'both NES Pulse channels have hardware Sweep');
  assert.deepEqual(instrument.read().voices.map(v => v.id), ['c','d']);
});

test('all initial sources produce finite audible PCM at 44.1 and 48 kHz; mono source owners replace safely', async t => {
  for (const rate of [44100,48000]) {
    const {instrument} = await fixture(t,rate);
    for (const [source,channel] of [['pulse',0],['triangle',2],['noise',3],['fds',5]]) {
      const preset = instrument.read().preset; preset.source = source; instrument.loadPreset(preset);
      assert.deepEqual(instrument.read().voices, []);
      assert.deepEqual(instrument.noteOn('old',60), {channel,stolenId:null}); audible(instrument.generateStereo(4096));
      if (source !== 'pulse') {assert.deepEqual(instrument.noteOn('new',64), {channel,stolenId:'old'}); assert.equal(instrument.noteOff('old'),false);}
      instrument.stop(); instrument.generateStereo(rate);
      assert(rms(instrument.generateStereo(2048).left) < .0001, `${source} stops at ${rate}`);
    }
  }
});

test('invalid presets, notes and multi-voice pitch changes are atomic', async t => {
  const {instrument,writes} = await fixture(t);
  instrument.noteOn('low',36); instrument.noteOn('high',72); audible(instrument.generateStereo(4096));
  const before = instrument.read(), count = writes.length;
  const bad = instrument.read().preset; bad.source = 'fds'; bad.fds.wave[63] = 64;
  assert.throws(() => instrument.setPreset(bad)); assert.throws(() => instrument.loadPreset(bad));
  assert.throws(() => instrument.noteOn('invalid',0), /frequency range/);
  assert.throws(() => instrument.setPitch(-24), /frequency range/);
  assert.equal(writes.length,count); assert.deepEqual(instrument.read(),before);
});

test('live constant volume / Duty changes and same-byte Pitch preserve Pulse owners without high timer writes', async t => {
  const {instrument,writes} = await fixture(t,48000);
  instrument.noteOn('one',60); instrument.noteOn('two',64); instrument.generateStereo(4096);
  const owners = instrument.read().voices, preset = instrument.read().preset;
  writes.length = 0; preset.pulse.duty = .25; preset.pulse.volume = 6; instrument.setPreset(preset);
  assert.deepEqual(writes.map(([r]) => r), [0x4000,0x4004]); assert.deepEqual(instrument.read().voices,owners);
  writes.length = 0; instrument.setPitch(2);
  assert.deepEqual(writes.map(([r]) => r), [0x4002,0x4006]); assert.equal(instrument.read().pitch,2);
  assert.deepEqual(instrument.read().voices,owners); audible(instrument.generateStereo(4096));
  preset.pulse.envelope = {enabled:true,period:3,loop:false}; writes.length = 0; instrument.setPreset(preset);
  assert(writes.every(([r]) => [0x4000,0x4004].includes(r)));
  assert(instrument.read().registers[0] & 16, 'held constant-volume voice keeps its envelope mode');
  instrument.noteOff('one'); instrument.noteOn('next',67);
  assert.equal(instrument.read().registers[0] & 16,0,'next attack receives the hardware envelope');
  preset.pulse.envelope.enabled = false; instrument.setPreset(preset);
  preset.pulse.volume = 12; instrument.setPreset(preset);
  assert.equal(instrument.read().registers[0] & 16,0,'further draft volume edits do not apply a pending envelope mode change to a held channel');
  instrument.noteOff('next'); instrument.noteOn('constant',69);
  assert(instrument.read().registers[0] & 16,'next attack receives the pending constant-volume mode');
  assert.equal(instrument.read().registers[0] & 15,12);
});

test('Pitch crossing a timer high-byte boundary writes the required hardware register while retaining ownership', async t => {
  const {instrument,writes} = await fixture(t);
  instrument.noteOn('a3',57); writes.length = 0; instrument.setPitch(-1);
  assert.deepEqual(writes.map(([r]) => r),[0x4002,0x4003]);
  assert.equal(instrument.read().voices[0].id,'a3'); assert.equal(instrument.read().pitch,-1);
});

test('hardware Pulse envelope decays and a disabled Sweep does not mute low valid notes', async t => {
  const {instrument,core} = await fixture(t);
  instrument.noteOn('low',36); audible(instrument.generateStereo(4096));
  instrument.stop(); const preset = instrument.read().preset; preset.pulse.envelope = {enabled:true,period:1,loop:false};
  instrument.loadPreset(preset); instrument.noteOn('env',60); instrument.generateStereo(2048);
  assert(core.getState().volumes[0] > 0); instrument.generateStereo(20000); assert.equal(core.getState().volumes[0],0);
});

test('Noise clock edits are live and musical key / Pitch do not tune its LFSR', async t => {
  const a = await fixture(t), b = await fixture(t);
  const preset = a.instrument.read().preset; preset.source = 'noise';
  a.instrument.loadPreset(preset); b.instrument.loadPreset(preset);
  a.instrument.noteOn('low',12); b.instrument.noteOn('high',100); a.writes.length = 0;
  a.instrument.setPitch(2); assert.deepEqual(a.writes,[]);
  const first = a.instrument.generateStereo(4096), second = b.instrument.generateStereo(4096); audible(first); assert.deepEqual(first,second);
  preset.noise.period = 2; preset.noise.shortMode = true; a.writes.length = 0; a.instrument.setPreset(preset);
  assert.deepEqual(a.writes.map(([r])=>r),[0x400c,0x400e]); assert.equal(a.instrument.read().voices[0].id,'low');
  audible(a.instrument.generateStereo(4096));
});

test('enabling default FDS modulation changes actual PCM cycle lengths; live controls do not rewrite modulation RAM', async t => {
  const plain = await fixture(t), modulated = await fixture(t);
  const preset = plain.instrument.read().preset; preset.source = 'fds';
  plain.instrument.loadPreset(preset); preset.fds.modulation.enabled = true; modulated.instrument.loadPreset(preset);
  plain.instrument.noteOn('plain',60); modulated.instrument.noteOn('mod',60);
  const a = plain.instrument.generateStereo(16000).left, b = modulated.instrument.generateStereo(16000).left;
  const variation = samples => {
    const periods = []; let previous;
    for (let i=2001;i<samples.length;i++) if(samples[i-1]<=0 && samples[i]>0) {if(previous)periods.push(i-previous);previous=i;}
    assert(periods.length > 20); const mean = periods.reduce((sum,v)=>sum+v,0)/periods.length;
    return Math.sqrt(periods.reduce((sum,v)=>sum+(v-mean)**2,0)/periods.length)/mean;
  };
  audible({left:a,right:a}); audible({left:b,right:b});
  assert(variation(b) > variation(a) + .015, `actual FDS modulation varies wave cycle length: ${variation(a)} -> ${variation(b)}`);
  modulated.writes.length = 0; const next = modulated.instrument.read().preset;
  next.fds.modulation.depth = 24; next.fds.modulation.rate = 80; next.fds.modulation.bias = -3;
  modulated.instrument.setPreset(next);
  assert.deepEqual(modulated.writes.map(([r])=>r),[0x4084,0x4085,0x4086,0x4087]);
  assert.equal(modulated.instrument.read().voices[0].id,'mod'); audible(modulated.instrument.generateStereo(4096));
  assert.equal(modulated.core.getState().fdsSweepGain,24);
});

test('FDS wave / table edits stop held ownership, loading restores data and disposing is idempotent', async t => {
  const {instrument,core} = await fixture(t);
  const preset = instrument.read().preset; preset.source = 'fds'; instrument.loadPreset(preset); instrument.noteOn('old',60);
  preset.fds.wave = waveShape('saw'); instrument.setPreset(preset); assert.deepEqual(instrument.read().voices,[]); assert.equal(instrument.noteOff('old'),false);
  instrument.noteOn('wave',64); preset.fds.modulation.table[0] = 4; instrument.setPreset(preset); assert.deepEqual(instrument.read().voices,[]);
  instrument.loadPreset(preset); preset.fds.wave[0] = 63;
  assert.equal(instrument.read().preset.fds.wave[0],0); assert.deepEqual(core.getState().wave,instrument.read().preset.fds.wave);
  assert.deepEqual(core.getState().modulation,instrument.read().preset.fds.modulation.table);
  instrument.noteOn('last',60); instrument.setPitch(1); instrument.loadPreset(instrument.read().preset);
  assert.equal(instrument.read().pitch,0); assert.deepEqual(instrument.read().voices,[]);
  instrument.dispose(); instrument.dispose(); assert.equal(core.handle,0); assert.throws(()=>instrument.read(),/disposed/);
});
