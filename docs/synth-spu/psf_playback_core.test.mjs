// SPDX-License-Identifier: BSD-3-Clause
// Numeric-only PSF machine tests: no AudioContext or output device is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPsfPlaybackCore} from './psf_playback_core.js';
import {preparePsfSongSource} from './psf_song_source.js';
import {readPsfFileSet} from '../playground/playground_ps1_psf.js';
import {createPsfPlaybackFixture} from '../../test/helpers/spu_psf_playback_fixture.mjs';

const wasmBinary=await readFile(new URL('../generated/psf-player/psf_player.wasm',import.meta.url));
const fixture=createPsfPlaybackFixture();
const standalone=await preparePsfSongSource(await readPsfFileSet(fixture.standaloneFiles),'standalone.psf');
const mini=await preparePsfSongSource(await readPsfFileSet(fixture.files),'Demo/track.minipsf');
const create=(image=standalone,options={})=>createPsfPlaybackCore({image,wasmBinary,...options});
const peak=samples=>samples.reduce((value,sample)=>Math.max(value,Math.abs(sample)),0);
const crossings=samples=>{
  let count=0;
  for(let frame=401;frame<samples.length/2;frame++)if(samples[(frame-1)*2]<=0&&samples[frame*2]>0)count++;
  return count;
};

test('original PSF MIPS program executes and produces finite stereo PCM',async()=>{
  const core=await create();
  try {
    assert.equal(core.sampleRate,44100);
    const samples=core.render(8820);
    assert.equal(samples.length,17640);
    assert.ok(samples.every(Number.isFinite));
    assert.ok(peak(samples)>.001,'CPU sample transfer and key-on must produce sound');
    assert.ok(peak(samples)<=1);
    const left=samples.filter((_,index)=>!(index&1)),right=samples.filter((_,index)=>index&1);
    assert.ok(peak(left)>peak(right)*1.5,'authored L/R volume difference survives execution');
    assert.ok(crossings(samples)>20,'the test contains a repeating ADPCM cycle');
    assert.equal(core.position,.2);
  } finally {core.dispose();}
});

test('MiniPSF instruction overlay changes the executed sample pitch',async()=>{
  const plain=await create(),patched=await create(mini);
  try {
    const a=plain.render(8820),b=patched.render(8820);
    assert.ok(peak(a)>.001&&peak(b)>.001);
    assert.ok(crossings(b)>crossings(a)*1.15,'0x1400 patch must run faster than original 0x1000');
    assert.notDeepEqual(a,b);
  } finally {plain.dispose();patched.dispose();}
});

test('render subdivision preserves samples and separate machines keep independent state',async()=>{
  const whole=await create(),split=await create();
  try {
    const expected=whole.render(8193),actual=new Float32Array(expected.length);
    let frames=0;
    while(frames<8193) {
      const count=Math.min(127,8193-frames);
      actual.set(split.render(count),frames*2);frames+=count;
    }
    assert.deepEqual(actual,expected);
    whole.dispose();
    assert.ok(peak(split.render(1025))>.001,'disposing one machine cannot stop another');
  } finally {whole.dispose();split.dispose();}
});

test('machine validates RAM, entry point, timing, render sizes and disposal',async()=>{
  await assert.rejects(create({...standalone,ram:new Uint8Array(8)}),/2 MiB RAM/);
  await assert.rejects(create({...standalone,pc:0x80010001}),/entry point/);
  await assert.rejects(create({...standalone,pc:0x80030000}),/entry point/);
  await assert.rejects(create({...standalone,refresh:55}),/refresh/);
  const core=await create();
  for(const frames of [0,-1,1.5,44101])assert.throws(()=>core.render(frames),/render size/);
  assert.equal(core.render(1).length,2);
  core.dispose();core.dispose();
  assert.throws(()=>core.render(1),/disposed/);
});

test('abort cancels creation and further rendering without an audio device',async()=>{
  const early=new AbortController();early.abort();
  await assert.rejects(create(standalone,{signal:early.signal}),{name:'AbortError'});
  const late=new AbortController(),core=await create(standalone,{signal:late.signal});
  late.abort();
  assert.throws(()=>core.render(1),{name:'AbortError'});
  core.dispose();
});
