// SPDX-License-Identifier: BSD-3-Clause
// Numeric-only capture: original self-authored ADPCM, no audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {preparePsfVoiceCapture} from './psf_capture.js';
import {readPsfLiveSnapshot} from './psf_live_snapshot.js';
import {readSpuInstrument} from './spu_synth_instrument.js';
import {createPsfPlaybackCore} from './psf_playback_core.js';
import {preparePsfSongSource} from './psf_song_source.js';
import {readPsfFileSet} from '../playground/playground_ps1_psf.js';
import {playbackAdpcm,createPsfSpuFeatureFixture} from '../../test/helpers/spu_psf_playback_fixture.mjs';
import factory from '../generated/ps1_spu_wasm.js';
import {Ps1Spu} from '../js/ps1_spu.js';
import {Ps1Synth} from '../js/ps1synth.js';
import {noteToHz} from '../js/soundchip_pitch.js';

const RAM_BYTES=512*1024,START=0x2000;
const editorReverb={preset:'off',volumeLeft:.33,volumeRight:.27};
function fixture({voice=0,pitch=0x1379,oneShot=false,loopPacket=0,marker=true}={}) {
  const ram=new Uint8Array(RAM_BYTES),adpcm=playbackAdpcm(),registers=new Uint16Array(512);
  adpcm[1]=0;if(marker)adpcm[loopPacket*16+1]=4;adpcm[49]=oneShot?1:3;ram.set(adpcm,START);
  const base=voice*8;
  for(const [at,value] of [[0,0x2345],[1,0x7000],[2,pitch],[3,START/8],[4,0x000f],[5,0x1fc0],[7,(START+loopPacket*16)/8]])registers[base+at]=value;
  registers[0x198/2]=voice<16?1<<voice:0;registers[0x19a/2]=voice>=16?1<<(voice-16):0;
  registers[0x1aa/2]=0xc080;registers[0x180/2]=0x100;registers[0x182/2]=0x200;
  registers[0x1c0/2]=0x1234; // Unknown song reverb must never overwrite the editor.
  const frame=8820,state=readPsfLiveSnapshot({readRegister:offset=>registers[offset/2],readRam:(at,length)=>ram.slice(at,at+length),
    nativeFrames:frame,keyGateMask:1<<voice,activeMask:1<<voice});
  return {state,ram,voice,frame,source:{entry:'demo/track.minipsf',title:'Original fixture'},adpcm};
}
const prepare=(input,options={})=>preparePsfVoiceCapture(input,{reverb:editorReverb,...options});
function rawAddress(input,{start,repeat,pitch}={}) {
  const channel=input.state.channels[input.voice];
  if(start!==undefined){channel.startAddress=start;channel.sample=start;channel.rawRegisters[3]=start/8;}
  if(repeat!==undefined){channel.repeatAddress=repeat;channel.rawRegisters[7]=repeat/8;}
  if(pitch!==undefined){channel.pitch=pitch;channel.rawRegisters[2]=pitch;}
}

test('capture preserves original ADPCM, voice parameters and reference tuning in portable instrument JSON',()=>{
  const input=fixture({voice:23,loopPacket:1}),before=structuredClone(input),result=prepare(input,{referenceNote:'D4',name:'Captured voice'});
  const instrument=readSpuInstrument(JSON.parse(JSON.stringify(result.instrument))),channel=input.state.channels[23];
  assert.equal(result.instrument.version,1);assert(Array.isArray(result.instrument.sample.adpcm));
  assert.deepEqual(instrument.sample.adpcm,input.adpcm);assert.equal(instrument.sample.loopStartSamples,28);
  assert.equal(instrument.sample.baseFrequencyHz,noteToHz('D4')*4096/channel.pitch);
  assert.deepEqual(instrument.preset,{volumeLeft:channel.volumeLeft,volumeRight:channel.volumeRight,adsr1:channel.adsr1,
    adsr2:channel.adsr2,pitch:channel.pitch,reverb:true});
  assert.deepEqual(instrument.reverb,editorReverb,'editor shared reverb is retained instead of song custom registers');
  assert.equal(instrument.pmon.enabled,false);assert.equal(instrument.noise.enabled,false);assert.equal(instrument.morph.enabled,false);
  assert.equal(instrument.waveform,null);assert.equal(result.capture.rootNoteInferred,false);
  assert.equal(result.capture.referenceNote,'D4');assert.equal(result.capture.rawPitch,0x1379);
  assert.equal(result.capture.envelopeStateCaptured,false);assert.equal(result.capture.frame,input.frame);
  assert.deepEqual(input,before,'capture preparation never edits registers, bytes or source metadata');
  result.instrument.sample.adpcm[2]^=1;result.capture.source.title='Changed';
  assert.deepEqual(input,before,'returned data is detached');
});

