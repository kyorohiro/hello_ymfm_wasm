// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/spc_wasm.js';
import {SnesDspCore} from '../js/spc.js';
import {SnesSynth} from '../js/snessynth.js';
import {encodeBrr} from '../js/snes_brr_encoder.js';
import {encodeBase64} from './sample.js';
import {SnesInstrument} from './instrument.js';
import {createDefaultPreset,readPreset,envelopeRegisters,modulatorEnvelopeRegisters,waveShape,presetToCode,createNoiseCarrier,sampleBudget,ECHO_BRR_MAX_BYTES} from './preset.js';

const wasmBinary=await readFile(new URL('../generated/spc_wasm.wasm',import.meta.url));
const create=()=>SnesDspCore.create({moduleFactory:factory,moduleOptions:{wasmBinary}});
async function setup(t) {const core=await create(),instrument=new SnesInstrument(core);t.after(()=>instrument.dispose());return {core,instrument};}
function render(instrument,frames) {const left=new Float32Array(frames),right=new Float32Array(frames);instrument.renderInto(left,right);return {left,right};}
const peak=values=>values.reduce((result,value)=>Math.max(result,Math.abs(value)),0);

test('eight physical voices start together, retain finite headroom and release via hardware KOFF',async t=>{
  const {instrument}=await setup(t);
  for(let channel=0;channel<8;channel++)assert.deepEqual(instrument.noteOn(`note-${channel}`,60),{channel,stolenId:null});
  const output=render(instrument,4096);assert(output.left.every(Number.isFinite));assert(peak(output.left)>.2);assert(peak(output.left)<.95);
  const state=instrument.read();assert.equal(state.capacity,8);assert.equal(state.voices.length,8);
  assert.deepEqual(state.registers.map(row=>row[4]),Array(8).fill(0));assert(state.registers.every(row=>row[8]>0));
  for(let channel=0;channel<8;channel++)assert.equal(instrument.noteOff(`note-${channel}`),true);
  assert.equal(instrument.read().voices.length,0);render(instrument,1024);
  assert.equal(instrument.read().tails.length,0);assert.equal(peak(render(instrument,128).left),0);
});

test('ninth note steals safely and a replaced owner cannot stop its new channel',async t=>{
  const {instrument}=await setup(t);
  for(let i=0;i<8;i++)instrument.noteOn(`n${i}`,60+i);
  render(instrument,256);assert.deepEqual(instrument.noteOn('new',72),{channel:0,stolenId:'n0'});
  assert.equal(instrument.noteOff('n0'),false);assert.equal(instrument.read().voices.length,8);
  render(instrument,512);assert(peak(render(instrument,128).left)>.001);
  for(let i=1;i<8;i++)instrument.noteOff(`n${i}`);instrument.noteOff('new');render(instrument,1024);
  assert.equal(instrument.read().tails.length,0);
});

test('release slots are preferred over held notes and reused identities keep their new owner',async t=>{
  const {instrument}=await setup(t);for(let i=0;i<8;i++)instrument.noteOn(`n${i}`,60+i);
  render(instrument,512);instrument.noteOff('n4');
  assert.deepEqual(instrument.noteOn('again',64),{channel:4,stolenId:null});
  assert.equal(instrument.noteOff('n4'),false);assert.equal(instrument.read().voices.length,8);
  instrument.noteOff('again');instrument.noteOn('again',65);render(instrument,1024);
  assert(instrument.read().voices.some(v=>v.id==='again'));
});

test('live level, envelope, tuning and Pitch changes preserve owners and native execution',async t=>{
  const {instrument,core}=await setup(t);instrument.noteOn('held',60);render(instrument,333);
  const before=instrument.read(),p=before.preset;
  p.volume.left=-16;p.envelope.mode='gain';p.envelope.gainLevel=80;instrument.setPreset(p);instrument.setPitch(2);
  const edited=instrument.read();assert.deepEqual(edited.voices,before.voices);assert.equal(edited.generation,before.generation);assert.equal(core.nativeFrames,333);
  assert.equal(edited.registers[0][0],240);assert.equal(edited.registers[0][7],80);
  const expected=Math.round(4096*440*2**((62-69)/12)/250);
  assert.equal(edited.registers[0][2]|(edited.registers[0][3]<<8),expected);
  const pcm=render(instrument,512);assert(pcm.left.some((value,index)=>value!==pcm.right[index]));
});

test('sample replacement and Stop reclaim RAM, silence all voices and invalidate buffered output generations',async t=>{
  const {instrument,core}=await setup(t);instrument.noteOn('old',60);render(instrument,256);
  let generation=instrument.generation;
  for(let i=0;i<40;i++) {
    const p=instrument.read().preset;p.wave=waveShape(i%2?'triangle':'square');instrument.setPreset(p);
    assert(instrument.generation>generation);generation=instrument.generation;
    assert.equal(instrument.read().voices.length,0);assert.equal(instrument.synth.samples.length,1);
    assert.equal(instrument.synth.nextAddress,1024+72);assert.equal(core.nativeFrames,0);
  }
  instrument.noteOn('again',60);render(instrument,256);instrument.stop();
  assert(instrument.generation>generation);assert.equal(instrument.read().voices.length,0);assert.equal(peak(render(instrument,512).left),0);
});

test('a supplied BRR sample uses declared root/base PITCH and renders a finite one-shot',async t=>{
  const {instrument}=await setup(t),p=createDefaultPreset();p.source='brr';
  const encoded=encodeBrr(Float32Array.from({length:64},(_,i)=>.6*Math.sin(i*Math.PI/8)));
  p.brr={name:'authored',data:encodeBase64(encoded.brr),rootNote:57,basePitch:2048,loopStartSamples:null};
  instrument.loadPreset(p);instrument.noteOn('brr',69);
  let state=instrument.read();assert.equal(state.registers[0][2]|state.registers[0][3]<<8,4096);
  assert(peak(render(instrument,128).left)>.001);render(instrument,1024);assert.equal(peak(render(instrument,128).left),0);
  assert.equal(instrument.read().voices.length,1,'held one-shot retains its keyboard owner');
  const before=instrument.generation;p.brr.rootNote=60;p.brr.basePitch=3072;instrument.setPreset(p);
  state=instrument.read();assert.equal(state.generation,before);assert.equal(state.voices[0].id,'brr');
  assert.equal(state.sample.rootNote,60);assert.equal(state.sample.basePitch,3072);
  assert.equal(state.registers[0][2]|state.registers[0][3]<<8,Math.round(3072*2**(9/12)));
});

