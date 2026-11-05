// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {Huc6280Instrument} from './instrument.js';
import {decodeDdaData} from './dda_pcm.js';
import {extractVgmDacStreams} from './vgm_dac.js';
const u32=value=>[value&255,value>>>8&255,value>>>16&255,value>>>24&255];
const w=(register,value)=>[0xb9,register,value];
const wait=(samples=1000)=>[0x61,samples&255,samples>>>8];
const block=(data,type=5)=>[0x67,0x66,type,...u32(data.length),...data];
const setup=(id=0,channel=0,rate=11025,step=1,base=0,bank=5,register=6)=>[
  0x90,id,0x1b,channel,register,0x91,id,bank,step,base,0x92,id,...u32(rate)];
const start=(count=4,{id=0,offset=0,mode=1}={})=>[0x93,id,...u32(offset),mode,...u32(count)];
const hardware=(channel=0,{volume=25,pan=247}={})=>[...w(1,255),...w(9,0),...w(0,channel),...w(5,pan),...(channel>=4?w(7,0):[]),...w(4,192|volume)];
const data=[0,31,8,23];
function vgm(commands) {
  const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x34,0xcc,true);view.setUint32(0xa4,3579545,true);bytes.set(commands,256);return bytes;
}
const run=commands=>extractVgmDacStreams(vgm([...commands,0x66]));
const samples=voice=>[...decodeDdaData(voice.preset.dda.data)];

test('explicit DAC sample counts recover exact five-bit values, rate, level and pan',async()=>{
  const result=await run([...hardware(),...block([0xe0,0xff,0x88,0x37]),...setup(0,0,7000),...start(),...wait()]);
  assert.equal(result.voices.length,1);const voice=result.voices[0];
  assert.deepEqual(samples(voice),data);assert.equal(voice.kind,'pcm');assert.equal(voice.channel,1);
  assert.equal(voice.firstTime,0);assert.equal(voice.occurrences,1);assert.equal(voice.preset.source,'dda');
  assert.equal(voice.preset.dda.sampleRate,7000);assert.equal(voice.preset.dda.rootNote,60);assert.equal(voice.preset.dda.speed,1);
  assert.equal(voice.preset.dda.loop,false);assert.equal(voice.preset.envelope.enabled,false);
  assert.equal(voice.preset.volume,25);assert.deepEqual(voice.preset.pan,{left:15,right:7});
});

test('step and base cross bank blocks, fast block IDs, reverse and Loop retain exact values',async()=>{
  const result=await run([...hardware(),...block([99,0,99,31]),...block([99,8,99,23]),...setup(0,0,11025,2,1),
    ...start(),...wait(),...start(4,{mode:0x91}),...wait(),0x94,0,
    0x95,0,1,0,0x11,...wait(),0x94,0]);
  assert.deepEqual(result.voices.map(samples),[data,[...data].reverse(),[23,8]]);
  assert.deepEqual(result.voices.map(v=>v.preset.dda.loop),[false,true,true]);
});

test('length modes: milliseconds, end of bank, and previous effective start / count',async()=>{
  const result=await run([...hardware(),...block([16,16,...data]),...setup(0,0,1000,1,1),
    ...start(4,{offset:1,mode:2}),...wait(),
    ...start(99,{offset:0xffffffff,mode:0}),...wait(),
    ...start(0,{offset:1,mode:3}),...wait()]);
  assert.equal(result.voices.length,1);assert.deepEqual(samples(result.voices[0]),data);
  assert.equal(result.voices[0].occurrences,3);assert.equal(result.voices[0].preset.dda.sampleRate,1000);
  const missing=await run([...hardware(),...block(data),...setup(),...start(0,{mode:0}),...wait()]);
  assert.equal(missing.voices.length,0);assert.match(missing.warnings.join(' '),/previous command count/);
});

