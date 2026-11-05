// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {Huc6280Instrument} from './instrument.js';
import {readPreset} from './preset.js';
import {decodeDdaData} from './dda_pcm.js';
import {extractVgmInstruments, MAX_VGM_BYTES} from './vgm_import.js';

const w = (register,value) => [0xb9,register,value];
const wait = (samples=1000) => [0x61,samples&255,samples>>8];
const wave = Array.from({length:32},(_,index)=>index);
const other = Array.from({length:32},(_,index)=>index<16?31:0);
const globals = [...w(1,255),...w(9,0)];
const upload = (channel=0,values=wave) => [...w(0,channel),...w(4,64),...w(4,0),...values.flatMap(value=>w(6,value))];
const play = (channel=0,volume=25,balance=255) => [...w(0,channel),...w(5,balance),...w(2,172),...w(3,1),...w(4,128|volume)];
const stop = channel => [...w(0,channel),...w(4,0)];
const noise = (channel=4,clock=16,volume=23) => [...w(0,channel),...w(5,255),...w(7,128|clock),...w(4,128|volume)];
function vgm(commands,clock=3579545) {
  const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x34,0xcc,true);view.setUint32(0xa4,clock,true);bytes.set(commands,256);return bytes;
}
const complete = () => vgm([...globals,...upload(),...play(),...wait(),...w(2,200),...wait(),...stop(0),
  ...upload(2,other),...play(2,20,247),...wait(),...stop(2),...noise(),...wait(),...stop(4),0x66]);

test('PCM-only VGM/VGZ and mixed libraries merge chronologically with portable exact-rate presets',async()=>{
  const data=[0xe0|16,255,0,23,8,16];
  const pcm=[0x67,0x66,5,data.length,0,0,0,...data,...w(0,0),...w(4,0xdf),...w(5,0xab),
    0x90,0,0x1b,0,6,0x91,0,5,1,0,0x92,0,0x58,0x1b,0,0,0x95,0,0,0,0,...wait(),0x94,0,...stop(0)];
  const only=await extractVgmInstruments(vgm([...globals,...pcm,0x66]));
  assert.equal(only.voices.length,1);const voice=only.voices[0];
  assert.deepEqual([voice.id,voice.kind,voice.channel,voice.firstTime],[1,'pcm',1,0]);
  assert.deepEqual([...decodeDdaData(voice.preset.dda.data)],data.map(value=>value&31));
  assert.equal(voice.preset.dda.sampleRate,7000);assert.equal(voice.preset.dda.rootNote,60);
  assert.equal(voice.preset.dda.loop,false);assert.equal(voice.preset.envelope.enabled,false);
  assert.equal(voice.preset.volume,31);assert.deepEqual(voice.preset.pan,{left:10,right:11});
  assert.deepEqual(only,await extractVgmInstruments(gzipSync(vgm([...globals,...pcm,0x66]))));
  const mixed=await extractVgmInstruments(vgm([...globals,...upload(2),...play(2),...wait(),...stop(2),...pcm,
    ...upload(3,other),...play(3),...wait(),0x66]));
  assert.deepEqual(mixed.voices.map(value=>[value.id,value.kind,value.channel,value.firstTime]),[
    [1,'wave',3,0],[2,'pcm',1,1000],[3,'wave',4,2000],
  ]);
  assert.deepEqual(mixed.voices.map(value=>value.preset.name),['Wave CH3 · 1','PCM CH1 · 2','Wave CH4 · 3']);
  for(const value of mixed.voices)assert.deepEqual(value.preset,readPreset(value.preset));
});
const period = (channel,value) => [...w(0,channel),...w(2,value&255),...w(3,(value&4095)>>8)];
function lfoSetup({carrierPeriod=700,modulatorPeriod=913,rate=7,depth=2,reset=false,output=true,
  carrierWave=wave,modulatorWave=other,carrierVolume=25,modulatorVolume=19}={}) {
  return [...globals,...upload(0,carrierWave),...upload(1,modulatorWave),
    ...period(1,modulatorPeriod),...w(5,0xdf),...w(4,(output?128:0)|modulatorVolume),
    ...period(0,carrierPeriod),...w(5,247),...w(4,128|carrierVolume),
    ...(rate===null?[]:w(8,rate)),...w(9,depth|(reset?128:0))];
}