test('invalid presets and notes preserve the existing sound before any reset or register edit',async t=>{
  const {instrument}=await setup(t);instrument.noteOn('held',60);render(instrument,256);const before=instrument.read();
  const invalid=structuredClone(before.preset);invalid.volume.left=128;
  assert.throws(()=>instrument.loadPreset(invalid));assert.deepEqual(instrument.read(),before);
  invalid.volume.left=16;invalid.wave[0]=NaN;assert.throws(()=>instrument.setPreset(invalid));assert.deepEqual(instrument.read(),before);
  assert.throws(()=>instrument.noteOn('held',61));assert.throws(()=>instrument.noteOn('new',128));assert.throws(()=>instrument.setPitch(Infinity));
  assert.deepEqual(instrument.read(),before);
  const empty=createDefaultPreset();empty.source='brr';instrument.loadPreset(empty);assert.throws(()=>instrument.noteOn('empty',60),/Load a BRR/);
});

test('native rendering matches raw SnesSynth register setup and remains chunk invariant',async t=>{
  const a=await setup(t),b=await setup(t),rawCore=await create(),raw=new SnesSynth({core:rawCore});t.after(()=>raw.dispose());
  const p=createDefaultPreset();p.envelope.mode='gain';p.envelope.gainLevel=100;p.volume={left:32,right:24};
  a.instrument.loadPreset(p);b.instrument.loadPreset(p);
  const encoded=encodeBrr(Float32Array.from(p.wave),{loopStartSamples:0});const sample=raw.loadBRR(encoded.brr,{baseFrequencyHz:250,loopStartSamples:0});
  const regs=envelopeRegisters(p);raw.setPreset(0,{sample,...regs,volumeLeft:32,volumeRight:24,pitch:Math.round(4096*440*2**((60-69)/12)/250)});
  raw.keyOn(0);a.instrument.noteOn('same',60);b.instrument.noteOn('same',60);
  const expected=render(a.instrument,4096),oracle=render(raw,4096),split={left:new Float32Array(4096),right:new Float32Array(4096)};
  assert.deepEqual(expected,oracle);
  for(let offset=0;offset<4096;offset+=17)b.instrument.renderInto(split.left,split.right,Math.min(17,4096-offset),offset);
  assert.deepEqual(split,expected);assert.deepEqual(b.instrument.read(),a.instrument.read());
});

test('decreasing GAIN acts on existing hardware envelope without synthetic key-on prefill',async t=>{
  const {instrument}=await setup(t),p=createDefaultPreset();p.envelope.mode='gain';p.envelope.gainMode='linear-decrease';p.envelope.gainRate=31;
  instrument.loadPreset(p);instrument.noteOn('fresh',60);assert.equal(peak(render(instrument,512).left),0);
  p.envelope.gainMode='direct';p.envelope.gainLevel=127;instrument.setPreset(p);assert(peak(render(instrument,512).left)>.001);
  p.envelope.gainMode='exponential-decrease';p.envelope.gainRate=31;instrument.setPreset(p);
  const envBefore=instrument.read().registers[0][8];render(instrument,512);const envAfter=instrument.read().registers[0][8];
  assert(envAfter<envBefore);assert.equal(instrument.read().voices[0].id,'fresh');
});

function pulsePreset(echo={}) {
  const p=createDefaultPreset();p.source='brr';p.envelope.mode='gain';p.envelope.gainLevel=127;p.volume={left:32,right:32};
  const pcm=Float32Array.from({length:32},(_,i)=>i<8?.8:0),encoded=encodeBrr(pcm);
  p.brr={name:'Self-authored pulse',data:encodeBase64(encoded.brr),rootNote:60,basePitch:4096,loopStartSamples:null};
  p.echo={...p.echo,enabled:true,delay:1,feedback:0,volumeLeft:64,volumeRight:64,...echo};
  return p;
}

test('hardware Echo arrives after the dry pulse; FIR, feedback and signed returns alter the delayed signal',async t=>{
  const wet=await setup(t),dry=await setup(t),mutedFir=await setup(t),feedback=await setup(t),opposed=await setup(t);
  for(const [entry,options]of[[wet,{}],[dry,{enabled:false}],[mutedFir,{fir:Array(8).fill(0)}],[feedback,{feedback:64}],[opposed,{volumeRight:-64}]]) {
    entry.instrument.loadPreset(pulsePreset(options));entry.instrument.noteOn('pulse',60);
  }
  const w=render(wet.instrument,2048),d=render(dry.instrument,2048),f=render(mutedFir.instrument,2048),repeat=render(feedback.instrument,2048),negative=render(opposed.instrument,2048);
  assert(peak(d.left.slice(0,128))>.01,'the authored one-shot has a dry transient');
  assert.equal(peak(d.left.slice(128)),0,'the dry one-shot ends before the delayed return');
  assert.equal(peak(w.left.slice(128,500)),0,'there is no artificial immediate wet path');
  assert(peak(w.left.slice(512,640))>.005,'EDL1 produces a delayed hardware return');
  assert.equal(peak(w.left.slice(1024,1152)),0,'zero feedback does not produce another echo');
  assert(peak(repeat.left.slice(1024,1152))>.001,'feedback feeds the delay again');
  assert.equal(peak(f.left.slice(128)),0,'zero FIR coefficients remove the wet signal');
  assert(peak(negative.right.slice(512,640))>.005);
  for(let i=512;i<640;i++)assert(Math.abs(negative.left[i]+negative.right[i])<=2/32768,'signed right return inverts delayed polarity');
});

