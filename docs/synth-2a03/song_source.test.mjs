import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {prepareNesSongSource,nesVgmAddress} from './song_source.js';

export function fixture(commands=[0xb4,0x15,1,0xb4,0,0xbf,0xb4,1,8,0xb4,2,0x40,0xb4,3,9,0x61,0x44,0xac,0x66],{fds=false,clock=1789773}={}) {
  const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x34,256-0x34,true);view.setUint32(0x84,(clock|(fds?0x80000000:0))>>>0,true);bytes.set(commands,256);return bytes;
}
const block=(type,data)=>{const bytes=new Uint8Array(7+data.length);bytes.set([0x67,0x66,type]);new DataView(bytes.buffer).setUint32(3,data.length,true);bytes.set(data,7);return [...bytes];};
test('VGM and VGZ validation is independent of audio and retains the original clock',async()=>{
  const bytes=fixture(undefined,{clock:1662607}),plain=await prepareNesSongSource(bytes),gzip=await prepareNesSongSource(gzipSync(bytes));
  assert.equal(plain.clock,1662607);assert.equal(plain.totalSamples,44100);assert.equal(gzip.format,'VGZ');assert.deepEqual(gzip.bytes,bytes);
  assert.equal(nesVgmAddress(0x20),0x4080);assert.equal(nesVgmAddress(0x3f),0x4023);assert.equal(nesVgmAddress(0x7f),0x407f);
});
test('other chips, secondary NES, FDS without its flag and unsupported commands fail before playback',async()=>{
  const other=fixture();new DataView(other.buffer).setUint32(0x2c,7670454,true);
  await assert.rejects(prepareNesSongSource(other),/Unsupported chip: YM2612/);
  const dual=fixture();new DataView(dual.buffer).setUint32(0x84,1789773|0x40000000,true);
  await assert.rejects(prepareNesSongSource(dual),/single NES/);
  await assert.rejects(prepareNesSongSource(fixture([0xb4,0x3f,2,0x62,0x66])),/FDS header flag/);
  await assert.rejects(prepareNesSongSource(fixture([0xb4,0,31,0x90,0,0x14,0,0x11,0x62,0x66])),/command 0x90/);
  await assert.rejects(prepareNesSongSource(fixture([0xb4,0x80,31,0x62,0x66])),/Second NES/);
});
test('NES DPCM bank copies become equivalent timed RAM uploads',async()=>{
  const bytes=fixture([...block(7,[0x12,0x34]),...block(7,[0x56]),
    0x68,0x66,7,1,0,0,0,0xc0,0,2,0,0,0xb4,0x10,15,0x62,0x66]);
  const source=await prepareNesSongSource(bytes),parser=new Ym2612VGM(source.bytes),event=parser.step();
  assert.equal(event.type,'nes-apu-data');assert.equal(event.offset,0xc000);assert.deepEqual([...event.data],[0x34,0x56]);
  assert.equal(parser.step().type,'nes-apu-write');assert.equal(source.totalSamples,735);assert.equal(bytes[0x102],7);
  await assert.rejects(prepareNesSongSource(fixture([0x68,0x66,7,0,0,0,0,0xc0,0,1,0,0,0xb4,0,31,0x62,0x66])),/recorded bank/);
});
test('missing end, truncated commands and aborted inputs are rejected',async()=>{
  await assert.rejects(prepareNesSongSource(fixture([0xb4,0,31,0x62])),/no end/);
  await assert.rejects(prepareNesSongSource(fixture([0xb4,0])),/Truncated|bounds|offset/i);
  const controller=new AbortController();controller.abort();await assert.rejects(prepareNesSongSource(fixture(),{signal:controller.signal}),{name:'AbortError'});
});
