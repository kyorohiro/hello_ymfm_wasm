// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/nesapu_wasm.js';
import {NesApuWasm} from '../js/nesapu_wasm.js';
import {NesInstrument} from './instrument.js';

const wasmBinary = await readFile(new URL('../generated/nesapu_wasm.wasm', import.meta.url));
async function fixture(t, sampleRate = 48000, {depth = {}, volume = {}, clock = {}, modulation = {}} = {}) {
  const core = await NesApuWasm.create({moduleFactory:factory, moduleOptions:{wasmBinary}, sampleRate, fds:true});
  const writes = [], write = core.writeRegister.bind(core);
  core.writeRegister = (address,value) => {writes.push([address,value]); return write(address,value);};
  const instrument = new NesInstrument(core); t.after(() => instrument.dispose());
  const preset = instrument.read().preset; preset.source = 'fds';
  preset.fds.envelope = {enabled:false,increase:false,period:63,initialGain:32,...volume};
  preset.fds.envelopeClock = {masterSpeed:8,halt:false,...clock};
  Object.assign(preset.fds.modulation,modulation);
  preset.fds.modulation.envelope = {enabled:true,increase:true,period:63,initialGain:0,...depth};
  instrument.loadPreset(preset); writes.length = 0;
  return {instrument,core,writes,render:seconds => instrument.generateStereo(Math.round(seconds * sampleRate))};
}
const rms = samples => Math.sqrt(samples.reduce((sum,value) => sum + value * value,0) / samples.length);
const audible = pcm => {
  assert(pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite));
  assert(rms(pcm.left) > .0001,'the real FDS core produces finite audible PCM');
};

test('FDS depth envelopes rise and fall in actual WASM even when modulation-table playback is disabled', async t => {
  for (const sampleRate of [44100,48000]) {
    const up = await fixture(t,sampleRate);
    up.instrument.noteOn('up',60); assert.equal(up.core.getState().fdsSweepGain,0);
    assert.equal(up.core.getState().fdsModEnabled,false);
    audible(up.render(.02)); assert(up.core.getState().fdsSweepGain > 0 && up.core.getState().fdsSweepGain < 32);
    up.render(.12); assert.equal(up.core.getState().fdsSweepGain,32);
    const down = await fixture(t,sampleRate,{depth:{increase:false,initialGain:63}});
    down.instrument.noteOn('down',60); assert.equal(down.core.getState().fdsSweepGain,63);
    down.render(.02); assert(down.core.getState().fdsSweepGain > 32 && down.core.getState().fdsSweepGain < 63);
    down.render(.2); assert.equal(down.core.getState().fdsSweepGain,0);
    assert.equal(down.instrument.read().voices[0].id,'down');
  }
});

test('FDS volume and depth envelopes use the same master clock and halt line with separate divider periods', async t => {
  for (const sampleRate of [44100,48000]) {
    for (const clock of [{masterSpeed:0},{halt:true}]) {
      const frozen = await fixture(t,sampleRate,{volume:{enabled:true,initialGain:19},depth:{initialGain:7},clock});
      frozen.instrument.noteOn('frozen',60); audible(frozen.render(.3));
      assert.equal(frozen.core.getState().fdsGain,19); assert.equal(frozen.core.getState().fdsSweepGain,7);
    }
    const same = await fixture(t,sampleRate,{volume:{enabled:true},depth:{increase:false,initialGain:32}});
    same.instrument.noteOn('same',60); same.render(.02);
    assert.equal(same.core.getState().fdsGain,same.core.getState().fdsSweepGain);
    assert(same.core.getState().fdsGain > 0 && same.core.getState().fdsGain < 32);
    const separate = await fixture(t,sampleRate,{volume:{enabled:true},depth:{increase:false,initialGain:32,period:0}});
    separate.instrument.noteOn('separate',60); separate.render(.02);
    assert.equal(separate.core.getState().fdsSweepGain,0); assert(separate.core.getState().fdsGain > 0);
    const slowMaster = await fixture(t,sampleRate,{volume:{enabled:true},depth:{increase:false,initialGain:32},clock:{masterSpeed:255}});
    slowMaster.instrument.noteOn('slow',60); slowMaster.render(.02);
    assert.equal(slowMaster.core.getState().fdsGain,32); assert.equal(slowMaster.core.getState().fdsSweepGain,32);
  }
});

