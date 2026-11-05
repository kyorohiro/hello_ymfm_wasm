// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/nesapu_wasm.js';
import {NesApuWasm} from '../js/nesapu_wasm.js';
import {NesInstrument} from './instrument.js';

const wasmBinary = await readFile(new URL('../generated/nesapu_wasm.wasm', import.meta.url));
const LENGTH = [10,254,20,2,40,4,80,6,160,8,60,10,14,12,26,14,12,16,24,18,48,20,96,22,192,24,72,26,16,28,32,30];
const acRms = samples => {
  const mean = samples.reduce((sum,value) => sum + value,0) / samples.length;
  return Math.sqrt(samples.reduce((sum,value) => sum + (value - mean) ** 2,0) / samples.length);
};
const audible = pcm => {
  assert(pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite));
  assert(acRms(pcm.left) > .0001,'actual PCM contains a cycling waveform');
};
async function fixture(t, sampleRate = 44100) {
  const core = await NesApuWasm.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate,fds:true});
  const writes = [], write = core.writeRegister.bind(core);
  core.writeRegister = (address,value) => {writes.push([address,value]); return write(address,value);};
  const instrument = new NesInstrument(core); t.after(() => instrument.dispose());
  const load = (source,settings = {}) => {
    const preset = instrument.read().preset; preset.source = source;
    preset[source] = {...preset[source],...settings}; instrument.loadPreset(preset); writes.length = 0;
  };
  const render = seconds => instrument.generateStereo(Math.round(seconds * sampleRate));
  return {instrument,core,writes,load,render};
}

test('Pulse and Noise defaults halt the hardware length counter at both host rates', async t => {
  for (const rate of [44100,48000]) {
    const {instrument,core,load,render} = await fixture(t,rate);
    for (const source of ['pulse','noise']) {
      load(source,{lengthHalt:true,lengthIndex:3});
      const channels = source === 'pulse' ? [0,1] : [3];
      for (const channel of channels) assert.equal(instrument.noteOn(`held-${channel}`,60).channel,channel);
      render(2.3); audible(render(.05));
      for (const channel of channels) {
        assert.equal(core.getState().lengths[channel],2);
        assert.equal(instrument.read().registers[channel * 4] & 48,48);
      }
    }
  }
});

test('Pulse both channels and Noise load all 32 hardware lengths, including index zero', async t => {
  for (const rate of [44100,48000]) {
    const {instrument,core,load} = await fixture(t,rate);
    for (const source of ['pulse','noise']) for (let index=0;index<32;index++) {
      load(source,{lengthHalt:false,lengthIndex:index});
      const channels = source === 'pulse' ? [0,1] : [3];
      for (const channel of channels) {
        assert.equal(instrument.noteOn(`index-${index}-${channel}`,60).channel,channel);
        assert.equal(core.getState().lengths[channel],LENGTH[index]);
        assert.equal(instrument.read().registers[channel * 4 + 3] >> 3,index);
        assert.equal(instrument.read().registers[channel * 4] & 48,16);
      }
    }
  }
});

test('fixed-volume Pulse and Noise stop actual PCM at hardware table durations while retaining owners', async t => {
  for (const rate of [44100,48000]) {
    const {instrument,core,load,render} = await fixture(t,rate);
    for (const source of ['pulse','noise']) {
      const durations = [];
      for (const index of [3,0,4]) {
        load(source,{lengthHalt:false,lengthIndex:index});
        const channels = source === 'pulse' ? [0,1] : [3];
        for (const channel of channels) instrument.noteOn(`timed-${channel}`,60);
        let stopped, peakRms = 0;
        for (let ms=1;ms<=400;ms++) {
          peakRms = Math.max(peakRms,acRms(render(.001).left));
          if (channels.every(channel => core.getState().lengths[channel] === 0)) {stopped=ms;break;}
        }
        assert(peakRms > .0001 && stopped,'the hardware sounds then reaches length zero');
        assert.equal(instrument.read().voices.length,channels.length,'expiry does not invent a host key release');
        render(.3); assert(acRms(render(.04).left) < .000001,'the filtered output settles after its hardware gate closes');
        durations.push(stopped);
      }
      assert(durations[0]>=12 && durations[0]<=22);
      assert(durations[1]>=78 && durations[1]<=90);
      assert(durations[2]>=325 && durations[2]<=345);
    }
  }
});