test('positive intervals recover exact Wave / Noise settings and ignore pitch-only duplication',async()=>{
  const result=await extractVgmInstruments(complete());
  assert.deepEqual(result.voices.map(voice=>[voice.kind,voice.channel,voice.firstTime,voice.occurrences]),[
    ['wave',1,0,1],['wave',3,2000,1],['noise',5,3000,1],
  ]);
  assert.deepEqual(result.voices[0].preset.wave,wave);assert.equal(result.voices[0].preset.volume,25);
  assert.deepEqual(result.voices[1].preset.wave,other);assert.deepEqual(result.voices[1].preset.pan,{left:15,right:7});
  assert.equal(result.voices[2].preset.noise.frequency,16);assert.equal(result.voices[2].preset.volume,23);
  for(const voice of result.voices) {assert.deepEqual(voice.preset,readPreset(voice.preset));assert.equal(voice.preset.envelope.enabled,false);}
  assert.equal(result.timebase,44100);assert.equal(result.metadata,null);
  assert(result.warnings.some(message=>message.includes('Static')));
});

test('all same-time writes are batched, repeated waits are not uses, and retriggers count once',async()=>{
  const commands=[...globals,...upload(),...play(),...upload(0,other),...play(),...wait(),0x62,0x63,0x70,0x80,0x8f,
    ...stop(0),...play(),...wait(),...stop(0),...play(0,19),...wait(),...stop(0),...play(),...wait(),0x66];
  const result=await extractVgmInstruments(vgm(commands));
  assert.equal(result.voices.length,2);assert.deepEqual(result.voices[0].preset.wave,other);
  assert.equal(result.voices[0].occurrences,3);assert.equal(result.voices[1].preset.volume,19);
  assert.equal(result.voices[1].firstTime,3633);
  await assert.rejects(extractVgmInstruments(vgm([...globals,...upload(),...play(),0x66])),/No complete/);
});

test('known write pointer and all 32 samples are required; playback only loses index, not RAM',async()=>{
  const result=await extractVgmInstruments(vgm([...globals,
    ...upload(0,wave.slice(0,31)),...play(),...wait(),...stop(0),
    ...w(0,1),...w(4,0),...wave.flatMap(value=>w(6,value)),...play(1),...wait(),...stop(1),
    ...upload(2),...play(2),...wait(),...w(2,20),...wait(),...stop(2),
    ...w(6,31),...play(2),...wait(),...stop(2),...noise(),...wait(),0x66]));
  assert.deepEqual(result.voices.map(voice=>[voice.kind,voice.channel]),[['wave',3],['noise',5]]);
  assert.equal(result.voices[0].occurrences,1);
  assert(result.warnings.some(message=>message.includes('Incomplete')));
  assert(result.warnings.some(message=>message.includes('unknown playback/write index')));
});

test('DDA transitions reset the index, DDA data retains Wave RAM, and enabled Wave writes do not advance',async()=>{
  const changed=[...wave];changed[0]=7;
  const result=await extractVgmInstruments(vgm([...globals,...upload(),...play(),...w(6,7),...w(6,9),...wait(),
    ...w(4,0xd9),...w(6,31),...wait(),...w(4,0),...w(6,7),...play(),...wait(),0x66]));
  assert.equal(result.voices.length,2);
  const first=[...wave];first[0]=9;
  assert.deepEqual(result.voices[0].preset.wave,first);assert.deepEqual(result.voices[1].preset.wave,changed);
  assert(result.warnings.some(message=>message.includes('DDA / PCM')));
});

test('Noise has priority over DDA, while incomplete LFO pairs and unknown modulation indices are omitted',async()=>{
  const result=await extractVgmInstruments(vgm([...globals,...upload(0),...upload(1,other),...play(0),...w(9,1),...wait(),
    ...w(9,0),...w(0,1),...w(6,8),...play(1),...wait(),...stop(0),...stop(1),
    ...noise(4,17),...w(4,0xd7),...wait(),...stop(4),...noise(5,3),...wait(),0x66]));
  assert.deepEqual(result.voices.map(voice=>[voice.kind,voice.channel]),[['wave',1],['noise',5],['noise',6]]);
  assert(result.warnings.some(message=>message.includes('Hardware LFO')));
  assert(result.warnings.some(message=>message.includes('unknown playback/write index')));
});