test('Echo native rendering equals manual DSP setup and is invariant under small render partitions',async t=>{
  const a=await setup(t),b=await setup(t),rawCore=await create(),raw=new SnesSynth({core:rawCore});t.after(()=>raw.dispose());
  const p=pulsePreset({feedback:-37,volumeLeft:61,volumeRight:-43,fir:[90,16,-8,4,0,0,0,0]});
  a.instrument.loadPreset(p);b.instrument.loadPreset(p);
  const bytes=Uint8Array.from(Buffer.from(p.brr.data,'base64'));
  rawCore.loadRam(bytes,0x7c00);rawCore.loadRam(Uint8Array.of(0,0x7c,0,0x7c),0x7800);
  const env=envelopeRegisters(p);
  for(let channel=0;channel<8;channel++)raw.setPreset(channel,{...env,volumeLeft:32,volumeRight:32,pitch:4096});
  for(const [register,value]of[[0x5d,0x78],[0x6d,0],[0x7d,1],[0x0d,219],[0x2c,61],[0x3c,213],[0x4d,255],
    ...p.echo.fir.map((value,index)=>[0x0f+index*16,value&255]),[0x6c,0],[0x5c,254],[0x4c,1]])rawCore.writeDsp(register,value);
  a.instrument.noteOn('pulse',60);b.instrument.noteOn('pulse',60);
  const expected=render(a.instrument,4096),oracle=render(raw,4096),split={left:new Float32Array(4096),right:new Float32Array(4096)};
  assert.deepEqual(expected,oracle,'the standalone effect is the existing accurate DSP path');
  for(let offset=0;offset<4096;offset+=17)b.instrument.renderInto(split.left,split.right,Math.min(17,4096-offset),offset);
  assert.deepEqual(split,expected);assert.deepEqual(b.instrument.read(),a.instrument.read());
});

test('Echo parameter edits preserve held owners, hardware phase and bank bytes; On/Off resets the bank and tails',async t=>{
  const {instrument,core}=await setup(t),p=createDefaultPreset();p.echo.enabled=true;instrument.loadPreset(p);
  instrument.noteOn('held',60);render(instrument,2048);const before=instrument.read(),ram=core.snapshot().ram;
  p.echo={...p.echo,delay:15,feedback:-64,volumeLeft:-55,volumeRight:44,send:false,fir:[100,-16,8,0,0,0,0,0]};
  instrument.setPreset(p);const edited=instrument.read();
  assert.deepEqual(edited.voices,before.voices);assert.equal(edited.generation,before.generation);assert.equal(edited.nativeFrames,2048);
  assert.deepEqual(core.snapshot().ram,ram,'live effect edits do not clear or relocate RAM');
  assert.deepEqual(edited.echoRegisters,{flg:0,esa:0,edl:15,efb:192,eon:0,volumeLeft:201,volumeRight:44,fir:[100,240,8,0,0,0,0,0]});
  assert.equal(edited.echo.sendMask,0);assert.deepEqual(edited.memory,{directoryAddress:0x7800,maxSampleBytes:ECHO_BRR_MAX_BYTES});
  p.echo.enabled=false;instrument.setPreset(p);const off=instrument.read();
  assert.equal(off.voices.length,0);assert(off.generation>before.generation);assert.equal(off.nativeFrames,0);
  assert.deepEqual(off.memory,{directoryAddress:0,maxSampleBytes:64512});assert.equal(off.echoRegisters.flg&0x20,0x20);
  assert.equal(peak(render(instrument,4096).left),0,'turning Echo off clears held sound and old returns');
  p.echo.enabled=true;instrument.setPreset(p);instrument.noteOn('again',60);render(instrument,2048);const generation=instrument.generation;
  instrument.stop();assert(instrument.generation>generation);assert.equal(instrument.read().voices.length,0);
  assert.equal(peak(render(instrument,4096).left),0,'Stop removes hardware echo tails while keeping the effect settings');
  assert.equal(instrument.read().preset.echo.enabled,true);
});

test('Echo capacity failures preserve current RAM and held notes; repeated EDL15 layouts never overwrite BRR or directory',async t=>{
  const {instrument,core}=await setup(t),large=createDefaultPreset(),bytes=new Uint8Array(ECHO_BRR_MAX_BYTES+9);bytes[bytes.length-9]=1;
  large.source='brr';large.brr={...large.brr,name:'Over Echo budget',data:encodeBase64(bytes)};
  instrument.loadPreset(large);instrument.noteOn('held',60);render(instrument,256);
  const before=instrument.read(),ram=core.snapshot().ram;large.echo.enabled=true;
  assert.throws(()=>instrument.setPreset(large),/33,786/);assert.deepEqual(instrument.read(),before);assert.deepEqual(core.snapshot().ram,ram);
  const p=createDefaultPreset(),encoded=encodeBrr(Float32Array.from(p.wave),{loopStartSamples:0}).brr;
  for(let iteration=0;iteration<12;iteration++) {
    p.echo.enabled=iteration%2===0;p.echo.delay=15;p.echo.feedback=40;
    instrument.loadPreset(p);instrument.noteOn(`pass-${iteration}`,60);render(instrument,24000);
    const state=instrument.read(),memory=core.snapshot().ram,start=p.echo.enabled?0x7c00:0x400,directory=p.echo.enabled?0x7800:0;
    assert.equal(state.sample.startAddress,start);assert.equal(instrument.synth.samples.length,1);
    assert.deepEqual(memory.slice(start,start+encoded.length),encoded);
    assert.deepEqual(Array.from(memory.slice(directory,directory+4)),[start&255,start>>8,start&255,start>>8]);
    assert.equal(core.readDsp(0x5d)<<8,directory);
  }
});

function noisePreset(echo={}) {
  const p=createDefaultPreset();p.source='noise';p.envelope.mode='gain';p.envelope.gainLevel=127;
  p.echo={...p.echo,...echo};return p;
}

test('hardware Noise ignores musical MIDI and Pitch while using a valid silent fetch loop',async t=>{
  const a=await setup(t),b=await setup(t),p=noisePreset();
  a.instrument.loadPreset(p);b.instrument.loadPreset(p);
  a.instrument.noteOn('same',12);b.instrument.noteOn('same',108);
  a.instrument.setPitch(12);b.instrument.setPitch(-12);
  const state=a.instrument.read();assert.equal(state.pitch,0);assert.equal(state.noise.enabled,true);
  assert.deepEqual(state.noiseRegisters,{non:255,flg:63,clock:31});
  assert.equal(state.registers[0][2]|state.registers[0][3]<<8,4096);
  assert.equal(state.sample.byteLength,9);assert.equal(state.sample.frames,16);assert.equal(state.sample.loop,true);
  assert.deepEqual(a.core.snapshot().ram.slice(state.sample.startAddress,state.sample.startAddress+9),createNoiseCarrier());
  const first=render(a.instrument,8192),other=render(b.instrument,8192);
  assert.deepEqual(first,other,'different notes and wheels do not tune the shared LFSR');
  assert(first.left.every(Number.isFinite));assert(peak(first.left)>.01);
  assert(new Set(first.left.slice(128)).size>100,'the hardware noise generator advances rather than playing the silent carrier');
});

