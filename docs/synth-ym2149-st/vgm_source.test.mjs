import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {readYmVgmSource, decodeYmVgmFile, YM_VGM_LIMITS} from './vgm_source.js';
import {createYmVgmFixture, ayWrite, ayWait} from './vgm_test_helpers.mjs';

test('owned VGM / VGZ bytes retain header variants, metadata, raw repeated shapes and exact waits', async () => {
  const input = createYmVgmFixture(undefined, {clock: 1773400, flags: 0x11, metadata: ['Fixture', '', 'Test', '', 'Atari ST', '', 'Composer', '', '2026', 'Test author', 'Original synthetic test'], loop: true});
  const source = await readYmVgmSource(input, {name: 'test.vgm'});
  assert.equal(source.format, 'vgm');
  assert.equal(source.clock, 1773400);
  assert.equal(source.type, 0x10); assert.equal(source.flags, 0x11);
  assert.equal(source.header.ay8910Flags, 0x11);
  assert.equal(source.metadata.title, 'Fixture'); assert.equal(source.metadata.author, 'Composer');
  assert.equal(source.durationFrames, 1 + 16 + 735 + 251 + 882 + 3000 + 200);
  assert.equal(source.totalSamples, source.durationFrames); assert.equal(source.header.totalSamples, 123);
  assert.deepEqual([source.subsongCount, source.defaultSubsong], [1, 1]);
  assert.deepEqual(source.trace.events.filter(event => event.register === 13), [{time: 0, register: 13, value: 10}, {time: 752, register: 13, value: 10}]);
  const compressed = await readYmVgmSource(gzipSync(input), {name: 'fixture.vgz'});
  assert.deepEqual(compressed.bytes, source.bytes); assert.deepEqual(compressed.trace, source.trace);
  input.fill(0); assert.equal(source.bytes[0], 86);
  assert.equal((await readYmVgmSource(createYmVgmFixture(), {name: 'Named.vgz'})).metadata.title, 'Named');
});

test('zero-duration writes are retained and hardware registers are not normalized', async () => {
  const source = await readYmVgmSource(createYmVgmFixture([...ayWrite(1, 255), ...ayWrite(14, 0xab), ...ayWrite(8, 0), ...ayWait(0), 0x66]));
  assert.equal(source.durationFrames, 0);
  assert.deepEqual(source.trace.events.map(event => event.value), [255, 0xab, 0]);
});

test('rejects malformed headers, EOF/data offsets, truncated commands, unknown registers and missing end', async () => {
  await assert.rejects(readYmVgmSource(new Uint8Array(4)), /truncated VGM header/);
  await assert.rejects(readYmVgmSource(new Uint8Array(256)), /identifier/);
  for (const [offset, value] of [[0x34, 0x100000], [4, 100000], [0x34, 0], [8, 0x150]]) {
    const bytes = createYmVgmFixture(); new DataView(bytes.buffer).setUint32(offset, value, true);
    await assert.rejects(readYmVgmSource(bytes), /header|offset/);
  }
  for (const commands of [[0xa0, 0], [0x61, 1], [...ayWrite(0, 1)], [...ayWrite(0, 1), 0x61, 1]])
    await assert.rejects(readYmVgmSource(createYmVgmFixture(commands)), /truncated|missing end/);
  await assert.rejects(readYmVgmSource(createYmVgmFixture([...ayWrite(16, 1), 0x66])), /register/);
  await assert.rejects(readYmVgmSource(createYmVgmFixture([0x66])), /no AY/);
  await assert.rejects(decodeYmVgmFile('bad'), /ArrayBuffer/);
  await assert.rejects(decodeYmVgmFile(new Uint8Array([0x1f, 0x8b, 1, 2])), /./);
});

test('rejects non-AY, dual/variant clocks, unsupported AY modes and all companion clock fields', async () => {
  for (const options of [{clock: 0}, {clock: 0x40000000 | 2000000}, {clock: 0x80000000 | 2000000}, {type: 1}, {flags: 2}, {type: 0, flags: 0x11}])
    await assert.rejects(readYmVgmSource(createYmVgmFixture(undefined, options)), /clock|multiple AY|type|flags/);
  for (const offset of [0x0c, 0x10, 0x38, 0x40, 0x44, 0x80, 0xb0, 0xc0, 0xf0]) {
    const bytes = createYmVgmFixture(); new DataView(bytes.buffer).setUint32(offset, 1000000, true);
    await assert.rejects(readYmVgmSource(bytes), /mixed-chip/);
  }
  const extra = createYmVgmFixture(); new DataView(extra.buffer).setUint32(0xbc, 16, true);
  await assert.rejects(readYmVgmSource(extra), /extra-header/);
  await assert.rejects(readYmVgmSource(createYmVgmFixture([...ayWrite(128, 1), 0x66])), /second AY/);
  for (const commands of [[0x50, 1], [0x31, 255], [0x90, 0, 0x12, 0, 8], [0x67, 0x66, 0, 0, 0, 0, 0], [0x80], [0xff]])
    await assert.rejects(readYmVgmSource(createYmVgmFixture([...commands, 0x66])), /unsupported command/);
  for (const options of [{type: 0, flags: 0}, {type: 0x10, flags: 0x11}])
    await assert.doesNotReject(readYmVgmSource(createYmVgmFixture(undefined, options)));
});

test('source, gzip expansion, commands and duration are bounded; long parsing is cancellable', async () => {
  await assert.rejects(decodeYmVgmFile(new Uint8Array(YM_VGM_LIMITS.sourceBytes + 1)), /16 MiB/);
  await assert.rejects(decodeYmVgmFile(gzipSync(new Uint8Array(YM_VGM_LIMITS.expandedBytes + 1))), /32 MiB/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readYmVgmSource(createYmVgmFixture(), {signal: controller.signal}), {name: 'AbortError'});
  const many = new Uint8Array(30000 * 3 + 1);
  for (let index = 0; index < 30000; index++) many.set(ayWrite(8, 15), index * 3);
  many[many.length - 1] = 0x66;
  const running = new AbortController(), promise = readYmVgmSource(createYmVgmFixture(many), {signal: running.signal});
  setTimeout(() => running.abort(), 0);
  await assert.rejects(promise, {name: 'AbortError'});
  const waits = new Uint8Array(65538 * 3 + 4);
  waits.set(ayWrite(0, 1));
  for (let index = 0; index < 65538; index++) waits.set(ayWait(65535), 3 + index * 3);
  waits[waits.length - 1] = 0x66;
  await assert.rejects(readYmVgmSource(createYmVgmFixture(waits)), /duration exceeds/);
  const commands = new Uint8Array(YM_VGM_LIMITS.commands + 4).fill(0x70);
  commands.set(ayWrite(0, 1)); commands[commands.length - 1] = 0x66;
  await assert.rejects(readYmVgmSource(createYmVgmFixture(commands)), /command count/);
});
