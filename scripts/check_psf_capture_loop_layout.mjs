// SPDX-License-Identifier: BSD-3-Clause
// Original packets only: verify fresh-key capture against actual fixed SPU PCM.
// No AudioContext, audio device, browser, game input or WASM rebuild is used.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Ps1Spu} from '../tetorica_src/runtime/ps1_spu.js';
import {Ps1Synth} from '../tetorica_src/runtime/ps1synth.js';
import factory from '../docs/generated/ps1_spu_wasm.js';
import {playbackAdpcm} from '../test/helpers/spu_psf_playback_fixture.mjs';
import {readPsfLiveSnapshot} from '../docs/synth-spu/psf_live_snapshot.js';
import {preparePsfVoiceCapture} from '../docs/synth-spu/psf_capture.js';
import {readSpuInstrument} from '../docs/synth-spu/spu_synth_instrument.js';

if(process.argv.length!==2&&!(process.argv.length===4&&process.argv[2]==='--out'))
  throw new Error('Usage: node scripts/check_psf_capture_loop_layout.mjs [--out REPORT.json]');
const wasmBinary=await readFile(new URL('../docs/generated/ps1_spu_wasm.wasm',import.meta.url));
const create=()=>Ps1Spu.create({moduleFactory:factory,moduleOptions:{wasmBinary}});
const START=0x2000,EXTERNAL=0x3000,MARKER=START+32,FRAMES=4096;
const reverb={preset:'off',volumeLeft:.25,volumeRight:.25};
const source=playbackAdpcm();
for(let at=1;at<source.length;at+=16)source[at]=0;
source[33]=4;source[49]=3; // Loop Start after 56 samples; Repeat END after 112.
const external=new Uint8Array(32);
external[0]=external[16]=2;external[1]=6;external[17]=3;
for(let i=0;i<28;i++) {
  external[2+(i>>1)]|=(i<14?7:9)<<((i&1)*4);
  external[18+(i>>1)]|=(i<7?3:13)<<((i&1)*4);
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const interleave=({left,right})=>Float32Array.from({length:left.length*2},(_,i)=>(i&1)?right[i>>1]:left[i>>1]);
function pcmHash(pcm) {
  const bytes=Buffer.alloc(pcm.length*4);
  pcm.forEach((value,i)=>{assert(Number.isFinite(value));bytes.writeFloatLE(value,i*4);});
  return sha(bytes);
}
const same=(a,b)=>a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
const differences=(a,b)=>a.reduce((count,value,i)=>count+Number(!Object.is(value,b[i])),0);
function configure(core,start,repeat) {
  for(const [offset,value] of [[0x180,0x3fff],[0x182,0x3fff],[0x1aa,0xc000],
    [0,0x2000],[2,0x1000],[4,4096],[6,start/8],[8,15],[10,0x1fc0],[14,repeat/8]])core.write(offset,value);
}
async function raw(bytes=source,{start=START,repeat=EXTERNAL}={}) {
  const core=await create();core.loadRam(bytes,START);core.loadRam(external,EXTERNAL);
  configure(core,start,repeat);core.write(0x188,1);return core;
}
function capture(core,frame) {
  const ram=core.readRam(),registers=Array.from({length:8},(_,i)=>core.read(i*2));
  const state=readPsfLiveSnapshot({readRegister:offset=>core.read(offset),readRam:(at,length)=>ram.slice(at,at+length),
    nativeFrames:frame,keyGateMask:1,activeMask:1});
  const result=preparePsfVoiceCapture({state,ram,voice:0,frame},{referenceNote:'C4',reverb});
  assert.equal(sha(core.readRam()),sha(ram),'preparation never rewrites source RAM');
  assert.deepEqual(Array.from({length:8},(_,i)=>core.read(i*2)),registers,'preparation never changes source registers');
  return result;
}
async function renderInstrument(document) {
  const instrument=readSpuInstrument(document),core=await create(),synth=new Ps1Synth({core});
  try {
    const {adpcm,...options}=instrument.sample,sample=synth.loadADPCM(adpcm,options);
    synth.setPreset(0,{...instrument.preset,sample});synth.setReverb(instrument.reverb);synth.keyOn(0);
    return interleave(core.generateStereo(FRAMES));
  }finally{synth.dispose();}
}
const report={passed:false,scope:'Fresh key-on instrument capture; continuing decoder/envelope state is not captured',
  frames:FRAMES,source:{start:START,marker:MARKER,externalRepeat:EXTERNAL,bytes:source.length,sha256:sha(source)},cases:[],physicalOutputUsed:false};

// An old repeat register remains outside this sample until the later marker
// is crossed. Cache preparation knows that marker already; fresh KON uses it.
for(const [name,bytes,repeat,loopSource,resolved] of [
  ['marker-before-playback',source,EXTERNAL,'adpcm-marker',MARKER],
  ['markerless-internal-repeat',source.map((value,i)=>i===33?0:value),START+16,'repeat-register',START+16],
  ['one-shot-marker',source.map((value,i)=>i===49?1:value),EXTERNAL,null,null],
]) {
  const core=await raw(bytes,{repeat});
  try {
    const early=interleave(core.generateStereo(32)),result=capture(core,32);
    assert.equal(result.capture.repeatAddress,repeat);assert.equal(result.capture.loopSource,loopSource);
    assert.equal(result.capture.resolvedLoopAddress,resolved);
    assert.deepEqual(readSpuInstrument(result.instrument).sample.adpcm,bytes,'no re-encoding or packet edits');
    if(loopSource==='adpcm-marker')assert.equal(core.read(14)*8,EXTERNAL,'raw repeat has not reached the marker yet');
    const expected=new Float32Array(FRAMES*2);expected.set(early);expected.set(interleave(core.generateStereo(FRAMES-32)),early.length);
    const portable=await renderInstrument(result.instrument);assert(same(expected,portable),'fresh source key-on and captured Synth are sample-exact');
    report.cases.push({name,rawRepeat:repeat,loopSource,resolvedLoopAddress:resolved,
      loopStartSamples:result.capture.loopStartSamples,pcmSha256:pcmHash(portable),sampleExact:true,
      warnings:result.capture.warnings??[]});
  }finally{core.dispose();}
}

// A driver can force a different loop after the marker has passed. That
// changes continuation, but a new KON clears the forced flag and uses marker.
{
  const forced=await raw(),normal=await raw();
  try {
    forced.generateStereo(80);normal.generateStereo(80);forced.write(14,EXTERNAL/8);
    const result=capture(forced,80);assert.equal(result.capture.repeatAddress,EXTERNAL);
    assert.equal(result.capture.loopSource,'adpcm-marker');assert.equal(result.capture.resolvedLoopAddress,MARKER);
    const continuation=interleave(forced.generateStereo(FRAMES)),baseline=interleave(normal.generateStereo(FRAMES));
    assert(same(continuation.subarray(0,64),baseline.subarray(0,64)),'both voices reach END from the same source position');
    assert(!same(continuation,baseline),'forced external loop changes continuing playback');
    forced.write(0x188,1);const restarted=interleave(forced.generateStereo(FRAMES));
    const portable=await renderInstrument(result.instrument);assert(same(restarted,portable));
    report.cases.push({name:'forced-after-marker',rawRepeat:EXTERNAL,loopSource:result.capture.loopSource,
      resolvedLoopAddress:result.capture.resolvedLoopAddress,first32FramesEqual:true,
      continuationDifferences:differences(continuation,baseline),freshRestartSampleExact:true,
      restartSha256:pcmHash(restarted),warnings:result.capture.warnings??[]});
  }finally{forced.dispose();normal.dispose();}
}

// Programmed Start may already describe the next note while the running
// voice still plays its previous sample. Capture explicitly means a new key.
{
  const core=await raw(source,{start:EXTERNAL});
  try {
    core.generateStereo(80);core.write(6,START/8);const result=capture(core,80);
    assert.equal(result.capture.repeatAddress,EXTERNAL);assert.equal(result.capture.resolvedLoopAddress,MARKER);
    core.write(0x188,1);const restarted=interleave(core.generateStereo(FRAMES));
    assert(same(restarted,await renderInstrument(result.instrument)));
    report.cases.push({name:'programmed-start-for-next-key',rawRepeat:EXTERNAL,resolvedLoopAddress:MARKER,
      freshRestartSampleExact:true,pcmSha256:pcmHash(restarted)});
  }finally{core.dispose();}
}

// Without a marker there is no safe fallback to the first packet. Show that
// fabricating that metadata changes actual PCM after the first END, and reject.
{
  const bytes=source.slice();bytes[33]=0;const core=await raw(bytes),fabricated=await raw(bytes,{repeat:START});
  try {
    assert.throws(()=>capture(core,0),/discontiguous|inside the captured contiguous sample/);
    const actual=interleave(core.generateStereo(FRAMES)),wrong=interleave(fabricated.generateStereo(FRAMES));
    assert(same(actual.subarray(0,224),wrong.subarray(0,224)));assert(!same(actual,wrong));
    report.cases.push({name:'markerless-external-repeat',rejected:true,first112FramesEqual:true,
      fabricatedStartDifferences:differences(actual,wrong),externalLoopPcmSha256:pcmHash(actual)});
  }finally{core.dispose();fabricated.dispose();}
}
report.passed=true;
if(process.argv[2]==='--out')await writeFile(process.argv[3],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
