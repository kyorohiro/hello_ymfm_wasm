// SPDX-License-Identifier: BSD-3-Clause
// Numeric-only capture: original self-authored ADPCM, no audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {preparePsfVoiceCapture,PSF_NOISE_SUPPORT_ADPCM,PSF_NOISE_SUPPORT_BASE_HZ} from './psf_capture.js';
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
  assert.equal(result.capture.kind,'adpcm');
  assert.equal(result.capture.loopSource,'adpcm-marker');assert.equal(result.capture.resolvedLoopAddress,START+16);
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
  assert.equal(single.capture.loopSource,null);assert.equal(single.capture.resolvedLoopAddress,null);
  const external=fixture({loopPacket:2,marker:false}),loop=prepare(external);
  assert.equal(loop.capture.loopStartSamples,56);assert.equal(loop.capture.markerAddress,null);
  assert.equal(loop.capture.loopSource,'repeat-register');assert.equal(loop.capture.resolvedLoopAddress,START+32);
  assert.deepEqual(readSpuInstrument(loop.instrument).sample.adpcm,external.adpcm);
});

test('a fresh-key capture prefers its unique encoded marker while preserving differing raw Repeat provenance',()=>{
  for(const repeat of [0,START-16,START+64,START+8,START+32]) {
    const input=fixture({loopPacket:1});rawAddress(input,{repeat});const before=structuredClone(input);
    const result=prepare(input,{referenceNote:'F3'}),instrument=readSpuInstrument(JSON.parse(JSON.stringify(result.instrument)));
    assert.equal(result.capture.repeatAddress,repeat,'observed Repeat is never rewritten');
    assert.equal(result.capture.loopSource,'adpcm-marker');assert.equal(result.capture.resolvedLoopAddress,START+16);
    assert.equal(result.capture.markerAddress,START+16);assert.equal(result.capture.loopStartSamples,28);
    assert.equal(instrument.sample.loopStartSamples,28);assert.deepEqual(instrument.sample.adpcm,input.adpcm);
    assert.equal(instrument.sample.baseFrequencyHz,noteToHz('F3')*4096/input.state.channels[0].pitch);
    assert.equal(instrument.preset.pitch,input.state.channels[0].pitch);
    assert(result.capture.notes.some(note=>/fresh key-on.*encoded Loop Start.*differing captured Repeat/.test(note)));
    assert.deepEqual(result.capture.warnings,['Internal Loop Start chosen for a new key-on; observed Repeat retained as provenance.']);
    assert.deepEqual(input,before,'neither current registers nor encoded flags/bytes change');
  }
  const same=prepare(fixture({loopPacket:1}));
  assert.equal(same.capture.notes.some(note=>/differing captured Repeat/.test(note)),false);
  assert.deepEqual(same.capture.warnings,[]);
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
    [input=>{input.ram[START+1]=0;rawAddress(input,{repeat:START-16});},'discontiguous'],
    [input=>{input.ram[START+1]=0;rawAddress(input,{repeat:START+64});},'discontiguous'],
    [input=>{input.ram[START+1]=0;rawAddress(input,{repeat:START+8});},'16-byte-aligned'],
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

function noiseFixture({voice=2,clock=37}={}) {
  const input=fixture({voice}),channel=input.state.channels[voice];
  input.ram.fill(0xff);channel.sample=null;
  // Deliberately unusable ADPCM settings: Noise must not inspect them.
  channel.rawRegisters[2]=0;channel.pitch=0;
  channel.rawRegisters[3]=0xffff;channel.startAddress=0xffff*8;
  channel.rawRegisters[7]=1;channel.repeatAddress=8;
  channel.noise=true;input.state.observation.noiseMask=1<<voice;
  input.state.noise={enabled:true,clock};
  input.state.observation.control=(input.state.observation.control&~0x3f00)|(clock<<8);
  return input;
}

test('Noise capture ignores unusable source ADPCM, PITCH and reference key while retaining voice/clock settings',()=>{
  class NoAdpcmExtraction extends Uint8Array {slice(){assert.fail('Noise capture must not extract source ADPCM');}}
  const input=noiseFixture(),channel=input.state.channels[input.voice];input.ram=new NoAdpcmExtraction(input.ram);
  const before=structuredClone(input),result=prepare(input,{referenceNote:'not a musical note'});
  const parsed=readSpuInstrument(JSON.parse(JSON.stringify(result.instrument)));
  assert.equal(result.capture.kind,'noise');assert.equal(result.capture.noiseClock,37);
  assert.equal(result.capture.byteLength,0);assert.equal(result.capture.placeholderByteLength,64);
  assert.equal(result.capture.referenceNote,null);assert.equal(result.capture.referenceFrequencyHz,null);
  assert.equal(result.capture.baseFrequencyHz,null);assert.equal(result.capture.rawPitch,0);
  assert.equal(result.capture.tuning,'noise-clock');assert.equal(result.capture.lfsrPhaseCaptured,false);
  assert.equal(result.capture.envelopeStateCaptured,false);assert.equal(result.capture.loop,null);
  assert.equal(result.capture.loopSource,null);assert.equal(result.capture.resolvedLoopAddress,null);
  assert.deepEqual(parsed.noise,{enabled:true,clock:37});assert.equal(parsed.preset.pitch,4096);
  assert.equal(parsed.preset.volumeLeft,channel.volumeLeft);assert.equal(parsed.preset.volumeRight,channel.volumeRight);
  assert.equal(parsed.preset.adsr1,channel.adsr1);assert.equal(parsed.preset.adsr2,channel.adsr2);assert.equal(parsed.preset.reverb,true);
  assert.deepEqual(parsed.reverb,editorReverb);assert.equal(parsed.waveform,null);
  assert.equal(parsed.pmon.enabled,false);assert.equal(parsed.morph.enabled,false);
  assert.equal(parsed.sample.baseFrequencyHz,44100/112);assert.equal(parsed.sample.loopStartSamples,0);
  assert.deepEqual(parsed.sample.adpcm,Uint8Array.from(PSF_NOISE_SUPPORT_ADPCM));
  assert.deepEqual([1,17,33,49].map(at=>parsed.sample.adpcm[at]),[6,0,0,3]);
  assert([0,16,32,48].every(at=>parsed.sample.adpcm[at]===0x0c));
  assert.deepEqual(structuredClone(input),before);
  result.instrument.sample.adpcm[2]=123;result.capture.source.title='changed';
  assert.equal(PSF_NOISE_SUPPORT_ADPCM[2],0);assert.equal(prepare(input).instrument.sample.adpcm[2],0);
  assert.deepEqual(structuredClone(input),before,'source state and fixed support data remain detached');
});

test('Noise capture accepts capture-buffer/unaligned addresses and all clocks but rejects inconsistent snapshots and PMON carriers',()=>{
  for(const clock of [0,37,63]) {
    const input=noiseFixture({clock});rawAddress(input,{start:0,repeat:8});
    assert.equal(prepare(input,{referenceNote:null}).capture.noiseClock,clock);
  }
  const cases=[
    [value=>value.state.channels[value.voice].noise=false,/Noise flag/],
    [value=>value.state.observation.noiseMask=0,/Noise flag/],
    [value=>value.state.noise.clock=64,/Noise clock/],
    [value=>value.state.noise.clock=-1,/Noise clock/],
    [value=>value.state.noise.clock=.5,/Noise clock/],
    [value=>value.state.noise.clock=38,/shared Noise clock/],
    [value=>value.state.noise.enabled=false,/shared Noise clock/],
    [value=>delete value.state.observation.control,/SPU control/],
    [value=>value.state.channels[value.voice].volumeLeft=.5,/volumes.*raw register/],
    [value=>{value.state.observation.pmonMask=1<<value.voice;value.state.channels[value.voice].hardwarePmon=true;},/PMON carriers/],
    [value=>value.ram=new Uint8Array(16),/512 KiB/],
    [value=>value.frame++,/same PSF observation frame/],
  ];
  for(const [change,message]of cases){const input=noiseFixture();change(input);const before=structuredClone(input);assert.throws(()=>prepare(input),message);assert.deepEqual(input,before);}
  const adpcm=fixture();adpcm.state.observation.noiseMask=4;adpcm.state.noise={enabled:true,clock:37};
  assert.equal(prepare(adpcm).capture.kind,'adpcm','another channel using Noise does not change ADPCM capture');
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

test('captured Noise runs through real SPU registers with clock/pitch independence, fresh ADSR and silent support data',async()=>{
  const render=async({clock=37,pitch=4096,release=false,silence=false}={})=>{
    const parsed=readSpuInstrument(prepare(noiseFixture({clock}),{referenceNote:'ignored'}).instrument);
    const core=await nativeSpu(),synth=new Ps1Synth({core});
    try {
      const sample=synth.loadADPCM(parsed.sample.adpcm,{baseFrequencyHz:parsed.sample.baseFrequencyHz,loopStartSamples:0});
      synth.setPreset(0,{...parsed.preset,sample});synth.setReverb(parsed.reverb);
      core.write(0x194,1);core.write(0x196,0);core.write(0x1aa,(core.read(0x1aa)&~0x3f00)|(parsed.noise.clock<<8));
      core.write(4,pitch);
      assert.equal(core.read(12),0,'capture never writes the old live envelope level');
      synth.keyOn(0);
      const left=new Float32Array(4096),right=new Float32Array(4096);synth.renderInto(left,right);
      assert.equal(core.read(0x194),1);assert.equal((core.read(0x1aa)>>8)&63,clock);
      assert.equal(core.read(4),pitch);assert.equal(core.read(0),0x2345);assert.equal(core.read(2),0x7000);
      assert.equal(core.read(8),parsed.preset.adsr1);assert.equal(core.read(10),parsed.preset.adsr2);
      assert(core.read(12)>0,'captured ADSR starts a new sounding Noise voice');
      assert(left.some(value=>Math.abs(value)>.001));
      if(release||silence) {
        if(release)synth.keyOff(0);else core.write(0x194,0);
        const tail=new Float32Array(8192),other=new Float32Array(8192);synth.renderInto(tail,other);
        assert((release?tail.subarray(4096):tail).every(value=>value===0),release?'captured ADSR release reaches silence':'support ADPCM loop itself is silent');
        if(release)assert.equal(core.read(12),0);else assert(core.read(12)>0);
      }
      assert.equal(parsed.sample.baseFrequencyHz,PSF_NOISE_SUPPORT_BASE_HZ);
      return left;
    } finally {synth.dispose();}
  };
  const a=await render({pitch:0}),b=await render({pitch:0x3fff});
  assert.deepEqual(a,b,'fresh same-clock Noise does not depend on the sample PITCH');
  assert.notDeepEqual(await render({clock:38}),a,'shared Noise clock changes the generated texture');
  await render({release:true});await render({silence:true});
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
