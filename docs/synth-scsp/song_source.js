// SPDX-License-Identifier: BSD-3-Clause
import { parseVgmMetadata } from '../js/vgm_file.js';

export const MAX_SCSP_SONG_BYTES = 64 * 1024 * 1024;
export const SCSP_SONG_CLOCK = 22579200;
const RAM_BYTES = 512 * 1024;
const later = () => new Promise((resolve) => globalThis.setTimeout(resolve, 0));
const check = (signal) => {
	if (signal?.aborted) throw new DOMException('SCSP song operation cancelled', 'AbortError');
};
const hex = (value) => '0x' + value.toString(16).padStart(3, '0');
const OTHER_CLOCKS = [
	[0x0c, 'Sega PSG'],
	[0x10, 'YM2413'],
	[0x2c, 'YM2612'],
	[0x30, 'YM2151'],
	[0x38, 'Sega PCM'],
	[0x40, 'RF5C68'],
	[0x44, 'YM2203'],
	[0x48, 'YM2608'],
	[0x4c, 'YM2610'],
	[0x50, 'YM3812'],
	[0x54, 'YM3526'],
	[0x58, 'Y8950'],
	[0x5c, 'YMF262'],
	[0x60, 'YMF278B'],
	[0x64, 'YMF271'],
	[0x68, 'YMZ280B'],
	[0x6c, 'RF5C164'],
	[0x70, 'PWM'],
	[0x74, 'AY8910'],
	[0x80, 'Game Boy'],
	[0x84, 'NES APU'],
	[0x88, 'MultiPCM'],
	[0x8c, 'uPD7759'],
	[0x90, 'OKIM6258'],
	[0x98, 'OKIM6295'],
	[0x9c, 'K051649'],
	[0xa0, 'K054539'],
	[0xa4, 'HuC6280'],
	[0xa8, 'C140'],
	[0xac, 'K053260'],
	[0xb0, 'POKEY'],
	[0xb4, 'QSound'],
	[0xc0, 'WonderSwan'],
	[0xc4, 'VSU'],
	[0xc8, 'SAA1099'],
	[0xcc, 'ES5503'],
	[0xd0, 'ES5506'],
	[0xd8, 'X1-010'],
	[0xdc, 'C352'],
	[0xe0, 'GA20'],
	[0xe4, 'Mikey'],
	[0xe8, 'K007232'],
	[0xec, 'K005289'],
	[0xf0, 'MSM5205'],
	[0xf4, 'MSM5232'],
	[0xf8, 'BSMT2000'],
	[0xfc, 'ICS2115'],
];

async function decode(input, signal) {
	check(signal);
	if (!(input instanceof Uint8Array) && !(input instanceof ArrayBuffer))
		throw new TypeError('Choose a binary VGM or VGZ file');
	const original = input instanceof Uint8Array ? input : new Uint8Array(input);
	if (original.length > MAX_SCSP_SONG_BYTES) throw new RangeError('Song file exceeds 64 MiB');
	const bytes = original.slice();
	if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return { bytes, format: 'VGM' };
	if (typeof DecompressionStream !== 'function')
		throw new Error('VGZ requires browser gzip support');
	const reader = new Blob([bytes])
		.stream()
		.pipeThrough(new DecompressionStream('gzip'))
		.getReader();
	const cancel = () => {
		void reader.cancel().catch(() => {});
	};
	signal?.addEventListener('abort', cancel, { once: true });
	const chunks = [];
	let length = 0;
	try {
		for (;;) {
			check(signal);
			const { value, done } = await reader.read();
			check(signal);
			if (done) break;
			length += value.length;
			if (length > MAX_SCSP_SONG_BYTES) throw new RangeError('Expanded VGZ exceeds 64 MiB');
			chunks.push(value);
		}
	} finally {
		signal?.removeEventListener('abort', cancel);
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
	const expanded = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		expanded.set(chunk, offset);
		offset += chunk.length;
	}
	return { bytes: expanded, format: 'VGZ' };
}

