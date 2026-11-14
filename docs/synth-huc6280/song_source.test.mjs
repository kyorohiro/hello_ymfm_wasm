// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {prepareHuc6280SongSource,MAX_HUC6280_SONG_BYTES,MAX_MSM5205_SONG_CLOCK} from './song_source.js';
import {vgm,write,wait,block,streamSetup,streamStart,u32,fixtures} from './song_test_helpers.mjs';
const prepare = commands => prepareHuc6280SongSource(vgm(commands));
function msmSource(commands,{huc=true,version=0x172,clock=384000,flags=4}={}){
  const bytes=vgm(commands,{clock:huc?3579545:0}),view=new DataView(bytes.buffer);
  view.setUint32(8,version,true);view.setUint32(0xf0,clock,true);bytes[0xd7]=flags;return bytes;
}

test('VGM1.72 MSM5205 packed writes are accepted with HuC6280 or alone, with explicit cache/CD-DA limits',async()=>{
  for(const huc of [true,false]){
    const source=await prepareHuc6280SongSource(msmSource([...(huc?write(0,0):[]),0x32,0x00,0x32,0x17,...wait(200)],{huc}));
    assert.equal(source.header.msm5205Clock,384000);assert.equal(source.header.msm5205Flags,4);assert.equal(source.totalSamples,200);
    assert(source.warnings.some(w=>/MSM5205/.test(w)&&/checkpoints/.test(w)&&/CD-DA/.test(w)));
  }
});

test('MSM5205 preflight rejects undeclared/old-version, dual/variant, reserved flags and excessive render clocks before playback',async()=>{
  await assert.rejects(prepare([0x32,0x17,...wait(1)]),/undeclared MSM5205/);
  await assert.rejects(prepareHuc6280SongSource(msmSource([0x32,0x17,...wait(1)],{version:0x171})),/version 1.72/);
  for(const clock of [384000|0x40000000,384000|0x80000000])await assert.rejects(prepareHuc6280SongSource(msmSource([0x32,0x17,...wait(1)],{clock:clock>>>0})),/dual|variant/);
  await assert.rejects(prepareHuc6280SongSource(msmSource([0x32,0x17,...wait(1)],{clock:MAX_MSM5205_SONG_CLOCK+1})),/render budget/);
  await assert.rejects(prepareHuc6280SongSource(msmSource([0x32,0x17,...wait(1)],{flags:8})),/flags/);
  await assert.rejects(prepareHuc6280SongSource(msmSource([0x32,0x97,...wait(1)])),/Second MSM5205/);
  await assert.rejects(prepareHuc6280SongSource(msmSource([...write(0,0),...wait(1)],{huc:false})),/undeclared HuC6280/);
  await assert.rejects(prepareHuc6280SongSource(msmSource([...streamSetup(),...wait(1)],{huc:false})),/undeclared HuC6280/);
  for(const offset of [0xe8,0xec,0xf4,0xf8,0xfc]){
    const bytes=msmSource([0x32,0x17,...wait(1)]);new DataView(bytes.buffer).setUint32(offset,1,true);
    await assert.rejects(prepareHuc6280SongSource(bytes),/Unsupported chip/);
  }
});

test('full-file HuC source preparation accepts Wave/Noise/LFO/directDAC/stream and detached VGZ', async () => {
  for (const [name,bytes] of Object.entries(fixtures())) {
    const source = await prepareHuc6280SongSource(bytes);
    assert(source.totalSamples > 0,name); assert.equal(source.header.huc6280Clock,3579545);
    assert.deepEqual(source.bytes,bytes); bytes.fill(0); assert.equal(source.bytes[0],86,'result owns its bytes');
  }
  const bytes = vgm([...write(0,0),...wait(500)],{loop:true});
  const source = await prepareHuc6280SongSource(gzipSync(bytes));
  assert.deepEqual(source.bytes,bytes); assert.equal(source.totalSamples,500); assert.match(source.warnings[0],/once/);
});

