// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/nesapu_wasm.js';
import {NesApuWasm} from '../js/nesapu_wasm.js';
import {NesInstrument} from './instrument.js';
import {hardwareStateModel} from './hardware_state.js';

const wasmBinary = await readFile(new URL('../generated/nesapu_wasm.wasm',import.meta.url));
async function fixture(t,rate=48000) {
  const core = await NesApuWasm.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:rate,fds:true});
  const instrument = new NesInstrument(core);t.after(()=>instrument.dispose());
  const load = (source,settings={}) => {
    const preset=instrument.read().preset;preset.source=source;Object.assign(preset[source],settings);instrument.loadPreset(preset);
  };
  const read = source => hardwareStateModel(instrument.read(),source);
  return {instrument,core,load,read,render:seconds=>instrument.generateStereo(Math.round(seconds*rate))};
}
const value = (model,row,metric) => model.channels[row].metrics.find(item=>item.id===metric).value;
const unknown = model => model.channels.every(row=>row.status==='No observation'&&row.metrics.every(item=>item.value===null&&item.text==='—'));

test('hardware meters stay unknown without a coherent observed snapshot and never use authored settings as live values', async t => {
  for(const source of ['pulse','triangle','noise','fds']) {
    assert(unknown(hardwareStateModel(null,source)));
    assert(unknown(hardwareStateModel({preset:{source}},source)));
  }
  const {instrument,load}=await fixture(t);load('pulse');instrument.noteOn('held',60);const snapshot=instrument.read();
  for(const corrupt of [
    state=>{state.preset.source='noise';},state=>{delete state.coreState;},state=>{state.voices=null;},state=>{state.voices[0].channel=6;},
    state=>{state.coreState.enableMask=NaN;},state=>{state.coreState.muteMask=-1;},state=>{state.coreState.lengths[0]=255;},
    state=>{state.coreState.volumes[0]=16;},state=>{state.coreState.registers[0]=undefined;},
  ]) {
    const invalid=structuredClone(snapshot);corrupt(invalid);assert(unknown(hardwareStateModel(invalid,'pulse')));
  }
  assert.deepEqual(hardwareStateModel(snapshot,'unknown').channels,[]);
  assert.deepEqual(hardwareStateModel(snapshot,'dmc').channels,[]);assert.match(hardwareStateModel(null,'dmc').note,/DAC preview/);
});

test('Pulse meters observe both hardware channels, completed Length and pending edits independently', async t => {
  for(const rate of [44100,48000]) {
    const {instrument,load,read,render}=await fixture(t,rate);
    load('pulse',{lengthHalt:false,lengthIndex:4});instrument.noteOn('one',60);instrument.noteOn('two',64);render(.05);
    const before=read('pulse');assert.deepEqual(before.channels.map(row=>row.id),['pulse1','pulse2']);
    for(const row of [0,1]) {assert.equal(value(before,row,'volume'),10);assert(value(before,row,'length')<40&&value(before,row,'length')>0);assert.match(before.channels[row].status,/Fixed volume.*Length running/);}
    const preset=instrument.read().preset;preset.pulse.lengthHalt=true;preset.pulse.lengthIndex=1;preset.pulse.envelope.enabled=true;instrument.setPreset(preset);
    const pending=read('pulse');assert.equal(value(pending,0,'length'),value(before,0,'length'));assert.match(pending.channels[0].status,/Fixed volume.*Length running/);
    render(.35);const ended=read('pulse');
    for(const row of ended.channels) {assert.match(row.status,/Held.*Length ended/);assert.equal(row.metrics.find(item=>item.id==='length').value,0);}
    assert.equal(instrument.read().voices.length,2,'observation does not release expired held owners');
    instrument.stop();assert(read('pulse').channels.every(row=>row.status==='Idle'));
  }
});

test('Noise meters follow the real Envelope decay and Loop halt bit instead of a simulated gain', async t => {
  for(const rate of [44100,48000]) {
    const {instrument,load,read,render}=await fixture(t,rate);
    load('noise',{lengthHalt:true,lengthIndex:1,envelope:{enabled:true,period:1,loop:false}});instrument.noteOn('decay',60);
    render(.035);const early=read('noise');assert(value(early,0,'volume')>0&&value(early,0,'volume')<15);assert.match(early.channels[0].status,/Envelope.*Length running/);
    render(.2);const ended=read('noise');assert.equal(value(ended,0,'volume'),0);assert(value(ended,0,'length')>0);assert.match(ended.channels[0].status,/Envelope at 0/);
    load('noise',{lengthHalt:false,lengthIndex:3,envelope:{enabled:true,period:1,loop:true}});instrument.noteOn('loop',60);render(.3);
    const loop=read('noise');assert.equal(value(loop,0,'length'),2);assert.match(loop.channels[0].status,/Length halted/);
    const preset=instrument.read().preset;preset.noise.envelope.loop=false;instrument.setPreset(preset);
    assert.match(read('noise').channels[0].status,/Length halted/,'pending Loop edit is not presented as the active hardware mode');
  }
});