test('Envelope Loop shares Length halt on Pulse and Noise rather than providing independent gates', async t => {
  for (const rate of [44100,48000]) {
    const {instrument,core,load,render} = await fixture(t,rate);
    for (const source of ['pulse','noise']) {
      const channel = source === 'pulse' ? 0 : 3;
      load(source,{lengthHalt:true,lengthIndex:3,envelope:{enabled:true,period:15,loop:false}});
      instrument.noteOn('short-envelope',60); render(.05);
      assert.equal(instrument.read().registers[channel * 4] & 48,0,'non-looping envelope makes the shared halt bit zero');
      assert.equal(core.getState().lengths[channel],0);
      assert(core.getState().volumes[channel]>0,'length stops this voice before the envelope finishes');
      render(.3); assert(acRms(render(.04).left)<.000001);
      load(source,{lengthHalt:false,lengthIndex:3,envelope:{enabled:true,period:1,loop:true}});
      instrument.noteOn('loop-envelope',60); render(.5); audible(render(.05));
      assert.equal(instrument.read().registers[channel * 4] & 48,32,'looping envelope sets the same halt bit');
      assert.equal(core.getState().lengths[channel],2);
      load(source,{lengthHalt:true,lengthIndex:1,envelope:{enabled:true,period:1,loop:false}});
      instrument.noteOn('long-envelope',60); render(.25);
      assert.equal(core.getState().volumes[channel],0,'the non-looping envelope can also finish before length');
      assert(core.getState().lengths[channel]>0);
    }
  }
});

test('expired Pulse and Noise owners retrigger safely through late release, explicit release and Stop', async t => {
  for (const rate of [44100,48000]) {
    const {instrument,core,load,render} = await fixture(t,rate);
    for (const source of ['pulse','noise']) {
      load(source,{lengthHalt:false,lengthIndex:3});
      const channels = source === 'pulse' ? [0,1] : [3];
      for (const channel of channels) instrument.noteOn(`old-${channel}`,60);
      render(.05); assert(channels.every(channel => core.getState().lengths[channel]===0));
      const first = channels[0];
      assert.deepEqual(instrument.noteOn('new',64),{channel:first,stolenId:`old-${first}`});
      audible(render(.005)); const before = instrument.read();
      assert.equal(instrument.noteOff(`old-${first}`),false); assert.deepEqual(instrument.read(),before);
      assert.equal(instrument.noteOff('new'),true); assert.equal(core.getState().lengths[first],0);
      instrument.noteOn('stop',60); instrument.stop();
      assert.deepEqual(instrument.read().voices,[]); assert(channels.every(channel => core.getState().lengths[channel]===0));
    }
  }
});

test('live fixed-volume, Duty and Noise clock edits retain active gates while authored Length settings await attack', async t => {
  const {instrument,core,writes,load,render} = await fixture(t,48000);
  for (const source of ['pulse','noise']) {
    load(source,{lengthHalt:false,lengthIndex:4});
    const channels = source === 'pulse' ? [0,1] : [3];
    for (const channel of channels) instrument.noteOn(`held-${channel}`,60);
    render(.03); const owners=instrument.read().voices, lengths=core.getState().lengths;
    const next=instrument.read().preset; next[source].lengthHalt=true; next[source].lengthIndex=0; next[source].volume=6;
    if (source==='pulse') next.pulse.duty=.25;
    else {next.noise.period=2;next.noise.shortMode=true;}
    writes.length=0; instrument.setPreset(next);
    assert(writes.every(([address])=> ![0x4003,0x4007,0x400f].includes(address)));
    assert.deepEqual(instrument.read().voices,owners);
    for (const channel of channels) {
      assert.equal(instrument.read().registers[channel*4]&63,22,'volume changes without applying pending halt');
      assert.equal(instrument.read().registers[channel*4+3]>>3,4);
      assert.equal(core.getState().lengths[channel],lengths[channel]);
    }
    render(.35); assert(channels.every(channel=>core.getState().lengths[channel]===0),'live edits did not stop its countdown');
    instrument.stop(); instrument.noteOn('next',60); render(.15);
    const channel=source==='pulse'?0:3;
    assert.equal(instrument.read().registers[channel*4]&63,54);
    assert.equal(instrument.read().registers[channel*4+3]>>3,0);
    assert.equal(core.getState().lengths[channel],10,'the next attack applies the pending held-key gate');
  }
});

