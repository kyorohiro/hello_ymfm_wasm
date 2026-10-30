// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const options={};
for(let i=2;i<process.argv.length;i+=2){assert(['--wasm-dir','--native-fixture','--out'].includes(process.argv[i]));assert(process.argv[i+1]);options[process.argv[i].slice(2)]=resolve(process.argv[i+1]);}
assert(options['wasm-dir']&&options['native-fixture'],'Usage: node tests/scsp_wasm_smoke.mjs --wasm-dir DIR --native-fixture EXE [--out JSON]');
const root=fileURLToPath(new URL('../',import.meta.url)),out=options['wasm-dir'];
const {default:factory}=await import(pathToFileURL(join(out,'scsp_wasm.js')).href);
const wasmBinary=await readFile(join(out,'scsp_wasm.wasm'));
const m=await factory({wasmBinary});
const bind=(name,result,args)=>m.cwrap('scsp_'+name,result,args);
const api={create:bind('create','number',[]),destroy:bind('destroy',null,['number']),reset:bind('reset','number',['number','number']),rate:bind('sample_rate','number',[]),write:bind('write','number',['number','number','number','number']),read:bind('read','number',['number','number']),load:bind('load_ram','number',['number','number','number','number']),render:bind('render','number',['number','number','number','number'])};
assert.equal(api.rate(),44100);
const sineSource=await readFile(join(root,'native/examples/scsp_pattern.hpp'),'utf8');
const sine=sineSource.match(/sine=\{([^}]+)\}/)[1].split(',').map(Number);assert.equal(sine.length,64);
const bytes=Uint8Array.from(sine.flatMap(v=>[(v>>8)&255,v&255]));
const upload=m._malloc(128),left=m._malloc(8192*4),right=m._malloc(8192*4);
const a=api.create(),b=api.create();assert(a&&b&&a!==b);
const write=(h,at,v,mask=65535)=>assert.equal(api.write(h,at,v,mask),1);
function configure(h){
  m.HEAPU8.set(bytes,upload);assert.equal(api.load(h,0x1000,upload,128),1);
  for(const [at,v]of [[0x400,0x20f],[2,0x1000],[4,0],[6,64],[8,31],[10,0x3c1f],[12,0],[14,0],[16,0],[18,0],[20,0],[22,0xe000],[0,0x1820]])write(h,at,v);
}
function render(h,frames,block){
  const pcm=Buffer.alloc(frames*8);let peak=0;
  for(let at=0;at<frames;at+=block){
    const n=Math.min(block,frames-at);assert.equal(api.render(h,left,right,n),1);
    for(let i=0;i<n;i++)for(const [ch,ptr]of [[0,left],[1,right]]){
      const v=m.HEAPF32[(ptr>>>2)+i];assert(Number.isFinite(v)&&Math.abs(v)<=1);
      peak=Math.max(peak,Math.abs(v));pcm.writeFloatLE(v,(at+i)*8+ch*4);
    }
  }
  return {pcm,peak};
}
let result;
try {
  configure(a);configure(b);
  assert.equal(api.write(a,0x418,0,65535),0);assert.equal(api.write(a,1,0,65535),0);
  assert.equal(api.load(a,524287,upload,2),0);assert.equal(api.render(a,left,left,10),0);
  const whole=render(a,8192,8192),partitioned=render(b,8192,127);
  assert.deepEqual(whole.pcm,partitioned.pcm);assert(whole.peak>0.1&&whole.peak<0.3);
  const native=execFileSync(options['native-fixture'],['--pcm'],{maxBuffer:1024*1024});
  assert.deepEqual(whole.pcm,native,'Native and WASM use identical inputs and produce bit-exact float PCM');
  write(a,0,0x1020);const release=render(a,4410,73);
  assert(release.pcm.subarray(-800).every(v=>v===0),'Key-off reaches silence');
  assert.equal(api.reset(a,0),1);assert.equal(render(a,128,128).peak,0);
  assert(render(b,64,64).peak>0.1,'Independent handle survives sibling reset');
  result={schemaVersion:1,passed:true,scope:'Original 64-frame PCM16 sine, 44.1 kHz, 8192 stereo frames; Native/WASM bit-exact parity and block invariance, release, reset, handle independence and invalid input',nativeWasmBitExact:true,blockPartitionInvariant:true,frames:8192,sampleRate:44100,peak:whole.peak,pcmSha256:createHash('sha256').update(whole.pcm).digest('hex'),wasmSha256:createHash('sha256').update(wasmBinary).digest('hex'),listeningPerformed:false,hardwareAccuracyVerified:false};
} finally {api.destroy(a);api.destroy(b);m._free(upload);m._free(left);m._free(right);}
if(options.out)await writeFile(options.out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
