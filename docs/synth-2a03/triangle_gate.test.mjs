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
  assert(acRms(pcm.left) > .0001,'actual PCM contains a cycling Triangle waveform');
};
async function fixture(t, sampleRate = 44100) {
  const core = await NesApuWasm.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate,fds:true});
  const writes = [], write = core.writeRegister.bind(core);
  core.writeRegister = (address,value) => {writes.push([address,value]); return write(address,value);};
  const instrument = new NesInstrument(core); t.after(() => instrument.dispose());
  const load = triangle => {
    const preset = instrument.read().preset;
    preset.source = 'triangle'; preset.triangle = {...preset.triangle,...triangle};
    instrument.loadPreset(preset); writes.length = 0;
  };
  const render = seconds => instrument.generateStereo(Math.round(seconds * sampleRate));
  load({}); return {instrument,core,writes,load,render};
}

test('Triangle held-key mode keeps both counters open at both host sample rates', async t => {
  for (const rate of [44100,48000]) {
    const {instrument,core,load,render} = await fixture(t,rate);
    instrument.noteOn('held',60); audible(render(.8));
    assert.equal(core.getState().volumes[2],127); assert.equal(core.getState().lengths[2],254);
    assert.equal(instrument.read().registers[8],255);
    // C also halts the length counter and retains the linear reload flag;
    // a small positive reload and a short length still sustain while held.
    load({control:true,linearReload:7,lengthIndex:3});
    instrument.noteOn('short-held',60); audible(render(.5));
    assert.equal(core.getState().volumes[2],7); assert.equal(core.getState().lengths[2],2);
  }
});

test('Triangle reload zero never opens the sequencer in either gate mode', async t => {
  for (const rate of [44100,48000]) {
    const {instrument,core,load,render} = await fixture(t,rate);
    for (const control of [false,true]) {
      load({control,linearReload:0,lengthIndex:1}); instrument.noteOn(`zero-${control}`,60);
      const pcm = render(.3);
      assert(pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite));
      assert(acRms(pcm.left) < .000001); assert.equal(core.getState().volumes[2],0);
      assert.equal(instrument.read().voices.length,1,'a silent gate still retains its held-key owner');
    }
  }
});

test('Triangle linear and length counters independently stop actual PCM with ordered hardware durations', async t => {
  for (const rate of [44100,48000]) {
    const {instrument,core,load,render} = await fixture(t,rate);
    function duration(triangle) {
      load({control:false,...triangle}); instrument.noteOn('timed',60);
      let opened = false, stopped, maxRms = 0;
      for (let ms=1;ms<=700;ms++) {
        const pcm=render(.001), state=core.getState(); maxRms=Math.max(maxRms,acRms(pcm.left));
        const active=state.volumes[2]>0 && state.lengths[2]>0;
        if(active)opened=true;
        else if(opened) {stopped={ms,linear:state.volumes[2],length:state.lengths[2]};break;}
      }
      assert(stopped && maxRms>.0001,'the real core opens, sounds, then closes its counter gate');
      assert.equal(instrument.read().voices[0].id,'timed','expiry does not invent a key release');
      render(.3); assert(acRms(render(.04).left)<.00001,'the filtered output settles after the sequencer stops');
      return stopped;
    }
    const linear24=duration({linearReload:24,lengthIndex:1}), linear48=duration({linearReload:48,lengthIndex:1});
    assert.equal(linear24.linear,0); assert(linear24.length>0);
    assert.equal(linear48.linear,0); assert(linear48.length>0);
    assert(linear24.ms>=95 && linear24.ms<=110); assert(linear48.ms>=195 && linear48.ms<=210);
    assert(linear48.ms>linear24.ms*1.8,'doubling the linear reload extends its independently clocked gate');
    const length2=duration({linearReload:127,lengthIndex:3});
    const length10=duration({linearReload:127,lengthIndex:0});
    const length40=duration({linearReload:127,lengthIndex:4});
    for(const stopped of [length2,length10,length40]) {assert.equal(stopped.length,0);assert(stopped.linear>0);}
    assert(length2.ms>=12 && length2.ms<=22); assert(length10.ms>=78 && length10.ms<=90); assert(length40.ms>=325 && length40.ms<=345);
    assert(length10.ms>length2.ms*3 && length40.ms>length10.ms*3,'the length lookup value, not its index order, determines duration');
  }
});

test('Triangle loads every hardware length index, including index zero, at both host sample rates', async t => {
  for (const rate of [44100,48000]) {
    const {instrument,core,load} = await fixture(t,rate);
    for(let index=0;index<32;index++) {
      load({control:false,linearReload:127,lengthIndex:index}); instrument.noteOn(`length-${index}`,60);
      assert.equal(core.getState().lengths[2],LENGTH[index],`hardware length index ${index}`);
      assert.equal(instrument.read().registers[0x0b]>>3,index);
    }
  }
});

