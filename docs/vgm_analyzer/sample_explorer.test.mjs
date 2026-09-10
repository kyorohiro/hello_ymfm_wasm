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
