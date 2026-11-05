// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {Huc6280Instrument} from './instrument.js';
import {createDefaultPreset} from './preset.js';
import {encodeDdaData} from './dda_pcm.js';

const wasmBinary=await readFile(new URL('../generated/huc6280_wasm.wasm',import.meta.url));
const codes=Uint8Array.from([16,31,0,4,23,19,16,7,28]);
async function setup(t,rate=48000,samples=codes) {
  const core=await Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:rate});
  const instrument=new Huc6280Instrument(core),preset=createDefaultPreset();
  preset.source='dda';preset.dda.data=encodeDdaData(samples);preset.volume=31;preset.envelope.enabled=false;
  instrument.loadPreset(preset);t.after(()=>instrument.dispose());return {core,instrument,preset};
}
const peak=data=>data.reduce((maximum,value)=>Math.max(maximum,Math.abs(value)),0);

test('DDA writes match the actual five-bit DAC at both output rates and retain exact silence after one-shot end',async t=>{
  for(const rate of [44100,48000]) for(const dacRate of [7000,11025,192000]) {
    const {instrument,preset}=await setup(t,rate);preset.dda.sampleRate=dacRate;instrument.loadPreset(preset);
    const raw=await Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:rate});
    t.after(()=>raw.dispose());
    raw.writeHuc6280(1,255);raw.writeHuc6280(0,0);raw.writeHuc6280(5,255);raw.writeHuc6280(4,223);
    instrument.noteOn('one',60);
    const expected={left:new Float32Array(128),right:new Float32Array(128)};
    for(let frame=0;frame<128;frame++) {
      const sample=Math.floor(frame*dacRate/rate);
      if(sample<codes.length) raw.writeHuc6280(6,codes[sample]);
      else {raw.writeHuc6280(4,95);raw.writeHuc6280(6,16);}
      const pcm=raw.processFrames(1);expected.left[frame]=pcm.left[0];expected.right[frame]=pcm.right[0];
    }
    assert.deepEqual(instrument.generateStereo(128),expected);
    const state=instrument.read();assert.equal(state.voices.length,1);assert.equal(state.dda.voices[0].ended,true);
    assert.equal(state.dda.voices[0].position,codes.length);assert.equal(state.registers[0][4]&128,0);assert.equal(state.registers[0][6],16);
    assert.equal(peak(instrument.generateStereo(128).left),0);
    assert.equal(instrument.noteOff('one'),true);assert.equal(instrument.read().voices.length,0);
  }
});

test('rational DAC rates follow exact VGM tick boundaries through loops, one-shot ends and render chunking',async t=>{
  const source=Uint8Array.from({length:47},(_,i)=>(i*13+i%3)&31),frames=5000;
  for(const rate of [44100,48000]) for(const spacing of [6,7,8,13]) for(const loop of [false,true]) {
    const a=await setup(t,rate,source),b=await setup(t,rate,source);
    a.preset.dda.sampleRate=44100/spacing;a.preset.dda.loop=loop;
    a.instrument.loadPreset(a.preset);b.instrument.loadPreset(a.preset);
    a.instrument.noteOn('exact',60);b.instrument.noteOn('exact',60);
    const raw=await Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:rate});
    t.after(()=>raw.dispose());raw.writeHuc6280(1,255);raw.writeHuc6280(0,0);raw.writeHuc6280(5,255);raw.writeHuc6280(4,223);
    const expected={left:new Float32Array(frames),right:new Float32Array(frames)};
    for(let frame=0;frame<frames;frame++) {
      // Integer products preserve the exact VGM timeline independently of the
      // Instrument's floating-point cursor accumulation.
      const index=Math.floor(frame*44100/(spacing*rate));
      if(loop||index<source.length) raw.writeHuc6280(6,source[index%source.length]);
      else {raw.writeHuc6280(4,95);raw.writeHuc6280(6,16);}
      const output=raw.processFrames(1);expected.left[frame]=output.left[0];expected.right[frame]=output.right[0];
    }
    const label=`output ${rate}, spacing ${spacing}, loop ${loop}`;
    assert.deepEqual(a.instrument.generateStereo(frames),expected,label);
    const split={left:new Float32Array(frames),right:new Float32Array(frames)};
    for(let frame=0;frame<frames;) {
      const count=Math.min(17,frames-frame),output=b.instrument.generateStereo(count);
      split.left.set(output.left,frame);split.right.set(output.right,frame);frame+=count;
    }
    assert.deepEqual(split,expected,`${label}, split`);assert.deepEqual(a.instrument.read(),b.instrument.read());
    assert.equal(a.instrument.read().dda.voices[0].ended,!loop);
  }
});