test('muted / constant intervals are omitted, optional unrecorded flags are disclosed and global gain is not fabricated',async()=>{
  const result=await extractVgmInstruments(vgm([...upload(),...play(),...wait(),...stop(0),...upload(2,Array(32).fill(16)),...play(2),...wait(),...stop(2),
    ...upload(3),...play(3,1,0x11),...wait(),...stop(3),...noise(4),...w(1,0),...wait(),
    ...w(1,0xdd),...wait(),0x66]));
  assert.deepEqual(result.voices.map(voice=>[voice.kind,voice.channel]),[['wave',1],['noise',5]]);
  assert(result.warnings.some(message=>message.includes('LFO control was not recorded')));
  assert(result.warnings.some(message=>message.includes('Global balance was not recorded')));
  assert(result.warnings.some(message=>message.includes('Constant Wave RAM')));
  assert(result.warnings.some(message=>message.includes('Recorded global balance is not applied')));
  assert.equal(result.voices[1].preset.volume,23);
});

test('DAC stream setup alone is passive; started streams invalidate affected RAM until direct reinitialization',async()=>{
  const setup=[0x90,0,0x1b,0,6],start=[0x93,0,0,0,0,0,1,10,0,0,0],end=[0x94,255];
  const result=await extractVgmInstruments(vgm([...globals,...upload(),...play(),...setup,...wait(),...start,...wait(),...end,
    ...stop(0),...play(),...wait(),...stop(0),...upload(0,other),...play(),...wait(),0x66]));
  assert.equal(result.voices.length,2);assert.deepEqual(result.voices[0].preset.wave,wave);assert.deepEqual(result.voices[1].preset.wave,other);
  assert(result.warnings.some(message=>message.includes('DAC streams')));
  assert(result.warnings.some(message=>message.includes('Incomplete')));
  await assert.rejects(extractVgmInstruments(vgm([...globals,0x90,0,0x9b,0,6,0x66])),/Second HuC6280/);
});

test('current-channel stream targets follow selection, globals become unknown, and direct control restores them',async()=>{
  const result=await extractVgmInstruments(vgm([...globals,...upload(0),...play(0),...upload(2,other),...play(2),
    ...w(0,0),0x90,0,0x1b,255,6,0x93,0,0,0,0,0,1,1,0,0,0,...wait(),
    ...w(0,2),...wait(),0x94,0,...stop(0),...stop(2),...upload(3),...play(3),
    0x90,0,0x1b,0,1,0x93,0,0,0,0,0,1,1,0,0,0,...wait(),0x94,0,...w(1,255),...wait(),0x66]));
  assert.deepEqual(result.voices.map(voice=>voice.channel),[3,4]);
  assert(result.warnings.some(message=>message.includes('global balance changed')));
});

test('unknown LFO or carrier control cannot preserve a fictitious modulator write index',async()=>{
  for (const register of [9,4]) {
    const settings = register===9 ? [...w(9,0)] : [...w(9,1)];
    const result=await extractVgmInstruments(vgm([...globals,...upload(0),...upload(1,other),...play(0),...settings,
      0x90,0,0x1b,0,register,0x93,0,0,0,0,0,1,1,0,0,0,...wait(),0x94,255,
      ...w(9,0),...stop(0),...w(0,1),...w(6,9),...play(1),...wait(),
      ...stop(1),...noise(),...wait(),0x66]));
    assert(result.voices.every(voice=>voice.channel!==2));
    assert(result.warnings.some(message=>message.includes('unknown playback/write index')));
  }
});

test('direct writes after an unknown selector invalidate every possible target instead of preserving stale settings',async()=>{
  for(const register of [4,5,6]) {
    const result=await extractVgmInstruments(vgm([...globals,...upload(2),...play(2),
      0x90,0,0x1b,255,0,0x93,0,0,0,0,0,1,1,0,0,0,...wait(),0x94,255,
      ...w(register,31),...w(0,2),...(register===4?[]:w(4,154)),...wait(),
      ...stop(2),...noise(),...wait(),0x66]));
    assert.deepEqual(result.voices.map(voice=>[voice.kind,voice.channel,voice.preset.volume]),[['wave',3,25],['noise',5,23]]);
    assert(result.warnings.some(message=>message.includes('known channel selection')));
  }
  const unknownNoise=await extractVgmInstruments(vgm([...globals,...noise(),
    0x90,0,0x1b,255,0,0x93,0,0,0,0,0,1,1,0,0,0,...wait(),0x94,255,
    ...w(7,145),...w(0,4),...w(4,152),...wait(),0x66]));
  assert.equal(unknownNoise.voices.length,1);assert.equal(unknownNoise.voices[0].preset.noise.frequency,16);
});