test('Node Buffer subarrays with a nonzero offset and trailing bytes remain owned after declared EOF trimming', async () => {
  const bytes = vgm([...write(0,0),...wait(321)]);
  const backing = Buffer.alloc(bytes.length + 50, 0xa5);
  backing.set(bytes, 13);
  const input = backing.subarray(13, 13 + bytes.length + 17);
  assert(input.byteOffset > 0);
  const source = await prepareHuc6280SongSource(input);
  assert.equal(source.totalSamples,321); assert.equal(source.bytes.length,bytes.length);
  assert.equal(source.bytes.byteOffset,0); assert.equal(Buffer.isBuffer(source.bytes),false);
  assert.deepEqual(source.bytes,bytes);
  input.fill(0); assert.deepEqual(source.bytes,bytes,'neither original Buffer nor its EOF tail is borrowed');
});

test('preflight rejects every other declared chip, second/variant HuC, unsupported clock and extra headers', async () => {
  for (const offset of [0x0c,0x40,0x64,0x80,0xb8,0xc0,0xe4,0xf0]) {
    const bytes = vgm([...write(0,0),...wait(1)]); new DataView(bytes.buffer).setUint32(offset,1000,true);
    await assert.rejects(prepareHuc6280SongSource(bytes),/Unsupported chip/);
  }
  for (const clock of [0,3579546,3579545|0x40000000,3579545|0x80000000]) {
    await assert.rejects(prepareHuc6280SongSource(vgm([...write(0,0),...wait(1)],{clock})),/no HuC|normal|dual or variant/);
  }
  const bytes = vgm([...write(0,0),...wait(1)]); new DataView(bytes.buffer).setUint32(0xbc,32,true);
  await assert.rejects(prepareHuc6280SongSource(bytes),/extra headers/);
});

test('preflight rejects mixed commands and trailing invalid/truncated writes before playback', async () => {
  for (const command of [0x50,0x52,0xb3,0xb4,0x64,0x68,0x80,0xe0,0xff]) {
    await assert.rejects(prepare([...write(0,0),...wait(1),command]),/does not support/);
  }
  await assert.rejects(prepare([...write(0x80,0),...wait(1)]),/Second/);
  await assert.rejects(prepare([...write(10,0),...wait(1)]),/register range/);
  await assert.rejects(prepareHuc6280SongSource(vgm([...write(0,0),...wait(1),0xb9],{end:false})),/Truncated/);
  await assert.rejects(prepareHuc6280SongSource(vgm([...write(0,0),...wait(1)],{end:false})),/no end/);
  await assert.rejects(prepare(wait(1)),/no timed/);
  await assert.rejects(prepare(write(0,0)),/no timed/);
});

test('stream starts preserve byte stride/base/reused starts, length modes, bank blocks, reverse and loop', async () => {
  const bank = block([99,0,99,31,99,8,99,23]);
  for (const mode of [1,3,0x11,0x81,0x91]) {
    const source = await prepare([...bank,...streamSetup(0,0,1000,2,1),...streamStart(4,{mode}),...wait(1000)]);
    assert.equal(source.totalSamples,1000);
  }
  await prepare([...bank,...streamSetup(0,0,1000,2,1),...streamStart(4),...wait(300),
    ...streamStart(0,{offset:0xffffffff,mode:0}),...wait(300)]);
  await prepare([...bank,...streamSetup(0,0,1000,2,1),...streamStart(4,{mode:2}),...wait(300)]);
  await prepare([...block([1,2]),...block([3,4]),...streamSetup(),0x95,0,1,0,0x11,...wait(1000),0x94,255]);
});

