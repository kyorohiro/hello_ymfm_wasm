// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { maybeDecodeVgmFile } from '../js/vgm_file.js';
import { loadVsuVgm, parseVsuVgm } from './vgm.js';

function vgm(commands, { loop = null, gd3 = null, clock = 5000000, version = 0x171 } = {}) {
	const start = 0xc8;
	const tag = gd3 === null ? Buffer.alloc(0) : Buffer.from(
		['', gd3, ...Array(9).fill('')].join('\0') + '\0', 'utf16le');
	const gd3Start = start + commands.length;
	const bytes = Buffer.alloc(gd3Start + (tag.byteLength ? 12 + tag.byteLength : 0));
	bytes.write('Vgm ', 0, 'ascii');
	bytes.writeUInt32LE(bytes.length - 4, 4);
	bytes.writeUInt32LE(version, 8);
	if (loop !== null) bytes.writeUInt32LE(start + loop - 0x1c, 0x1c);
	bytes.writeUInt32LE(start - 0x34, 0x34);
	bytes.writeUInt32LE(clock, 0xc4);
	bytes.set(commands, start);
	if (tag.byteLength) {
		bytes.writeUInt32LE(gd3Start - 0x14, 0x14);
		bytes.write('Gd3 ', gd3Start, 'ascii');
		bytes.writeUInt32LE(0x100, gd3Start + 4);
		bytes.writeUInt32LE(tag.byteLength, gd3Start + 8);
		bytes.set(tag, gd3Start + 12);
	}
	return bytes;
}

const begin = [0xc7, 0x01, 0x00, 0x80];
const stop = [0xc7, 0x01, 0x60, 0x01];

test('maps VGM VSU word offsets and waits into a 44.1 kHz byte-offset timeline', () => {
	const log = vgm([
		...begin, 0x70, 0x7f, 0x61, 0x02, 0x01,
		0xc7, 0x00, 0xa0, 0x7f, 0x62, 0x63, ...stop, 0x66,
	]);
	const result = parseVsuVgm(log.subarray(0));
	assert.deepEqual([...result.writes], [0, 0x400, 0x80, 275, 0x280, 0x7f, 1892, 0x580, 1]);
	assert.equal(result.durationTicks, 1892);
	assert.equal(result.loopTick, null);
	assert.equal(result.loopIndex, 0);
	assert.equal(result.title, '');
});

test('retains exact loop cursor on a wait even if earlier writes share its tick', () => {
	const result = parseVsuVgm(vgm([
		...begin, 0x61, 0x00, 0x00, ...stop, 0x70, ...begin, 0x62, 0x66,
	], { loop: 11 }));
	assert.equal(result.durationTicks, 736);
	assert.equal(result.loopTick, 0);
	assert.equal(result.loopIndex, 2);
	assert.equal(result.writes[result.loopIndex * 3], 1);
});

test('loads both VGM and compressed VGZ with GD3 title fallback', async () => {
	const bytes = vgm([...begin, 0x62, 0x66], { gd3: '音源テスト' });
	const raw = await loadVsuVgm(Uint8Array.from(bytes).buffer);
	const compressed = await loadVsuVgm(gzipSync(bytes));
	assert.deepEqual(raw, compressed);
	assert.equal(raw.title, '音源テスト');
	assert.equal(raw.metadata.trackNameOriginal, '音源テスト');
});

test('rejects incompatible clocks, commands and invalid read boundaries', () => {
	assert.throws(() => parseVsuVgm(vgm([...begin, 0x62, 0x66], { clock: 0 })), /no Virtual Boy VSU clock/);
	assert.throws(() => parseVsuVgm(vgm([...begin, 0x62, 0x66], { clock: 0x404c4b40 })), /single 5 MHz VSU/);
	assert.throws(() => parseVsuVgm(vgm([...begin, 0x62, 0x66], { version: 0x170 })), /requires a VGM 1.71/);
	assert.throws(() => parseVsuVgm(vgm([...begin, 0x50, 0xff, 0x62, 0x66])), /Unsupported VGM command 0x50/);
	assert.throws(() => parseVsuVgm(vgm([0xc7, 0x01, 0x61, 0xaa, 0x62, 0x66])), /out-of-range VSU write/);
	assert.throws(() => parseVsuVgm(vgm([...begin, 0x62], { gd3: 'name' })), /missing its end command/);
	assert.throws(() => parseVsuVgm(vgm([0xc7, 0x00, 0xfe])), /Truncated VGM VSU write/);
	assert.throws(() => parseVsuVgm(vgm([...begin, 0x61, 0x00])), /Truncated VGM wait/);
	assert.throws(() => parseVsuVgm(vgm([...begin, 0x66])), /no timed VSU performance/);
	assert.throws(() => parseVsuVgm(vgm([...begin, 0x62, 0x66], { loop: 2 })), /must point to a command/);
	assert.throws(() => parseVsuVgm(vgm([...begin, 0x62, 0x66], { loop: 5 })), /playback time remaining/);
	assert.throws(() => parseVsuVgm(vgm([...begin, 0x62, 0x66]).subarray(0, -1)), /Invalid VGM data or end offset/);
});

test('shared decoding bounds raw bytes and streamed gzip expansion when requested', async () => {
	const bytes = Buffer.alloc(128 * 1024, 0x01);
	await assert.rejects(maybeDecodeVgmFile(bytes, { maxBytes: 256 }), /uncompressed size limit/);
	await assert.rejects(maybeDecodeVgmFile(gzipSync(bytes), { maxBytes: 256 }), /uncompressed size limit/);
	assert.equal((await maybeDecodeVgmFile(gzipSync(bytes), { maxBytes: bytes.byteLength })).byteLength, bytes.byteLength);
	assert.equal((await maybeDecodeVgmFile(gzipSync(bytes))).byteLength, bytes.byteLength);
});