/** Validate the standalone core's byte-write modes without touching audio.
 * Timer/IRQ/MIDI bookkeeping only affects CPU execution or serial output. A VGM
 * already records the resulting audio writes and their times, so these writes
 * can be omitted during replay. DMA execution changes sound RAM and is rejected.
 */
function registerWrite(registers, address, value) {
	if (address > 0xfff) throw new RangeError(`Unsupported SCSP register ${hex(address)}`);
	registers[address] = value;
	const wordAddress = address & ~1;
	const word = (registers[wordAddress] << 8) | registers[wordAddress + 1];
	if (wordAddress < 0x400) {
		if (wordAddress % 32 === 0 && ((word >> 7) & 3) === 3)
			throw new Error(`Unsupported SCSP source mode at ${hex(wordAddress)}`);
		return true;
	}
	if (wordAddress === 0x400) {
		if (word & ~0x030f || !(word & 0x0200))
			throw new Error(
				'SCSP playback requires the 512 KiB memory mode and supported master settings',
			);
		return true;
	}
	if (wordAddress === 0x402) {
		if (word & ~0x01bf) throw new Error('Unsupported SCSP DSP ring configuration');
		return true;
	}
	if (wordAddress === 0x408) {
		if (value & (address & 1 ? 0xff : 7))
			throw new Error('SCSP monitor status bits are read-only');
		return true;
	}
	if (wordAddress >= 0x412 && wordAddress <= 0x416) {
		if (wordAddress === 0x416 && word & 0x1000)
			throw new Error('SCSP DMA execution requires a playback core with DMA support');
		return false;
	}
	if (
		wordAddress === 0x404 ||
		wordAddress === 0x406 ||
		(wordAddress >= 0x418 && wordAddress <= 0x42e)
	)
		return false;
	if (
		wordAddress >= 0x600 &&
		wordAddress < 0xc00 &&
		!(wordAddress >= 0x7c0 && wordAddress < 0x800)
	)
		return true;
	throw new RangeError(`Unsupported SCSP register ${hex(address)}`);
}

/** Read and validate a complete single-SCSP VGM before committing a new source.
 * The private replay stream contains C5 writes, E0 RAM blocks and sample waits.
 * Original imported bytes and metadata belong to the project's Files entry.
 */