test('looping DDA is render-chunk invariant for fractional cursors and mixed keyboard pitches',async t=>{
  const a=await setup(t),b=await setup(t);
  a.preset.dda.loop=true;a.preset.dda.speed=1.3;a.preset.envelope={enabled:true,attack:.005,decay:.01,sustain:.6,release:.02};
  a.instrument.loadPreset(a.preset);b.instrument.loadPreset(a.preset);
  for(const [id,note] of [['a',60],['b',67],['c',43]]) {a.instrument.noteOn(id,note);b.instrument.noteOn(id,note);}
  const expected=a.instrument.generateStereo(4096),actual={left:new Float32Array(4096),right:new Float32Array(4096)};
  for(let offset=0;offset<4096;) {
    const count=Math.min(7,4096-offset),pcm=b.instrument.generateStereo(count);
    actual.left.set(pcm.left,offset);actual.right.set(pcm.right,offset);offset+=count;
  }
  assert.deepEqual(actual,expected);assert.deepEqual(b.instrument.read(),a.instrument.read());assert(peak(actual.left)>.001);
});

test('high-rate looping DAC playback skips source values on the analytical output-frame timeline',async t=>{
  for(const rate of [44100,48000]) {
    const {instrument,preset}=await setup(t,rate);preset.dda.loop=true;preset.dda.sampleRate=192000;
    instrument.loadPreset(preset);instrument.noteOn('fast',60);
    const raw=await Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:rate});
    t.after(()=>raw.dispose());raw.writeHuc6280(1,255);raw.writeHuc6280(0,0);raw.writeHuc6280(5,255);raw.writeHuc6280(4,223);
    const frames=5000,expected={left:new Float32Array(frames),right:new Float32Array(frames)};
    for(let frame=0;frame<frames;frame++) {
      raw.writeHuc6280(6,codes[Math.floor(frame*192000/rate)%codes.length]);
      const output=raw.processFrames(1);expected.left[frame]=output.left[0];expected.right[frame]=output.right[0];
    }
    assert.deepEqual(instrument.generateStereo(frames),expected);assert.equal(instrument.read().dda.voices[0].ended,false);
  }
});

test('live fractional rate and Pitch edits preserve the owned phase at exact piecewise timeline boundaries',async t=>{
  const samples=Uint8Array.from({length:47},(_,index)=>index&1?31:0),{instrument,preset}=await setup(t,44100,samples);
  preset.dda.loop=true;preset.dda.sampleRate=7350;instrument.loadPreset(preset);instrument.noteOn('held',60);
  const raw=await Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:44100});
  t.after(()=>raw.dispose());raw.writeHuc6280(1,255);raw.writeHuc6280(0,0);raw.writeHuc6280(5,255);raw.writeHuc6280(4,223);
  const renderExpected=(frames,indexAt)=>{
    const expected={left:new Float32Array(frames),right:new Float32Array(frames)};
    for(let frame=0;frame<frames;frame++) {
      raw.writeHuc6280(6,samples[indexAt(frame)%samples.length]);
      const output=raw.processFrames(1);expected.left[frame]=output.left[0];expected.right[frame]=output.right[0];
    }
    return expected;
  };
  assert.deepEqual(instrument.generateStereo(5),renderExpected(5,frame=>Math.floor(frame/6)));
  const first=instrument.read();preset.dda.sampleRate=5512.5;instrument.setPreset(preset);
  assert.deepEqual(instrument.read().voices,first.voices);assert.equal(instrument.read().dda.voices[0].position,first.dda.voices[0].position);
  assert.deepEqual(instrument.generateStereo(128),renderExpected(128,frame=>Math.floor((20+3*frame)/24)));
  const second=instrument.read();instrument.setPitch(12);
  assert.deepEqual(instrument.read().voices,second.voices);assert.equal(instrument.read().dda.voices[0].position,second.dda.voices[0].position);
  assert.deepEqual(instrument.generateStereo(96),renderExpected(96,frame=>Math.floor((202+3*frame)/12)));
  instrument.noteOff('held');assert.equal(instrument.read().voices.length,0);assert.equal(peak(instrument.generateStereo(128).left),0);
});

test('six DDA voices steal safely, prefer ended slots and never leave a DAC value sounding',async t=>{
  const {instrument,preset}=await setup(t);
  for(let ch=0;ch<6;ch++) assert.equal(instrument.noteOn(`n${ch}`,60).channel,ch);
  instrument.generateStereo(4);
  assert.deepEqual(instrument.noteOn('new',64),{channel:0,stolenId:'n0'});
  assert.equal(instrument.noteOff('n0'),false);assert.equal(instrument.read().voices.length,6);
  instrument.generateStereo(100);assert(instrument.read().dda.voices.every(voice=>voice.ended));
  assert.deepEqual(instrument.noteOn('after-end',60),{channel:1,stolenId:'n1'});
  instrument.stop();assert.equal(peak(instrument.generateStereo(128).left),0);
  for(const register of instrument.read().registers.slice(0,6)) {assert.equal(register[4]&128,0);assert.equal(register[6],16);}
  preset.source='wave';instrument.loadPreset(preset);instrument.noteOn('wave',60);
  assert.equal(instrument.read().registers[0][4]&64,0);assert(peak(instrument.generateStereo(1024).left)>.001);
});

