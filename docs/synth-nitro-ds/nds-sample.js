// SPDX-License-Identifier: BSD-3-Clause
import { readSamplePCM } from '../js/adpcm_b_sample.js';
import {
	NDS_ADPCM_INDEX_DELTAS, NDS_ADPCM_STEPS, NDS_AUDIO_CLOCK, NDS_MAX_SAMPLE_BYTES,
	decodeNdsAdpcm, ndsAdpcmDelta, readNdsAdpcmHeader,
} from './nds-core.js?v=nds-sample-1';

export const NDS_MAX_WAV_BYTES = 16 * 1024 * 1024;
const MIN_SAMPLE_RATE = Math.ceil(NDS_AUDIO_CLOCK / 65536);
const MAX_LOOP_START_WORDS = 0xffff;
const SAMPLE_FORMATS = {
	pcm8: { framesPerWord: 4, headerWords: 0 },
	pcm16: { framesPerWord: 2, headerWords: 0 },
	adpcm: { framesPerWord: 8, headerWords: 1 },
};
const MAX_WAV_FRAMES = (NDS_MAX_SAMPLE_BYTES / 4 - 1) * SAMPLE_FORMATS.adpcm.framesPerWord;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function validateNdsSampleRate(rate) {
	if (!Number.isInteger(rate) || rate < MIN_SAMPLE_RATE || rate > NDS_AUDIO_CLOCK)
		throw new RangeError(`DS sample rate must be an integer from ${MIN_SAMPLE_RATE} through ${NDS_AUDIO_CLOCK} Hz`);
	return rate;
}

/** Read a bounded PCM/float RIFF WAV without resampling or opening an audio device. */
export async function readNdsWav(bytes, { signal } = {}) {
	if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) throw new TypeError('Expected WAV bytes');
	if (bytes.byteLength > NDS_MAX_WAV_BYTES) throw new RangeError('WAV exceeds the 16 MiB import limit');
	const { channels, sampleRate } = await readSamplePCM(bytes, { signal });
	signal?.throwIfAborted();
	validateNdsSampleRate(sampleRate);
	const frames = channels[0].length;
	if (!frames || frames > MAX_WAV_FRAMES) throw new RangeError('WAV must contain audio that fits in a DS sample');
	const pcm = new Float32Array(frames);
	for (let frame = 0; frame < frames; frame++) {
		let sum = 0;
		for (const channel of channels) {
			const value = channel[frame];
			if (!Number.isFinite(value)) throw new TypeError('WAV samples must be finite');
			sum += value;
		}
		pcm[frame] = clamp(sum / channels.length, -1, 1);
	}
	return { pcm, sampleRate };
}

function sampleFormat(mode) {
	if (!Object.hasOwn(SAMPLE_FORMATS, mode)) throw new RangeError('Choose PCM8, PCM16 or IMA-ADPCM');
	return SAMPLE_FORMATS[mode];
}

/** Validate packed sample data and return its decoded frame grid. */
export function getNdsSampleLayout(bytes, mode) {
	const { framesPerWord, headerWords } = sampleFormat(mode);
	if (!(bytes instanceof Uint8Array) || bytes.length < 16 || bytes.length > NDS_MAX_SAMPLE_BYTES || bytes.length % 4)
		throw new RangeError('DS samples must have 16 bytes to 1 MiB of word-aligned data');
	if (headerWords) readNdsAdpcmHeader(bytes);
	return { mode, framesPerWord, headerWords, frames: (bytes.length / 4 - headerWords) * framesPerWord };
}

function unpack(bytes, sampleRate, layout) {
	const { mode } = layout;
	const pcm = new Float32Array(layout.frames);
	if (mode === 'adpcm') {
		const decoded = decodeNdsAdpcm(bytes);
		for (let index = 0; index < pcm.length; index++) pcm[index] = decoded[index] / 32768;
	} else {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
		for (let index = 0; index < pcm.length; index++)
			pcm[index] = mode === 'pcm8' ? view.getInt8(index) / 128 : view.getInt16(index * 2, true) / 32768;
	}
	return { ...layout, sampleRate, bytes, pcm };
}

/** Reopen a packed sample without re-encoding it. The preview reflects the stored bytes. */
export function readNdsSample(bytes, sampleRate, mode) {
	validateNdsSampleRate(sampleRate);
	const layout = getNdsSampleLayout(bytes, mode);
	return unpack(new Uint8Array(bytes), sampleRate, layout);
}