test('FDS depth Envelope changes the actual PCM frequency compared with a fixed-depth control', async t => {
  const modulation = {enabled:true,table:Array(32).fill(0),bias:8,rate:256,depth:0};
  const moving = await fixture(t,48000,{modulation});
  const fixed = await fixture(t,48000,{modulation,depth:{enabled:false}});
  moving.instrument.noteOn('moving',60); fixed.instrument.noteOn('fixed',60);
  moving.render(.2); fixed.render(.2); assert.equal(moving.core.getState().fdsSweepGain,32); assert.equal(fixed.core.getState().fdsSweepGain,0);
  const a = moving.render(.12), b = fixed.render(.12); audible(a); audible(b);
  const cycles = samples => samples.reduce((count,value,index) => count + (index > 0 && samples[index-1] <= 0 && value > 0 ? 1 : 0),0);
  const ratio = cycles(a.left) / cycles(b.left);
  assert(ratio > 1.15 && ratio < 1.35,`a nonzero modulation counter makes the raised depth audible in PCM cycle rate: ${ratio}`);
});

test('live FDS Master, Pitch, modulation clock and bias edits preserve both Envelope phases until the next key', async t => {
  const options = {volume:{enabled:true},depth:{period:31}};
  const a = await fixture(t,48000,options), b = await fixture(t,48000,options);
  a.instrument.noteOn('held',60); b.instrument.noteOn('comparison',60); a.render(.02); b.render(.02);
  const before = a.core.getState(), owners = a.instrument.read().voices, preset = a.instrument.read().preset;
  preset.fds.master = 2;
  preset.fds.modulation.envelope = {enabled:true,increase:false,period:0,initialGain:63};
  preset.fds.envelopeClock = {masterSpeed:0,halt:true};
  preset.fds.modulation.rate = 77; preset.fds.modulation.bias = 5; preset.fds.modulation.enabled = true;
  a.writes.length = 0; a.instrument.setPreset(preset);
  assert.deepEqual(a.writes.map(([address]) => address),[0x4089,0x4085,0x4086,0x4087]);
  assert.equal(a.core.getState().fdsGain,before.fdsGain); assert.equal(a.core.getState().fdsSweepGain,before.fdsSweepGain);
  assert.deepEqual(a.instrument.read().voices,owners); assert.equal(a.instrument.read().registers[0x84],64|31); assert.equal(a.instrument.read().registers[0x8a],8);
  a.writes.length = 0; a.instrument.setPitch(1);
  assert.deepEqual(a.writes.map(([address]) => address),[0x4082,0x4083]); assert.equal(a.instrument.read().registers[0x83] & 0xc0,0);
  a.render(.04); b.render(.04);
  assert.equal(a.core.getState().fdsGain,b.core.getState().fdsGain); assert.equal(a.core.getState().fdsSweepGain,b.core.getState().fdsSweepGain);
  a.instrument.noteOff('held'); a.instrument.noteOn('next',60);
  assert.equal(a.instrument.read().registers[0x84],0); assert.equal(a.instrument.read().registers[0x8a],0); assert.equal(a.instrument.read().registers[0x83] & 0xc0,64);
  assert.equal(a.core.getState().fdsSweepGain,63); assert.equal(a.core.getState().fdsGain,32); a.render(.3);
  assert.equal(a.core.getState().fdsSweepGain,63); assert.equal(a.core.getState().fdsGain,32);
  preset.fds.modulation.envelope.enabled = false; preset.fds.modulation.depth = 19; preset.fds.master = 3; preset.fds.envelopeClock = {masterSpeed:8,halt:false};
  a.writes.length = 0; a.instrument.setPreset(preset); assert.deepEqual(a.writes,[[0x4089,3]]);
  assert.equal(a.core.getState().fdsSweepGain,63,'pending fixed depth does not interrupt an active envelope');
  a.instrument.noteOff('next'); a.instrument.noteOn('fixed-depth',60);
  assert.equal(a.instrument.read().registers[0x84],128|19); assert.equal(a.core.getState().fdsSweepGain,19);
  a.render(.02); assert.equal(a.core.getState().fdsSweepGain,19); assert(a.core.getState().fdsGain < 32);
});

