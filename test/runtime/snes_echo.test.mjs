import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../../docs/generated/spc_wasm.js';
import {SnesDspCore} from '../../tetorica_src/runtime/spc.js';
import {SnesSynth,SNES_ECHO_RESERVED_BYTES,SNES_ECHO_MAX_SAMPLE_BYTES} from '../../tetorica_src/runtime/snessynth.js';

const pulse=Uint8Array.of(0xc0,0x70,0,0,0,0,0,0,0,0xc1,0,0,0,0,0,0,0,0);
const wave=Uint8Array.of(0xc3,0x12,0x34,0x56,0x76,0x54,0x32,0x10,0xfe);
const peak=values=>values.reduce((result,value)=>Math.max(result,Math.abs(value)),0);
function fake(){
  const ram=new Uint8Array(65536),dsp=new Uint8Array(128),writes=[];
  const core={reset(){ram.fill(0);dsp.fill(0);writes.push('reset');},loadRam(data,at){ram.set(data,at);writes.push('ram');},writeDsp(reg,value){dsp[reg]=value;writes.push([reg,value]);},readDsp:reg=>dsp[reg],dispose(){}};
  return {synth:new SnesSynth({core}),ram,dsp,writes};
}
let assets;
async function real(t){
  assets??=readFile(new URL('../../docs/generated/spc_wasm.wasm',import.meta.url));
  const core=await SnesDspCore.create({moduleFactory:factory,moduleOptions:{wasmBinary:await assets}});
  t.after(()=>core.dispose());return {core,synth:new SnesSynth({core})};
}
function render(synth,count){const left=new Float32Array(count),right=new Float32Array(count);synth.renderInto(left,right);return {left,right};}

test('Echo starts disabled; first enable relocates IDs safely and retains the reservation across disable/reset',()=>{
  const {synth,ram,dsp,writes}=fake(),sample=synth.loadBRR(wave,{rootNote:60,loopStartSamples:0});
  synth.setPreset(3,{sample,volumeLeft:-22,adsr1:0x9f});synth.noteOn(3,60);
  const before=synth.getPreset(3),state=synth.setEcho({enabled:true});
  assert.equal(state.reserved,true);assert.equal(state.byteLength,SNES_ECHO_RESERVED_BYTES);assert.equal(SNES_ECHO_MAX_SAMPLE_BYTES,33786);
  assert.equal(sample.startAddress,1024,'previous returned address is a copied historical value');
  assert.equal(synth.getState().samples[0].startAddress,0x7c00);assert.equal(synth.getState().directoryAddress,0x7800);
  assert.deepEqual(synth.getPreset(3),before);assert.deepEqual(ram.slice(0x7c00,0x7c09),wave);
  assert.deepEqual([...ram.slice(0x7800,0x7804)],[0,124,0,124]);assert.equal(dsp[0x5c],255);assert.equal(dsp[0x4c],0);
  const starts=writes.filter(v=>v==='reset').length;
  synth.setEcho({delay:15,feedback:-64,volumeLeft:-32,volumeRight:63,sendMask:8,fir:[64,32,16,8,4,2,1,-1]});
  assert.equal(writes.filter(v=>v==='reset').length,starts,'live edits do not reset or relocate voices');
  assert.equal(dsp[0x6d],0);assert.equal(dsp[0x7d],15);assert.equal(dsp[0x0d],192);assert.equal(dsp[0x2c],224);assert.equal(dsp[0x4d],8);assert.equal(dsp[0x7f],255);
  const detached=synth.getEcho();detached.fir.fill(0);assert.equal(synth.getEcho().fir[0],64);
  synth.setEcho({enabled:false});assert.equal(synth.getEcho().reserved,true);assert.equal(dsp[0x2c],0);assert.equal(dsp[0x4d],0);assert.equal(dsp[0x6c]&0x20,0x20);
  synth.reset();assert.equal(synth.getState().directoryAddress,0x7800);assert.deepEqual(ram.slice(0x7c00,0x7c09),wave);assert.equal(synth.getEcho().feedback,-64);
});

