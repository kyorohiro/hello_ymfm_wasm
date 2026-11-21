// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeSampleWav } from '../js/playground_sample_edit.js';
import { NDS_AUDIO_CLOCK, NDS_MAX_SAMPLE_BYTES } from './nds-core.js';
import { NdsSoundCore } from '../../test/runtime/nds_sound_reference.mjs';
import {
	NDS_MAX_WAV_BYTES, encodeNdsSample, getNdsSampleLayout, normalizeNdsSampleRange,
	readNdsSample, readNdsSampleRange, readNdsWav,
} from './nds-sample.js';

test('DS WAV import keeps the original rate and averages stereo frames', async () => {
	const signal = { sampleRate: 32000, channels: [Float32Array.of(.5, -.5, 1, 0), Float32Array.of(.25, .25, -1, .5)] };
	const wav = encodeSampleWav(signal);
	const framed = new Uint8Array(wav.length + 8);
	framed.set(wav, 3);
	const audio = await readNdsWav(framed.subarray(3, 3 + wav.length));
	assert.equal(audio.sampleRate, 32000);
	assert.deepEqual(audio.pcm, Float32Array.of(.375, -.125, 0, .25));
});

test('DS WAV import rejects malformed, nonfinite, and oversized sources', async () => {
	await assert.rejects(readNdsWav('sample.wav'), /Expected WAV bytes/);
	const wav = encodeSampleWav({ sampleRate: 48000, channels: [Float32Array.of(0, .5)] });
	await assert.rejects(readNdsWav(wav.subarray(0, wav.length - 1)), /Truncated WAV/);
	const invalid = new Uint8Array(wav);
	new DataView(invalid.buffer).setFloat32(58, NaN, true);
	await assert.rejects(readNdsWav(invalid), /must be finite/);
	const outOfRange = new Uint8Array(wav);
	new DataView(outOfRange.buffer).setUint32(24, 1, true);
	await assert.rejects(readNdsWav(outOfRange), /sample rate/);
	await assert.rejects(readNdsWav(new Uint8Array(NDS_MAX_WAV_BYTES + 1)), /16 MiB/);
	const abort = AbortSignal.abort();
	await assert.rejects(readNdsWav(wav, { signal: abort }), { name: 'AbortError' });
});

test('DS PCM encoding uses signed bytes, little-endian words and hardware padding', () => {
	const source = Float32Array.of(-1, -.5, 0, .5, 1);
	const pcm8 = encodeNdsSample(source, 44100, 'pcm8');
	assert.equal(pcm8.frames, 16);
	assert.equal(pcm8.sourceFrames, 5);
	assert.deepEqual(pcm8.bytes.subarray(0, 6), Uint8Array.of(128, 192, 0, 64, 127, 0));
	assert.deepEqual(pcm8.pcm.subarray(0, 6), Float32Array.of(-1, -.5, 0, .5, 127 / 128, 0));
	const pcm16 = encodeNdsSample(source, 44100, 'pcm16');
	assert.equal(pcm16.frames, 8);
	assert.deepEqual(pcm16.bytes.subarray(0, 12), Uint8Array.of(0, 128, 0, 192, 0, 0, 0, 64, 255, 127, 0, 0));
	assert.deepEqual(pcm16.pcm.subarray(0, 6), Float32Array.of(-1, -.5, 0, .5, 32767 / 32768, 0));
	for (const asset of [pcm8, pcm16]) {
		const reopened = readNdsSample(asset.bytes, asset.sampleRate, asset.mode);
		assert.notStrictEqual(reopened.bytes, asset.bytes);
		assert.deepEqual(reopened.pcm, asset.pcm);
	}
});