test('Noise clock changes preserve LFSR, envelope, owner and RAM; clock zero holds the current value',async t=>{
  const a=await setup(t),b=await setup(t),p=noisePreset();a.instrument.loadPreset(p);b.instrument.loadPreset(p);
  a.instrument.noteOn('held',60);b.instrument.noteOn('held',60);
  assert.deepEqual(render(a.instrument,2048),render(b.instrument,2048));
  const before=a.instrument.read(),ram=a.core.snapshot().ram;
  p.noise.clock=10;a.instrument.setPreset(p);b.core.writeDsp(0x6c,(b.core.readDsp(0x6c)&0xe0)|10);
  const state=a.instrument.read();assert.equal(state.generation,before.generation);assert.equal(state.nativeFrames,before.nativeFrames);
  assert.deepEqual(state.voices,before.voices);assert.equal(state.registers[0][8],before.registers[0][8]);assert.deepEqual(a.core.snapshot().ram,ram);
  assert.deepEqual(render(a.instrument,4096),render(b.instrument,4096),'live change matches a raw clock edit without resetting LFSR history');
  p.noise.clock=0;a.instrument.setPreset(p);const held=render(a.instrument,512).left.slice(32);
  assert(held.every(value=>value===held[0]),'clock zero holds a noise value; it is not a synthetic mute');
  const previous=a.instrument.read(),memory=a.core.snapshot().ram;p.noise.clock=32;
  assert.throws(()=>a.instrument.setPreset(p),/Noise clock/);assert.deepEqual(a.instrument.read(),previous);assert.deepEqual(a.core.snapshot().ram,memory);
  assert.throws(()=>a.instrument.setPitch(Infinity),/Pitch/);assert.deepEqual(a.instrument.read(),previous);
});

test('Noise uses hardware ADSR and live increasing / decreasing GAIN without a sample envelope',async t=>{
  const {instrument}=await setup(t),p=noisePreset();
  p.envelope={...p.envelope,mode:'adsr',attack:8,decay:0,sustainLevel:7,sustainRate:0};
  instrument.loadPreset(p);instrument.noteOn('envelope',60);render(instrument,256);
  const attack=instrument.read();assert(attack.registers[0][8]>0&&attack.registers[0][8]<127);
  render(instrument,6000);assert(instrument.read().registers[0][8]>attack.registers[0][8]);
  p.envelope.mode='gain';p.envelope.gainMode='linear-decrease';p.envelope.gainRate=31;
  const generation=instrument.generation;instrument.setPreset(p);render(instrument,512);
  assert.equal(instrument.read().registers[0][8],0);assert.equal(peak(render(instrument,128).left),0);
  p.envelope.gainMode='linear-increase';instrument.setPreset(p);render(instrument,512);
  const raised=instrument.read();assert.equal(raised.registers[0][8],127);assert(peak(render(instrument,128).left)>.01);
  p.envelope.gainMode='exponential-decrease';instrument.setPreset(p);render(instrument,512);
  assert(instrument.read().registers[0][8]<raised.registers[0][8]);
  assert.deepEqual(instrument.read().voices,attack.voices);assert.equal(instrument.generation,generation);
});

test('Noise envelopes, steal, Echo and Stop share the real DSP without damaging either bank layout',async t=>{
  const {instrument,core}=await setup(t),p=noisePreset({enabled:true,delay:15,feedback:48,volumeLeft:48,volumeRight:40});
  const inactive=new Uint8Array(64512);inactive[inactive.length-9]=1;p.brr.data=encodeBase64(inactive);
  instrument.loadPreset(p);for(let index=0;index<8;index++)instrument.noteOn('n'+index,12+index*12);
  render(instrument,2048);assert.deepEqual(instrument.noteOn('new',120),{channel:0,stolenId:'n0'});assert.equal(instrument.noteOff('n0'),false);
  p.noise.clock=24;p.echo.feedback=-48;p.echo.fir=[100,20,-10,5,0,0,0,0];
  const before=instrument.read();instrument.setPreset(p);const live=instrument.read();
  assert.deepEqual(live.voices,before.voices);assert.equal(live.generation,before.generation);assert.equal(live.echoRegisters.flg&32,0);assert.equal(live.echoRegisters.flg&31,24);
  const output=render(instrument,24000);assert(output.left.every(Number.isFinite));assert(peak(output.left)>.05);
  const state=instrument.read(),memory=core.snapshot().ram,start=state.sample.startAddress;
  assert.equal(start,0x7c00);assert.deepEqual(memory.slice(start,start+9),createNoiseCarrier());
  assert.deepEqual(Array.from(memory.slice(0x7800,0x7804)),[0,0x7c,0,0x7c]);
  for(let index=1;index<8;index++)instrument.noteOff('n'+index);instrument.noteOff('new');
  const tail=render(instrument,12000);assert(peak(tail.left.slice(1024))>.001,'Noise can feed hardware Echo beyond KOFF');
  instrument.stop();assert.equal(peak(render(instrument,4096).left),0);assert.equal(instrument.read().preset.noise.clock,24);
  instrument.loadPreset(createDefaultPreset());assert.equal(instrument.read().noiseRegisters.non,0);assert.equal(instrument.read().noiseRegisters.clock,0);
  instrument.noteOn('wave',60);assert(peak(render(instrument,2048).left)>.01);
});

test('Noise JSON and exported existing low-level API reproduce native stereo PCM exactly',async t=>{
  const {instrument}=await setup(t),rawCore=await create(),raw=new SnesSynth({core:rawCore});t.after(()=>raw.dispose());
  const p=noisePreset({enabled:true,delay:2,feedback:-40,volumeLeft:48,volumeRight:-24,fir:[100,20,-10,5,0,0,0,0]});
  p.noise.clock=25;p.volume={left:24,right:-16};
  const restored=readPreset(JSON.parse(JSON.stringify(p)));assert.deepEqual(restored,p);
  instrument.loadPreset(restored);instrument.noteOn('noise',100);
  const code=presetToCode(restored),AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  assert(code.includes('writeDsp(0x3d, 1)'));assert(code.includes('noiseFlags & 0xe0'));
  await new AsyncFunction('useSoundChip','pg',code)(async mode=>{assert.equal(mode,'snes');return raw;},
    {encodeBrr(){throw new Error('Noise export must use the silent fetch loop, not encode an authored wave');}});
  assert.deepEqual(render(raw,12000),render(instrument,12000));
  assert.equal(raw.readDsp(0x3d),1);assert.equal(raw.readDsp(0x6c)&31,25);assert.equal(raw.readDsp(0x6c)&32,0);
});