test('first write requires a positive wait; stop one frame before / at last write is handled exactly',async()=>{
  for(const [delay,expected] of [[0,0],[11,0],[12,1]]) {
    const result=await run([...hardware(),...block(data),...setup(),...start(),...wait(delay),0x94,0,...wait()]);
    assert.equal(result.voices.length,expected,`stop at ${delay} frames`);
  }
  const cut=await run([...hardware(),...block(data),...setup(),...start(),...wait(11)]);
  assert.equal(cut.voices.length,0);assert.match(cut.warnings.join(' '),/ends before/);
});

test('restarts and duplicate assets count uses without fabricating interrupted full samples',async()=>{
  const result=await run([...hardware(),...block(data),...setup(),...start(),...wait(5),
    ...start(),...wait(),...start(),...wait()]);
  assert.equal(result.voices.length,1);assert.equal(result.voices[0].occurrences,2);
  assert.match(result.warnings.join(' '),/restarted/);
});

test('data blocks only exist after their command; missing / short / compressed banks never invent PCM',async()=>{
  for(const commands of [
    [...setup(),...start(),...block(data)],
    [...block(data.slice(0,3)),...setup(),...start()],
    [...block([1,2],0x45),...block(data),...setup(),0x95,0,0,0,0],
    [...block(data),...setup(),0x95,0,9,0,0],
  ]) {
    const result=await run([...hardware(),...commands,...wait()]);assert.equal(result.voices.length,0);assert(result.warnings.length);
  }
  const valid=await run([...hardware(),...block(data,2),...setup(0,0,11025,1,0,2),...start(),...wait()]);
  assert.deepEqual(samples(valid.voices[0]),data);
});

test('stream config changes, direct writes, and incomplete Loop cycles are omitted',async()=>{
  const changes=[w(4,192|20),w(5,255),w(6,31),w(1,0xdd),w(9,1),[0x92,0,...u32(8000)],[0x91,0,5,2,0]];
  for(const change of changes) {
    const result=await run([...hardware(),...block(data),...setup(),...start(),...wait(4),...change,...wait()]);
    assert.equal(result.voices.length,0,JSON.stringify(change));assert.match(result.warnings.join(' '),/omitted/);
  }
  const loop=await run([...hardware(),...block(data),...setup(),...start(4,{mode:129}),...wait(4),0x94,255]);
  assert.equal(loop.voices.length,0);assert.match(loop.warnings.join(' '),/stopped before/);
});

test('overlapping streams on one channel are omitted while independent channels survive',async()=>{
  const result=await run([...hardware(),...hardware(2),...block(data),...setup(),...setup(1,0),...setup(2,2),
    ...start(),...start(4,{id:1}),...start(4,{id:2}),...wait()]);
  assert.equal(result.voices.length,1);assert.equal(result.voices[0].channel,3);
  assert.match(result.warnings.join(' '),/overlap/);
});

test('known DDA / balance / audibility and no competing LFO / Noise are required',async()=>{
  for(const extra of [w(4,128|25),w(4,192),w(5,0),w(9,1)]) {
    const result=await run([...hardware(),...extra,...block(data),...setup(),...start(),...wait()]);
    assert.equal(result.voices.length,0);assert(result.warnings.length);
  }
  const noise=await run([...hardware(4),...w(7,128),...block(data),...setup(0,4),...start(),...wait()]);
  assert.equal(noise.voices.length,0);assert.match(noise.warnings.join(' '),/Noise/);
  const unknown=await run([...w(0,0),...w(4,217),...block(data),...setup(),...start(),...wait()]);
  assert.equal(unknown.voices.length,0);assert.match(unknown.warnings.join(' '),/balance/);
});