test('Triangle expired counters retrigger and keep mono ownership safe through old release, explicit release and Stop', async t => {
  for (const rate of [44100,48000]) {
    const {instrument,core,load,render} = await fixture(t,rate);
    load({control:false,linearReload:12,lengthIndex:1}); instrument.noteOn('old',60); render(.15);
    assert.equal(core.getState().volumes[2],0); assert.equal(instrument.read().voices[0].id,'old');
    assert.deepEqual(instrument.noteOn('new',64),{channel:2,stolenId:'old'}); audible(render(.02));
    const before=instrument.read(); assert.equal(instrument.noteOff('old'),false); assert.deepEqual(instrument.read(),before);
    assert.equal(instrument.noteOff('new'),true); assert.equal(core.getState().lengths[2],0);
    render(.3); assert(acRms(render(.04).left)<.00001);
    instrument.noteOn('stop',60); audible(render(.02)); instrument.stop();
    assert.deepEqual(instrument.read().voices,[]); assert.equal(core.getState().lengths[2],0);
    render(.3); assert(acRms(render(.04).left)<.00001);
  }
});

test('Triangle authored control, reload and length changes wait for the next owned attack', async t => {
  const {instrument,core,writes,load,render}=await fixture(t,48000);
  load({control:false,linearReload:96,lengthIndex:1}); instrument.noteOn('counter',60); render(.04);
  const before=core.getState(), owners=instrument.read().voices;
  const next=instrument.read().preset; next.triangle={control:true,linearReload:7,lengthIndex:0};
  writes.length=0; instrument.setPreset(next); assert.deepEqual(writes,[]);
  assert.equal(instrument.read().registers[8],96); assert.equal(instrument.read().registers[0x0b]>>3,1);
  assert.deepEqual(instrument.read().voices,owners); render(.04); assert(core.getState().volumes[2]<before.volumes[2]);
  instrument.noteOff('counter'); instrument.noteOn('hold',60); render(.15);
  assert.equal(instrument.read().registers[8],135); assert.equal(core.getState().volumes[2],7); assert.equal(core.getState().lengths[2],10);
  next.triangle={control:false,linearReload:24,lengthIndex:4}; writes.length=0; instrument.setPreset(next); assert.deepEqual(writes,[]);
  render(.1); assert.equal(core.getState().volumes[2],7); assert.equal(core.getState().lengths[2],10);
  instrument.noteOff('hold'); writes.length=0; instrument.setPreset({...next,triangle:{...next.triangle,linearReload:25}});
  assert.deepEqual(writes,[[0x4008,25]],'idle editing configures control without writing the trigger');
  instrument.noteOn('next',60); render(.2); assert.equal(core.getState().volumes[2],0); assert(core.getState().lengths[2]>0);
});

test('Triangle Pitch preserves active length index zero and only reloads counters when timer-high changes', async t => {
  const {instrument,core,writes,load,render}=await fixture(t,48000);
  load({control:false,linearReload:127,lengthIndex:0}); instrument.noteOn('held',60); render(.02);
  const before=core.getState(); writes.length=0; instrument.setPitch(1);
  assert.deepEqual(writes.map(([address])=>address),[0x400a]);
  assert.equal(core.getState().lengths[2],before.lengths[2]); assert.equal(core.getState().volumes[2],before.volumes[2]);
  const next=instrument.read().preset; next.triangle={control:true,linearReload:7,lengthIndex:31};
  writes.length=0; instrument.setPreset(next); assert.deepEqual(writes,[]); render(.02);
  assert(core.getState().lengths[2]<10); writes.length=0; instrument.setPitch(-12);
  assert.deepEqual(writes.map(([address])=>address),[0x400a,0x400b]);
  assert.equal(instrument.read().registers[0x0b]>>3,0,'Pitch uses the active zero index, not a pending index or the Pulse fallback');
  assert.equal(core.getState().lengths[2],10,'the hardware high write reloads the active length');
  assert.equal(instrument.read().registers[8],127); render(.005); assert.equal(core.getState().volumes[2],127,'the high write also reloads the active linear value');
  assert.equal(instrument.read().voices[0].id,'held');
  instrument.noteOff('held'); instrument.noteOn('next',60); render(.04);
  assert.equal(instrument.read().registers[0x0b]>>3,31); assert.equal(core.getState().lengths[2],30); assert.equal(core.getState().volumes[2],7);
});

test('invalid Triangle gates cannot write registers or replace a sounding owner', async t => {
  const {instrument,writes,load,render}=await fixture(t,48000);
  load({control:false,linearReload:48,lengthIndex:1}); instrument.noteOn('held',60); audible(render(.02));
  const before=instrument.read(), count=writes.length;
  for(const mutate of [
    p=>{p.triangle.control=1;},p=>{p.triangle.linearReload=-1;},p=>{p.triangle.linearReload=128;},p=>{p.triangle.linearReload=1.5;},
    p=>{p.triangle.lengthIndex=-1;},p=>{p.triangle.lengthIndex=32;},p=>{delete p.triangle;},p=>{p.triangle.extra=1;},
  ]) {
    const invalid=instrument.read().preset; mutate(invalid);
    assert.throws(()=>instrument.setPreset(invalid)); assert.throws(()=>instrument.loadPreset(invalid));
    assert.equal(writes.length,count); assert.deepEqual(instrument.read(),before);
  }
});
