// SPDX-License-Identifier: BSD-3-Clause
// Numeric-only observations: no AudioContext or output device is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decodePsfAdpcmPreview,readPsfLiveSnapshot} from './psf_live_snapshot.js';
import {createPsfPlaybackCore} from './psf_playback_core.js';
import {preparePsfSongSource} from './psf_song_source.js';
import {readPsfFileSet} from '../playground/playground_ps1_psf.js';
import {createPsfSpuFeatureFixture} from '../../test/helpers/spu_psf_playback_fixture.mjs';

function packets({end=3}={}) {
  const bytes=new Uint8Array(64);
  for(let at=0;at<64;at+=16){bytes[at]=12;bytes.fill(0x21,at+2,at+16);}
  bytes[49]=end;return bytes;
}
function reader({configured=24,customReverb=false}={}) {
  const registers=new Uint16Array(512),reads=[];
  for(let ch=0;ch<configured;ch++) {
    const base=ch*8;
    registers[base]=0x2000;registers[base+1]=0x1000;registers[base+2]=0x1000;
    registers[base+3]=(0x1000+ch*64)/8;registers[base+4]=15;registers[base+5]=0x1fc0;registers[base+7]=registers[base+3];
  }
  registers[0x1aa/2]=0xc080|(40<<8);registers[0x196/2]=0x80;registers[0x192/2]=0x80;
  registers[0x19a/2]=0x80;registers[0x180/2]=0x3fff;registers[0x182/2]=0x2000;
  if(customReverb)registers[0x1c0/2]=0x1234;
  return {registers,reads,args:{nativeFrames:123,keyGateMask:1,activeMask:1,
    readRegister:offset=>registers[offset/2],readRam(address,length){reads.push({address,length});return packets().slice(0,length);}}};
}

test('bounded ADPCM preview uses LSB-first data, packet history, END and signed-short wrapping',()=>{
  const bytes=packets(),plain=decodePsfAdpcmPreview(bytes);
  assert.equal(plain.pcm[0],1/32768);assert.equal(plain.pcm[1],2/32768);
  assert.equal(plain.decodedFrames,112);assert.equal(plain.loop,true);assert.equal(plain.fullSampleKnown,false);
  bytes[1]=1;bytes[16]=0xff;
  const ended=decodePsfAdpcmPreview(bytes);
  assert.equal(ended.decodedFrames,28);assert.equal(ended.packetCount,1);assert.equal(ended.paddingFrames,84);
  assert.ok(ended.pcm.slice(28).every(value=>value===0),'graph padding never decodes data after END');
  const history=packets();history.fill(0x11,2,16);history[16]=0x1c;history.fill(0,18,32);
  assert.equal(decodePsfAdpcmPreview(history).pcm[28],1/32768,'predictor state crosses packets');
  const wrap=packets();wrap[0]=0;wrap.fill(0x77,2,16);wrap[16]=0x10;wrap.fill(0x77,18,32);
  assert.equal(decodePsfAdpcmPreview(wrap).pcm[28],-9984/32768,'preview matches fixed decoder int16 wrapping');
  const invalid=packets();invalid[0]=0x50;
  assert.throws(()=>decodePsfAdpcmPreview(invalid),/predictor/);
  assert.throws(()=>decodePsfAdpcmPreview(new Uint8Array(80)),/1–4/);
});

test('all-voice snapshots read at most 64 bytes per start and preserve custom hardware settings',()=>{
  const source=reader({customReverb:true}),state=readPsfLiveSnapshot(source.args);
  assert.equal(state.channels.length,24);assert.equal(state.samples.length,24);
  assert.equal(source.reads.length,24);assert.equal(source.reads.reduce((sum,value)=>sum+value.length,0),24*64);
  assert.ok(source.reads.every(value=>value.length<=64));
  assert.equal(state.nativeFrames,123);assert.equal(state.observation.nativeFrames,123);
  assert.equal(state.reverb.preset,'custom');assert.equal(state.reverb.registers[0],0x1234);
  assert.equal(state.observation.noiseMask,0x800000);assert.equal(state.channels[23].noise,true);
  assert.equal(state.observation.pmonMask,0x800000);assert.equal(state.channels[23].hardwarePmon,true);
  assert.deepEqual(state.noise,{enabled:true,clock:40});assert.deepEqual(state.pmon,{enabled:true});
  assert.equal(state.channels[0].gate,true);assert.equal(state.channels[0].active,true);
  assert.equal(state.channels[0].envelopeStage,null);assert.equal(state.observation.envelopeStageAvailable,false);
  assert.equal(state.samples[0].rootFrequencyHz,null);assert.equal(state.channels[0].waveform.preview,true);
  state.channels[0].waveform.pcm[0]=.9;state.reverb.registers[0]=0;state.channels[0].rawRegisters[0]=0;
  const next=readPsfLiveSnapshot(source.args);
  assert.equal(next.channels[0].waveform.pcm[0],1/32768);assert.equal(next.reverb.registers[0],0x1234);
  assert.equal(next.channels[0].rawRegisters[0],0x2000);
});

test('unconfigured and malformed voices have local unavailable previews without fake silence',()=>{
  const source=reader({configured:2});
  source.args.readRam=(address,length)=>{const data=packets().slice(0,length);if(address===0x1000)data[0]=0x50;return data;};
  const state=readPsfLiveSnapshot(source.args);
  assert.equal(state.channels[0].waveform,null);assert.match(state.channels[0].waveformUnavailable,/predictor/);
  assert.ok(state.channels[1].waveform);assert.equal(state.channels[2].sample,null);
  assert.equal(state.channels[2].waveform,null);assert.match(state.channels[2].waveformUnavailable,/no programmed/);
});

