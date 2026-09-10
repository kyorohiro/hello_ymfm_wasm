import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSamples } from './sample_explorer.js';
function vgm(commands) {
  const b = new Uint8Array(256 + commands.length), v = new DataView(b.buffer);
  b.set([86,103,109,32]); v.setUint32(8,0x171,true); v.setUint32(0x4c,8000000,true); v.setUint32(0x34,0xcc,true);
  b.set(commands,256); return b;
}
const u32 = n => [n&255,n>>>8&255,n>>>16&255,n>>>24&255];
const block = (offset,data) => [0x67,0x66,0x82,...u32(8+data.length),...u32(512),...u32(offset),...data];
const write = (r,v) => [0x59,r,v];
const on = [...write(0x10,1),...write(0x20,1),...write(0,1)];
test('split ROM blocks join; repeated range shares definition across channels; timestamps stay in VGM samples',async()=>{
  const result=await extractSamples(vgm([...block(256,new Array(128).fill(1)),...block(384,new Array(128).fill(2)),...on,0x61,100,0,...write(0x11,1),...write(0x21,1),...write(0,2),0x66]));
  assert.equal(result.samples.length,1);assert.equal(result.samples[0].size,256);
  assert.equal(result.samples[0].data[127],1);assert.equal(result.samples[0].data[128],2);
  assert.deepEqual(result.events.map(e=>[e.channel,e.startTime]),[[1,0],[2,100]]);
  assert.equal(result.events[0].endTime,null);
});
test('later ROM data cannot retroactively fill a missing sample; changed contents preserve old samples',async()=>{
  const r=await extractSamples(vgm([...on,...block(256,new Array(256).fill(7)),...on,...block(256,new Array(256).fill(9)),...on,0x66]));
  assert.equal(r.samples.length,3);assert.equal(r.samples[0].data,null);
  assert.equal(r.samples[1].data[0],7);assert.equal(r.samples[2].data[0],9);
});
test('partial memory does not export fabricated zero bytes; stop is an observation, not guessed EOS',async()=>{
  const r=await extractSamples(vgm([...block(256,[1,2]),...on,0x61,50,0,...write(0,128|1),0x66]));
  assert.equal(r.samples[0].available,2);assert.equal(r.samples[0].data,null);
  assert.equal(r.events.length,1);assert.equal(r.events[0].nextControlTime,50);assert.equal(r.events[0].endTime,null);
});
test('cancelled analysis exits',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(extractSamples(vgm([0x66]),{signal:controller.signal}),{name:'AbortError'});
});
const bwrite=(r,v)=>[0x58,r,v];
const bon=[...bwrite(0x12,1),...bwrite(0x14,1),...bwrite(0x19,0),...bwrite(0x1a,128),...bwrite(0x1b,255),...bwrite(0x10,128)];
const bblock=(offset,data)=>{const b=block(offset,data);b[2]=0x83;return b;};
test('ADPCM-A/B ROMs and channel 1 observations are independent',async()=>{
 const r=await extractSamples(vgm([...block(256,new Array(256).fill(1)),...bblock(256,new Array(256).fill(2)),...on,...bon,...bwrite(0x10,1),0x66]));
 assert.equal(r.samples.length,2);assert.equal(r.samples[0].data[0],1);assert.equal(r.samples[1].data[0],2);
 assert.equal(r.events[0].nextControl,undefined);assert.equal(r.events[1].nextControl,'reset');
 assert.equal(r.events[1].deltaN,32768);assert.equal(r.events[1].rate,8000000/144/2);
});
test('ADPCM-B reuse shares sample but preserves different rate/repeat/level settings',async()=>{
 const r=await extractSamples(vgm([...bblock(256,new Array(256).fill(2)),...bon,0x61,100,0,...bwrite(0x1a,64),...bwrite(0x1b,100),...bwrite(0x10,0x90),0x66]));
 assert.equal(r.samples.length,1);assert.equal(r.events.length,2);
 assert.equal(r.events[1].startTime,100);assert.equal(r.events[1].deltaN,16384);assert.equal(r.events[1].level,100);assert.equal(r.events[1].loop,true);
 assert.equal(r.events[1].endTime,null);
});
test('ADPCM-B zero Delta-N is retained; reversed ranges are explicitly unsupported',async()=>{
 const r=await extractSamples(vgm([...bon,...bwrite(0x1a,0),...bwrite(0x10,128),...bwrite(0x12,2),...bwrite(0x10,128),0x66]));
 assert.equal(r.events[1].rate,0);assert.equal(r.events.length,2);assert.ok(r.warnings.some(w=>w.includes('wrapped')));
});
test('ADPCM-B preview uses the existing WASM decoder and produces finite audible samples',async()=>{
 const [{default: factory},{Ym2610B},{configureSamplePreview}]=await Promise.all([
  import('../generated/ym2610b_wasm.js'),import('../js/ym2610b.js'),import('./sample_explorer.js')]);
 const r=await extractSamples(vgm([...bblock(256,new Array(256).fill(0x12)),...bon,0x66]));
 const chip=await Ym2610B.create({moduleFactory:factory});
 try {
  configureSamplePreview(chip,r.samples[0],r.events[0]);
  const pcm=chip.generateStereo(4096);
  assert.ok(pcm.left.every(Number.isFinite));assert.ok(pcm.left.some(v=>v!==0));
  assert.deepEqual(pcm.left,pcm.right);
 }finally{chip.dispose();}
});
function opnaVgm(commands) {
 const b=vgm(commands);new DataView(b.buffer).setUint32(0x48,8000000,true);return b;
}
const owrite=(r,v)=>[0x57,r,v];
const oblock=(offset,data)=>{const b=block(offset,data);b[2]=0x81;return b;};
const osetup=(mode)=>[...owrite(1,mode),...owrite(2,1),...owrite(4,1),...owrite(12,255),...owrite(13,255),...owrite(10,128),...owrite(11,255)];
test('YM2608 ROM/8-bit mode uses 32-byte units, 1-bit mode uses four; YM2610 stays isolated',async()=>{
 const r=await extractSamples(opnaVgm([...oblock(0,new Array(512).fill(0x12)),...bblock(0,new Array(512).fill(0x34)),...osetup(1),...owrite(0,0xa0),...osetup(0),...owrite(0,0xa0),...bon,0x66]));
 assert.deepEqual(r.samples.map(s=>[s.chip,s.byteStart,s.size]),[['ym2608',32,32],['ym2608',4,4],['ym2610',256,256]]);
 assert.equal(r.samples[0].data[0],0x12);assert.equal(r.samples[2].data[0],0x34);
 assert.equal(r.events[1].rate,8000000/144/2);
});
test('YM2608 prescaler changes rate, record and CPU playback are not mistaken for samples',async()=>{
 const r=await extractSamples(opnaVgm([...osetup(2),0x56,0x2e,0,...owrite(0,0xa0),...owrite(0,0xc0),...owrite(0,0x80),0x66]));
 assert.equal(r.events.length,1);assert.equal(r.events[0].prescale,3);assert.equal(r.events[0].rate,8000000/72/2);
 assert.ok(r.warnings.some(w=>w.includes('CPU-driven')));
});
test('YM2608 CPU memory uploads follow the existing core end condition and retain old data',async()=>{
 const r=await extractSamples(opnaVgm([...osetup(0),...owrite(4,2),...owrite(0,0x60),...owrite(8,1),...owrite(8,2),...owrite(8,3),...owrite(8,4),...owrite(4,1),...owrite(0,0xa0),...owrite(4,2),...owrite(0,0x60),...owrite(8,9),...owrite(4,1),...owrite(0,0xa0),0x66]));
 assert.deepEqual([...r.samples[0].data],[1,2,3,4]);assert.deepEqual([...r.samples[1].data],[9,2,3,4]);
});
test('YM2608 preview produces stereo audio through its own WASM core',async()=>{
 // The shipped build supports shell, not Node. Run its JS shell adapter in
 // an isolated VM and supply the unmodified WASM binary explicitly.
 const {readFile}=await import('node:fs/promises');
 const {runInNewContext}=await import('node:vm');
 const url=new URL('../generated/ym2608_wasm.js',import.meta.url);
 const source=await readFile(url,'utf8');
 const factory=runInNewContext(source.replaceAll('import.meta.url',JSON.stringify(url.href)).replace('export default Module;', 'Module;'),{console,WebAssembly,TextDecoder,TextEncoder,URL,setTimeout,clearTimeout});
 const wasmBinary=await readFile(new URL('../generated/ym2608_wasm.wasm',import.meta.url));
 const [{Ym2608},{configureSamplePreview}]=await Promise.all([import('../js/ym2608.js'),import('./sample_explorer.js')]);
 const r=await extractSamples(opnaVgm([...oblock(0,new Array(512).fill(0x12)),...osetup(1),...owrite(0,0xa0),0x66]));
 const chip=await Ym2608.create({moduleFactory:factory,moduleOptions:{wasmBinary}});
 try{configureSamplePreview(chip,r.samples[0],r.events[0]);const pcm=chip.generateStereo(4096);assert.ok(pcm.left.every(Number.isFinite));assert.ok(pcm.left.some(v=>v!==0));assert.deepEqual(pcm.left,pcm.right);}finally{chip.dispose();}
});
