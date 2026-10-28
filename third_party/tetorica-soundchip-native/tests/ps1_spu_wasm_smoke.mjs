// SPDX-License-Identifier: BSD-3-Clause
// Actual archived/rebuilt C ABI, original ADPCM and optional Native parity.
// No npm, application checkout, ROM, browser, MAME framework or audio device.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const [directory='dist/wasm',fixture]=process.argv.slice(2);
assert(process.argv.length<=4,'Usage: node tests/ps1_spu_wasm_smoke.mjs [wasm-directory] [native-fixture]');
const temporary=await mkdtemp(path.join(tmpdir(),'tetorica-ps1-spu-wasm-'));
let m;
try{const loader=path.join(temporary,'loader.mjs');await writeFile(loader,await readFile(path.join(directory,'ps1_spu_wasm.js')));
  const {default:create}=await import(pathToFileURL(loader));m=await create({wasmBinary:await readFile(path.join(directory,'ps1_spu_wasm.wasm'))});
}finally{await rm(temporary,{recursive:true,force:true});}
for(const name of ['create','destroy','reset','sample_rate','write','read','load_ram','read_ram','render'])assert.equal(typeof m['_ps1_spu_'+name],'function','C ABI export '+name);
assert.equal(m._ps1_spu_sample_rate(),44100);
const n=32768,l=m._malloc(n*4),r=m._malloc(n*4),ram=m._malloc(512*1024),handles=new Set(),checks=[];
let frames=0;
const create=()=>{const h=m._ps1_spu_create();assert(h>0);handles.add(h);return h;};
const write=(h,a,v)=>assert.equal(m._ps1_spu_write(h,a,v),1);
const wave=new Uint8Array(64);
for(let b=0;b<4;b++){wave[b*16]=4;wave[b*16+1]=b===0?6:b===3?3:0;
  for(let p=0;p<14;p++){const f=i=>Math.round(7*Math.sin(2*Math.PI*i/112))&15;wave[b*16+2+p]=f(b*28+2*p)|(f(b*28+2*p+1)<<4);}}
const load=h=>{m.HEAPU8.set(wave,ram);assert.equal(m._ps1_spu_load_ram(h,0x2000,ram,wave.length),1);};
const configure=h=>{load(h);write(h,0x180,0x3fff);write(h,0x182,0x3fff);write(h,0x1aa,0xc000);};
const voice=(h,c,pitch=4096)=>{for(const [a,v] of [[0,0x1800],[2,0x1000],[4,pitch],[6,0x400],[8,15],[10,0x1fc0],[14,0x400]])write(h,c*16+a,v);};
const key=(h,c,on)=>write(h,(on?0x188:0x18c)+(c>=16?2:0),1<<(c%16));
const render=(h,count)=>{assert(count<=n);assert.equal(m._ps1_spu_render(h,l,r,count),1);frames+=count;
  const left=Float32Array.from(m.HEAPF32.subarray(l/4,l/4+count)),right=Float32Array.from(m.HEAPF32.subarray(r/4,r/4+count));
  assert(left.every(x=>Number.isFinite(x)&&Math.abs(x)<=1));assert(right.every(x=>Number.isFinite(x)&&Math.abs(x)<=1));return {left,right};};
