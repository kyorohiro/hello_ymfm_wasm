// Standalone low-level ABI test. Reads only the supplied release directory;
// needs no package.json, npm dependencies, browser, or parent repository.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const directory=path.resolve(process.argv[2]??'wasm');
const loader=await readFile(path.join(directory,'ym2612_wasm.js'),'utf8');
const wasmBinary=await readFile(path.join(directory,'ym2612_wasm.wasm'));
// Emscripten's Node branch calls createRequire(import.meta.url), so its loader
// needs a file: URL. A temporary .mjs retains the original bytes and avoids
// imposing a package.json type on either the SDK or its consumer.
const temporary=await mkdtemp(path.join(tmpdir(),'tetorica-wasm-smoke-'));
let module;
try{const filename=path.join(temporary,'loader.mjs');await writeFile(filename,loader);const {default:create}=await import(pathToFileURL(filename));module=await create({wasmBinary});}
finally{await rm(temporary,{recursive:true,force:true});}
const chip=module._ym2612_create();assert(chip>0);
const frames=4096,left=module._malloc(frames*4),right=module._malloc(frames*4);
let saved=0;
try{
  assert.equal(typeof module._ym2612_sample_rate(chip,7670454),'number');
  assert.equal(module._ym2612_sample_rate(chip,7670454),Math.floor(7670454/144));
  const write=(register,value)=>{module._ym2612_write(chip,0,register);module._ym2612_write(chip,1,value);};
  const generate=()=>{assert.equal(module._ym2612_generate(chip,left,right,frames),undefined);return [Float32Array.from(module.HEAPF32.subarray(left/4,left/4+frames)),Float32Array.from(module.HEAPF32.subarray(right/4,right/4+frames))];};
  const silence=generate();assert(silence.every(channel=>channel.every(Number.isFinite)));
  // Algorithm 7: one audible operator, stereo CH1, no external preset layer.
  for(const offset of [0,4,8,12]){write(0x30+offset,1);write(0x40+offset,offset?127:20);write(0x50+offset,31);write(0x60+offset,0);write(0x70+offset,0);write(0x80+offset,15);}
  write(0xb0,7);write(0xb4,0xc0);write(0xa4,0x22);write(0xa0,0x69);write(0x28,0xf0);
  const sounding=generate();assert(sounding.every(channel=>channel.every(value=>Number.isFinite(value)&&Math.abs(value)<=1)));
  assert(sounding[0].some(value=>Math.abs(value)>.001),'Configured FM voice produces audio');assert.deepEqual(sounding[0],sounding[1],'Stereo outputs match for centered mono voice');
  const status=module._ym2612_read_status(chip);assert.equal(typeof status,'number');assert.equal(status&255,status);
  assert.equal(module._ym2612_read(chip,0),status,'read and read_status are synchronous');assert([0,1].includes(module._ym2612_get_irq(chip)));
  const size=module._ym2612_save_state(chip,0);assert(size>0);saved=module._malloc(size);assert.equal(module._ym2612_save_state(chip,saved),size);
  const expected=generate();assert.equal(module._ym2612_load_state(chip,saved,size-1),0,'Wrong-size state is rejected');assert.equal(module._ym2612_load_state(chip,saved,size),1);
  const restored=generate();assert.deepEqual(restored,expected,'save/load restores the exact PCM continuation');
  module._ym2612_reset(chip);assert.equal(module._ym2612_get_irq(chip),0);
  console.log(JSON.stringify({passed:true,artifact:'ym2612',frames,checks:['sync-read','finite-audible-stereo','save-load-exact-PCM','reset']}));
}finally{if(saved)module._free(saved);module._free(left);module._free(right);module._ym2612_destroy(chip);}
