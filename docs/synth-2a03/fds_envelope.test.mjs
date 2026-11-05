// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/nesapu_wasm.js';
import {NesApuWasm} from '../js/nesapu_wasm.js';
import {NesInstrument} from './instrument.js';

const wasmBinary = await readFile(new URL('../generated/nesapu_wasm.wasm', import.meta.url));
async function fixture(t, sampleRate = 48000, envelope = {}) {
  const core = await NesApuWasm.create({moduleFactory:factory, moduleOptions:{wasmBinary}, sampleRate, fds:true});
  const writes = [], write = core.writeRegister.bind(core);
  core.writeRegister = (address,value) => {writes.push([address,value]); return write(address,value);};
  const instrument = new NesInstrument(core); t.after(() => instrument.dispose());
  const preset = instrument.read().preset; preset.source = 'fds';
  preset.fds.envelope = {enabled:true,increase:false,period:63,masterSpeed:8,initialGain:32,halt:false,...envelope};
  instrument.loadPreset(preset); writes.length = 0;
  return {instrument,core,writes,render:seconds => instrument.generateStereo(Math.round(seconds * sampleRate))};
}
const rms = samples => Math.sqrt(samples.reduce((sum,value) => sum + value * value,0) / samples.length);
const audible = pcm => {
  assert(pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite));
  assert(rms(pcm.left) > .0001,'the actual FDS core produces finite audible PCM');
};

test('FDS volume envelopes rise from zero and decay from six-bit gain at both host sample rates', async t => {
  for (const sampleRate of [44100,48000]) {
    const up = await fixture(t,sampleRate,{increase:true,initialGain:0});
    up.instrument.noteOn('up',60); assert.equal(up.core.getState().fdsGain,0);
    audible(up.render(.02)); assert(up.core.getState().fdsGain > 0 && up.core.getState().fdsGain < 32);
    up.render(.12); assert.equal(up.core.getState().fdsGain,32,'the hardware increase reaches its gain ceiling');
    const down = await fixture(t,sampleRate,{initialGain:63});
    down.instrument.noteOn('down',60); assert.equal(down.core.getState().fdsGain,63,'the raw seed preserves all six gain bits');
    audible(down.render(.02)); assert(down.core.getState().fdsGain > 32 && down.core.getState().fdsGain < 63);
    down.render(.2); assert.equal(down.core.getState().fdsGain,0,'the hardware decrease reaches zero');
    assert.equal(down.instrument.read().voices[0].id,'down','a completed envelope retains its held-key owner');
  }
});

test('FDS envelope master speed zero and the hardware halt flag preserve the seeded gain', async t => {
  for (const sampleRate of [44100,48000]) {
    for (const envelope of [{masterSpeed:0,initialGain:7,increase:true},{halt:true,initialGain:19}]) {
      const {instrument,core,render} = await fixture(t,sampleRate,envelope);
      instrument.noteOn('frozen',60); audible(render(.3));
      assert.equal(core.getState().fdsGain,envelope.initialGain);
      const before = instrument.read().registers[0x83] & 0xc0;
      instrument.setPitch(2); assert.equal(instrument.read().registers[0x83] & 0xc0,before,'Pitch preserves the active Envelope halt flag');
      render(.1); assert.equal(core.getState().fdsGain,envelope.initialGain);
    }
  }
});

test('FDS envelope divider and shared master speed independently change the real gain rate', async t => {
  for (const sampleRate of [44100,48000]) {
    const fast = await fixture(t,sampleRate,{period:0});
    const slow = await fixture(t,sampleRate,{period:63});
    const masterSlow = await fixture(t,sampleRate,{period:63,masterSpeed:255});
    for (const item of [fast,slow,masterSlow]) {item.instrument.noteOn('rate',60); item.render(.02);}
    assert.equal(fast.core.getState().fdsGain,0);
    assert(slow.core.getState().fdsGain > 0 && slow.core.getState().fdsGain < 32);
    assert.equal(masterSlow.core.getState().fdsGain,32,'the slower shared clock has not reached its first gain step');
  }
});

test('FDS Envelope retriggers its authored seed, ignores old note releases and stops on explicit release', async t => {
  const {instrument,core,render,writes} = await fixture(t,48000,{increase:true,initialGain:0});
  instrument.noteOn('old',48); audible(render(.03)); assert(core.getState().fdsGain > 0);
  assert.deepEqual(instrument.noteOn('new',72),{channel:5,stolenId:'old'});
  assert.equal(core.getState().fdsGain,0); const before = instrument.read(), count = writes.length;
  assert.equal(instrument.noteOff('old'),false); assert.equal(writes.length,count); assert.deepEqual(instrument.read(),before);
  audible(render(.02)); assert(core.getState().fdsGain > 0);
  assert.equal(instrument.noteOff('new'),true); assert.equal(core.getState().fdsGain,0); assert.equal(core.getState().fdsActive,false);
  render(.2); assert(rms(render(.05).left) < .000001);
  instrument.noteOn('stop',60); audible(render(.02)); instrument.stop();
  assert.equal(core.getState().fdsGain,0); assert.deepEqual(instrument.read().voices,[]);
});