test('unusable stream setups and unsupported blocks/modes never silently omit audio', async () => {
  const invalid = [
    [...block([1,2],0x45),...streamSetup(),...streamStart(2)],
    [...block([1,2],0x80),...streamSetup(),...streamStart(2)],
    [0x90,0,0x02,0,0,...wait(1)], [0x90,0,0x9b,0,6,...wait(1)],
    [0x90,0,0x1b,8,6,...wait(1)], [0x90,0,0x1b,0,0x16,...wait(1)],
    [0x90,255,0x1b,0,6,...wait(1)], [0x92,0,...u32(1000)],
    [...block([1,2]),...streamSetup(0,0,0),...streamStart(2)],
    [...block([1,2]),...streamSetup(0,0,192001),...streamStart(2)],
    [...block([1,2]),...streamSetup(0,0,1000,0),...streamStart(2)],
    [...streamSetup(),...streamStart(2)],
    [...block([1,2]),...streamSetup(),...streamStart(3)],
    [...block([1,2]),...streamSetup(),...streamStart(2,{mode:5})],
    [...block([1,2]),...streamSetup(),...streamStart(2,{offset:0xffffffff})],
    [...block([1,2]),...streamSetup(),0x95,0,8,0,0],
    [...block([1,2]),...streamSetup(),0x95,0,0,0,2],
  ];
  for (const commands of invalid) await assert.rejects(prepare([...commands,...wait(1000)]),/HuC6280|DAC|stream/i);
});

test('bounded preflight rejects excessive command bursts, local density, metadata recursion, DAC rates and duration', async () => {
  await assert.rejects(prepare([...Array.from({length:4097},()=>write(0,0)).flat(),...wait(1)]),/without positive time/);
  const dense = Array.from({length:10},()=>[...Array.from({length:3500},()=>write(0,0)).flat(),...wait(1)]).flat();
  await assert.rejects(prepare(dense),/command density/);
  await assert.rejects(prepare([...Array.from({length:257},()=>block([])).flat(),...write(0,0),...wait(1)]),/consecutive DAC metadata/);
  const streams = [0,1,2].flatMap(id=>[...streamSetup(id,id,192000),...streamStart(1,{id,mode:129})]);
  await assert.rejects(prepare([...block([1]),...streams,...wait(1)]),/combined/);
  await assert.rejects(prepare([...write(0,0),...Array.from({length:2423},()=>wait(65535)).flat()]),/one hour/);
});

test('active DAC data/stride reconfiguration is rejected before the shared renderer can read outside its interval', async () => {
  await assert.rejects(prepare([...block([1,2,3,4]),...streamSetup(0,0,44100),...streamStart(4),0x91,0,5,255,0,...wait(10)]),/stopping a DAC stream/);
  // An explicitly stopped (or naturally completed) stream can be configured again.
  await prepare([...block([1,2,3,4]),...streamSetup(0,0,44100),...streamStart(4),0x94,0,
    0x91,0,5,2,0,...streamStart(2),...wait(10)]);
  await prepare([...block([1,2,3,4]),...streamSetup(0,0,44100),...streamStart(4),...wait(10),
    0x91,0,5,2,0,...streamStart(2),...wait(10)]);
});

test('invalid lengths, gzip expansion, async cancellation and cooperative validation remain bounded', async () => {
  await assert.rejects(prepareHuc6280SongSource(new Uint8Array(MAX_HUC6280_SONG_BYTES + 1)),/64 MiB/);
  const expanded = gzipSync(new Uint8Array(MAX_HUC6280_SONG_BYTES + 1));
  await assert.rejects(prepareHuc6280SongSource(expanded),/Expanded VGZ/);
  await assert.rejects(prepareHuc6280SongSource(Uint8Array.of(0x1f,0x8b,1)),/unexpected|invalid|gzip/i);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareHuc6280SongSource(fixtures().wave,{signal:controller.signal}),{name:'AbortError'});
  const later = new AbortController(); let yields = 0;
  await assert.rejects(prepareHuc6280SongSource(vgm(Array.from({length:5000},()=>[...write(0,0),...wait(1)]).flat()),
    {signal:later.signal,yieldTask:async()=>{yields++;later.abort();}}),{name:'AbortError'});
  assert.equal(yields,1);
});