export async function prepareScspSongSource(input, { signal, yieldTask = later } = {}) {
	let { bytes, format } = await decode(input, signal);
	if (bytes.length < 0xc0) throw new Error('Truncated VGM header with SCSP clock');
	let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, true) !== 0x206d6756) throw new Error('Invalid VGM identifier');
	const version = view.getUint32(8, true);
	if (version < 0x171 || version > 0x172) throw new Error('SCSP playback supports VGM 1.71–1.72');
	const eof = view.getUint32(4, true);
	if (eof && (eof + 4 > bytes.length || eof + 4 < 0xc0)) throw new Error('Invalid VGM file size');
	if (eof && eof + 4 < bytes.length) {
		bytes = bytes.slice(0, eof + 4);
		view = new DataView(bytes.buffer);
	}
	const dataOffset = view.getUint32(0x34, true) ? 0x34 + view.getUint32(0x34, true) : 0x40;
	if (dataOffset < 0xc0 || dataOffset >= bytes.length)
		throw new Error('Invalid SCSP VGM data offset');
	const rawClock = view.getUint32(0xb8, true);
	if (rawClock & 0x40000000) throw new Error('SCSP playback supports one SCSP instance');
	if (rawClock !== SCSP_SONG_CLOCK)
		throw new Error(`SCSP playback requires a ${SCSP_SONG_CLOCK} Hz clock`);
	if (view.getUint32(0xbc, true))
		throw new Error(
			'SCSP playback does not support VGM extra-header clock or volume overrides',
		);
	const others = OTHER_CLOCKS.filter(
		([offset]) => offset + 4 <= dataOffset && view.getUint32(offset, true),
	).map(([, name]) => name);
	if (others.length)
		throw new Error(`SCSP playback has an unsupported chip ${others.join(', ')}`);
	const metadata = parseVgmMetadata(bytes);
	const chunks = [],
		banks = [],
		registers = new Uint8Array(0x1000);
	registers[0x400] = 2;
	let outputSize = dataOffset,
		bankSize = 0,
		writes = 0,
		ignoredWrites = 0,
		commands = 0,
		burst = 0,
		totalSamples = 0,
		ended = false;
	const append = (chunk) => {
		outputSize += chunk.length;
		if (outputSize > MAX_SCSP_SONG_BYTES)
			throw new RangeError('Prepared SCSP song exceeds 64 MiB');
		chunks.push(chunk);
	};
	const need = (position, size) => {
		if (size > bytes.length - position) throw new Error('Truncated SCSP VGM command');
	};
	const u24 = (position) =>
		bytes[position] | (bytes[position + 1] << 8) | (bytes[position + 2] << 16);
	for (let position = dataOffset; position < bytes.length; ) {
		check(signal);
		if (++commands > 4000000) throw new RangeError('SCSP song exceeds four million commands');
		if (++burst > 65536)
			throw new RangeError('SCSP song exceeds 65536 commands without time progress');
		const command = bytes[position];
		let length = 1,
			samples = 0;
		if (command === 0xc5) {
			length = 4;
			need(position, length);
			if (bytes[position + 1] & 0x80)
				throw new Error('Second SCSP instance writes are unsupported');
			const address = (bytes[position + 1] << 8) | bytes[position + 2];
			if (registerWrite(registers, address, bytes[position + 3])) {
				append(bytes.subarray(position, position + length));
				writes++;
			} else ignoredWrites++;
		} else if (command === 0x67) {
			need(position, 7);
			if (bytes[position + 1] !== 0x66) throw new Error('Invalid VGM data block header');
			const type = bytes[position + 2],
				rawSize = view.getUint32(position + 3, true),
				size = rawSize & 0x7fffffff;
			if (rawSize >>> 31) throw new Error('Second SCSP instance memory is unsupported');
			length = 7 + size;
			need(position, length);
			if (type === 6) {
				banks.push({
					start: bankSize,
					data: bytes.subarray(position + 7, position + length),
				});
				bankSize += size;
			} else if (type === 0xe0) {
				if (size < 4 || view.getUint32(position + 7, true) + size - 4 > RAM_BYTES)
					throw new RangeError('SCSP RAM block exceeds 512 KiB');
				append(bytes.subarray(position, position + length));
			} else throw new Error(`Unsupported SCSP data block ${hex(type)}`);
		} else if (command === 0x68) {
			length = 12;
			need(position, length);
			if (bytes[position + 1] !== 0x66 || bytes[position + 2] !== 6)
				throw new Error('SCSP playback requires SCSP PCM RAM copies');
			const from = u24(position + 3),
				address = u24(position + 6),
				size = u24(position + 9) || 0x1000000;
			if (from + size > bankSize || address + size > RAM_BYTES)
				throw new RangeError('SCSP PCM RAM copy exceeds its bank or 512 KiB RAM');
			if (outputSize + 11 + size > MAX_SCSP_SONG_BYTES)
				throw new RangeError('Prepared SCSP song exceeds 64 MiB');
			const block = new Uint8Array(11 + size),
				blockView = new DataView(block.buffer);
			block.set([0x67, 0x66, 0xe0]);
			blockView.setUint32(3, size + 4, true);
			blockView.setUint32(7, address, true);
			for (const part of banks) {
				const low = Math.max(from, part.start),
					high = Math.min(from + size, part.start + part.data.length);
				if (low < high)
					block.set(
						part.data.subarray(low - part.start, high - part.start),
						11 + low - from,
					);
			}
			append(block);
		} else if (command === 0x61) {
			length = 3;
			need(position, length);
			samples = view.getUint16(position + 1, true);
			append(bytes.subarray(position, position + length));
		} else if (command === 0x62 || command === 0x63 || (command >= 0x70 && command <= 0x7f)) {
			samples = command === 0x62 ? 735 : command === 0x63 ? 882 : (command & 15) + 1;
			append(bytes.subarray(position, position + 1));
		} else if (command === 0x66) {
			append(bytes.subarray(position, position + 1));
			ended = true;
			break;
		} else throw new Error(`Unsupported SCSP VGM command ${hex(command)}`);
		totalSamples += samples;
		if (samples) burst = 0;
		position += length;
		if (commands % 4096 === 0) await yieldTask();
	}
	check(signal);
	if (!ended) throw new Error('SCSP song has no end command');
	if (!writes || !totalSamples) throw new Error('SCSP song contains no timed register audio');
	const warnings = [];
	if (ignoredWrites)
		warnings.push(
			`${ignoredWrites} recorded CPU timer, IRQ, MIDI or inactive DMA setup writes are omitted during audio replay.`,
		);
	if (view.getUint32(0x1c, true)) warnings.push('Playback follows the recorded timeline once.');
	const prepared = new Uint8Array(outputSize);
	prepared.set(bytes.subarray(0, dataOffset));
	let offset = dataOffset;
	for (const chunk of chunks) {
		prepared.set(chunk, offset);
		offset += chunk.length;
	}
	const preparedView = new DataView(prepared.buffer);
	preparedView.setUint32(4, prepared.length - 4, true);
	preparedView.setUint32(0x14, 0, true);
	preparedView.setUint32(0x18, totalSamples, true);
	preparedView.setUint32(0x1c, 0, true);
	preparedView.setUint32(0x20, 0, true);
	return {
		bytes: prepared,
		header: { version, dataOffset, scspClock: rawClock },
		clock: rawClock,
		sourceClock: rawClock,
		sourceChip: 'scsp',
		totalSamples,
		metadata,
		format,
		warnings,
		writes,
		ignoredWrites,
	};
}