function pmonPreset(echo={}) {
  const p=createDefaultPreset();p.pmon.enabled=true;p.envelope.mode='gain';p.envelope.gainLevel=127;
  p.echo={...p.echo,...echo};return p;
}
const pitchAt=(frequency,base=250)=>Math.max(1,Math.min(0x3fff,Math.round(4096*frequency/base)));
const frequencyAt=midi=>440*2**((midi-69)/12);

test('PMON allocates four adjacent pairs, steals and releases both physical voices under one owner',async t=>{
  const {instrument,core}=await setup(t);instrument.loadPreset(pmonPreset());
  for(let index=0;index<4;index++)assert.deepEqual(instrument.noteOn(`n${index}`,60+index),{channel:1+index*2,stolenId:null});
  const paired=instrument.read();assert.equal(paired.capacity,4);assert.deepEqual(paired.pmonRegisters,{mask:0xaa});
  assert.deepEqual(paired.voices.map(v=>[v.modulatorChannel,v.channel]),[[0,1],[2,3],[4,5],[6,7]]);
  assert.equal(core.readDsp(0x4c),255);assert.equal(core.readDsp(0x5c),0);
  render(instrument,512);assert.deepEqual(instrument.noteOn('new',72),{channel:1,stolenId:'n0'});
  assert.equal(instrument.noteOff('n0'),false);assert.equal(instrument.read().voices.length,4);
  instrument.noteOff('n2');assert.equal(core.readDsp(0x5c)&0x30,0x30);
  assert.deepEqual(instrument.noteOn('reused',64),{channel:5,stolenId:null},'a released pair is preferred over a held pair');
  assert.equal(instrument.noteOff('n2'),false);assert.equal(core.readDsp(0x5c)&0x30,0);
  for(const id of ['new','n1','n3','reused'])instrument.noteOff(id);
  assert.equal(core.readDsp(0x5c),255);assert.equal(instrument.read().voices.length,0);
  render(instrument,1024);assert.equal(instrument.read().tails.length,0);
  assert(instrument.read().registers.every(reg=>reg[8]===0));assert.equal(peak(render(instrument,128).left),0);
});

test('paired BRR PMON equals manual S-DSP stereo setup with Echo and arbitrary render partitions',async t=>{
  const a=await setup(t),b=await setup(t),rawCore=await create(),raw=new SnesSynth({core:rawCore});t.after(()=>raw.dispose());
  const p=pmonPreset({enabled:true,delay:2,feedback:-37,volumeLeft:55,volumeRight:-40,fir:[100,20,-10,5,0,0,0,0]});
  const carrierBytes=encodeBrr(Float32Array.from(waveShape('triangle')),{loopStartSamples:0}).brr;
  p.source='brr';p.brr={name:'Authored triangle',data:encodeBase64(carrierBytes),rootNote:57,basePitch:2048,loopStartSamples:0};
  p.volume={left:20,right:-16};p.pmon.ratio=1.5;p.pmon.wave=waveShape('saw');p.pmon.envelope.gainLevel=87;
  a.instrument.loadPreset(p);b.instrument.loadPreset(p);a.instrument.setPitch(-2);b.instrument.setPitch(-2);
  const {send,...echo}=p.echo;raw.setEcho({...echo,sendMask:send?0xaa:0});
  const carrier=raw.loadBRR(carrierBytes,{rootNote:57,basePitch:2048,loopStartSamples:0});
  const modulator=raw.loadBRR(encodeBrr(Float32Array.from(p.pmon.wave),{loopStartSamples:0}).brr,{baseFrequencyHz:250,loopStartSamples:0});
  const mainEnv=envelopeRegisters(p),modEnv=modulatorEnvelopeRegisters(p),notes=[48,55,60,67];
  for(let pair=0;pair<4;pair++) {
    const midi=notes[pair],mod=pair*2,ch=mod+1;
    raw.setPreset(mod,{sample:modulator,...modEnv,volumeLeft:0,volumeRight:0,pitch:pitchAt(frequencyAt(midi-2)*1.5)});
    raw.setPreset(ch,{sample:carrier,...mainEnv,volumeLeft:20,volumeRight:-16,pitch:Math.max(1,Math.min(0x3fff,Math.round(2048*2**((midi-2-57)/12))))});
    raw.keyOn(mod);raw.keyOn(ch);a.instrument.noteOn(`n${pair}`,midi);b.instrument.noteOn(`n${pair}`,midi);
  }
  raw.writeDsp(0x2d,0xaa);raw.writeDsp(0x3d,0);
  const actual=render(a.instrument,12000),expected=render(raw,12000),partitioned={left:new Float32Array(12000),right:new Float32Array(12000)};
  assert.deepEqual(actual,expected);assert(actual.left.every(Number.isFinite));assert(peak(actual.left)>.05);
  for(let offset=0;offset<12000;offset+=17)b.instrument.renderInto(partitioned.left,partitioned.right,Math.min(17,12000-offset),offset);
  assert.deepEqual(partitioned,actual);assert.deepEqual(b.instrument.read(),a.instrument.read());
  assert.equal(a.instrument.read().echo.sendMask,0xaa);assert.equal(raw.readDsp(0x4d),0xaa);
});

test('zero-volume modulators still change carrier pitch while contributing neither dry audio nor Echo',async t=>{
  const modulated=await setup(t),flat=await setup(t),silent=await setup(t);
  const p=pmonPreset({enabled:true,delay:1,feedback:64,volumeLeft:64,volumeRight:64});
  modulated.instrument.loadPreset(p);p.pmon.envelope.gainLevel=0;flat.instrument.loadPreset(p);
  p.pmon.envelope.gainLevel=100;p.volume={left:0,right:0};silent.instrument.loadPreset(p);
  for(const entry of [modulated,flat,silent])entry.instrument.noteOn('test',60);
  const output=render(modulated.instrument,4096),baseline=render(flat.instrument,4096);
  assert.notDeepEqual(output,baseline,'modulator GAIN changes the pre-volume PMON signal');
  assert.equal(peak(render(silent.instrument,8192).left),0);assert.equal(peak(render(silent.instrument,512).right),0);
  const state=modulated.instrument.read();
  for(const channel of [0,2,4,6])assert.deepEqual(state.registers[channel].slice(0,2),[0,0]);
  assert(state.registers[0][8]>0);assert.notEqual(modulated.core.readDsp(9),0,'OUTX remains active before the zero L/R volumes');
  const mute=modulated.instrument.read().preset;mute.echo.send=false;modulated.instrument.setPreset(mute);assert.equal(modulated.core.readDsp(0x4d),0);
});