test('held fixed FDS depth stays live and a pending depth Envelope starts on the next key', async t => {
  const {instrument,core,writes,render} = await fixture(t,44100,{depth:{enabled:false},modulation:{depth:9}});
  instrument.noteOn('fixed',60); audible(render(.02)); assert.equal(core.getState().fdsSweepGain,9);
  const preset = instrument.read().preset; preset.fds.modulation.depth = 17;
  writes.length = 0; instrument.setPreset(preset); assert.deepEqual(writes,[[0x4084,128|17]]); assert.equal(core.getState().fdsSweepGain,17);
  preset.fds.modulation.envelope = {enabled:true,increase:true,period:0,initialGain:0};
  writes.length = 0; instrument.setPreset(preset); assert.deepEqual(writes,[]); render(.1); assert.equal(core.getState().fdsSweepGain,17);
  instrument.noteOff('fixed'); instrument.noteOn('envelope',60); assert.equal(core.getState().fdsSweepGain,0);
  render(.02); assert.equal(core.getState().fdsSweepGain,32); assert.equal(instrument.read().voices[0].id,'envelope');
});

test('FDS depth Envelope reattacks reseed, ignore old releases and stay silent after explicit release or Stop', async t => {
  for (const sampleRate of [44100,48000]) {
    const {instrument,core,writes,render} = await fixture(t,sampleRate);
    instrument.noteOn('old',48); audible(render(.03)); assert(core.getState().fdsSweepGain > 0);
    assert.deepEqual(instrument.noteOn('new',72),{channel:5,stolenId:'old'}); assert.equal(core.getState().fdsSweepGain,0);
    const before = instrument.read(), count = writes.length;
    assert.equal(instrument.noteOff('old'),false); assert.equal(writes.length,count); assert.deepEqual(instrument.read(),before);
    render(.02); assert(core.getState().fdsSweepGain > 0); assert.equal(instrument.noteOff('new'),true);
    assert.equal(core.getState().fdsGain,0); assert.equal(core.getState().fdsActive,false); render(.2); assert(rms(render(.05).left) < .000001);
    instrument.noteOn('stop',60); audible(render(.02)); instrument.stop(); assert.deepEqual(instrument.read().voices,[]); assert.equal(core.getState().fdsGain,0);
  }
});

test('invalid depth Envelope or shared-clock presets cannot mutate an active FDS voice', async t => {
  const {instrument,writes,render} = await fixture(t); instrument.noteOn('held',60); audible(render(.02));
  const before = instrument.read(), count = writes.length;
  for (const mutate of [
    p => {p.fds.modulation.envelope.period = 64;}, p => {p.fds.modulation.envelope.period = -1;}, p => {p.fds.modulation.envelope.period = .5;},
    p => {p.fds.modulation.envelope.initialGain = 64;}, p => {p.fds.modulation.envelope.initialGain = -1;},
    p => {p.fds.modulation.envelope.enabled = 1;}, p => {p.fds.modulation.envelope.increase = '';},
    p => {delete p.fds.modulation.envelope;}, p => {p.fds.modulation.envelope.extra = 1;},
    p => {p.fds.envelopeClock.masterSpeed = 256;}, p => {p.fds.envelopeClock.halt = 1;}, p => {p.fds.envelopeClock.extra = 1;},
  ]) {
    const invalid = instrument.read().preset; mutate(invalid);
    assert.throws(() => instrument.setPreset(invalid)); assert.throws(() => instrument.loadPreset(invalid));
    assert.equal(writes.length,count); assert.deepEqual(instrument.read(),before);
  }
});
