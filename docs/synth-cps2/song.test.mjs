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
  const chip=new QSoundPcm(new Uint8Array(),rate,{spatialPcm:true});
  const transport=new SongTransport(source,chip,new Uint16Array(16));
  const reference=new QSoundPcm(demoRom(),rate,{spatialPcm:true});
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
  const make=()=>new SongTransport(source,new QSoundPcm(new Uint8Array(),rate,{spatialPcm:true}),new Uint16Array(16));
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

test('standard-mode PCM stereo balance tracks CTR at five pan positions',()=>{
  const hits=demoTracks.pan.score().slice(0,5);
  // 100 ms stereo RMS measurements of the same generated hits, libvgm CTR at 44.1 kHz.
  const reference=[[2884,2340],[2562,1014],[2371,1623],[1479,2280],[2332,2884]];
  for(const [i,pan] of [0,7,16,25,32].entries()){
    const score=hits.map(({t,writes})=>({t,writes:writes.map(([r,v])=>[r,r===0x80?0x110+pan:v])}));
    score.push({t:8820,writes:[]});
    const chip=new QSoundPcm(new Uint8Array(),44100,{spatialPcm:true});
    const song=new SongTransport(demoVgm(score),chip,new Uint16Array(16));
    const left=new Float32Array(8820),right=left.slice();
    song.render(left,right);
    for(const [ch,samples] of [left,right].entries()){
      const energy=samples.subarray(4410).reduce((n,v)=>n+v*v,0);
      const rms=Math.sqrt(energy/4410)*32767;
      // CTR's player gain is approximately twice the Synth gain.
      assert.ok(Math.abs(2*rms/reference[i][ch]-1)<0.08,`pan ${pan}, side ${ch}`);
    }
  }
});

test('ROM history follows played banks and seek restores the ROM image at the requested tick',()=>{
  const u32=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24];
  const block=(offset,bytes)=>[0x67,0x66,0x8f,...u32(8+bytes.length),...u32(0x10100),...u32(offset),...bytes];
  const write=(reg,value)=>[0xc4,value>>>8,value&255,reg];
  const commands=[
    ...block(0,[12]),...write(5,256),...write(6,1000),0x61,100,0,
    ...block(0,[34]),...block(0x10000,[56]),...write(0x78,0x8001),0x61,100,0,
    ...write(6,0),0x61,100,0,0x66,
  ];
  const bytes=new Uint8Array(256+commands.length);
  bytes.set(demoVgm().subarray(0,256));bytes.set(commands,256);
  new DataView(bytes.buffer).setUint32(4,bytes.length-4,true);
  const at=t=>rebuildSongState(bytes,44100,t,Array(19).fill(false)).chip;
  const early=at(50),late=at(250);
  const history=t=>rebuildSongState(bytes,44100,t,Array(19).fill(false)).ranges.map(([,range])=>range);
  assert.deepEqual(history(50).map(p=>p.bank),[0]);
  assert.deepEqual(history(250).map(p=>[p.bank,Boolean(p.earlierImage)]),[[0,true],[1,false]]);
  assert.equal(early.rom[0],12);assert.equal(early.romUsage[256],0);
  assert.equal(late.rom[0],34);assert.equal(late.rom[65536],56);
  assert.equal(late.voices[0].volume,0);
  assert.deepEqual([...late.romUsage.entries()].filter(([,used])=>used),[[0,1],[256,1]]);
});

test('one ROM region can have multiple PCM rates and an independent fixed-rate ADPCM preset',()=>{
  const bytes=demoVgm([
    {t:0,writes:[[1,8],[2,512],[4,16],[5,24],[0xca,8],[0xcb,24],[0xcc,0]]},
    {t:100,writes:[[2,768]]},
    {t:200,writes:[]},
  ]);
  const ranges=rebuildSongState(bytes,44100,150,Array(19).fill(false)).ranges.map(([,p])=>p);
  assert.deepEqual(ranges.filter(p=>p.kind==='PCM').map(p=>[p.start,p.end,p.rate,p.loop]),[[8,24,512,16],[8,24,768,16]]);
  assert.deepEqual(ranges.filter(p=>p.kind==='ADPCM'),[{kind:'ADPCM',bank:0,start:8,end:24}]);
});