test('PMON ratio, envelope and Pitch edits preserve modulator phase, owners, generations and RAM',async t=>{
  const a=await setup(t),reference=await setup(t),p=pmonPreset();
  for(const entry of [a,reference]){entry.instrument.loadPreset(p);entry.instrument.noteOn('held',60);}
  assert.deepEqual(render(a.instrument,777),render(reference.instrument,777));
  const before=a.instrument.read(),memory=a.core.snapshot().ram;
  p.pmon.ratio=2.5;p.pmon.envelope.gainLevel=33;a.instrument.setPreset(p);
  reference.instrument.synth.setPitch(0,pitchAt(frequencyAt(60)*2.5));
  reference.instrument.synth.setPreset(0,modulatorEnvelopeRegisters(p));
  const edited=a.instrument.read();assert.deepEqual(edited.voices,before.voices);assert.equal(edited.generation,before.generation);
  assert.equal(edited.nativeFrames,777);assert.deepEqual(a.core.snapshot().ram,memory);assert.equal(edited.registers[0][8],before.registers[0][8]);
  assert.deepEqual(render(a.instrument,4096),render(reference.instrument,4096),'live changes keep the existing oscillator and envelope state');
  a.instrument.setPitch(3.25);reference.instrument.synth.setPitch(0,pitchAt(frequencyAt(63.25)*2.5));reference.instrument.synth.setPitch(1,pitchAt(frequencyAt(63.25)));
  assert.deepEqual(render(a.instrument,4096),render(reference.instrument,4096));
  const tuned=a.instrument.read();assert.equal(tuned.registers[0][2]|tuned.registers[0][3]<<8,pitchAt(frequencyAt(63.25)*2.5));
  assert.equal(tuned.registers[1][2]|tuned.registers[1][3]<<8,pitchAt(frequencyAt(63.25)));assert.equal(tuned.generation,before.generation);
});

test('modulator ADSR and GAIN run independently from the audible carrier envelope',async t=>{
  const {instrument}=await setup(t),p=pmonPreset();
  p.pmon.envelope={...p.pmon.envelope,mode:'adsr',attack:8,decay:0,sustainLevel:7,sustainRate:0};
  instrument.loadPreset(p);instrument.noteOn('held',60);render(instrument,256);
  const initial=instrument.read();assert(initial.registers[0][8]>0&&initial.registers[0][8]<127);assert.equal(initial.registers[1][8],127);
  render(instrument,6000);assert(instrument.read().registers[0][8]>initial.registers[0][8]);
  p.pmon.envelope.mode='gain';p.pmon.envelope.gainMode='linear-decrease';p.pmon.envelope.gainRate=31;
  instrument.setPreset(p);render(instrument,512);assert.equal(instrument.read().registers[0][8],0);assert.equal(instrument.read().registers[1][8],127);
  p.pmon.envelope.gainMode='linear-increase';instrument.setPreset(p);render(instrument,512);assert.equal(instrument.read().registers[0][8],127);
  p.pmon.envelope.gainMode='exponential-decrease';instrument.setPreset(p);render(instrument,512);assert(instrument.read().registers[0][8]<127);
  assert.deepEqual(instrument.read().voices,initial.voices);assert.equal(instrument.generation,initial.generation);
});

test('Noise remembers inactive PMON drafts without resets and restores paired allocation on returning to Wave',async t=>{
  const {instrument}=await setup(t),p=noisePreset();p.pmon.enabled=true;instrument.loadPreset(p);instrument.noteOn('noise',60);render(instrument,512);
  const noise=instrument.read();assert.equal(noise.capacity,8);assert.deepEqual(noise.pmon,{enabled:true,active:false,ratio:1});
  assert.deepEqual(noise.pmonRegisters,{mask:0});assert.equal(noise.modulatorSample,null);assert.equal(instrument.synth.samples.length,1);
  p.pmon.ratio=4;p.pmon.wave=waveShape('square');p.pmon.envelope.gainLevel=20;instrument.setPreset(p);
  assert.deepEqual(instrument.read().voices,noise.voices);assert.equal(instrument.generation,noise.generation);assert.equal(instrument.read().nativeFrames,512);
  p.source='wave';instrument.setPreset(p);let state=instrument.read();
  assert(state.generation>noise.generation);assert.equal(state.voices.length,0);assert.equal(state.capacity,4);assert.equal(state.pmonRegisters.mask,0xaa);
  assert.equal(state.pmon.ratio,4);assert.equal(instrument.synth.samples.length,2);
  instrument.noteOn('wave',60);render(instrument,512);const paired=instrument.read();
  p.pmon.wave=waveShape('triangle');instrument.setPreset(p);state=instrument.read();assert(state.generation>paired.generation);assert.equal(state.voices.length,0);
  p.pmon.enabled=false;instrument.setPreset(p);state=instrument.read();assert.equal(state.capacity,8);assert.equal(state.pmonRegisters.mask,0);assert.equal(state.modulatorSample,null);
  instrument.noteOn('plain',60);render(instrument,512);const plain=instrument.read();p.pmon.wave=waveShape('saw');instrument.setPreset(p);
  assert.equal(instrument.generation,plain.generation);assert.deepEqual(instrument.read().voices,plain.voices);
});