test('Echo validation and capacity failures leave RAM, registers, sample metadata and writes untouched',()=>{
  const {synth,ram,dsp,writes}=fake(),bytes=new Uint8Array(64512);bytes[bytes.length-9]=1;synth.loadBRR(bytes,{rootNote:60});
  const baseline=synth.getState(),memory=ram.slice(),registers=dsp.slice(),count=writes.length;
  const invalid=[null,[],{unknown:1},{enabled:1},{delay:16},{delay:NaN},{feedback:128},{volumeLeft:-129},{volumeRight:1.5},{sendMask:256},{fir:null},{fir:undefined},{fir:new Int8Array(8)},{fir:Array(8)},{fir:[128,0,0,0,0,0,0,0]},{fir:[0]},{enabled:true}];
  for(const value of invalid){assert.throws(()=>synth.setEcho(value));assert.deepEqual(synth.getState(),baseline);assert.deepEqual(ram,memory);assert.deepEqual(dsp,registers);assert.equal(writes.length,count);}
  const other=fake();other.synth.setEcho({enabled:true});const exact=new Uint8Array(33786);exact[exact.length-9]=1;
  other.synth.loadBRR(exact,{rootNote:60});assert.equal(other.synth.nextAddress,65530);
  const before=other.ram.slice();assert.throws(()=>other.synth.loadBRR(pulse,{rootNote:60}),/RAM is full/);assert.deepEqual(other.ram,before);
});

test('real Echo produces delayed signed stereo output and FIR-zero removes the wet signal',async t=>{
  const wet=await real(t),dry=await real(t),filtered=await real(t);
  for(const p of [wet,filtered])p.synth.setEcho({enabled:true,delay:2,feedback:0,volumeLeft:64,volumeRight:-64,sendMask:1,...(p===filtered?{fir:Array(8).fill(0)}:{})});
  for(const p of [wet,dry,filtered]){const sample=p.synth.loadBRR(pulse,{rootNote:60});p.synth.setPreset(0,{sample,gain:127,volumeLeft:32,volumeRight:32});p.synth.noteOn(0,60);}
  const a=render(wet.synth,4096),b=render(dry.synth,4096),c=render(filtered.synth,4096);
  assert.deepEqual(a.left.slice(0,500),b.left.slice(0,500));assert.equal(peak(b.left.slice(128)),0);
  assert(peak(a.left.slice(900,1300))>.001,'Echo returns after its hardware delay');
  assert.equal(peak(a.left.slice(1500)),0,'zero feedback has no second return');
  assert.deepEqual(c.left,b.left,'zero FIR coefficients preserve dry audio and remove only Echo');
  assert(a.left.every(Number.isFinite));assert(a.right.every(Number.isFinite));
  for(let index=128;index<a.left.length;index++)assert(Math.abs(a.left[index]+a.right[index])<=2/32768,'signed return changes polarity');
});

test('Echo setup matches independent raw DSP register programming byte-for-byte',async t=>{
  const high=await real(t),raw=await real(t);
  high.synth.setEcho({enabled:true,delay:3,feedback:41,volumeLeft:50,volumeRight:31,sendMask:1,fir:[96,32,0,0,0,0,0,0]});
  const sample=high.synth.loadBRR(wave,{rootNote:60,loopStartSamples:0}),other=raw.synth.loadBRR(wave,{rootNote:60,loopStartSamples:0});
  raw.core.loadRam(new Uint8Array(0x7800),0);raw.core.loadRam(wave,0x7c00);raw.core.loadRam(Uint8Array.of(0,124,0,124),0x7800);
  const registers=[[0x5d,0x78],[0x6d,0],[0x7d,3],[0x0d,41],[0x2c,50],[0x3c,31],[0x4d,1],[0x6c,0]];
  for(let i=0;i<8;i++)registers.push([0x0f+i*16,[96,32,0,0,0,0,0,0][i]]);
  for(const [reg,value]of registers)raw.core.writeDsp(reg,value);
  high.synth.setPreset(0,{sample,gain:100,volumeLeft:16,volumeRight:-24});raw.synth.setPreset(0,{sample:other,gain:100,volumeLeft:16,volumeRight:-24});
  high.synth.noteOn(0,60);raw.synth.noteOn(0,60);
  for(const count of [1,17,128,2000,4096]){const a=render(high.synth,count),b=render(raw.synth,count);assert.deepEqual(a.left,b.left);assert.deepEqual(a.right,b.right);}
});

test('maximum live Echo delay and FIR changes cannot write sample or directory RAM',async t=>{
  const {synth,core}=await real(t);synth.setEcho({enabled:true,delay:15});
  const sample=synth.loadBRR(wave,{rootNote:60,loopStartSamples:0});synth.setPreset(0,{sample,gain:100,volumeLeft:32,volumeRight:32});synth.noteOn(0,60);
  const saved=core.snapshot().ram.slice(0x7800);let previousFrames=core.nativeFrames;
  for(const delay of [15,0,1,14,3]){
    synth.setEcho({delay,feedback:40,fir:[64,32,16,0,0,0,0,0]});const pcm=render(synth,8193);
    assert(peak(pcm.left)>.001);assert(core.nativeFrames>previousFrames);previousFrames=core.nativeFrames;
    assert.deepEqual(core.snapshot().ram.slice(0x7800),saved);
  }
  assert.equal(synth.getPreset(0).sample,sample.id);
});
