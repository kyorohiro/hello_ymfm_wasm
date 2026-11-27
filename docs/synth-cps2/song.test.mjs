// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {QSoundPcm} from '../js/qsoundpcm.js';
import {demoVgm,demoRom,demoTracks} from './demo.js';
import {rebuildSongState} from './song-seek.js';
import {inspectSong,SongTransport} from './song.js';

test('imported echo comparison matches the original worklet score at 48 kHz across pause and block boundaries',()=>{
  const score=demoTracks.echo.score(), source=demoVgm(score), rate=48000;
  assert.deepEqual(inspectSong(source),{ticks:score.at(-1).t,canLoop:false,loopTick:null});
  const chip=new QSoundPcm(new Uint8Array(),rate);
  const transport=new SongTransport(source,chip,new Uint16Array(16));
  const reference=new QSoundPcm(demoRom(),rate);
  const length=Math.round(score.at(-1).t*rate/44100);
  const l=new Float32Array(length),r=new Float32Array(length);
  for(let i=0;i<score.length-1;i++){
    for(const [reg,val] of score[i].writes)reference.writeRegister(reg,val);
    const begin=Math.round(score[i].t*rate/44100), end=Math.round(score[i+1].t*rate/44100);
    reference.render(l.subarray(begin,end),r.subarray(begin,end));
  }
  const left=new Float32Array(length), right=new Float32Array(length);
  for(let i=0;i<length;i+=128){
    if(i===128){
      transport.paused=true;
      const a=new Float32Array(128).fill(1),b=a.slice();
      transport.render(a,b);
      assert.ok(a.every(x=>x===0)&&b.every(x=>x===0));
      assert.equal(transport.frames,128);
      transport.paused=false;
    }
    transport.render(left.subarray(i,i+128),right.subarray(i,i+128));
  }
  assert.deepEqual(left,l);assert.deepEqual(right,r);
  assert.deepEqual(chip.rom,demoRom());
});

test('preflight rejects other chip configurations and songs without embedded samples',()=>{
  const source=demoVgm();
  const header=new DataView(source.buffer);
  header.setUint32(0x2c,7670454,true);
  assert.throws(()=>inspectSong(source),/single-chip/);
  header.setUint32(0x2c,0,true);
  const start=256+7+header.getUint32(259,true);
  source.copyWithin(256,start);
  assert.throws(()=>inspectSong(source),/embedded/);
});

test('loop output matches an explicitly repeated command stream, including across pause and resume',()=>{
  const intro=[[0x78,0x8000],[1,0],[2,0x1234],[4,256],[5,256],[6,9000],[0xba,7000]];
  const source=demoVgm([{t:0,writes:intro},{t:23,writes:[[0x80,0x118]]},{t:61,writes:[]}]);
  const target=source.length-8; // pan write, 38-tick wait, end command
  const header=new DataView(source.buffer);
  const make=bytes=>new SongTransport(bytes,new QSoundPcm(new Uint8Array(),48000),new Uint16Array(16));
  for(const invalid of [target+1,source.length-1,source.length+4]){
    header.setUint32(0x1c,invalid-0x1c,true);
    assert.equal(inspectSong(source).canLoop,false);
  }
  header.setUint32(0x1c,target-0x1c,true);
  assert.ok(inspectSong(source).canLoop);
  const repeated=demoVgm([{t:0,writes:intro},...[23,61,99].map(t=>({t,writes:[[0x80,0x118]]})),{t:137,writes:[]}]);
  const original=make(source),expected=make(repeated);
  original.loop=true;
  function compare(frames) {
    const buffers=Array.from({length:4},()=>new Float32Array(frames));
    original.render(buffers[0],buffers[1]);expected.render(buffers[2],buffers[3]);
    assert.deepEqual(buffers[0],buffers[2]);assert.deepEqual(buffers[1],buffers[3]);
  }
  compare(100);
  original.paused=true;
  original.render(new Float32Array(128),new Float32Array(128));
  original.paused=false;
  compare(20);
  original.loop=false;
  compare(100);
  assert.ok(original.parser.ended);
});

test('seeking restores stereo output including PCM phase, ADPCM decoding and delayed echo',()=>{
  const events=[...demoTracks.echo.score(),...demoTracks.adpcm.score()].sort((a,b)=>a.t-b.t);
  const source=demoVgm(events),rate=48000;
  const make=()=>new SongTransport(source,new QSoundPcm(new Uint8Array(),rate),new Uint16Array(16));
  for(const tick of [0,22050,24000,44099,inspectSong(source).ticks]){
    const reference=make(),restored=make();
    const frame=Math.round(tick*rate/44100);
    reference.render(new Float32Array(frame),new Float32Array(frame));
    restored.restore(structuredClone(rebuildSongState(source,rate,tick,Array(19).fill(false))));
    const buffers=Array.from({length:4},()=>new Float32Array(4096));
    reference.render(buffers[0],buffers[1]);restored.render(buffers[2],buffers[3]);
    assert.deepEqual(buffers[0],buffers[2]);assert.deepEqual(buffers[1],buffers[3]);
    assert.deepEqual(restored.starts,reference.starts);
  }
});

test('exported pan demo repeats the same PCM hit at left, center and right',()=>{
  const bytes=demoVgm(demoTracks.pan.score());
  const chip=new QSoundPcm(new Uint8Array(),44100);
  const song=new SongTransport(bytes,chip,new Uint16Array(16));
  const left=new Float32Array(inspectSong(bytes).ticks), right=left.slice();
  song.render(left,right);
  function energy(samples,start){
    return samples.subarray(start,start+4410).reduce((sum,x)=>sum+x*x,0);
  }
  const first=energy(left,4410),middle=energy(left,26460),last=energy(right,48510);
  assert.ok(first>0);
  assert.equal(energy(right,4410),0);
  assert.equal(energy(left,48510),0);
  assert.equal(middle,energy(right,26460));
  assert.ok(Math.abs(last/first-1)<0.01 && Math.abs(middle/first-0.25)<0.01);
});
