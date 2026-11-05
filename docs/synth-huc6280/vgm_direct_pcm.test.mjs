// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {Huc6280Instrument} from './instrument.js';
import {decodeDdaData} from './dda_pcm.js';
import {extractVgmDirectPcm} from './vgm_direct_pcm.js';
const w=(register,value)=>[0xb9,register,value];
const wait=(samples=4)=>[0x61,samples&255,samples>>>8];
const u32=value=>[value&255,value>>>8&255,value>>>16&255,value>>>24&255];
const hardware=(channel=0,{volume=25,pan=247}={})=>[...w(1,255),...w(9,0),...w(0,channel),...w(4,0),...w(5,pan),...(channel>=4?w(7,0):[]),...w(4,192|volume)];
const codes=[0,31,8,23];
const writes=(data=codes,spacing=4)=>data.flatMap(value=>[...w(6,value),...wait(spacing)]);
const region=(data=codes,spacing=4,channel=0)=>[...hardware(channel),...writes(data,spacing),...w(4,0)];
function vgm(commands) {
  const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x34,0xcc,true);view.setUint32(0xa4,3579545,true);bytes.set(commands,256);return bytes;
}
const run=commands=>extractVgmDirectPcm(vgm([...commands,0x66]));
const samples=voice=>[...decodeDdaData(voice.preset.dda.data)];

test('explicit direct DDA regions retain five-bit samples, exact timing, channel mix and portable controls',async()=>{
  const result=await run(region([0xe0,0xff,0x88,0x37],4,2));assert.equal(result.voices.length,1);
  const voice=result.voices[0];assert.deepEqual(samples(voice),codes);
  assert.deepEqual([voice.kind,voice.origin,voice.channel,voice.firstTime,voice.occurrences],['pcm','direct',3,0,1]);
  assert.equal(voice.preset.dda.sampleRate,11025);assert.equal(voice.preset.dda.rootNote,60);
  assert.equal(voice.preset.dda.speed,1);assert.equal(voice.preset.dda.loop,false);assert.equal(voice.preset.envelope.enabled,false);
  assert.equal(voice.preset.volume,25);assert.deepEqual(voice.preset.pan,{left:15,right:7});
});

test('fractional rates preserve VGM time rather than rounding the keyboard pitch',async()=>{
  for(const spacing of [3,4,6,8,13]) {
    const result=await run(region(codes,spacing));assert.equal(result.voices.length,1);
    assert.equal(result.voices[0].preset.dda.sampleRate,44100/spacing);
    assert(Math.abs(samples(result.voices[0]).length/result.voices[0].preset.dda.sampleRate-codes.length*spacing/44100)<1e-16);
  }
});

test('same-time writes keep their last audible value, and terminal zero-duration writes are excluded',async()=>{
  const result=await run([...hardware(),...w(6,30),...w(6,0),...wait(),...w(6,31),...wait(),
    ...w(6,8),...wait(),...w(6,23),...wait(),...w(6,16),...w(4,0),...wait()]);
  assert.deepEqual(samples(result.voices[0]),codes);
  const cleared=await run([...hardware(),...writes(),...w(4,0),...w(6,31),...wait()]);
  assert.deepEqual(samples(cleared.voices[0]),codes);
});

test('DAC writes before DDA activation are not reclassified as PCM by timestamp batching',async()=>{
  const result=await run([...w(1,255),...w(9,0),...w(0,0),...w(4,0),...w(5,247),
    ...w(6,0),...w(4,217),...wait(),...writes([31,8,23]),...w(4,0)]);
  assert.equal(result.voices.length,0);assert.match(result.warnings.join(' '),/initial direct DAC|initial DAC/);
});

test('explicit closure is required; irregular waits, long tails and short clips are not guessed into samples',async()=>{
  const fixtures=[
    [...hardware(),...writes()],
    [...hardware(),...w(6,0),...wait(),...w(6,31),...wait(5),...w(6,8),...wait(),...w(4,0)],
    [...hardware(),...writes(),...wait(100),...w(4,0)],
    [...hardware(),...writes([0,31]),...w(4,0)],
    [...hardware(),...writes(codes,0),...w(4,0)],
  ];
  for(const commands of fixtures){const result=await run(commands);assert.equal(result.voices.length,0);assert(result.warnings.length);}
  const constant=await run(region([32,64,96]));assert.equal(constant.voices.length,0);assert.match(constant.warnings.join(' '),/constant/);
});

test('gate-off with DDA held, DDA clear with key held, and same-time retriggers close distinct regions',async()=>{
  for(const end of [25,64|25,128|25]) {
    const result=await run([...hardware(),...writes(),...w(4,end)]);assert.deepEqual(samples(result.voices[0]),codes);
  }
  const result=await run([...region(),...hardware(),...writes(),...w(4,0)]);
  assert.equal(result.voices.length,1);assert.equal(result.voices[0].occurrences,2);
});

test('concurrent direct channels retain independent clocks, exact first times and write order',async()=>{
  const result=await run([...hardware(0),...w(6,0),...hardware(2),...w(6,0),...wait(),
    ...w(0,0),...w(6,31),...w(0,2),...w(6,31),...wait(),
    ...w(0,0),...w(6,8),...w(0,2),...w(6,8),...wait(),
    ...w(0,0),...w(4,0),...w(0,2),...w(4,0)]);
  assert.equal(result.voices.length,1,'identical samples and channel mix share a portable sound');
  assert.equal(result.voices[0].occurrences,2);assert.deepEqual(samples(result.voices[0]),[0,31,8]);
  const delayed=await run([...wait(7),...region()]);assert.equal(delayed.voices[0].firstTime,7);
});