test('unsupported destinations and stream-written globals invalidate affected settings conservatively',async()=>{
  for(const [port,register] of [[255,6],[0,0x16],[0,1]]) {
    const result=await run([...hardware(),...block(data),...setup(0,port,11025,1,0,5,register),...start(),...wait()]);
    assert.equal(result.voices.length,0);assert.match(result.warnings.join(' '),/destination/);
  }
  const contaminated=await run([...hardware(),...block(data),...setup(0,0,11025,1,0,5,1),...start(4,{mode:129}),
    ...wait(1),...w(1,255),...setup(1),...start(4,{id:1}),...wait()]);
  assert.equal(contaminated.voices.length,0);assert.match(contaminated.warnings.join(' '),/global balance|same channel/);
});

test('unsupported but writing starts and changed stream timing cannot conceal later DAC conflicts',async()=>{
  const unsupported=[
    [...setup(0,0,200000),...start(4,{mode:129})],
    [...block([0],0x45),...setup(),...start(4,{mode:129})],
    [...setup(),...start(4,{mode:5})],
    [...setup(),0x95,0,0,0,2],
    [...block([0],0x45),...setup(),0x95,0,0,0,0],
  ];
  for(const commands of unsupported) {
    const result=await run([...hardware(),...block(data),...commands,...setup(1),...start(4,{id:1}),...wait()]);
    assert.equal(result.voices.length,0);assert.match(result.warnings.join(' '),/overlap|compressed/);
  }
  const changed=await run([...hardware(),...block(data),...setup(),...start(),...wait(4),
    0x92,0,...u32(1),...wait(100),...setup(1),...start(4,{id:1}),...wait()]);
  assert.equal(changed.voices.length,0);assert.match(changed.warnings.join(' '),/overlap/);
});

test('constant PCM is omitted and bank byte values are masked rather than scaled',async()=>{
  const result=await run([...hardware(),...block([0,32,64,96]),...setup(),...start(),...wait()]);
  assert.equal(result.voices.length,0);assert.match(result.warnings.join(' '),/constant/);
});

test('invalid ranges, flags, commands, second chip, missing previous starts and abort are bounded',async()=>{
  for(const commands of [
    [...setup(0,0,0),...start()], [...setup(0,0,192001),...start()],
    [...setup(),...start(4,{mode:5})],
    [...setup(),0x95,0,0,0,2],
    [...block([0],0x45),...setup(),0x95,0,0,0,0], [...setup(),...start(4,{offset:0xffffffff})],
    [...setup(),0x95,0,0,0,2], [...setup(),...start(0xffffffff)],
  ]) {
    const result=await run([...hardware(),...block(data),...commands,...wait()]);assert.equal(result.voices.length,0);assert(result.warnings.length);
  }
  await assert.rejects(run([0x90,0,0x9b,0,6]),/Second HuC6280/);
  await assert.rejects(extractVgmDacStreams(vgm([0x93,0,0])),/Truncated/);
  await assert.rejects(extractVgmDacStreams(vgm([0x67,0,5,0,0,0,0,0x66])),/block header/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(extractVgmDacStreams(vgm([0x66]),{signal:controller.signal}),{name:'AbortError'});
  const pending=extractVgmDacStreams(vgm([...Array(20000).fill(0x70),0x66]),{signal:(()=>{const c=new AbortController();setTimeout(()=>c.abort(),0);return c.signal;})()});
  await assert.rejects(pending,{name:'AbortError'});
});

test('extracted low-rate PCM at C4 matches direct timed DAC writes through real WASM',async()=>{
  const rate=7000,source=Uint8Array.from({length:47},(_,i)=>(i*7+i%3)&31);
  const result=await run([...hardware(),...block(source),...setup(0,0,rate),...start(source.length),...wait()]);
  const wasmBinary=await readFile(new URL('../generated/huc6280_wasm.wasm',import.meta.url));
  const create=()=>Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:48000,masterVolume:1});
  const [actualCore,expectedCore]=await Promise.all([create(),create()]);
  const instrument=new Huc6280Instrument(actualCore);
  try {
    instrument.loadPreset(result.voices[0].preset);instrument.noteOn('oracle',60);
    expectedCore.writeHuc6280(1,255);expectedCore.writeHuc6280(0,0);
    expectedCore.writeHuc6280(5,247);expectedCore.writeHuc6280(4,217);
    const frames=Math.floor((source.length-1)*48000/rate),left=new Float32Array(frames),right=new Float32Array(frames);
    let previous=-1,position=0;
    for(let frame=0;frame<frames;frame++) {
      const code=source[Math.floor(position)];position+=rate/48000;
      if(code!==previous){expectedCore.writeHuc6280(6,code);previous=code;}
      const output=expectedCore.processFrames(1);left[frame]=output.left[0];right[frame]=output.right[0];
    }
    const actual=instrument.generateStereo(frames);assert.deepEqual(actual.left,left);assert.deepEqual(actual.right,right);
  } finally {instrument.dispose();expectedCore.dispose();}
});