function encodeAdpcm(pcm, frames, bytes) {
	const targetAt = index => clamp(Math.round((pcm[index] ?? 0) * 32768), -32767, 32767);
	const first = targetAt(0);
	const firstDiff = pcm.length > 1 ? Math.abs(targetAt(1) - first) : 0;
	let stepIndex = NDS_ADPCM_STEPS.findIndex(step => ndsAdpcmDelta(step, 7) >= firstDiff);
	if (stepIndex < 0) stepIndex = 88;
	let sample = clamp(first - ndsAdpcmDelta(NDS_ADPCM_STEPS[stepIndex], 0), -32767, 32767);
	new DataView(bytes.buffer).setInt16(0, sample, true);
	bytes[2] = stepIndex;
	for (let frame = 0; frame < frames; frame++) {
		const target = targetAt(frame);
		const sign = target < sample ? 8 : 0;
		const step = NDS_ADPCM_STEPS[stepIndex];
		let bestCode = 0, bestValue = sample, bestError = Infinity;
		for (let magnitude = 0; magnitude < 8; magnitude++) {
			const code = sign | magnitude;
			const value = clamp(sample + ndsAdpcmDelta(step, code), -32767, 32767);
			const error = Math.abs(target - value);
			if (error < bestError) {
				bestCode = code;
				bestValue = value;
				bestError = error;
			}
		}
		bytes[4 + (frame >>> 1)] |= bestCode << ((frame & 1) * 4);
		sample = bestValue;
		stepIndex = clamp(stepIndex + NDS_ADPCM_INDEX_DELTAS[bestCode & 7], 0, 88);
	}
}

/** Convert to native data, padding to full words and the four-word minimum with zero-valued targets. */
export function encodeNdsSample(pcm, sampleRate, mode) {
	validateNdsSampleRate(sampleRate);
	if (!(pcm instanceof Float32Array) || !pcm.length) throw new TypeError('Expected nonempty mono Float32 PCM');
	const { framesPerWord, headerWords } = sampleFormat(mode);
	const words = Math.max(4, headerWords + Math.ceil(pcm.length / framesPerWord));
	if (words * 4 > NDS_MAX_SAMPLE_BYTES) throw new RangeError('Converted DS sample exceeds 1 MiB. Choose a smaller WAV or another format.');
	for (const value of pcm) if (!Number.isFinite(value)) throw new TypeError('PCM samples must be finite');
	const bytes = new Uint8Array(words * 4);
	if (mode === 'adpcm') encodeAdpcm(pcm, (words - headerWords) * framesPerWord, bytes);
	else {
		const view = new DataView(bytes.buffer);
		for (let index = 0; index < pcm.length; index++) {
			if (mode === 'pcm8') view.setInt8(index, clamp(Math.round(pcm[index] * 128), -128, 127));
			else view.setInt16(index * 2, clamp(Math.round(pcm[index] * 32768), -32768, 32767), true);
		}
	}
	return { ...unpack(bytes, sampleRate, getNdsSampleLayout(bytes, mode)), sourceFrames: pcm.length };
}

/** Validate exact stored PNT/LEN codes and restore editor positions. The end is exclusive. */
export function readNdsSampleRange({ frames, framesPerWord, headerWords }, { loopStartWords, lengthWords, loop }) {
	if (typeof loop !== 'boolean') throw new TypeError('DS sample loop must be a boolean');
	if (!Number.isInteger(loopStartWords) || loopStartWords < (loop ? headerWords : 0) || loopStartWords > MAX_LOOP_START_WORDS)
		throw new RangeError('DS loop start is outside its valid word range');
	const endWords = loopStartWords + lengthWords;
	const endFrame = (endWords - headerWords) * framesPerWord;
	if (!Number.isInteger(lengthWords) || lengthWords < 1 || endWords < 4 || endFrame > frames)
		throw new RangeError('DS sample length must end inside the sample and use at least four words');
	return { startFrame: Math.max(0, loopStartWords - headerWords) * framesPerWord,
		endFrame, loop, loopStartWords, lengthWords };
}

/** Align a UI range to DS words, preserving the chosen repeat start while Repeat is off. */
export function normalizeNdsSampleRange(asset, { startFrame = 0, endFrame = asset.frames, loop = false } = {}) {
	if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame)) throw new RangeError('DS sample frame positions must be finite');
	const { frames, framesPerWord, headerWords } = asset;
	const endWords = clamp(Math.ceil(endFrame / framesPerWord) + headerWords, 4, frames / framesPerWord + headerWords);
	const loopStartWords = clamp(Math.floor(startFrame / framesPerWord) + headerWords,
		headerWords, Math.min(endWords - 1, MAX_LOOP_START_WORDS));
	return readNdsSampleRange(asset, { loopStartWords, lengthWords: endWords - loopStartWords, loop });
}