test('normalized volume controls remain bounded while exact signed register codes are retained',()=>{
  const source=reader({configured:1});
  source.registers[0]=0x4000;source.registers[0x180/2]=0x4000;source.registers[0x184/2]=0x8000;
  const state=readPsfLiveSnapshot(source.args);
  assert.equal(state.channels[0].volumeLeft,-1);assert.equal(state.channels[0].rawRegisters[0],0x4000);
  assert.equal(state.main.volumeLeft,-1);assert.equal(state.main.rawVolumeLeft,0x4000);
  assert.equal(state.reverb.volumeLeft,-1);assert.equal(state.reverb.rawVolumeLeft,0x8000);
  source.args.readRegister=()=>0xffffffff;
  assert.throws(()=>readPsfLiveSnapshot(source.args),/observation failed/);
});

test('shared starts are read once and RAM-end previews wrap within the hard byte bound',()=>{
  const source=reader({configured:2});
  source.registers[3]=source.registers[11]=0x7fff0/8;
  source.args.readRam=(address,length)=>{source.reads.push({address,length});return packets().slice(address===0?16:0,address===0?16+length:length);};
  const state=readPsfLiveSnapshot(source.args);
  assert.equal(state.samples.length,1);assert.deepEqual(source.reads,[{address:0x7fff0,length:16},{address:0,length:48}]);
  assert.ok(state.channels[0].waveform);assert.notEqual(state.channels[0].waveform.pcm,state.channels[1].waveform.pcm);
});

const wasmBinary=await readFile(new URL('../generated/psf-player/psf_player.wasm',import.meta.url));
async function coreFor(fixture,options={}) {
  const image=await preparePsfSongSource(await readPsfFileSet(fixture.standaloneFiles),'spu-conformance.psf');
  return createPsfPlaybackCore({image,wasmBinary,...options});
}

test('native observations leave CPU/SPU rendering unchanged and return detached state at exact frame boundaries',async()=>{
  const fixture=createPsfSpuFeatureFixture({carrier:23,pmon:true,reverb:true}),observed=await coreFor(fixture),plain=await coreFor(fixture);
  try {
    assert.deepEqual(observed.render(1024),plain.render(1024));
    const state=observed.observe(),position=observed.position;
    assert.equal(state.nativeFrames,1024);assert.equal(state.channels[23].gate,true);
    assert.equal(state.channels[22].gate,true);assert.equal(state.channels[23].active,true);
    assert.equal(state.channels[23].ended,true,'ENDX can be latched while this loop is active');
    assert.equal(state.channels[23].hardwarePmon,true);assert.equal(state.reverb.preset,'room');
    assert.equal(state.channels[23].waveform.packetCount,4);assert.equal(state.channels[23].waveform.endReached,true);
    assert.equal(state.channels[23].waveform.fullSampleKnown,false);
    state.channels[23].waveform.pcm.fill(1);state.channels[23].rawRegisters.fill(0);state.reverb.registers.fill(0);
    assert.equal(observed.observe().channels[23].pitch,0x1000);
    for(let n=0;n<10;n++)assert.equal(observed.observe().nativeFrames,1024);
    assert.equal(observed.position,position);
    assert.deepEqual(observed.render(4096),plain.render(4096),'observation never advances or modifies output/voice/RAM state');
    assert.equal(observed.observe().nativeFrames,5120);
  } finally {observed.dispose();plain.dispose();}
  assert.throws(()=>observed.observe(),/disposed/);
});

test('tracked CPU key gates survive cleared KON registers and distinguish later KOFF',async()=>{
  const fixture=createPsfSpuFeatureFixture({steps:[{delay:65535,writes:[[0x18c,1]]}]}),core=await coreFor(fixture);
  try {
    core.render(100);const held=core.observe();
    assert.equal(held.channels[0].gate,true);assert.equal(held.observation.keyGateMask,1);
    core.render(500);const released=core.observe();
    assert.equal(released.channels[0].gate,false);assert.equal(released.observation.keyGateMask,0);
    assert.equal(released.nativeFrames,600);
  } finally {core.dispose();}
});

test('observe performs bounded reads without modifying any CPU or SPU RAM',async()=>{
  let native,handle,observing=false;
  const reads=[];
  const fixture=createPsfSpuFeatureFixture({pair:true}),core=await coreFor(fixture,{moduleOptions:{onRuntimeInitialized(){
    native=this;
    const create=this._psf_create,readRam=this._psf_spu_read_ram;
    this._psf_create=(...args)=>(handle=create(...args));
    this._psf_spu_read_ram=(...args)=>{if(observing)reads.push({address:args[1],length:args[3]});return readRam(...args);};
  }}});
  const memory=(reader,length)=>{
    const buffer=native._malloc(length);
    try {assert.equal(reader(handle,0,buffer,length),1);return native.HEAPU8.slice(buffer,buffer+length);}
    finally {native._free(buffer);}
  };
  try {
    core.render(1024);
    const spuBefore=memory(native._psf_spu_read_ram,512*1024),cpuBefore=memory(native._psf_cpu_read_ram,2*1024*1024);
    observing=true;const state=core.observe();observing=false;
    assert.equal(state.nativeFrames,1024);assert.equal(reads.reduce((sum,value)=>sum+value.length,0),64);
    assert.ok(reads.every(value=>value.length<=64));
    assert.deepEqual(memory(native._psf_spu_read_ram,512*1024),spuBefore);
    assert.deepEqual(memory(native._psf_cpu_read_ram,2*1024*1024),cpuBefore);
  } finally {core.dispose();}
});