test('PMON reserves exact BRR RAM in both layouts and rejects invalid edits before touching owners or DSP',async t=>{
  const {instrument,core}=await setup(t),p=pmonPreset();p.source='brr';
  for(const echo of [false,true]) {
    p.echo.enabled=echo;p.echo.delay=15;const budget=sampleBudget(p),bytes=new Uint8Array(budget);bytes[bytes.length-9]=3;
    p.brr={name:'Boundary loop',data:encodeBase64(bytes),rootNote:60,basePitch:4096,loopStartSamples:0};
    instrument.loadPreset(p);instrument.noteOn('held',60);render(instrument,12000);
    const state=instrument.read(),memory=core.snapshot().ram,start=echo?0x7c00:0x400,modulator=encodeBrr(Float32Array.from(p.pmon.wave),{loopStartSamples:0}).brr;
    assert.equal(state.memory.maxSampleBytes,budget);assert.equal(state.sample.startAddress,start);assert.equal(state.modulatorSample.startAddress,start+budget);
    assert.equal(state.modulatorSample.byteLength,72);assert.equal(instrument.synth.nextAddress,start+budget+72);assert(instrument.synth.nextAddress<=65536);
    assert.deepEqual(memory.slice(start,start+budget),bytes);assert.deepEqual(memory.slice(start+budget,start+budget+72),modulator);
    const directory=echo?0x7800:0;assert.deepEqual(memory.slice(directory,directory+8),Uint8Array.of(start&255,start>>8,start&255,start>>8,(start+budget)&255,(start+budget)>>8,(start+budget)&255,(start+budget)>>8));
    for(const mutate of [invalid=>{invalid.pmon.ratio=0;},invalid=>{invalid.pmon.ratio=NaN;},invalid=>{invalid.pmon.wave.pop();},invalid=>{invalid.pmon.envelope.attack=16;},invalid=>{invalid.brr.data=encodeBase64(new Uint8Array(budget+9));}]) {
      const invalid=structuredClone(p);mutate(invalid);assert.throws(()=>instrument.setPreset(invalid));assert.deepEqual(instrument.read(),state);assert.deepEqual(core.snapshot().ram,memory);
    }
  }
  const full=createDefaultPreset(),large=new Uint8Array(64512);large[large.length-9]=3;
  full.source='brr';full.brr={name:'Full dry bank',data:encodeBase64(large),rootNote:60,basePitch:4096,loopStartSamples:0};
  instrument.loadPreset(full);instrument.noteOn('full',60);render(instrument,256);const before=instrument.read(),ram=core.snapshot().ram;
  full.pmon.enabled=true;assert.throws(()=>instrument.setPreset(full),/72/);assert.deepEqual(instrument.read(),before);assert.deepEqual(core.snapshot().ram,ram);
});

test('PMON JSON and copied JavaScript use the existing hardware API and reproduce the native pair PCM',async t=>{
  const {instrument}=await setup(t),rawCore=await create(),raw=new SnesSynth({core:rawCore});t.after(()=>raw.dispose());
  const p=pmonPreset({enabled:true,delay:1,feedback:-30,volumeLeft:60,volumeRight:-24,fir:[100,20,-10,5,0,0,0,0]});
  p.pmon.ratio=2.25;p.pmon.wave=waveShape('triangle');p.pmon.envelope.gainLevel=77;p.volume={left:24,right:-20};
  const restored=readPreset(JSON.parse(JSON.stringify(p)));assert.deepEqual(restored,p);instrument.loadPreset(restored);instrument.noteOn('pair',60);
  const code=presetToCode(restored),AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  await new AsyncFunction('useSoundChip','pg',code)(async mode=>{assert.equal(mode,'snes');return raw;},{encodeBrr});
  assert.deepEqual(render(raw,12000),render(instrument,12000));assert.equal(raw.readDsp(0x2d),2);assert.equal(raw.readDsp(0x4d),2);
  const generation=instrument.generation;instrument.stop();assert(instrument.generation>generation);assert.equal(instrument.read().voices.length,0);
  assert.equal(peak(render(instrument,4096).left),0);assert.equal(instrument.read().pmonRegisters.mask,0xaa);
});

function brrPmonPreset(echo={}) {
  const p=pmonPreset(echo),encode=shape=>encodeBase64(encodeBrr(Float32Array.from(waveShape(shape)),{loopStartSamples:0}).brr);
  p.source='brr';p.brr={name:'Carrier loop',data:encode('triangle'),rootNote:60,basePitch:3072,loopStartSamples:0};
  p.pmon.source='brr';p.pmon.brr={name:'Modulator loop',data:encode('saw'),rootNote:60,basePitch:1234,loopStartSamples:16};
  return p;
}

test('captured BRR carrier / modulator PITCH and Echo match manual DSP setup and exported native PCM',async t=>{
  const {instrument}=await setup(t),manualCore=await create(),manual=new SnesSynth({core:manualCore}),exportCore=await create(),exported=new SnesSynth({core:exportCore});
  t.after(()=>manual.dispose());t.after(()=>exported.dispose());
  const p=brrPmonPreset({enabled:true,delay:2,feedback:-40,volumeLeft:52,volumeRight:-37,fir:[100,20,-10,5,0,0,0,0]});
  p.pmon.envelope.gainLevel=89;p.volume={left:25,right:-19};instrument.loadPreset(p);instrument.noteOn('capture',60);
  const {send,...echo}=p.echo;manual.setEcho({...echo,sendMask:send?0xaa:0});
  const sample=manual.loadBRR(Buffer.from(p.brr.data,'base64'),{rootNote:60,basePitch:3072,loopStartSamples:0});
  const modSample=manual.loadBRR(Buffer.from(p.pmon.brr.data,'base64'),{rootNote:60,basePitch:1234,loopStartSamples:16});
  for(let ch=0;ch<8;ch++)manual.setPreset(ch,ch%2===0
    ?{sample:modSample,...modulatorEnvelopeRegisters(p),volumeLeft:0,volumeRight:0,pitch:ch===0?1234:4096}
    :{sample,...envelopeRegisters(p),volumeLeft:25,volumeRight:-19,pitch:ch===1?3072:4096});
  manual.writeDsp(0x2d,0xaa);manual.keyOn(0);manual.keyOn(1);
  const code=presetToCode(readPreset(JSON.parse(JSON.stringify(p)))),AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  await new AsyncFunction('useSoundChip','pg',code)(async()=>exported,{encodeBrr(){throw Error('Imported BRR assets must not be re-encoded');}});
  const state=instrument.read();assert.equal(state.registers[0][2]|state.registers[0][3]<<8,1234);assert.equal(state.registers[1][2]|state.registers[1][3]<<8,3072);
  assert.equal(state.modulatorSample.loopStartSamples,16);assert.equal(state.modulatorSample.basePitch,1234);
  const pcm=render(instrument,12000);assert(pcm.left.every(Number.isFinite));assert(peak(pcm.left)>.01);
  assert.deepEqual(render(manual,12000),pcm);assert.deepEqual(render(exported,12000),pcm);
});

