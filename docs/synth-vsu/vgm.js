// SPDX-License-Identifier: BSD-3-Clause
import { maybeDecodeVgmFile, parseVgmMetadata } from '../js/vgm_file.js';
import { VSU_SOUND_STOP } from './vsu.js';

export const VGM_SAMPLE_RATE = 44100;
export const VSU_VGM_MAX_BYTES = 64 * 1024 * 1024;
const MAX_VSU_WRITES = 2 * 1024 * 1024;
const VGM_MAGIC = 0x206d6756;
const GD3_MAGIC = 0x20336447;
const VSU_CLOCK_OFFSET = 0xc4;
const VSU_CLOCK_RATE = 5000000;

function dataBytes(source) {
	if (source instanceof Uint8Array) return source;
	if (source instanceof ArrayBuffer) return new Uint8Array(source);
	throw new TypeError('VGM source must be an ArrayBuffer or Uint8Array.');
}

function walkCommands(view, start, end, loopOffset, writes) {
	let cursor = start;
	let durationTicks = 0;
	let eventCount = 0;
	let loopTick = null;
	let loopIndex = 0;
	while (cursor < end) {
		if (cursor === loopOffset) {
			loopTick = durationTicks;
			loopIndex = eventCount;
		}
		const opcode = view.getUint8(cursor++);
		if (opcode === 0x66) {
			if (!eventCount || !durationTicks) throw new Error('The VGM contains no timed VSU performance.');
			if (loopOffset && (loopTick === null || loopTick >= durationTicks))
				throw new Error('The VGM loop must point to a command with playback time remaining.');
			return { durationTicks, loopTick, loopIndex, eventCount };
		}
		if (opcode === 0xc7) {
			if (cursor + 3 > end) throw new Error('Truncated VGM VSU write.');
			// VGM stores big-endian VSU word offsets. The core uses byte offsets.
			const address = view.getUint16(cursor, false) * 4;
			const value = view.getUint8(cursor + 2);
			cursor += 3;
			if (address > VSU_SOUND_STOP) throw new Error('The VGM contains an out-of-range VSU write.');
			if (eventCount === MAX_VSU_WRITES) throw new RangeError('The VGM contains too many VSU writes.');
			if (writes) {
				const index = eventCount * 3;
				writes[index] = durationTicks;
				writes[index + 1] = address;
				writes[index + 2] = value;
			}
			eventCount++;
			continue;
		}

		if (opcode === 0x61) {
			if (cursor + 2 > end) throw new Error('Truncated VGM wait.');
			durationTicks += view.getUint16(cursor, true);
			cursor += 2;
		} else if (opcode === 0x62 || opcode === 0x63) {
			durationTicks += opcode === 0x62 ? 735 : 882;
		} else if (opcode >= 0x70 && opcode <= 0x7f) {
			durationTicks += (opcode & 0x0f) + 1;
		} else {
			throw new Error(`Unsupported VGM command 0x${opcode.toString(16).padStart(2, '0')}.`);
		}
		if (durationTicks > 0xffffffff) throw new RangeError('The VGM playback duration exceeds the format limit.');
	}
	throw new Error('The VGM is missing its end command.');
}

/** Parse a single 5 MHz VSU performance. Timing is in 44.1 kHz VGM ticks. */
export function parseVsuVgm(source) {
	const bytes = dataBytes(source);
	if (bytes.byteLength > VSU_VGM_MAX_BYTES) throw new RangeError('VGM exceeds the uncompressed size limit.');
	if (bytes.byteLength < 0x40) throw new Error('Truncated VGM header.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, true) !== VGM_MAGIC) throw new Error('Choose a Virtual Boy VGM or VGZ file.');
	const version = view.getUint32(8, true);
	const end = 4 + view.getUint32(4, true);
	const start = 0x34 + view.getUint32(0x34, true);
	if (version < 0x171 || start < VSU_CLOCK_OFFSET + 4)
		throw new Error('Virtual Boy VSU playback requires a VGM 1.71 header with a VSU clock.');
	if (end > bytes.byteLength || start >= end) throw new Error('Invalid VGM data or end offset.');

	const clock = view.getUint32(VSU_CLOCK_OFFSET, true);
	if (!clock) throw new Error('The VGM has no Virtual Boy VSU clock.');
	if (clock !== VSU_CLOCK_RATE) throw new Error('This player requires a single 5 MHz VSU.');

	const relativeLoop = view.getUint32(0x1c, true);
	const loopOffset = relativeLoop ? 0x1c + relativeLoop : 0;
	const gd3 = 0x14 + view.getUint32(0x14, true);
	const commandsEnd = gd3 > start && gd3 + 4 <= end && view.getUint32(gd3, true) === GD3_MAGIC ? gd3 : end;
	if (loopOffset && (loopOffset < start || loopOffset >= commandsEnd))
		throw new Error('Invalid VGM loop offset.');

	// Count before allocating so the exact-size backing buffer can be handed
	// to the AudioWorklet without carrying unused source or taking another copy.
	const { durationTicks, loopTick, loopIndex, eventCount } = walkCommands(view, start, commandsEnd, loopOffset);
	const writes = new Uint32Array(eventCount * 3);
	walkCommands(view, start, commandsEnd, loopOffset, writes);
	const metadata = parseVgmMetadata(bytes.subarray(0, end));
	const title = metadata?.trackName || metadata?.trackNameOriginal || '';
	return { writes, durationTicks, loopTick, loopIndex, title, metadata };
}

/** Decode VGM or VGZ bytes and prepare the register timeline. */
export async function loadVsuVgm(source) {
	return parseVsuVgm(await maybeDecodeVgmFile(source, { maxBytes: VSU_VGM_MAX_BYTES }));
}
