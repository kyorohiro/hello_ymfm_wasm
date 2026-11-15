// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {prepareScspSongSource, buildScspSongDemo, SCSP_SONG_CLOCK} from './song_source.js';

const write = (address, value) => [0xc5, address >> 8, address & 255, value];
const fixture = (commands = [...write(0x401, 15), 0x62, 0x66]) => {
  const bytes = new Uint8Array(256 + commands.length), view = new DataView(bytes.buffer);
  bytes.set([86,103,109,32]); view.setUint32(4, bytes.length - 4, true); view.setUint32(8, 0x171, true);
  view.setUint32(0x34, 256 - 0x34, true); view.setUint32(0xb8, SCSP_SONG_CLOCK, true); bytes.set(commands, 256); return bytes;
};
const block = (type, data) => {
  const bytes = new Uint8Array(7 + data.length); bytes.set([0x67,0x66,type]);
  new DataView(bytes.buffer).setUint32(3, data.length, true); bytes.set(data, 7); return [...bytes];
};

test('original demo validates as VGM and bounded gzip without audio', async () => {
  const bytes = buildScspSongDemo(), plain = await prepareScspSongSource(bytes), gzip = await prepareScspSongSource(gzipSync(bytes));
  assert.equal(plain.clock, SCSP_SONG_CLOCK); assert.equal(plain.totalSamples, 105840);
  assert.equal(plain.format, 'VGM'); assert.equal(gzip.format, 'VGZ'); assert.deepEqual(gzip.bytes, plain.bytes);
  assert.deepEqual(bytes, buildScspSongDemo()); assert(plain.writes > 30);
});

test('SCSP sources enforce their clock, one instance and exclusive chip data', async () => {
  for (const clock of [0, SCSP_SONG_CLOCK - 1, (SCSP_SONG_CLOCK | 0x80000000) >>> 0]) {
    const bytes = fixture(); new DataView(bytes.buffer).setUint32(0xb8, clock, true);
    await assert.rejects(prepareScspSongSource(bytes), /clock/);
  }
  const dual = fixture(); new DataView(dual.buffer).setUint32(0xb8, SCSP_SONG_CLOCK | 0x40000000, true);
  await assert.rejects(prepareScspSongSource(dual), /one SCSP/);
  const other = fixture(); new DataView(other.buffer).setUint32(0x2c, 7670454, true);
  await assert.rejects(prepareScspSongSource(other), /unsupported chip YM2612/);
  await assert.rejects(prepareScspSongSource(fixture([...write(0x8000, 1), 0x62, 0x66])), /Second SCSP/);
  const extra = fixture(); new DataView(extra.buffer).setUint32(0xbc, 4, true);
  await assert.rejects(prepareScspSongSource(extra), /extra-header/);
});

test('recorded CPU bookkeeping is omitted while DMA execution and unsupported core modes fail', async () => {
  const bytes = fixture([...write(0x418, 3), ...write(0x41f, 64), ...write(0x407, 90), ...write(0x412, 2), ...write(0x401, 15), 0x62, 0x66]);
  const source = await prepareScspSongSource(bytes);
  assert.equal(source.ignoredWrites, 4); assert.equal(source.writes, 1); assert.equal(source.bytes.length, 262);
  assert.match(source.warnings[0], /recorded CPU/);
  await assert.rejects(prepareScspSongSource(fixture([...write(0x416, 0x10), 0x62, 0x66])), /DMA execution/);
  await assert.rejects(prepareScspSongSource(fixture([...write(0x400, 0), 0x62, 0x66])), /512 KiB memory mode/);
  await assert.rejects(prepareScspSongSource(fixture([...write(0x001, 0x80), ...write(0x000, 1), 0x62, 0x66])), /source mode/);
  await assert.rejects(prepareScspSongSource(fixture([...write(0xc00, 0), 0x62, 0x66])), /register 0xc00/);
});

test('RAM bank copies spanning banks become equivalent timed E0 uploads', async () => {
  const source = await prepareScspSongSource(fixture([...block(6, [0x12,0x34]), ...block(6, [0x56]),
    0x68,0x66,6,1,0,0,0,0x10,0,2,0,0, ...write(0x401, 15), 0x62,0x66]));
  const bytes = source.bytes, view = new DataView(bytes.buffer);
  assert.deepEqual([...bytes.subarray(256, 259)], [0x67,0x66,0xe0]);
  assert.equal(view.getUint32(263, true), 0x1000); assert.deepEqual([...bytes.subarray(267, 269)], [0x34,0x56]);
  await assert.rejects(prepareScspSongSource(fixture([0x68,0x66,6,0,0,0,0,0,0,1,0,0, ...write(0x401,15),0x62,0x66])), /bank/);
  await assert.rejects(prepareScspSongSource(fixture([...block(0xe0,[255,255,7,0,1,2]), ...write(0x401,15),0x62,0x66])), /512 KiB/);
});

test('truncated streams, missing end, unsupported commands and cancellation fail before commit', async () => {
  await assert.rejects(prepareScspSongSource(fixture([...write(0x401,15),0x62])), /no end/);
  await assert.rejects(prepareScspSongSource(fixture([0xc5,0])), /Truncated/);
  await assert.rejects(prepareScspSongSource(fixture([0x67,0x66,0xe0,255,255,255,127])), /Truncated/);
  await assert.rejects(prepareScspSongSource(fixture([0x90,0,0,0,0,0x62,0x66])), /command 0x090/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareScspSongSource(buildScspSongDemo(), {signal:controller.signal}), {name:'AbortError'});
  const invalid = fixture(); invalid[0] = 0;
  await assert.rejects(prepareScspSongSource(invalid), /identifier/);
});

test('gzip expansion stops at the 64 MiB source boundary', async () => {
  const compressed = gzipSync(new Uint8Array(64 * 1024 * 1024 + 1));
  await assert.rejects(prepareScspSongSource(compressed), /Expanded VGZ exceeds 64 MiB/);
});