const peak=a=>a.reduce((p,v)=>Math.max(p,Math.abs(v)),0);
// The original BSD-3-Clause Room table by pSXAuthor/R. Belmont; preset constants,
// not another effect implementation (vendor/mame-ps1-spu/spu_tables.cpp).
const room=[0x007d,0x005b,0x6d80,0x54b8,0xbed0,0,0,0xba80,0x5800,0x5300,0x04d6,0x0333,0x03f0,0x0227,0x0374,0x01ef,0x0334,0x01b5,0,0,0,0,0,0,0,0,0x01b4,0x0136,0x00b8,0x005c,0x8000,0x8000];
try{
  const a=create();assert.equal(peak(render(a,4097).left),0);
  assert.equal(m._ps1_spu_write(a,1,0),0);assert.equal(m._ps1_spu_write(a,0x400,0),0);
  assert.equal(m._ps1_spu_write(a,0,0x8000),0);assert.equal(m._ps1_spu_write(a,6,0x401),0);
  assert.equal(m._ps1_spu_read(a,1)>>>0,0xffffffff);assert.equal(m._ps1_spu_write(a,0x1ac,0),0);
  assert.equal(m._ps1_spu_load_ram(a,0x7ffff,ram,2),0);assert.equal(m._ps1_spu_read_ram(a,0x7ffff,ram,2),0);
  assert.equal(m._ps1_spu_render(a,l,l,10),0);assert.equal(m._ps1_spu_render(a,0,r,10),0);
  assert.equal(m._ps1_spu_render(a,0,0,0),1);
  checks.push('fixed-rate-C-ABI-register-RAM-and-render-guards');
  for(let c=0;c<24;c++){assert.equal(m._ps1_spu_reset(a,1),1);configure(a);voice(a,c);key(a,c,true);
    const pcm=render(a,4097);assert(peak(pcm.left)>.01&&peak(pcm.right)>.01);assert.notDeepEqual(pcm.left,pcm.right);
    key(a,c,false);render(a,4096);assert.equal(peak(render(a,257).left),0);}
  checks.push('24-voices-high-key-bank-ADSR-release-and-stereo');
  const b=create(),reference=create();
  for(const h of [a,b,reference]){assert.equal(m._ps1_spu_reset(h,1),1);configure(h);voice(h,23,0x1234);key(h,23,true);}
  const whole=render(a,8193),parts={left:new Float32Array(8193),right:new Float32Array(8193)};
  for(let at=0;at<8193;){const count=Math.min(127,8193-at),pcm=render(b,count);parts.left.set(pcm.left,at);parts.right.set(pcm.right,at);at+=count;}
  assert.deepEqual(whole,parts);assert.deepEqual(whole,render(reference,8193));
  assert.equal(m._ps1_spu_reset(a,1),1);assert.deepEqual(render(b,4093),render(reference,4093));
  checks.push('exact-block-partition-and-independent-instance-state');
  configure(a);voice(a,0);room.forEach((v,i)=>write(a,0x1c0+i*2,v));write(a,0x184,0x3000);write(a,0x186,0x3000);write(a,0x198,1);
  key(a,0,true);render(a,8192);key(a,0,false);render(a,2048);assert(peak(render(a,8192).left)>.00001);
  assert.equal(m._ps1_spu_reset(a,0),1);assert.equal(peak(render(a,4097).left),0);
  assert.equal(m._ps1_spu_read_ram(a,0x2000,ram,64),1);assert.deepEqual(m.HEAPU8.slice(ram,ram+64),wave);
  checks.push('preset-reverb-tail-reset-and-retained-sample-RAM');
  let parity;
  if(fixture){
    let samples=0,maxError=0;
    for(const wet of [false,true]){
      const h=create(),commands=[],expected=[];
      const u32=value=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value>>>0);return bytes;};
      const command=(op,...values)=>commands.push(Buffer.concat([u32(op),...values.map(u32)]));
      const w=(a,v)=>{write(h,a,v);command(1,a,v);};
      m.HEAPU8.set(wave,ram);assert.equal(m._ps1_spu_load_ram(h,0x2000,ram,64),1);
      commands.push(Buffer.concat([u32(3),u32(0x2000),u32(64),Buffer.from(wave)]));
      w(0x180,0x3fff);w(0x182,0x3fff);w(0x1aa,0xc000);
      for(let c=0;c<24;c++){for(const [a,v] of [[0,0x100],[2,0x180],[4,0x813+c*97],[6,0x400],[8,15],[10,0x1fc0],[14,0x400]])w(c*16+a,v);}
      if(wet){room.forEach((v,i)=>w(0x1c0+i*2,v));w(0x184,0x3000);w(0x186,0x3000);w(0x198,0xffff);w(0x19a,0xff);}
      w(0x188,0xffff);w(0x18a,0xff);
      for(const count of [1,127,2048,4097,8193]){const pcm=render(h,count);command(5,count);for(let i=0;i<count;i++)expected.push(pcm.left[i],pcm.right[i]);}
      w(0x18c,0xffff);w(0x18e,0xff);
      for(const count of [2048,8193]){const pcm=render(h,count);command(5,count);for(let i=0;i<count;i++)expected.push(pcm.left[i],pcm.right[i]);}
      const run=spawnSync(path.resolve(fixture),[],{input:Buffer.concat([u32(commands.length),...commands]),maxBuffer:16*1024*1024});
      assert.equal(run.status,0,run.stderr?.toString());assert.equal(run.stdout.length,expected.length*4);
      for(let i=0;i<expected.length;i++){const error=Math.abs(run.stdout.readFloatLE(i*4)-expected[i]);assert(Number.isFinite(error)&&error<=1e-6,`Native/WASM error ${error} at sample ${i}`);maxError=Math.max(maxError,error);}
      samples+=expected.length;
    }
    parity={passed:true,interleavedSamples:samples,maxAbsoluteError:maxError,tolerance:1e-6};checks.push('actual-Native-WASM-24-voice-ADSR-and-reverb-parity');
  }
  console.log(JSON.stringify({passed:true,artifact:'ps1_spu',sampleRate:44100,voices:24,ramBytes:524288,renderedFrames:frames,checks,...(parity?{nativeParity:parity}:{})}));
}finally{for(const h of handles)m._ps1_spu_destroy(h);for(const pointer of [l,r,ram])m._free(pointer);}