test('one-shot Loop Start flags remain unchanged and external in-sample repeat targets are accepted',()=>{
  const oneShot=fixture({oneShot:true});rawAddress(oneShot,{repeat:0});
  const single=prepare(oneShot),parsed=readSpuInstrument(single.instrument);
  assert.deepEqual(parsed.sample.adpcm,oneShot.adpcm);assert.equal(parsed.sample.adpcm[1],4);
  assert.equal(Object.hasOwn(parsed.sample,'loopStartSamples'),false);assert.equal(single.capture.loop,false);
  const external=fixture({loopPacket:2,marker:false}),loop=prepare(external);
  assert.equal(loop.capture.loopStartSamples,56);assert.equal(loop.capture.markerAddress,null);
  assert.deepEqual(readSpuInstrument(loop.instrument).sample.adpcm,external.adpcm);
});

test('unsupported or mismatched captures reject locally without rewriting any source state',()=>{
  const cases=[
    [input=>input.frame++,'same PSF observation frame'],
    [input=>input.state.observation.nativeFrames++,'same PSF observation frame'],
    [input=>input.state.channels[0].channel=1,'physical voice'],
    [input=>input.ram=new Uint8Array(16),'512 KiB'],
    [input=>input.state.observation.noiseMask=1,'Noise'],
    [input=>{input.voice=1;input.state.channels[1]=structuredClone(input.state.channels[0]);input.state.channels[1].channel=1;input.state.observation.pmonMask=2;},'PMON carriers'],
    [input=>rawAddress(input,{pitch:0}),'PITCH is zero'],
    [input=>input.state.channels[0].sample=null,'no configured'],
    [input=>rawAddress(input,{start:0x800}),'capture-buffer area'],
    [input=>rawAddress(input,{start:START+8}),'16-byte-aligned'],
    [input=>input.ram[START]=0x50,'predictor/shift'],
    [input=>input.ram[START]=13,'predictor/shift'],
    [input=>input.ram[START+1]=0x80,'flags'],
    [input=>input.ram[START+17]=4,'Multiple'],
    [input=>rawAddress(input,{repeat:START-16}),'discontiguous'],
    [input=>rawAddress(input,{repeat:START+64}),'discontiguous'],
    [input=>rawAddress(input,{repeat:START+8}),'16-byte-aligned'],
    [input=>rawAddress(input,{repeat:START+16}),'disagree'],
    [input=>input.ram[START+49]=0,'No ADPCM END'],
    [input=>input.state.channels[0].pitch++,'raw register snapshot'],
    [input=>input.state.channels[0].reverb=false,'reverb send'],
  ];
  for(const [change,message] of cases) {
    const input=fixture();change(input);const before=structuredClone(input);
    assert.throws(()=>prepare(input),new RegExp(message));assert.deepEqual(input,before,message);
  }
  assert.throws(()=>preparePsfVoiceCapture(fixture()),/shared reverb settings/);
  assert.throws(()=>prepare(fixture(),{reverb:{...editorReverb,preset:'custom'}}),/Unknown SPU reverb/);
  assert.throws(()=>prepare(fixture(),{referenceNote:'H4'}),/note/i);
});

test('PMON source is captured independently and the physical CH1 ignored PMON bit is not treated as a carrier',()=>{
  const source=fixture();source.state.observation.pmonMask=2;
  const sourceResult=prepare(source);
  assert.equal(sourceResult.instrument.pmon.enabled,false);assert.deepEqual(sourceResult.instrument.sample.adpcm,Array.from(source.adpcm));
  const first=fixture();first.state.observation.pmonMask=1;
  assert.equal(prepare(first).capture.voice,0);
});

test('capture handles the full remaining sample-RAM capacity and never follows a wrapped sample',()=>{
  const input=fixture();input.ram.fill(0);rawAddress(input,{start:0x1000,repeat:0x1000});
  input.ram[RAM_BYTES-15]=1;
  const result=prepare(input);
  assert.equal(result.instrument.sample.adpcm.length,RAM_BYTES-0x1000);assert.equal(result.capture.packetCount,(RAM_BYTES-0x1000)/16);
  assert.equal(result.capture.decodedFrames,result.capture.packetCount*28);
  input.ram[RAM_BYTES-15]=0;input.ram[1]=1;
  assert.throws(()=>prepare(input),/No ADPCM END.*wrapped/,'END across the physical RAM boundary is never followed');
});

const spuWasm=await readFile(new URL('../generated/ps1_spu_wasm.wasm',import.meta.url));
const nativeSpu=()=>Ps1Spu.create({moduleFactory:factory,moduleOptions:{wasmBinary:spuWasm,print:()=>{},printErr:()=>{}}});
test('playing the chosen reference key reproduces the original raw PITCH and actual SPU PCM after sample relocation',async()=>{
  for(const referenceNote of ['C4',69]) {
    const input=fixture({loopPacket:1}),{instrument}=prepare(input,{referenceNote}),checked=readSpuInstrument(instrument);
    const original=await nativeSpu(),restored=await nativeSpu(),synth=new Ps1Synth({core:restored});
    try {
      const channel=input.state.channels[0];original.loadRam(input.adpcm,START);
      for(const [at,value] of [[0x180,0x3fff],[0x182,0x3fff],[0x1aa,0xc000]])original.write(at,value);
      for(let index=0;index<8;index++)if(index!==6)original.write(index*2,channel.rawRegisters[index]);
      original.write(0x198,1);original.write(0x188,1);
      const sample=synth.loadADPCM(checked.sample.adpcm,{baseFrequencyHz:checked.sample.baseFrequencyHz,loopStartSamples:checked.sample.loopStartSamples});
      synth.setPreset(0,{...checked.preset,sample});synth.setReverb(checked.reverb);synth.noteOn(0,referenceNote);
      assert.equal(restored.read(4),input.state.channels[0].pitch);
      assert.equal(sample.startAddress,0x1000);assert.equal(sample.repeatAddress,0x1010);
      const expectedL=new Float32Array(4096),expectedR=new Float32Array(4096),actualL=new Float32Array(4096),actualR=new Float32Array(4096);
      original.renderInto(expectedL,expectedR);synth.renderInto(actualL,actualR);
      assert.deepEqual(actualL,expectedL);assert.deepEqual(actualR,expectedR);
    } finally {original.dispose();synth.dispose();}
  }
});

