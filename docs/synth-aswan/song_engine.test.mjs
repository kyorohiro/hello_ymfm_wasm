// SPDX-License-Identifier: BSD-3-Clause
// Actual native PCM into arrays only. No audio device or context is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import factory from '../generated/wonderswan_wasm.js';
import { WonderSwanAudioEngine } from '../js/wonderswanaudioengine.js';
import { VgmPlayer } from '../js/vgmplayer.js';
import { createAswanSongEngine, prepareAswanSongSource } from './song_engine.js';
import { aswanSongLiveView } from './song_live.js';
import { createWonderSwanVgm } from '../../test/helpers/wonderswan_vgm_fixture.mjs';

const wasmBinary = await readFile(new URL('../generated/wonderswan_wasm.wasm', import.meta.url));
const module = await factory({ wasmBinary }),
	moduleFactory = async () => module;
const render = (engine, length, sizes = [256]) => {
	const left = new Float32Array(length),
		right = new Float32Array(length);
	let frame = 0,
		index = 0;
	while (frame < length) {
		const size = Math.min(sizes[index++ % sizes.length], length - frame);
		const l = new Float32Array(size),
			r = new Float32Array(size),
			count = engine.process(l, r, size);
		assert.equal(count, size);
		left.set(l, frame);
		right.set(r, frame);
		frame += size;
	}
	return { left, right };
};
for (const mode of ['wave', 'sweep', 'noise', 'voice'])
	test(`ASWAN ${mode} exact timeline PCM equals the shared VGM player/native speaker path`, async () => {
		const bytes = createWonderSwanVgm({ mode, seconds: 0.2, loop: false }),
			source = await prepareAswanSongSource(bytes);
		const actual = await createAswanSongEngine(source, { moduleFactory });
		const reference = await WonderSwanAudioEngine.create({
			moduleFactory,
			clock: source.clock,
			outputSampleRate: 44100,
			masterVolume: 1,
		});
		try {
			const player = new VgmPlayer(reference);
			player.load(bytes, { logger: null });
			player.setLoopEnabled(false);
			player.setPrefetchFactor(1);
			player.reset();
			player.play();
			const expected = { left: new Float32Array(8000), right: new Float32Array(8000) };
			assert.equal(player.process(expected.left, expected.right, 8000), 8000);
			const pcm = render(actual, 8000, [1, 7, 113, 256, 77]);
			assert.deepEqual(pcm, expected);
			assert(pcm.left.some((value) => value !== 0));
			assert(pcm.left.every(Number.isFinite));
			assert(pcm.right.every(Number.isFinite));
			assert.equal(actual.frame, 8000);
			assert.equal(actual.snapshot().channels.length, 4);
		} finally {
			actual.dispose();
			reference.dispose();
		}
	});
test('partitioning, mute, reset and end boundaries preserve native song timing', async () => {
	const source = await prepareAswanSongSource(createWonderSwanVgm({ seconds: 0.1, loop: true }));
	const a = await createAswanSongEngine(source, { moduleFactory }),
		b = await createAswanSongEngine(source, { moduleFactory });
	try {
		const expected = render(a, 4000, [4000]);
		assert.deepEqual(render(b, 4000, [3, 128, 1, 900]), expected);
		b.reset();
		assert.equal(b.frame, 0);
		b.setChannelMuted(0, true);
		const muted = render(b, 4000);
		assert(muted.left.every((value) => value === 0));
		b.reset();
		b.setChannelMuted(0, false);
		assert.deepEqual(render(b, 4000), expected);
		const left = new Float32Array(1000),
			right = new Float32Array(1000);
		assert.equal(b.process(left, right, 1000), 410);
		assert.equal(b.ended, true);
		assert.equal(b.process(left, right, 1), 0);
		assert.throws(() => b.setChannelMuted(4, true), /physical channel/);
	} finally {
		a.dispose();
		b.dispose();
	}
});
test('Live snapshots own complete written waves and expose mode-compatible source fields', async () => {
	for (const mode of ['wave', 'sweep', 'noise', 'voice']) {
		const source = await prepareAswanSongSource(
			createWonderSwanVgm({ mode, seconds: 0.1, loop: false }),
		);
		const engine = await createAswanSongEngine(source, { moduleFactory });
		try {
			const snapshot = engine.snapshot(),
				channel = mode === 'sweep' ? 2 : mode === 'noise' ? 3 : mode === 'voice' ? 1 : 0;
			const view = aswanSongLiveView(snapshot, channel);
			assert.equal(view.gate, true);
			assert.equal(view.waveKnown, true);
			assert.equal(view.preset.envelope.enabled, false);
			assert.equal(
				view.preset.source,
				mode === 'voice' ? 'pcm' : mode === 'noise' ? 'noise' : 'wave',
			);
			assert.equal(view.preset.sweep.enabled, mode === 'sweep');
			assert.equal(view.canCapture, mode !== 'voice');
			assert.match(view.readout, /sent settings, not oscillator phase/);
			if (mode === 'voice') assert(view.unknownFields.includes('pcm.data'));
			snapshot.waveforms[0][0] = 1234;
			snapshot.registers[16] = 0;
			assert.notEqual(engine.snapshot().waveforms[0][0], 1234);
			assert.notEqual(engine.snapshot().registers[16], 0);
		} finally {
			engine.dispose();
		}
	}
	assert.throws(() => aswanSongLiveView({}, 0), /snapshot/);
	assert.throws(() => aswanSongLiveView({}, 4), /0..3/);
});