test('DS IMA-ADPCM stores a valid header and low-first nibbles decoded by the core', () => {
	const wave = Float32Array.from({ length: 63 }, (_, index) => .67 * Math.sin(index * Math.PI / 16));
	const sample = encodeNdsSample(wave, 48000, 'adpcm');
	assert.equal(sample.frames, 64);
	assert.equal(sample.headerWords, 1);
	assert.equal(sample.bytes.length, 36);
	assert.equal(sample.bytes[3], 0);
	assert(sample.bytes[2] <= 88);
	assert(Math.max(...wave.map((value, index) => Math.abs(value - sample.pcm[index]))) < .09);
	assert.deepEqual(readNdsSample(sample.bytes, 48000, 'adpcm').pcm, sample.pcm);
	const corrupted = new Uint8Array(sample.bytes);
	corrupted[2] = 99;
	assert.throws(() => readNdsSample(corrupted, 48000, 'adpcm'), /Invalid Nintendo DS ADPCM header/);
});

test('DS loop positions align within the sample and preserve one-shot PNT', () => {
	for (const [mode, start, end, expected] of [
		['pcm8', 27, 38, [24, 40, 6, 4]],
		['pcm16', 27, 39, [26, 40, 13, 7]],
		['adpcm', 27, 38, [24, 40, 4, 2]],
	]) {
		const sample = encodeNdsSample(new Float32Array(64), 48000, mode);
		for (const loop of [false, true]) {
			const range = normalizeNdsSampleRange(sample, { startFrame: start, endFrame: end, loop });
			assert.deepEqual([range.startFrame, range.endFrame, range.loopStartWords, range.lengthWords], expected);
			assert.deepEqual(readNdsSampleRange(sample, range), range);
		}
	}
	const adpcm = encodeNdsSample(new Float32Array(64), 48000, 'adpcm');
	assert.equal(normalizeNdsSampleRange(adpcm, { endFrame: 2 }).endFrame, 24);
	assert.throws(() => readNdsSampleRange(adpcm, { loopStartWords: 0, lengthWords: 9, loop: true }), /loop start/);
	assert.throws(() => readNdsSampleRange(adpcm, { loopStartWords: 1, lengthWords: 10, loop: true }), /end inside/);
	const big = getNdsSampleLayout(new Uint8Array(NDS_MAX_SAMPLE_BYTES), 'pcm8');
	assert.equal(normalizeNdsSampleRange(big, { startFrame: 400000, loop: true }).loopStartWords, 0xffff);
});

test('DS hardware renders the one-shot prefix and loops the exact selected interval', () => {
	const audio = encodeNdsSample(Float32Array.from({ length: 32 }, (_, index) => index / 32), 48000, 'pcm16');
	const core = new NdsSoundCore(48000);
	for (const loop of [false, true]) {
		const range = normalizeNdsSampleRange(audio, { startFrame: 6, endFrame: 16, loop });
		core.configure(0, { mode: audio.mode, bytes: audio.bytes, loop, loopStartWords: range.loopStartWords,
			lengthWords: range.lengthWords, pan: 0, volume: 127, timer: 65536 - Math.floor(NDS_AUDIO_CLOCK / 48000) });
		core.keyOn(0);
		const left = new Float32Array(32), right = new Float32Array(32);
		core.render(left, right);
		assert.deepEqual(left.subarray(3, 19), audio.pcm.subarray(0, 16).map(value => value * .25));
		const tail = loop ? audio.pcm.subarray(6, 16).map(value => value * .25) : new Float32Array(10);
		assert.deepEqual(left.subarray(19, 29), tail);
		assert(right.every(value => value === 0));
	}
});

test('conversion rejects over-capacity input without truncation or mutation', () => {
	const large = new Float32Array((NDS_MAX_SAMPLE_BYTES / 2) + 1);
	assert.throws(() => encodeNdsSample(large, 48000, 'pcm16'), /exceeds 1 MiB/);
	assert.throws(() => encodeNdsSample(Float32Array.of(Infinity), 48000, 'adpcm'), /must be finite/);
	assert.throws(() => readNdsSample(new Uint8Array(20), 48000, 'noise'), /Choose PCM8/);
	assert.throws(() => readNdsSample(new Uint8Array(17), 48000, 'pcm8'), /word-aligned/);
});