const psfWasm=await readFile(new URL('../generated/psf-player/psf_player.wasm',import.meta.url));
async function playback(options={},fixtureOptions={}) {
  const fixture=createPsfSpuFeatureFixture({pitch:0x1379,...fixtureOptions}),image=await preparePsfSongSource(await readPsfFileSet(fixture.standaloneFiles),'spu-conformance.psf');
  return createPsfPlaybackCore({image,wasmBinary:psfWasm,...options});
}
test('copySpuRam is lazy, detached, read-only, reused internally and released on disposal',async()=>{
  const allocations=[],freed=[];let scratch;
  const core=await playback({moduleOptions:{onRuntimeInitialized(){
    const allocate=this._malloc,free=this._free;
    this._malloc=size=>{const pointer=allocate(size);allocations.push(size);if(size===RAM_BYTES)scratch=pointer;return pointer;};
    this._free=pointer=>{freed.push(pointer);free(pointer);};
  }}}),plain=await playback();
  try {
    assert.equal(allocations.includes(RAM_BYTES),false);
    assert.deepEqual(core.render(1024),plain.render(1024));core.observe();
    assert.equal(allocations.includes(RAM_BYTES),false,'bounded observe does not allocate full RAM');
    const state=core.observe(),first=core.copySpuRam(),position=core.position;
    assert(first instanceof Uint8Array);assert.equal(first.length,RAM_BYTES);
    const original=first[START];first[START]^=255;
    const second=core.copySpuRam();assert.notEqual(first.buffer,second.buffer);assert.equal(second[START],original);
    assert.equal(allocations.filter(size=>size===RAM_BYTES).length,1);assert.equal(core.observe().nativeFrames,state.nativeFrames);
    assert.equal(core.position,position);assert.deepEqual(core.render(4096),plain.render(4096));
    const prepared=prepare({state,ram:second,voice:0,frame:state.nativeFrames,source:'native fixture'});
    assert.equal(prepared.capture.rawPitch,0x1379);
  } finally {core.dispose();plain.dispose();}
  assert.equal(freed.filter(pointer=>pointer===scratch).length,1);assert.throws(()=>core.copySpuRam(),/disposed/);
});

test('capture uses the retained same-frame bytes after the game driver has rewritten live sample RAM',async()=>{
  const core=await playback({}, {steps:[{delay:65535,writes:[[0x1aa,0xc010],[0x1a6,(START+8)/8],[0x1a8,0x1122],[0x1aa,0xc000]]}]});
  try {
    core.render(100);
    const earlier={state:core.observe(),ram:core.copySpuRam(),voice:0,frame:100,source:'Before rewrite'};
    core.render(500);
    const later={state:core.observe(),ram:core.copySpuRam(),voice:0,frame:600,source:'After rewrite'};
    assert.notEqual(earlier.ram[START+8],later.ram[START+8]);assert.equal(later.ram[START+8],0x22);
    const original=prepare(earlier),rewritten=prepare(later);
    assert.equal(original.instrument.sample.adpcm[8],earlier.ram[START+8]);
    assert.equal(rewritten.instrument.sample.adpcm[8],0x22);
    assert.equal(original.capture.frame,100);assert.equal(rewritten.capture.frame,600);
  } finally {core.dispose();}
});

test('copySpuRam failures and aborts do not change or stop the rendering core',async()=>{
  for(const failure of ['allocate','read']) {
    const core=await playback({moduleOptions:{onRuntimeInitialized(){
      if(failure==='allocate'){const original=this._malloc;this._malloc=size=>size===RAM_BYTES?0:original(size);}
      else {const original=this._psf_spu_read_ram;this._psf_spu_read_ram=(handle,address,out,length)=>length===RAM_BYTES?0:original(handle,address,out,length);}
    }}});
    try {assert.throws(()=>core.copySpuRam(),/PSF Capture/);assert.equal(core.render(32).length,64);assert.equal(core.observe().nativeFrames,32);}
    finally {core.dispose();}
  }
  const controller=new AbortController(),core=await playback({signal:controller.signal});controller.abort();
  try {assert.throws(()=>core.copySpuRam(),{name:'AbortError'});}finally {core.dispose();}
});
