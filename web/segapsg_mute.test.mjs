import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SegaPSG} from './segapsg.js';
import factory from '../docs/generated/segapsg_wasm.js';
const make=()=>SegaPSG.create({moduleFactory:factory,moduleOptions:{wasmBinary:readFileSync(new URL('../docs/generated/segapsg_wasm.wasm',import.meta.url))}});
const program=p=>[0x84,0x10,0x92,0xa7,0x12,0xb3,0xc9,0x14,0xd4,0xe7,0xf5].forEach(v=>p.write(v));
test('Sega PSG isolates all three tones and noise, retains mute on reset and restores live volume',async()=>{
 const p=await make();try {
  program(p);const state=p.saveState(),mix=p.generateStereo(1024).left;
  const sum=new Float32Array(1024);
  for(let solo=0;solo<4;solo++){
   p.loadState(state);for(let ch=0;ch<4;ch++)p.setChannelMuted(ch,ch!==solo);
   const samples=p.generateStereo(1024).left;assert(samples.some(v=>v!==0));
   samples.forEach((v,i)=>sum[i]+=v);
  }
  mix.forEach((v,i)=>assert(Math.abs(v-sum[i])<1e-7));
  for(let ch=0;ch<4;ch++)p.setChannelMuted(ch,true);
  p.reset();program(p);assert(p.generateStereo(128).left.every(v=>v===0));
  // Live writes while muted remain latched normally, including data-only volume.
  p.write(0x95);p.write(0x02);p.setChannelMuted(0,false);
  assert(p.generateStereo(128).left.some(v=>v!==0));
  assert.throws(()=>p.setChannelMuted(4,true),/Invalid/);
 }finally{p.dispose();}
});
test('muting Tone 3 preserves linked noise and unmuting preserves oscillator phase',async()=>{
 const p=await make(),ref=await make();try{
  program(p);program(ref);p.setChannelMuted(2,true);
  p.generateStereo(1371);ref.generateStereo(1371);
  p.setChannelMuted(2,false);assert.deepEqual(p.generateStereo(1024),ref.generateStereo(1024));
  for(let ch=0;ch<3;ch++){p.setChannelMuted(ch,true);ref.setChannelMuted(ch,true);}
  p.setChannelMuted(3,true);p.generateStereo(731);ref.generateStereo(731);
  p.setChannelMuted(3,false);assert.deepEqual(p.generateStereo(1024),ref.generateStereo(1024));
 }finally{p.dispose();ref.dispose();}
});