test('rate, root, speed, Loop and Pitch edits preserve DDA owner/cursor and never use pitch registers',async t=>{
  const {instrument,preset,core}=await setup(t);preset.dda.loop=true;instrument.loadPreset(preset);
  const writes=[],write=core.writeHuc6280.bind(core);core.writeHuc6280=(register,value)=>{writes.push([register,value]);write(register,value);};
  instrument.noteOn('held',60);instrument.generateStereo(5);const before=instrument.read();
  preset.dda.sampleRate=16000;preset.dda.rootNote=57;preset.dda.speed=2;instrument.setPreset(preset);instrument.setPitch(1.5);
  const edited=instrument.read();assert.deepEqual(edited.voices,before.voices);assert.equal(edited.dda.voices[0].position,before.dda.voices[0].position);
  assert(!writes.some(([register])=>register===2||register===3),'DDA uses software feeding, not the chip period');
  instrument.generateStereo(1);const moved=instrument.read().dda.voices[0].position;
  const step=16000*2*2**((60-57+1.5)/12)/48000;
  assert(Math.abs(moved-(before.dda.voices[0].position+step)%codes.length)<1e-12);
  preset.dda.loop=false;instrument.setPreset(preset);instrument.generateStereo(100);assert(instrument.read().dda.voices[0].ended);
  preset.dda.loop=true;instrument.setPreset(preset);assert(instrument.read().dda.voices[0].ended,'Loop after end affects next trigger');
  assert.equal(peak(instrument.generateStereo(128).left),0);instrument.noteOff('held');instrument.noteOn('again',60);
  assert.equal(instrument.read().dda.voices[0].position,0);instrument.generateStereo(200);assert.equal(instrument.read().dda.voices[0].ended,false);
});

test('DDA software Envelope eases attack, release and the natural non-looping end while raw codes remain intact',async t=>{
  const samples=Uint8Array.from({length:1600},(_,index)=>index&1?31:0),soft=await setup(t,48000,samples),raw=await setup(t,48000,samples);
  soft.preset.dda.sampleRate=16000;soft.preset.envelope={enabled:true,attack:.01,decay:0,sustain:1,release:.02};
  raw.preset.dda.sampleRate=16000;soft.instrument.loadPreset(soft.preset);raw.instrument.loadPreset(raw.preset);
  soft.instrument.noteOn('soft',60);raw.instrument.noteOn('raw',60);
  const softPcm=soft.instrument.generateStereo(4800).left,rawPcm=raw.instrument.generateStereo(4800).left;
  assert(peak(softPcm.slice(0,100))<peak(rawPcm.slice(0,100))*.5);
  assert(peak(softPcm.slice(-100))<peak(rawPcm.slice(-100))*.5);
  assert.equal(soft.instrument.read().preset.dda.data,soft.preset.dda.data);assert.equal(peak(soft.instrument.generateStereo(128).left),0);
  soft.preset.dda.loop=true;soft.instrument.loadPreset(soft.preset);soft.instrument.noteOn('release',60);soft.instrument.generateStereo(960);
  soft.instrument.noteOff('release');assert.equal(soft.instrument.read().voices.length,0);assert.equal(soft.instrument.read().tails.length,1);
  assert(peak(soft.instrument.generateStereo(100).left)>.001);soft.instrument.generateStereo(2000);
  assert.equal(soft.instrument.read().tails.length,0);assert.equal(peak(soft.instrument.generateStereo(128).left),0);
});

test('empty or invalid DDA data never changes an existing sound; data replacement stops notes',async t=>{
  const {instrument,preset}=await setup(t);preset.dda.loop=true;instrument.loadPreset(preset);instrument.noteOn('old',60);
  const invalid=structuredClone(preset);invalid.dda.data='IA==';const before=instrument.read();
  assert.throws(()=>instrument.setPreset(invalid));assert.deepEqual(instrument.read(),before);
  preset.dda.data=encodeDdaData(Uint8Array.from([31,0]));instrument.setPreset(preset);
  assert.equal(instrument.read().voices.length,0);assert.equal(peak(instrument.generateStereo(128).left),0);
  preset.dda.data='';instrument.loadPreset(preset);assert.throws(()=>instrument.noteOn('empty',60),/Load audio/);
  assert.equal(instrument.read().voices.length,0);
});

test('releasing a one-shot during its automatic end fade never raises DAC volume between envelope ticks',async t=>{
  const samples=Uint8Array.from({length:1600},(_,index)=>index&1?31:0);
  const {instrument,preset}=await setup(t,48000,samples);
  preset.dda.sampleRate=16000;preset.envelope={enabled:true,attack:0,decay:0,sustain:1,release:.02};
  instrument.loadPreset(preset);instrument.noteOn('ending',60);instrument.generateStereo(4701);
  const before=instrument.read().registers[0][4]&31;assert(before<31);
  instrument.noteOff('ending');const after=instrument.read().registers[0][4]&31;
  assert(after<=before,'a key release cannot undo the already-active sample-end fade');
  instrument.generateStereo(200);assert.equal(peak(instrument.generateStereo(128).left),0);
});
