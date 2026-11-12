// SPDX-License-Identifier: BSD-3-Clause
// Actual DSP tests: no AudioContext, audio devices or copyrighted samples.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/spc_wasm.js';
import {SnesDspCore} from '../js/spc.js';
import {encodeBrr} from '../js/snes_brr_encoder.js';
import {SnesInstrument} from './instrument.js';
import {createDefaultPreset,readPreset,waveShape} from './preset.js';
import {encodeBase64} from './sample.js';

const wasmBinary=await readFile(new URL('../generated/spc_wasm.wasm',import.meta.url));
const encoded=wave=>encodeBrr(Float32Array.from(wave),{loopStartSamples:0}).brr;
async function create(t,preset=createDefaultPreset()){
  const core=await SnesDspCore.create({moduleFactory:factory,moduleOptions:{wasmBinary}}),events=[];
  for(const method of ['writeDsp','loadRam','reset']){
    const raw=core[method].bind(core);
    core[method]=(...args)=>{events.push({method,args:args.map(value=>value instanceof Uint8Array?value.slice():value)});return raw(...args);};
  }
  const instrument=new SnesInstrument(core);instrument.loadPreset(preset);events.length=0;
  t.after(()=>instrument.dispose());return {core,instrument,events};
}
function render({instrument},frames){const left=new Float32Array(frames),right=new Float32Array(frames);instrument.renderInto(left,right);return {left,right};}
function patch(reference,sample,wave){reference.core.loadRam(encoded(wave),sample.startAddress);}
function assertOwners(actual,before){
  for(const field of ['voices','tails','generation','nativeFrames','sample','modulatorSample','echo','echoRegisters','registers','pitch'])assert.deepEqual(actual[field],before[field],field);
}

test('Wave upload matches a direct RAM edit at ongoing held and releasing cursors, without a new KON',async t=>{
  const host=await create(t),reference=await create(t),unchanged=await create(t);
  for(const instance of [host,reference,unchanged]){
    instance.instrument.noteOn('held',60);instance.instrument.noteOn('release',67);render(instance,433);
    instance.instrument.noteOff('release');render(instance,47);
  }
  const before=host.instrument.read(),snapshot=host.core.snapshot(),synth=host.instrument.synth,
    next=readPreset(before.preset),address=before.sample.startAddress;
  assert.equal(before.tails.length,1);assert(before.registers[1][8]>0);
  next.wave=waveShape('square');host.events.length=0;host.instrument.setPreset(next);patch(reference,before.sample,next.wave);
  assertOwners(host.instrument.read(),before);assert.equal(host.instrument.synth,synth);
  assert.deepEqual(host.events.map(event=>[event.method,event.args[1]]),[['loadRam',address]]);
  assert.deepEqual(host.instrument.synth.sampleBytes[before.sample.id],encoded(next.wave));
  const after=host.core.snapshot(),expectedRam=snapshot.ram.slice();expectedRam.set(encoded(next.wave),address);
  assert.deepEqual(after.ram,expectedRam);assert.deepEqual(after.dsp,snapshot.dsp);
  const actual=render(host,2048);assert.deepEqual(actual,render(reference,2048));assert.notDeepEqual(actual,render(unchanged,2048));
  assert(actual.left.every(Number.isFinite));assert(actual.left.some(value=>value!==0));
  assert.equal(host.instrument.noteOff('held'),true);assert.equal(reference.instrument.noteOff('held'),true);
  assert.deepEqual(render(host,1024),render(reference,1024));assert(render(host,256).left.every(value=>value===0));
  assert.deepEqual(host.instrument.read().voices,[]);assert.deepEqual(host.instrument.read().tails,[]);
  assert.equal(host.instrument.noteOff('release'),false,'an old release cannot reacquire the edited sample');
});