test('files containing only unsupported intervals report why no voice can be imported',async()=>{
  await assert.rejects(extractVgmInstruments(vgm([...globals,...upload(),...play(),...w(9,1),...wait(),0x66])),/Hardware LFO/);
  await assert.rejects(extractVgmInstruments(vgm([...globals,...play(),...w(4,0xd9),...wait(),0x66])),/DDA \/ PCM/);
  await assert.rejects(extractVgmInstruments(vgm([...globals,...play(),...wait(),0x66])),/Incomplete or unknown/);
});

test('VGZ and byte views preserve ownership; malformed, non-HuC and dual inputs fail without partial results',async()=>{
  const source=complete(),copy=source.slice(),result=await extractVgmInstruments(source);
  assert.deepEqual(source,copy);assert.deepEqual(await extractVgmInstruments(gzipSync(source)),result);
  const wrapped=new Uint8Array(source.length+9);wrapped.set(source,5);
  assert.deepEqual(await extractVgmInstruments(wrapped.subarray(5,5+source.length)),result);
  await assert.rejects(extractVgmInstruments(new Uint8Array(20)),/header/);
  await assert.rejects(extractVgmInstruments(vgm([0x66],0)),/no HuC6280/);
  await assert.rejects(extractVgmInstruments(vgm([0x66],3579545|0x40000000)),/Dual or variant/);
  await assert.rejects(extractVgmInstruments(vgm([0xb9,128,0,0x66])),/Second HuC6280/);
  await assert.rejects(extractVgmInstruments(vgm([...globals,...upload(),...play(),...wait()])),/end of VGM/);
  await assert.rejects(extractVgmInstruments(vgm([0xb9,2])),/Truncated VGM command/);
  await assert.rejects(extractVgmInstruments(vgm([0x67,0x66])),/Truncated VGM command/);
  await assert.rejects(extractVgmInstruments(vgm([0x67,0,0,0,0,0,0,0x66])),/data block header/);
  await assert.rejects(extractVgmInstruments(vgm([0x64,0x62,0,1,0x66])),/Unsupported raw VGM command/);
  const badOffset=source.slice();new DataView(badOffset.buffer).setUint32(0x34,0xffff,true);
  await assert.rejects(extractVgmInstruments(badOffset),/data offset/);
  const badSize=source.slice();new DataView(badSize.buffer).setUint32(4,source.length+10,true);
  await assert.rejects(extractVgmInstruments(badSize),/file size/);
  await assert.rejects(extractVgmInstruments(Uint8Array.from([0x1f,0x8b,0])),/./);
  const block=[0x67,0x66,0,4,0,0,0,0xb9,4,255,0x66];
  const ignored=await extractVgmInstruments(vgm([...block,...globals,...upload(),...play(),...wait(),0x66]));
  assert.equal(ignored.voices.length,1);
});

test('byte limits, bounded gzip expansion and cancellation stop parsing before a result is published',async()=>{
  await assert.rejects(extractVgmInstruments(new Uint8Array(MAX_VGM_BYTES+1)),/64 MiB/);
  const compressed=gzipSync(new Uint8Array(MAX_VGM_BYTES+1),{level:1});
  await assert.rejects(extractVgmInstruments(compressed),/Expanded VGZ exceeds 64 MiB/);
  const early=new AbortController();early.abort();await assert.rejects(extractVgmInstruments(complete(),{signal:early.signal}),{name:'AbortError'});
  const later=new AbortController(),commands=new Uint8Array(25000+1);commands.fill(0x80);commands[25000]=0x66;
  const task=extractVgmInstruments(vgm(commands),{signal:later.signal});setTimeout(()=>later.abort(),0);
  await assert.rejects(task,{name:'AbortError'});
});

test('command, definition and observation caps bound files that contain many small commands',async()=>{
  const ignored=new Uint8Array(4_000_001).fill(0x80);ignored[ignored.length-1]=0x66;
  await assert.rejects(extractVgmInstruments(vgm(ignored)),/four million commands/);
  const definitions=[...globals];
  for(let index=0;index<4097;index++) {
    const values=[...wave];values[0]=index&31;values[1]=index>>5&31;values[2]=index>>10&31;
    definitions.push(...upload(0,values),...play(0,31),0x70,...stop(0));
  }
  definitions.push(0x66);
  await assert.rejects(extractVgmInstruments(vgm(definitions)),/4,096 different voices/);
  const observations=[...globals,...upload(),...play()];
  for(let index=0;index<100001;index++)observations.push(0x70,...w(4,25),...w(4,153));
  observations.push(0x66);
  await assert.rejects(extractVgmInstruments(vgm(observations)),/100,000 voice observations/);
});