test('aggregate stream starts, definitions and extracted sample work have explicit bounds',async()=>{
  const startFlood=[];for(let i=0;i<100001;i++)startFlood.push(...start());
  await assert.rejects(run([...setup(),...startFlood]),/100,000 stream starts/);
  const definitionFlood=[];for(let i=0;i<4097;i++)definitionFlood.push(...start(2,{offset:i}),...wait(10));
  await assert.rejects(run([...hardware(),...block(new Uint8Array(4100)),...setup(),...definitionFlood]),/4,096/);
  const sampleFlood=[];for(let i=0;i<2048;i++)sampleFlood.push(...start(8193,{offset:i}),...wait(9000));
  await assert.rejects(run([...hardware(),...block(new Uint8Array(16384)),...setup(0,0,44100),...sampleFlood]),/16,777,216 extracted/);
});

test('empty block floods are bounded before allocating an unbounded chunk index',async()=>{
  const commands=[];for(let i=0;i<65537;i++)commands.push(...block([]));
  await assert.rejects(run(commands),/65,536 data bank blocks/);
});

test('many small extracted assets yield to cancellation after command parsing has finished',async()=>{
  const source=Uint8Array.from({length:128},(_,i)=>i&31),commands=[];
  for(let offset=0;offset<100;offset++)commands.push(...start(2,{offset}),...wait(10));
  const controller=new AbortController();setTimeout(()=>controller.abort(),0);
  await assert.rejects(extractVgmDacStreams(vgm([...hardware(),...block(source),...setup(),...commands,0x66]),
    {signal:controller.signal}),{name:'AbortError'});
});


test('forward / reverse stepped PCM matches a flat-byte oracle across empty and short bank chunks',async()=>{
  let seed=123456;
  const random=limit=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%limit;};
  for(let trial=0;trial<24;trial++) {
    const chunks=[],flat=[];
    for(let i=0;i<20;i++){const part=Array.from({length:random(5)},()=>random(256));chunks.push(...block(part));flat.push(...part);}
    const step=1+random(5),base=random(4),offset=random(3),reverse=Boolean(trial&1);
    const expected=[];for(let index=offset+base;index<flat.length;index+=step)expected.push(flat[index]&31);
    if(reverse)expected.reverse();
    const result=await run([...hardware(),...chunks,...setup(0,0,11025,step,base),...start(0,{offset,mode:3|(reverse?16:0)}),...wait()]);
    if(expected.some(code=>code!==expected[0]))assert.deepEqual(samples(result.voices[0]),expected);
    else assert.equal(result.voices.length,0);
  }
});

test('deduplicated uses preserve all reset / global-balance assumption notes',async()=>{
  const result=await run([...hardware(),...block(data),...setup(),...start(),...wait(),
    ...w(1,0xee),...start(),...wait()]);
  assert.equal(result.voices.length,1);assert.equal(result.voices[0].occurrences,2);
  assert.match(result.voices[0].warnings.join(' '),/Recorded global balance/);
});