test('carrier and PMON modulator edits preserve shared Echo history and both physical envelopes',async t=>{
  for(const target of ['carrier','modulator','both']){
    const preset=createDefaultPreset();preset.pmon.enabled=true;preset.echo.enabled=true;
    preset.echo.delay=2;preset.echo.feedback=48;preset.echo.volumeLeft=50;preset.echo.volumeRight=-40;
    const host=await create(t,preset),reference=await create(t,preset);
    for(const instance of [host,reference]){instance.instrument.noteOn('held',57);instance.instrument.noteOn('tail',64);render(instance,4096);instance.instrument.noteOff('tail');render(instance,35);}
    const before=host.instrument.read(),snapshot=host.core.snapshot(),next=readPreset(before.preset);
    assert(snapshot.ram.subarray(0,0x7800).some(value=>value!==0),'Echo has an existing history');
    if(target!=='modulator')next.wave=waveShape('triangle');
    if(target!=='carrier')next.pmon.wave=waveShape('saw');
    host.events.length=0;host.instrument.setPreset(next);
    if(target!=='modulator')patch(reference,before.sample,next.wave);
    if(target!=='carrier')patch(reference,before.modulatorSample,next.pmon.wave);
    assertOwners(host.instrument.read(),before);
    assert.deepEqual(host.events.map(event=>event.method),Array(target==='both'?2:1).fill('loadRam'));
    assert.deepEqual(host.core.snapshot().ram.subarray(0,0x7800),snapshot.ram.subarray(0,0x7800));
    assert.deepEqual(render(host,3072),render(reference,3072));
    assert.equal(host.instrument.noteOff('held'),true);assert.equal(reference.instrument.noteOff('held'),true);
    assert.deepEqual(render(host,2048),render(reference,2048));
    assert.deepEqual(host.instrument.read().voices,[]);assert.deepEqual(host.instrument.read().tails,[]);
  }
});

test('dormant Wave drafts under Noise, BRR and a disabled or BRR PMON source make no native writes',async t=>{
  for(const mode of ['noise','brr','disabled-pmon','brr-pmon']){
    const preset=createDefaultPreset(),brr={name:'Original test loop',data:encodeBase64(encoded(waveShape('saw'))),rootNote:60,basePitch:2048,loopStartSamples:0};
    if(mode==='noise')preset.source='noise';
    if(mode==='brr'){preset.source='brr';preset.brr=brr;}
    if(mode==='brr-pmon'){preset.pmon.enabled=true;preset.pmon.source='brr';preset.pmon.brr=brr;}
    const host=await create(t,preset);host.instrument.noteOn('held',60);render(host,512);
    const before=host.instrument.read(),snapshot=host.core.snapshot(),next=readPreset(before.preset);
    if(mode==='noise'||mode==='brr')next.wave=waveShape('square');
    next.pmon.wave=waveShape('triangle');host.events.length=0;host.instrument.setPreset(next);
    assert.deepEqual(host.events,[]);assertOwners(host.instrument.read(),before);assert.deepEqual(host.core.snapshot(),snapshot);
    assert.deepEqual(host.instrument.read().preset,next);assert.equal(host.instrument.noteOff('held'),true);
  }
});

test('expired envelopes and naturally ended voices are not restarted by a Wave edit',async t=>{
  const preset=createDefaultPreset();preset.envelope.mode='gain';preset.envelope.gainMode='exponential-decrease';preset.envelope.gainRate=31;
  const host=await create(t,preset);host.instrument.noteOn('silent-owner',60);render(host,2048);
  assert.equal(host.core.readDsp(8),0);const before=host.instrument.read(),next=readPreset(before.preset);next.wave=waveShape('saw');
  host.events.length=0;host.instrument.setPreset(next);assertOwners(host.instrument.read(),before);
  assert.deepEqual(host.events.map(event=>event.method),['loadRam']);assert(render(host,1024).left.every(value=>value===0));
  host.instrument.noteOff('silent-owner');render(host,512);assert.deepEqual(host.instrument.read().tails,[]);
  next.wave=waveShape('square');host.instrument.setPreset(next);assert(render(host,1024).left.every(value=>value===0));
  assert.deepEqual(host.instrument.read().voices,[]);assert.deepEqual(host.instrument.read().tails,[]);
});

test('invalid Wave edits are atomic; explicit loads and combined topology edits retain replacement semantics',async t=>{
  const host=await create(t);host.instrument.noteOn('held',60);render(host,257);
  const before=host.instrument.read(),snapshot=host.core.snapshot();host.events.length=0;
  for(const change of [p=>p.wave[0]=NaN,p=>p.pmon.wave.pop(),p=>{p.wave=waveShape('square');p.volume.left=128;}]){
    const next=readPreset(before.preset);change(next);assert.throws(()=>host.instrument.setPreset(next));
    assert.deepEqual(host.events,[]);assert.deepEqual(host.instrument.read(),before);assert.deepEqual(host.core.snapshot(),snapshot);
  }
  const next=readPreset(before.preset);next.wave=waveShape('triangle');next.pmon.enabled=true;host.instrument.setPreset(next);
  assert(host.instrument.generation>before.generation);assert.equal(host.core.nativeFrames,0);assert.deepEqual(host.instrument.read().voices,[]);
  host.instrument.noteOn('new',60);render(host,512);const generation=host.instrument.generation;
  host.instrument.loadPreset(host.instrument.read().preset);assert(host.instrument.generation>generation);assert.equal(host.core.nativeFrames,0);assert.deepEqual(host.instrument.read().voices,[]);
});
