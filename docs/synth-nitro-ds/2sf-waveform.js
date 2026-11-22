// SPDX-License-Identifier: BSD-3-Clause
import { decodeNdsAdpcm } from './nds-core.js';
import { getNdsSampleLayout } from './nds-sample.js?v=nds-2sf-audition-1';

const MAX_PREVIEW_FRAMES = 32768;
const MAX_PEAK_COLUMNS = 256;

/** Decode a bounded prefix and send only its peak columns to the UI. */
export function buildTwoSfWaveform(bytes, mode) {
	const { frames: frameCount } = getNdsSampleLayout(bytes, mode);
	const previewFrames = Math.min(frameCount, MAX_PREVIEW_FRAMES);
	const columns = Math.min(previewFrames, MAX_PEAK_COLUMNS);
	const peaks = new Float32Array(columns * 2);
	const unpacked = mode === 'adpcm' ? decodeNdsAdpcm(bytes.subarray(0, 4 + previewFrames / 2)) : null;
	const packed = unpacked ? null : new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const read = unpacked ? index => unpacked[index] / 32768
		: mode === 'pcm8' ? index => packed.getInt8(index) / 128
			: index => packed.getInt16(index * 2, true) / 32768;
	for (let column = 0; column < columns; column++) {
		const start = Math.floor(column * previewFrames / columns);
		const end = Math.floor((column + 1) * previewFrames / columns);
		let low = 1, high = -1;
		for (let index = start; index < end; index++) {
			const value = read(index);
			low = Math.min(low, value);
			high = Math.max(high, value);
		}
		peaks[column * 2] = low;
		peaks[column * 2 + 1] = high;
	}
	return { peaks, frameCount, previewFrames };
}