test('imported Wave renders byte-identical PCM to the recorded setup at the chosen MIDI pitch',async t=>{
  const commands=[...globals,...upload(),...play(0,25,249)];
  const {voices}=await extractVgmInstruments(vgm([...commands,...wait(),0x66]));
  const wasmBinary=await readFile(new URL('../generated/huc6280_wasm.wasm',import.meta.url));
  const create=()=>Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:48000});
  const raw=await create(),core=await create(),instrument=new Huc6280Instrument(core);
  t.after(()=>{raw.dispose();instrument.dispose();});
  for(let offset=0;offset<commands.length;offset+=3)raw.writeHuc6280(commands[offset+1],commands[offset+2]);
  instrument.loadPreset(voices[0].preset);instrument.noteOn('imported',60);
  assert.deepEqual(instrument.generateStereo(4096),raw.processFrames(4096));
  instrument.stop();assert(instrument.generateStereo(128).left.every(value=>value===0));
});

test('LFO pairs preserve both waves, independent periods, rate, depth, reset and audible CH2 output',async()=>{
  const setup=lfoSetup(),result=await extractVgmInstruments(vgm([...setup,...wait(),...wait(),
    ...period(0,701),...wait(),...w(9,130),...wait(),0x66]));
  assert.deepEqual(result.voices.map(voice=>[voice.kind,voice.channel,voice.firstTime,voice.occurrences]),[
    ['lfo',1,0,1],['lfo',1,2000,1],['lfo',1,3000,1],
  ]);
  const preset=result.voices[0].preset;
  assert.equal(preset.source,'wave');assert.equal(preset.volume,25);assert.deepEqual(preset.pan,{left:15,right:7});
  assert.deepEqual(preset.wave,wave);
  assert.deepEqual(preset.lfo,{enabled:true,frequency:7,depth:2,wave:other,mode:'recorded',carrierPeriod:700,modulatorPeriod:913,
    reset:false,output:{enabled:true,volume:19,pan:{left:13,right:15}}});
  assert.equal(preset.envelope.enabled,false);assert.equal(result.voices[1].preset.lfo.carrierPeriod,701);
  assert.equal(result.voices[2].preset.lfo.reset,true);assert.equal(preset.version,3);
  assert(result.warnings.some(message=>message.includes('C4')));
  assert(result.warnings.some(message=>message.includes('phase is not reconstructed')));
});

test('LFO can retain a constant modulator table, silent carrier or raw zero periods without guessing output metadata',async()=>{
  const fixed=await extractVgmInstruments(vgm([...lfoSetup({carrierPeriod:4096,modulatorPeriod:4096,rate:0,reset:true,
    modulatorWave:Array(32).fill(18),output:false}),...wait(),0x66]));
  assert.equal(fixed.voices.length,1);const preset=fixed.voices[0].preset;
  assert.equal(preset.lfo.carrierPeriod,4096);assert.equal(preset.lfo.modulatorPeriod,4096);
  assert.equal(preset.lfo.frequency,0);assert.equal(preset.lfo.reset,true);assert.deepEqual(preset.lfo.wave,Array(32).fill(18));
  assert.equal(preset.lfo.output.enabled,false);
  const modulatorOnly=await extractVgmInstruments(vgm([...lfoSetup({carrierVolume:0}),...wait(),0x66]));
  assert.equal(modulatorOnly.voices[0].preset.volume,0);assert.equal(modulatorOnly.voices[0].preset.lfo.output.enabled,true);
  const constantCarrier=await extractVgmInstruments(vgm([...lfoSetup({carrierWave:Array(32).fill(16)}),...wait(),0x66]));
  assert.equal(constantCarrier.voices[0].kind,'lfo');
  const noOutputPan=await extractVgmInstruments(vgm([...globals,...upload(0),...upload(1,other),...period(1,913),
    ...period(0,700),...w(5,255),...w(4,153),...w(8,7),...w(9,2),...wait(),0x66]));
  assert.deepEqual(noOutputPan.voices[0].preset.lfo.output,{enabled:false,volume:0,pan:{left:15,right:15}});
  assert(noOutputPan.warnings.some(message=>message.includes('CH2 balance was not recorded')));
});