test('held FDS envelopes keep gain phase during live Master, Pitch and modulation edits and defer authored Envelope changes', async t => {
  const a = await fixture(t), b = await fixture(t);
  a.instrument.noteOn('held',60); b.instrument.noteOn('comparison',60); a.render(.02); b.render(.02);
  const gain = a.core.getState().fdsGain, owners = a.instrument.read().voices;
  const preset = a.instrument.read().preset;
  preset.fds.master = 2;
  preset.fds.envelope = {enabled:true,increase:true,period:0,masterSpeed:0,initialGain:9,halt:true};
  preset.fds.modulation.depth = 22; preset.fds.modulation.rate = 77; preset.fds.modulation.bias = 5; preset.fds.modulation.enabled = true;
  a.writes.length = 0; a.instrument.setPreset(preset);
  assert.deepEqual(a.writes.map(([address]) => address),[0x4089,0x4084,0x4085,0x4086,0x4087]);
  assert.equal(a.core.getState().fdsGain,gain); assert.deepEqual(a.instrument.read().voices,owners);
  assert.equal(a.instrument.read().registers[0x80],63); assert.equal(a.instrument.read().registers[0x8a],8);
  a.writes.length = 0; a.instrument.setPitch(1);
  assert.deepEqual(a.writes.map(([address]) => address),[0x4082,0x4083]);
  assert.equal(a.instrument.read().registers[0x83] & 0xc0,0,'Pitch leaves the held Envelope running');
  a.render(.04); b.render(.04); assert.equal(a.core.getState().fdsGain,b.core.getState().fdsGain,'the original divider phase continues through unrelated edits');
  a.instrument.noteOff('held'); a.instrument.noteOn('next',60);
  assert.equal(a.instrument.read().registers[0x80],64); assert.equal(a.instrument.read().registers[0x8a],0);
  assert.equal(a.instrument.read().registers[0x83] & 0xc0,64); assert.equal(a.core.getState().fdsGain,9); assert.equal(a.core.getState().fdsMaster,2);
  audible(a.render(.3)); assert.equal(a.core.getState().fdsGain,9);
  preset.fds.envelope.enabled = false; preset.fds.volume = 17; preset.fds.master = 3;
  a.writes.length = 0; a.instrument.setPreset(preset); assert.deepEqual(a.writes,[[0x4089,3]]);
  assert.equal(a.core.getState().fdsGain,9,'pending fixed gain does not interrupt the held Envelope');
  a.instrument.noteOff('next'); a.instrument.noteOn('fixed',60);
  assert.equal(a.core.getState().fdsGain,17); assert.equal(a.core.getState().fdsMaster,3); assert.equal(a.instrument.read().registers[0x80],128|17);
});

test('held fixed FDS volume stays live while enabling Envelope waits for a fresh key', async t => {
  const {instrument,core,writes,render} = await fixture(t,44100,{enabled:false});
  instrument.noteOn('fixed',60); audible(render(.02)); assert.equal(core.getState().fdsGain,24);
  const preset = instrument.read().preset; preset.fds.volume = 11; preset.fds.master = 2;
  writes.length = 0; instrument.setPreset(preset);
  assert.deepEqual(writes,[[0x4023,2],[0x4080,128|11],[0x4089,2]]); assert.equal(core.getState().fdsGain,11);
  preset.fds.envelope = {enabled:true,increase:false,period:8,masterSpeed:232,initialGain:32,halt:false};
  writes.length = 0; instrument.setPreset(preset); assert.deepEqual(writes,[[0x4089,2]]);
  render(.1); assert.equal(core.getState().fdsGain,11); assert.equal(instrument.read().voices[0].id,'fixed');
  instrument.noteOff('fixed'); instrument.noteOn('envelope',60);
  assert.equal(core.getState().fdsGain,32); assert.equal(instrument.read().registers[0x80],8); assert.equal(instrument.read().registers[0x8a],232);
  audible(render(.02)); assert(core.getState().fdsGain < 32);
});

test('invalid FDS Envelope presets cannot write registers or replace a held owner', async t => {
  const {instrument,writes,render} = await fixture(t); instrument.noteOn('held',60); audible(render(.02));
  const before = instrument.read(), count = writes.length;
  for (const mutate of [
    p => {p.fds.envelope.period = 64;}, p => {p.fds.envelope.period = -1;},
    p => {p.fds.envelope.masterSpeed = 256;}, p => {p.fds.envelope.masterSpeed = .5;},
    p => {p.fds.envelope.initialGain = 64;}, p => {p.fds.envelope.initialGain = -1;},
    p => {p.fds.envelope.enabled = 1;}, p => {p.fds.envelope.increase = 'yes';}, p => {p.fds.envelope.halt = 0;},
    p => {delete p.fds.envelope;}, p => {p.fds.envelope.extra = 1;},
  ]) {
    const invalid = instrument.read().preset; mutate(invalid);
    assert.throws(() => instrument.setPreset(invalid)); assert.throws(() => instrument.loadPreset(invalid));
    assert.equal(writes.length,count); assert.deepEqual(instrument.read(),before);
  }
});
