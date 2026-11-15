// SPDX-License-Identifier: BSD-3-Clause
// Real native PCM rendered into arrays only; this test opens no audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import factory from '../generated/wonderswan_wasm.js';
import { WonderSwanAudioEngine } from '../js/wonderswanaudioengine.js';
import { VgmPlayer } from '../js/vgmplayer.js';
import { createAswanSongEngine, prepareAswanSongSource } from './song_engine.js';
import { extractVgmInstruments } from './vgm_import.js';
import {
	createWonderSwanLargeVgm,
	WONDERSWAN_LARGE_VGM_WRITES,
} from '../../test/helpers/wonderswan_large_vgm_fixture.mjs';

const wasmBinary = await readFile(new URL('../generated/wonderswan_wasm.wasm', import.meta.url));
const module = await factory({ wasmBinary });
const moduleFactory = async () => module;

test('dense VGZ extracts complete Wave/Noise sounds without replacing source bytes', async () => {
	const input = createWonderSwanLargeVgm(),
		copy = input.slice();
	const compressed = gzipSync(input),
		compressedCopy = Buffer.from(compressed),
		result = await extractVgmInstruments(compressed);
	assert.equal(result.totalSamples, WONDERSWAN_LARGE_VGM_WRITES);
	assert(result.voices.some((voice) => voice.kind === 'wave'));
	assert(result.voices.some((voice) => voice.kind === 'noise'));
	assert(
		result.voices.length < 10,
		'repeated driver refreshes are not separate static instruments',
	);
	assert(result.voices.every((voice) => voice.preset.envelope.enabled === false));
	assert.deepEqual(compressed, compressedCopy);
	assert.deepEqual(input, copy);
});

test('host-prepared dense song retains every write and exactly matches streaming native playback', async () => {
	const input = createWonderSwanLargeVgm(),
		source = await prepareAswanSongSource(input);
	assert(source.timeline.events.length * 32 > 8 * 1024 * 1024);
	assert.equal(source.timeline.events.length, source.trace.events.length);
	assert.equal(source.timeline.durationSamples, WONDERSWAN_LARGE_VGM_WRITES);
	const actual = await createAswanSongEngine(source, { moduleFactory });
	const reference = await WonderSwanAudioEngine.create({
		moduleFactory,
		clock: source.clock,
		outputSampleRate: 44100,
		masterVolume: 1,
	});
	try {
		const player = new VgmPlayer(reference);
		player.load(input, { logger: null });
		player.setLoopEnabled(false);
		player.setPrefetchFactor(1);
		player.reset();
		player.play();
		let frame = 0,
			partition = 0,
			nonzero = false;
		const sizes = [113, 7, 512, 1, 256];
		while (frame < source.timeline.durationSamples) {
			const count = Math.min(
				sizes[partition++ % sizes.length],
				source.timeline.durationSamples - frame,
			);
			const left = new Float32Array(count),
				right = new Float32Array(count),
				expectedLeft = new Float32Array(count),
				expectedRight = new Float32Array(count);
			assert.equal(actual.process(left, right, count), count);
			assert.equal(player.process(expectedLeft, expectedRight, count), count);
			assert.deepEqual(left, expectedLeft, `left PCM at frame ${frame}`);
			assert.deepEqual(right, expectedRight, `right PCM at frame ${frame}`);
			assert(left.every(Number.isFinite) && right.every(Number.isFinite));
			nonzero ||= left.some((value) => value !== 0) || right.some((value) => value !== 0);
			frame += count;
		}
		assert(nonzero);
		assert.equal(actual.ended, true);
		assert.equal(actual.frame, WONDERSWAN_LARGE_VGM_WRITES);
		assert.equal(
			actual.snapshot().registers[16],
			0x89,
			'same-On control writes survive to EOF',
		);
	} finally {
		actual.dispose();
		reference.dispose();
	}
});