test('incomplete LFO waves, periods, rate, output mode and balance are omitted with concrete reasons',async()=>{
  const cases=[
    [lfoSetup({rate:null}),/rate register/],
    [[...globals,...upload(0),...upload(1,other),...play(0),...w(8,7),...w(9,2)],/period bytes/],
    [lfoSetup({modulatorWave:other.slice(0,31)}),/CH1 \/ CH2 Wave RAM/],
    [[...lfoSetup(),...w(0,1),...w(4,0xd3)],/audible CH2 DDA/],
    [[...lfoSetup(),...w(0,0),...w(4,0xd9)],/carrier DDA/],
    [[...globals,...upload(0),...upload(1,other),...period(1,913),...w(4,147),
      ...period(0,700),...w(5,255),...w(4,153),...w(8,7),...w(9,2)],/unknown audible CH2 balance/],
  ];
  for(const [commands,reason]of cases)await assert.rejects(extractVgmInstruments(vgm([...commands,...wait(),0x66])),reason);
  const ordinary=await extractVgmInstruments(vgm([...lfoSetup({rate:null}),...upload(2),...play(2),...wait(),0x66]));
  assert.deepEqual(ordinary.voices.map(voice=>[voice.kind,voice.channel]),[['wave',3]]);
});

test('DAC stream changes to LFO period bytes and rate invalidate metadata until each affected write is restored',async()=>{
  for(const [channel,register]of [[0,2],[0,3],[1,2],[1,3],[0,8]]) {
    const start=[0x90,0,0x1b,channel,register,0x93,0,0,0,0,0,1,1,0,0,0],stopStream=[0x94,255];
    const restore=register===8?w(8,7):[...w(0,channel),...w(register,register===2?(channel===0?700:913)&255:(channel===0?700:913)>>8)];
    const result=await extractVgmInstruments(vgm([...lfoSetup(),...wait(),...start,...wait(),...stopStream,...wait(),
      ...restore,...wait(),0x66]));
    assert.equal(result.voices.length,1);assert.equal(result.voices[0].occurrences,2);
    assert(result.warnings.some(message=>/rate register|period bytes/.test(message)),`register ${register} becomes unknown`);
  }
  for(const register of [2,3]) {
    const result=await extractVgmInstruments(vgm([...lfoSetup(),...wait(),
      0x90,0,0x1b,255,0,0x93,0,0,0,0,0,1,1,0,0,0,...wait(),0x94,255,
      ...w(register,0),...w(0,0),...wait(),...period(0,700),...wait(),...period(1,913),...wait(),0x66]));
    assert.equal(result.voices.length,1);assert.equal(result.voices[0].occurrences,2,'both possibly affected channels must be restored');
    assert(result.warnings.some(message=>message.includes('known channel selection')));
  }
});

test('global attenuation cannot disguise unsupported CH2 DDA output or an entirely constant audible pair',async()=>{
  await assert.rejects(extractVgmInstruments(vgm([...lfoSetup({modulatorVolume:1}),...w(1,0xdd),
    ...w(0,1),...w(4,0xc1),...wait(),0x66])),/audible CH2 DDA/);
  for(const options of [{carrierVolume:0,modulatorWave:Array(32).fill(16)},
    {carrierVolume:0,reset:true},{carrierWave:Array(32).fill(16),output:false}]) {
    await assert.rejects(extractVgmInstruments(vgm([...lfoSetup(options),...wait(),0x66])),/Constant LFO pair/);
  }
});

test('recorded LFO pairs render the initialized original hardware setup through real WASM',async t=>{
  const wasmBinary=await readFile(new URL('../generated/huc6280_wasm.wasm',import.meta.url));
  const create=()=>Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:48000});
  for(const options of [{},{reset:true},{rate:0,carrierPeriod:4096,modulatorPeriod:4096,output:false}]) {
    const commands=lfoSetup(options),{voices}=await extractVgmInstruments(vgm([...commands,...wait(),0x66]));
    const raw=await create(),core=await create(),instrument=new Huc6280Instrument(core);
    t.after(()=>{raw.dispose();instrument.dispose();});
    for(let offset=0;offset<commands.length;offset+=3)raw.writeHuc6280(commands[offset+1],commands[offset+2]);
    instrument.loadPreset(voices[0].preset);instrument.noteOn('original',60);
    assert.deepEqual(instrument.generateStereo(4096),raw.processFrames(4096),JSON.stringify(options));
    instrument.noteOff('original');assert(instrument.generateStereo(128).left.every(value=>value===0));
    assert.equal(instrument.read().registers[1][4]&128,0,'paired CH2 output stops on release');
  }
});