test('Triangle meters identify Linear as a counter, independently show its expiry and the Length gate', async t => {
  for(const rate of [44100,48000]) {
    const {instrument,load,read,render}=await fixture(t,rate);
    load('triangle',{control:false,linearReload:24,lengthIndex:1});instrument.noteOn('linear',60);render(.03);
    const moving=read('triangle');assert(value(moving,0,'linear')>0&&value(moving,0,'linear')<24);assert.equal(moving.channels[0].metrics[0].max,127);assert.match(moving.note,/not volume/);
    render(.1);const linearEnd=read('triangle');assert.equal(value(linearEnd,0,'linear'),0);assert(value(linearEnd,0,'length')>0);assert.match(linearEnd.channels[0].status,/Linear ended/);
    load('triangle',{control:false,linearReload:127,lengthIndex:3});instrument.noteOn('length',60);render(.05);
    const lengthEnd=read('triangle');assert(value(lengthEnd,0,'linear')>0);assert.equal(value(lengthEnd,0,'length'),0);assert.match(lengthEnd.channels[0].status,/Length ended/);
    load('triangle',{control:true,linearReload:7,lengthIndex:3});instrument.noteOn('hold',60);render(.3);
    const hold=read('triangle');assert.equal(value(hold,0,'linear'),7);assert.equal(value(hold,0,'length'),2);assert.match(hold.channels[0].status,/Counters held/);
  }
});

test('FDS raw gains keep the Volume cap separate from effective Depth and observe the active shared clock', async t => {
  for(const rate of [44100,48000]) {
    const {instrument,load,read,render}=await fixture(t,rate);
    load('fds',{envelope:{enabled:true,increase:false,period:63,initialGain:63},envelopeClock:{masterSpeed:0,halt:false},
      modulation:{enabled:false,table:Array(32).fill(0),rate:256,depth:16,bias:8,envelope:{enabled:true,increase:false,period:63,initialGain:63}}});
    instrument.noteOn('raw',60);render(.03);const raw=read('fds');
    assert.equal(value(raw,0,'volumeGain'),63);assert.match(raw.channels[0].metrics[0].text,/63 raw.*32 effective/);
    assert.equal(value(raw,0,'depthGain'),63);assert.equal(raw.channels[0].metrics[1].text,'63 raw');assert.match(raw.channels[0].status,/clock paused.*Modulation off/);
    const preset=instrument.read().preset;preset.fds.envelopeClock={masterSpeed:8,halt:false};instrument.setPreset(preset);
    assert.match(read('fds').channels[0].status,/clock paused/,'authored clock edit does not fabricate active progress');
    instrument.noteOff('raw');instrument.noteOn('moving',60);render(.02);const moving=read('fds');
    assert(value(moving,0,'volumeGain')<63);assert(value(moving,0,'depthGain')<63);assert.match(moving.channels[0].status,/clock running.*Modulation off/);
    instrument.noteOff('moving');assert.match(read('fds').channels[0].status,/^Idle/);
    const malformed=instrument.read();malformed.coreState.fdsGain=64;assert(unknown(hardwareStateModel(malformed,'fds')));
  }
});

test('models own detached display objects and reading them cannot change the preset, owner or rendered PCM', async t => {
  const a=await fixture(t),b=await fixture(t);
  for(const item of [a,b]) {item.load('pulse',{envelope:{enabled:true,period:7,loop:true}});item.instrument.noteOn('held',60);item.render(.04);}
  const snapshot=a.instrument.read(),before=structuredClone(snapshot);
  for(let index=0;index<100;index++) {
    const model=hardwareStateModel(snapshot,'pulse');model.channels[0].metrics[0].value=999;model.channels[0].status='modified';
  }
  assert.deepEqual(snapshot,before);assert.deepEqual(a.instrument.read(),before);
  assert.deepEqual(a.render(.08),b.render(.08),'display projection does not advance chip time or write audio commands');
});