test('unknown, muted, LFO and Noise intervals cannot be mistaken for independent direct PCM',async()=>{
  for(const commands of [
    [...w(0,0),...w(4,217),...writes(),...w(4,0)],
    [...hardware(0,{volume:0}),...writes(),...w(4,0)],
    [...hardware(0,{pan:0}),...writes(),...w(4,0)],
    [...hardware(),...w(9,1),...writes(),...w(4,0)],
    [...hardware(4),...w(7,128),...writes(),...w(4,0)],
  ]){const result=await run(commands);assert.equal(result.voices.length,0);assert(result.warnings.length);}
});

test('audible configuration changes reject the whole region, but zero-time restored settings do not',async()=>{
  for(const change of [w(4,216),w(5,255),w(1,254),w(9,1)]) {
    const result=await run([...hardware(),...writes([0,31]),...change,...writes([8,23]),...w(4,0)]);
    assert.equal(result.voices.length,0);assert(result.warnings.length);
  }
  const restored=await run([...hardware(),...w(6,0),...wait(),...w(5,0),...w(5,247),...writes([31,8,23]),...w(4,0)]);
  assert.deepEqual(samples(restored.voices[0]),codes);
  const terminal=await run([...hardware(),...writes(),...w(5,0),...w(4,0)]);
  assert.deepEqual(samples(terminal.voices[0]),codes,'zero-duration terminal mix changes do not change prior audio');
});

test('streams overlapping direct PCM are rejected, and explicit empty streams do not claim writes',async()=>{
  const setup=(register=6,port=0)=>[0x90,0,0x1b,port,register,0x92,0,...u32(11025)];
  const start=count=>[0x93,0,...u32(0),1,...u32(count)];
  for(const config of [[6,0],[6,255],[1,0],[0x16,0]]) {
    const result=await run([...hardware(),...setup(...config),...start(999),...writes(),...w(4,0)]);
    assert.equal(result.voices.length,0);assert(result.warnings.length);
  }
  const empty=await run([...hardware(),...setup(),...start(0),...writes(),...w(4,0)]);
  assert.deepEqual(samples(empty.voices[0]),codes);
  const stopped=await run([...setup(),...start(999),0x94,255,...region()]);
  assert.deepEqual(samples(stopped.voices[0]),codes);
});

test('stream-written unknown settings remain unknown after stop until direct initialization',async()=>{
  const stream=[0x90,0,0x1b,0,5,0x92,0,...u32(11025),0x93,0,...u32(0),0x81,...u32(999)];
  const result=await run([...hardware(),...stream,...wait(),0x94,0,...w(4,0),...w(4,217),...writes(),...w(4,0),...region(codes,4,2)]);
  assert.equal(result.voices.length,1);assert.equal(result.voices[0].channel,3);
  assert.match(result.warnings.join(' '),/balance/);
});

test('direct PCM preserves fractional rates and integer VGM boundaries through actual WASM',async()=>{
  for(const spacing of [6,8]) {
  const source=[0,31,8,23,16],result=await run(region(source,spacing));
  const wasmBinary=await readFile(new URL('../generated/huc6280_wasm.wasm',import.meta.url));
  const create=()=>Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:44100,masterVolume:1});
  const [core,oracle]=await Promise.all([create(),create()]);const instrument=new Huc6280Instrument(core);
  try {
    instrument.loadPreset(result.voices[0].preset);instrument.noteOn('timed',60);
    oracle.writeHuc6280(1,255);oracle.writeHuc6280(0,0);oracle.writeHuc6280(5,247);oracle.writeHuc6280(4,217);
    const frames=source.length*spacing+16,left=new Float32Array(frames),right=new Float32Array(frames);
    for(let frame=0;frame<frames;frame++) {
      if(frame<source.length*spacing&&frame%spacing===0)oracle.writeHuc6280(6,source[frame/spacing]);
      if(frame===source.length*spacing){oracle.writeHuc6280(4,89);oracle.writeHuc6280(6,16);}
      const pcm=oracle.processFrames(1);left[frame]=pcm.left[0];right[frame]=pcm.right[0];
    }
    assert.deepEqual(instrument.generateStereo(frames),{left,right});
  }finally{instrument.dispose();oracle.dispose();}
  }
});

test('malformed input, second-chip writes and cancellation are rejected without partial assets',async()=>{
  await assert.rejects(extractVgmDirectPcm(vgm([0xb9,0])),/Truncated/);
  await assert.rejects(run([0xb9,128,0]),/Second HuC6280/);
  await assert.rejects(run([0x90,0,0x9b,0,6]),/Second HuC6280/);
  await assert.rejects(run([0x67,0,5,0,0,0,0]),/block header/);
  const before=new AbortController();before.abort();await assert.rejects(extractVgmDirectPcm(vgm([0x66]),{signal:before.signal}),{name:'AbortError'});
  const during=new AbortController();setTimeout(()=>during.abort(),0);
  await assert.rejects(extractVgmDirectPcm(vgm([...Array(20000).fill(0x70),0x66]),{signal:during.signal}),{name:'AbortError'});
});


test('DDA-region and unique-asset floods have explicit bounds',async()=>{
  const activations=[];for(let index=0;index<100001;index++)activations.push(...w(4,217),...w(4,0));
  await assert.rejects(run([...w(0,0),...activations]),/100,000 DDA regions/);
  const definitions=[];for(let spacing=1;spacing<=4097;spacing++)definitions.push(...region([0,31,8],spacing));
  await assert.rejects(run(definitions),/4,096 different assets/);
});