/** An original PCM16 sine phrase encoded using the public SCSP VGM format. */
export function buildScspSongDemo() {
	const commands = [],
		pcm = new Uint8Array(128),
		pcmView = new DataView(pcm.buffer);
	for (let index = 0; index < 64; index++)
		pcmView.setInt16(index * 2, Math.round(8192 * Math.sin((index * Math.PI) / 32)), false);
	const ram = new Uint8Array(11 + pcm.length),
		ramView = new DataView(ram.buffer);
	ram.set([0x67, 0x66, 0xe0]);
	ramView.setUint32(3, pcm.length + 4, true);
	ramView.setUint32(7, 0x1000, true);
	ram.set(pcm, 11);
	commands.push(...ram);
	const word = (address, value) =>
		commands.push(
			0xc5,
			address >> 8,
			address & 255,
			value >> 8,
			0xc5,
			address >> 8,
			(address + 1) & 255,
			value & 255,
		);
	for (const [address, value] of [
		[0x400, 0x020f],
		[2, 0x1000],
		[4, 0],
		[6, 64],
		[8, 31],
		[10, 0x3c1f],
		[12, 0],
		[14, 0],
		[18, 0],
		[20, 0],
		[22, 0xe000],
	])
		word(address, value);
	let totalSamples = 0;
	for (const midi of [60, 64, 67, 72, 67, 64, 62, 60]) {
		const ratio = (440 * 2 ** ((midi - 69) / 12) * 64) / 44100;
		const octave = Math.floor(Math.log2(ratio)),
			fine = Math.round((ratio / 2 ** octave - 1) * 1024);
		word(16, ((octave & 15) << 11) | fine);
		word(0, 0x1820);
		commands.push(0x61, 0x11, 0x2b);
		totalSamples += 11025;
		word(0, 0x1020);
		commands.push(0x61, 0x9d, 0x08);
		totalSamples += 2205;
	}
	commands.push(0x66);
	const bytes = new Uint8Array(256 + commands.length),
		view = new DataView(bytes.buffer);
	bytes.set([86, 103, 109, 32]);
	view.setUint32(4, bytes.length - 4, true);
	view.setUint32(8, 0x171, true);
	view.setUint32(0x18, totalSamples, true);
	view.setUint32(0x34, 256 - 0x34, true);
	view.setUint32(0xb8, SCSP_SONG_CLOCK, true);
	bytes.set(commands, 256);
	return bytes;
}
