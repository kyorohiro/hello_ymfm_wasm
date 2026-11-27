// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {QSoundPcm} from '../js/qsoundpcm.js';
import {demoVgm,demoRom,demoTracks} from './demo.js';
import {inspectSong,SongTransport} from './song.js';

test('imported echo comparison matches the original worklet score at 48 kHz across pause and block boundaries',()=>{
  const score=demoTracks.echo.score(), source=demoVgm(score), rate=48000;
  assert.equal(inspectSong(source),score.at(-1).t);
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
