import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {prepareFm2608SongSource} from './song_source.js';

export function songFixture(commands=[0x56,0x29,0x9f,0x61,0x44,0xac,0x66],clock=8000000) {
  const bytes = new Uint8Array(256+commands.length), view = new DataView(bytes.buffer);
  bytes.set([0x56,0x67,0x6d,0x20]); view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x34,256-0x34,true);view.setUint32(0x48,clock,true);bytes.set(commands,256);return bytes;
}
export function memoryBlock(data,offset=0,memorySize=0x200000) {
  const bytes = new Uint8Array(15+data.length),view=new DataView(bytes.buffer);
  bytes.set([0x67,0x66,0x81]);view.setUint32(3,8+data.length,true);view.setUint32(7,memorySize,true);view.setUint32(11,offset,true);bytes.set(data,15);return bytes;
}
test('VGM/VGZ imports own their bytes and count actual waits',async()=>{
  const fixture=songFixture();const prepared=await prepareFm2608SongSource(fixture);
  fixture.fill(0);assert.equal(prepared.bytes[0],0x56);assert.equal(prepared.totalSamples,44100);assert.equal(prepared.format,'VGM');
  const compressed=gzipSync(songFixture());const vgz=await prepareFm2608SongSource(compressed.buffer.slice(compressed.byteOffset,compressed.byteOffset+compressed.length));
  assert.equal(vgz.format,'VGZ');assert.equal(vgz.totalSamples,44100);
});
test('S98 uses the existing converter including nondefault clock and source tag',async()=>{
  const source=new Uint8Array(64);const view=new DataView(source.buffer);source.set([83,57,56,51]);
  view.setUint32(4,1,true);view.setUint32(8,100,true);view.setUint32(0x14,48,true);view.setUint32(0x1c,1,true);view.setUint32(0x20,4,true);view.setUint32(0x24,7987200,true);
  source.set([0,0x29,0x9f,0xff,0xfd],48);
  const prepared=await prepareFm2608SongSource(source);
  assert.equal(prepared.format,'S98');assert.equal(prepared.header.ym2608Clock,7987200);assert.equal(prepared.totalSamples,441);
});
test('ADPCM-B blocks and CPU data writes remain accepted',async()=>{
  const data=Uint8Array.from({length:32},(_,index)=>index);
  const source=songFixture([...memoryBlock(data,0x100),0x57,0,0x60,0x57,8,0xab,0x61,20,0,0x66]);
  assert.equal((await prepareFm2608SongSource(source)).totalSamples,20);
});
test('unsupported devices, dual chips, commands and bad memory blocks explain rejection',async()=>{
  const other=songFixture();new DataView(other.buffer).setUint32(0x2c,7670454,true);
  await assert.rejects(prepareFm2608SongSource(other),/Unsupported chip: YM2612/);
  await assert.rejects(prepareFm2608SongSource(songFixture(undefined,0x40000000|8000000)),/dual/);
  await assert.rejects(prepareFm2608SongSource(songFixture([0x52,0x22,0,0x66])),/command 0x52/);
  await assert.rejects(prepareFm2608SongSource(songFixture([0x67,0x66,0,0,0,0,0,0x66])),/0x81/);
  const second=memoryBlock(new Uint8Array(32));second[6]|=128;
  await assert.rejects(prepareFm2608SongSource(songFixture([...second,0x66])),/Second YM2608/);
});
test('truncated timelines, missing time and cancellation do not pass validation',async()=>{
  await assert.rejects(prepareFm2608SongSource(songFixture([0x56,0x29])),/truncated|end|bounds/i);
  await assert.rejects(prepareFm2608SongSource(songFixture([0x56,0x29,0x9f,0x66])),/timed/);
  const controller=new AbortController();controller.abort();await assert.rejects(prepareFm2608SongSource(songFixture(),{signal:controller.signal}),{name:'AbortError'});
});
