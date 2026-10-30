// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../docs/generated/scsp_wasm.js';
import {Scsp,SCSP_RAM_BYTES,SCSP_SAMPLE_RATE} from './scsp.js';
let module;
const moduleFactory=async()=>module??=await factory({wasmBinary:await readFile(new URL('../docs/generated/scsp_wasm.wasm',import.meta.url))});
async function create(t){const chip=await Scsp.create({moduleFactory});t.after(()=>chip.dispose());return chip;}
function sine(chip,{slot=0,pan=0}={}) {
  const pcm=Int16Array.from({length:64},(_,i)=>Math.round(8192*Math.sin(i*2*Math.PI/64)));
  const bytes=new Uint8Array(128),view=new DataView(bytes.buffer);
  pcm.forEach((v,i)=>view.setInt16(i*2,v,false));chip.loadRam(bytes,0x1000);
  const b=slot*32;
  for(const [at,v]of [[0x400,0x20f],[b+2,0x1000],[b+4,0],[b+6,64],[b+8,31],[b+10,0x3c1f],[b+12,0],[b+14,0],[b+16,0],[b+18,0],[b+20,0],[b+22,0xe000|pan],[b,0x1820]])chip.write(at,v);
  return {bytes,pcm};
}

test('real SCSP renders the original big-endian PCM16 sine with exact tuning and stereo samples',async t=>{
  const chip=await create(t),{pcm}=sine(chip);
  assert.equal(chip.sampleRate,SCSP_SAMPLE_RATE);chip.prepare(128);
  const {left,right}=chip.generateStereo(1024);
  for(let i=0;i<left.length;i++){assert.equal(left[i],pcm[i%64]/32768);assert.equal(left[i],right[i]);}
  assert.equal(chip.nativeFrames,1024);
  chip.write(0,0x1020);const released=chip.generateStereo(4410);
  assert(released.left.subarray(-100).every(v=>v===0));
});

test('render offsets and block partitioning preserve output and monitor state',async t=>{
  const a=await create(t),b=await create(t);sine(a);sine(b);
  const expected=a.generateStereo(1003),left=new Float32Array(1005).fill(9),right=left.slice();
  for(let at=0;at<1003;at+=7)b.renderInto(left,right,Math.min(7,1003-at),at+1);
  assert.deepEqual(left.subarray(1,1004),expected.left);assert.deepEqual(right.subarray(1,1004),expected.right);
  assert.equal(left[0],9);assert.equal(left[1004],9);assert.equal(a.read(0x408),b.read(0x408));
});

test('unsupported writes and bad host transfers fail before modifying state or advancing audio',async t=>{
  const chip=await create(t);sine(chip);const before=chip.read(0),ram=chip.readRam(0x1000,128);
  for(const [at,v,mask]of [[1,0,65535],[0x418,0,65535],[0x400,15,65535],[0,0x1980,65535],[0,65536,65535],[0,1,-1]])assert.throws(()=>chip.write(at,v,mask));
  assert.equal(chip.read(0),before);assert.throws(()=>chip.read(0x418));
  for(const fn of [()=>chip.loadRam(new Uint8Array(2),SCSP_RAM_BYTES-1),()=>chip.loadRam(new Int16Array(2)),
    ()=>chip.readRam(-1,4),()=>chip.readRam(SCSP_RAM_BYTES,1),()=>chip.reset({clearRam:1}),
    ()=>chip.renderInto(new Float32Array(2),new Float32Array(2),3),()=>chip.prepare(-1)])assert.throws(fn);
  const overlap=new Float32Array(16);assert.throws(()=>chip.renderInto(overlap,overlap,4));
  assert.throws(()=>chip.renderInto(new Float32Array(4),new Float32Array(4),1,-1));
  assert.equal(chip.nativeFrames,0);assert.deepEqual(chip.readRam(0x1000,128),ram);
  chip.write(22,0x1f,0xff);assert.equal(chip.read(22),0xe01f);
});

test('RAM readback is an owned copy, zero-length endpoints work, and reset/instances remain independent',async t=>{
  const a=await create(t),b=await create(t);const {bytes}=sine(a);sine(b,{slot:31,pan:0x1f00});
  const read=a.readRam(0x1000,128);read.fill(0);assert.deepEqual(a.readRam(0x1000,128),bytes);
  a.loadRam(new Uint8Array(),SCSP_RAM_BYTES);assert.equal(a.readRam(SCSP_RAM_BYTES,0).length,0);
  a.reset();assert.equal(a.nativeFrames,0);assert.deepEqual(a.readRam(0x1000,128),bytes);
  assert(a.generateStereo(64).left.every(v=>v===0));const other=b.generateStereo(64);
  assert(other.left.some(v=>v!==0));assert(other.right.every(v=>v===0));
  a.reset({clearRam:true});assert(a.readRam(0x1000,128).every(v=>v===0));
  a.dispose();a.dispose();assert.throws(()=>a.read(0),/disposed/);assert.throws(()=>a.generateStereo(0),/disposed/);
});

test('WASM-backed destinations are refused, shared-memory input upload is stabilized, and prepared PCM buffers are reused',async t=>{
  const chip=await create(t);sine(chip);chip.prepare(128);const ptr=chip.leftPtr;
  chip.renderInto(new Float32Array(64),new Float32Array(64));assert.equal(chip.leftPtr,ptr);
  const memory=new Float32Array(chip.module.HEAPU8.buffer,ptr,64);
  assert.throws(()=>chip.renderInto(memory,new Float32Array(64)),/outside WASM memory/);
  const source=chip.module.HEAPU8.subarray(ptr,ptr+32),expected=source.slice();
  chip.loadRam(source,0x2000);assert.deepEqual(chip.readRam(0x2000,32),expected);
});
