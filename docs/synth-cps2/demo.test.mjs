// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {QSoundPcm} from '../js/qsoundpcm.js';
import {demoRom,demoScore,demoVgm,noteWrites} from './demo.js';

test('CH1 bank is in CH16 register 0x78; half-rate phase and loop survive render boundaries',()=>{
  const rom = new Uint8Array(65538);
  rom.set([64,192],65536);
  const chip = new QSoundPcm(rom);
  for (const [r,v] of [[0x78,0x8001],[2,0x800],[4,2],[5,2],[6,0x4000],[0x80,0x110]]) chip.writeRegister(r,v);
  const left = new Float32Array(7), right = new Float32Array(7);
  chip.render(left.subarray(0,3),right.subarray(0,3));
  chip.render(left.subarray(3),right.subarray(3));
  assert.deepEqual([...left],[.5,.5,-.5,-.5,.5,.5,-.5]);
  assert.ok(right.every(x=>x===0));
});

test('original two-channel demo supplies its own ROM and reproduces the score as QSound VGM writes',()=>{
  const bytes = demoVgm(), view=new DataView(bytes.buffer);
  assert.equal(view.getUint32(4,true),bytes.length-4);
  assert.equal(view.getUint32(0xb4,true),4_000_000);
  const block=0x34+view.getUint32(0x34,true);
  assert.deepEqual([...bytes.slice(block,block+3)],[0x67,0x66,0x8f]);
  const size=view.getUint32(block+7,true), rom=bytes.slice(block+15,block+15+size);
  assert.deepEqual(rom,demoRom());
  const chip=new QSoundPcm(rom,44100), writes=[];
  let t=0, peak=0, stereo=false, i=block+7+view.getUint32(block+3,true);
  while(bytes[i]!==0x66){
    if(bytes[i]===0x61){
      const n=view.getUint16(i+1,true), left=new Float32Array(n),right=new Float32Array(n);
      chip.render(left,right);t+=n;i+=3;
      for(let j=0;j<n;j++){peak=Math.max(peak,Math.abs(left[j]));if(left[j]!==right[j])stereo=true;}
    }else{
      assert.equal(bytes[i],0xc4);
      const reg=bytes[i+3],value=view.getUint16(i+1);
      chip.writeRegister(reg,value);writes.push([t,reg,value]);i+=4;
    }
  }
  assert.deepEqual(writes,demoScore().flatMap(e=>e.writes.map(w=>[e.t,...w])));
  assert.equal(view.getUint32(0x18,true),t);
  assert.ok(peak>.1 && peak<1 && stereo);
  assert.equal(noteWrites(15,60,0,16,0)[0][0],112);
});

test('ADPCM high/low nibble cadence, latched volume and retrigger', () => {
  const chip = new QSoundPcm(Uint8Array.of(0x78));
  for (const [reg,value] of [[0xca,0],[0xcb,1],[0xcd,0x7fff],[0xd6,1],[0x90,0x110]]) chip.writeRegister(reg,value);
  const tick = () => {chip.tick();return chip.left * 32768;};
  assert.equal(tick(),37);
  chip.writeRegister(0xcd,0);
  assert.deepEqual(Array.from({length:6},tick),[37,37,-84,-84,-84,0]);
  chip.writeRegister(0xd6,1);
  assert.ok(Array.from({length:9},tick).every(x => x===0));
});