test('BRR modulator root, base PITCH and ratio tune held pairs without resetting native phase or RAM',async t=>{
  const a=await setup(t),reference=await setup(t),p=brrPmonPreset();
  for(const entry of [a,reference]){entry.instrument.loadPreset(p);entry.instrument.noteOn('held',60);}
  assert.deepEqual(render(a.instrument,777),render(reference.instrument,777));const before=a.instrument.read(),ram=a.core.snapshot().ram;
  p.pmon.brr.rootNote=48;p.pmon.brr.basePitch=1700;p.pmon.ratio=1.5;a.instrument.setPreset(p);reference.instrument.synth.setPitch(0,5100);
  const edited=a.instrument.read();assert.equal(edited.generation,before.generation);assert.equal(edited.nativeFrames,before.nativeFrames);assert.deepEqual(edited.voices,before.voices);assert.deepEqual(a.core.snapshot().ram,ram);
  assert.equal(edited.modulatorSample.rootNote,48);assert.equal(edited.modulatorSample.basePitch,1700);assert.equal(a.instrument.synth.samples[edited.modulatorSample.id].basePitch,1700);
  assert.deepEqual(render(a.instrument,4096),render(reference.instrument,4096));
  a.instrument.setPitch(-3);const modPitch=Math.round(1700*2**((57-48)/12)*1.5),mainPitch=Math.round(3072*2**(-3/12));
  reference.instrument.synth.setPitch(0,modPitch);reference.instrument.synth.setPitch(1,mainPitch);
  assert.deepEqual(render(a.instrument,4096),render(reference.instrument,4096));
  const last=a.instrument.read();assert.equal(last.registers[0][2]|last.registers[0][3]<<8,modPitch);assert.equal(last.registers[1][2]|last.registers[1][3]<<8,mainPitch);
});

test('empty modulator BRR is a silent editable draft and missing samples reject notes before DSP mutation',async t=>{
  const {instrument,core}=await setup(t),p=pmonPreset();p.pmon.source='brr';instrument.loadPreset(p);
  const state=instrument.read(),ram=core.snapshot().ram;assert.equal(state.modulatorSample,null);assert.equal(instrument.synth.samples.length,1);
  assert.throws(()=>instrument.noteOn('empty',60),/modulator BRR/);assert.deepEqual(instrument.read(),state);assert.deepEqual(core.snapshot().ram,ram);
  assert.equal(peak(render(instrument,512).left),0);assert.throws(()=>presetToCode(p),/modulator BRR/);
  p.source='noise';instrument.setPreset(p);instrument.noteOn('noise',60);assert(peak(render(instrument,512).left)>.01);assert.equal(instrument.read().modulatorSample,null);
  p.source='wave';p.pmon.enabled=false;instrument.setPreset(p);instrument.noteOn('wave',60);assert(peak(render(instrument,512).left)>.01);
  const bytes=encodeBrr(Float32Array.from(waveShape('square')),{loopStartSamples:0}).brr;
  p.pmon.enabled=true;p.pmon.brr={name:'Ready',data:encodeBase64(bytes),rootNote:60,basePitch:4096,loopStartSamples:0};
  instrument.setPreset(p);instrument.noteOn('pair',60);assert(peak(render(instrument,512).left)>.01);assert.equal(instrument.read().capacity,4);
});

test('BRR modulator bank edits replace pairs while inactive waves and source drafts preserve held owners',async t=>{
  const {instrument}=await setup(t),p=brrPmonPreset();instrument.loadPreset(p);instrument.noteOn('held',60);render(instrument,256);
  const before=instrument.read();p.pmon.wave=waveShape('square');p.pmon.brr.name='Renamed';instrument.setPreset(p);
  assert.equal(instrument.generation,before.generation);assert.deepEqual(instrument.read().voices,before.voices);
  p.pmon.brr.loopStartSamples=0;instrument.setPreset(p);assert(instrument.generation>before.generation);assert.equal(instrument.read().voices.length,0);
  instrument.noteOn('new',60);render(instrument,256);const looped=instrument.generation;p.pmon.source='wave';instrument.setPreset(p);
  assert(instrument.generation>looped);assert.equal(instrument.read().modulatorSample.byteLength,72);assert.equal(instrument.read().voices.length,0);
  p.source='noise';instrument.setPreset(p);instrument.noteOn('noise',60);render(instrument,256);const noise=instrument.read();
  p.pmon.source='brr';p.pmon.brr.data='';p.pmon.brr.loopStartSamples=null;instrument.setPreset(p);
  assert.equal(instrument.generation,noise.generation);assert.deepEqual(instrument.read().voices,noise.voices);
});

test('variable BRR modulator banks fill dry / Echo RAM safely and over-budget pairs fail atomically',async t=>{
  const {instrument,core}=await setup(t),p=pmonPreset();p.pmon.source='brr';
  for(const [echo,total,start,directory]of[[false,64512,0x400,0],[true,33786,0x7c00,0x7800]]) {
    p.echo.enabled=echo;p.echo.delay=15;const bytes=new Uint8Array(total-72);bytes[bytes.length-9]=3;
    p.pmon.brr={name:'RAM boundary modulator',data:encodeBase64(bytes),rootNote:60,basePitch:1234,loopStartSamples:0};
    instrument.loadPreset(p);instrument.noteOn('held',60);render(instrument,12000);const state=instrument.read(),ram=core.snapshot().ram;
    const carrier=encodeBrr(Float32Array.from(p.wave),{loopStartSamples:0}).brr;
    assert.equal(state.memory.maxSampleBytes,72);assert.equal(state.sample.startAddress,start);assert.equal(state.modulatorSample.startAddress,start+72);
    assert.equal(instrument.synth.nextAddress,start+total);assert.deepEqual(ram.slice(start,start+72),carrier);assert.deepEqual(ram.slice(start+72,start+total),bytes);
    assert.deepEqual(ram.slice(directory+4,directory+8),Uint8Array.of((start+72)&255,(start+72)>>8,(start+72)&255,(start+72)>>8));
    const tooLarge=new Uint8Array(total-63);tooLarge[tooLarge.length-9]=3;const invalid=structuredClone(p);invalid.pmon.brr.data=encodeBase64(tooLarge);
    assert.throws(()=>instrument.setPreset(invalid),/PMON reserves/);assert.deepEqual(instrument.read(),state);assert.deepEqual(core.snapshot().ram,ram);
    invalid.pmon.brr.data=p.pmon.brr.data;invalid.pmon.brr.basePitch=0;assert.throws(()=>instrument.setPreset(invalid));assert.deepEqual(instrument.read(),state);assert.deepEqual(core.snapshot().ram,ram);
  }
});