test('live Envelope-mode edits preserve its active shared bit and decay, then apply the new mode on attack', async t => {
  const {instrument,core,writes,load,render} = await fixture(t,48000);
  for (const source of ['pulse','noise']) {
    load(source,{lengthHalt:false,lengthIndex:3,envelope:{enabled:true,period:3,loop:true}});
    const channel=source==='pulse'?0:3;
    instrument.noteOn('held',60); render(.04); const volume=core.getState().volumes[channel];
    const next=instrument.read().preset;
    next[source].envelope={enabled:false,period:15,loop:false}; next[source].lengthHalt=false;
    next[source].lengthIndex=4;next[source].volume=7;
    writes.length=0;instrument.setPreset(next);
    assert.equal(instrument.read().registers[channel*4]&63,35);
    assert.equal(core.getState().volumes[channel],volume);assert.equal(core.getState().lengths[channel],2);
    assert(writes.every(([address])=> ![0x4003,0x4007,0x400f].includes(address)));
    render(.04); assert.equal(core.getState().lengths[channel],2);
    instrument.stop(); instrument.noteOn('new',60);
    assert.equal(instrument.read().registers[channel*4]&63,23);
    assert.equal(core.getState().lengths[channel],40);
  }
});

test('Pulse Pitch retains active zero length on both channels and reloads only on timer-high boundaries', async t => {
  for (const rate of [44100,48000]) {
    const {instrument,core,writes,load,render} = await fixture(t,rate);
    load('pulse',{lengthHalt:false,lengthIndex:0});instrument.noteOn('one',60);instrument.noteOn('two',60);render(.02);
    const before=core.getState(),owners=instrument.read().voices;writes.length=0;instrument.setPitch(1);
    assert.deepEqual(writes.map(([address])=>address),[0x4002,0x4006]);assert.deepEqual(core.getState().lengths,before.lengths);
    const next=instrument.read().preset;next.pulse.lengthHalt=true;next.pulse.lengthIndex=31;instrument.setPreset(next);
    render(.02);writes.length=0;instrument.setPitch(-12);
    assert.deepEqual(writes.map(([address])=>address),[0x4002,0x4003,0x4006,0x4007]);
    for (const channel of [0,1]) {
      assert.equal(instrument.read().registers[channel*4+3]>>3,0);assert.equal(core.getState().lengths[channel],10);
      assert.equal(instrument.read().registers[channel*4]&32,0,'pending halt remains unapplied');
    }
    assert.deepEqual(instrument.read().voices,owners);
    render(.1); assert(core.getState().lengths.slice(0,2).every(value=>value===0));
  }
});

test('invalid Pulse and Noise Length settings cannot write registers or replace sounding owners', async t => {
  const {instrument,writes,load,render}=await fixture(t,48000);
  for (const source of ['pulse','noise']) {
    load(source,{lengthHalt:true,lengthIndex:1});instrument.noteOn('held',60);audible(render(.02));
    const before=instrument.read(),count=writes.length;
    for (const mutate of [
      part=>{part.lengthHalt=1;},part=>{part.lengthIndex=-1;},part=>{part.lengthIndex=32;},part=>{part.lengthIndex=1.5;},
      part=>{delete part.lengthHalt;},part=>{delete part.lengthIndex;},
    ]) {
      const invalid=instrument.read().preset;mutate(invalid[source]);
      assert.throws(()=>instrument.setPreset(invalid));assert.throws(()=>instrument.loadPreset(invalid));
      assert.equal(writes.length,count);assert.deepEqual(instrument.read(),before);
    }
  }
});
