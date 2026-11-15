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

test('paused sparse native edits preserve disjoint ahead writes, gate, phase and later driver ownership', async () => {
	const { createAswanPausedSongFixture } = await import(
		'../../test/helpers/aswan_synth_paused_fixture.mjs'
	);
	const source = await prepareAswanSongSource(
		createAswanPausedSongFixture({
			changes: [
				[512, 0x88, 0xf3],
				[2000, 0x88, 0xa5],
			],
		}),
	);
	const a = await createAswanSongEngine(source, { moduleFactory }),
		b = await createAswanSongEngine(source, { moduleFactory });
	try {
		const original = a.snapshot(),
			before = aswanSongLiveView(original, 0).preset;
		assert.deepEqual(render(a, 1024), render(b, 1024));
		const nativeBefore = a.snapshot(),
			next = structuredClone(before);
		next.left = 7;
		const result = a.editVoice(0, before, next);
		assert.equal(result.nativeFrame, 1024);
		assert.deepEqual(result.changes, { left: 7 });
		const edited = a.snapshot();
		assert.equal(
			edited.registers[8],
			0x73,
			'native right3 survives a left-only UI edit based on frozen right15',
		);
		assert.deepEqual(edited.registers.slice(0, 8), nativeBefore.registers.slice(0, 8));
		assert.equal(edited.registers[16], nativeBefore.registers[16]);
		assert.deepEqual(edited.waveforms, nativeBefore.waveforms);
		const changed = render(a, 512),
			reference = render(b, 512);
		assert.deepEqual(changed.right, reference.right, 'right oscillator phase is uninterrupted');
		assert.notDeepEqual(changed.left, reference.left, 'native left volume changed');
		render(a, 600);
		assert.equal(
			a.snapshot().registers[8],
			0xa5,
			'later recorded byte takes over the edited field',
		);
		const invalid = structuredClone(next);
		invalid.wave[0] = 99;
		const state = a.snapshot();
		assert.throws(() => a.editVoice(0, next, invalid), /Wave sample/);
		assert.deepEqual(a.snapshot(), state);
	} finally {
		a.dispose();
		b.dispose();
	}
});
test('wave, Noise and Sweep edits change native output without key-off or source-file changes', async () => {
	for (const mode of ['wave', 'noise', 'sweep']) {
		const bytes = createWonderSwanVgm({ mode, seconds: 0.2, loop: false }),
			copy = bytes.slice(),
			source = await prepareAswanSongSource(bytes),
			engine = await createAswanSongEngine(source, { moduleFactory });
		try {
			const channel = mode === 'noise' ? 3 : mode === 'sweep' ? 2 : 0,
				first = engine.snapshot(),
				before = aswanSongLiveView(first, channel).preset,
				next = structuredClone(before);
			if (mode === 'wave') next.wave = Array.from({ length: 32 }, (_, i) => i % 16);
			if (mode === 'noise') next.noise.type = 7;
			if (mode === 'sweep') {
				next.sweep.step = -4;
				next.sweep.time = 7;
			}
			const result = engine.editVoice(channel, before, next),
				edited = engine.snapshot();
			assert.equal(result.nativeFrame, 0);
			assert.equal(edited.registers[16], first.registers[16]);
			if (mode === 'wave') assert.deepEqual(edited.waveforms[channel], next.wave);
			if (mode === 'noise') assert.equal(edited.registers[14] & 7, 7);
			if (mode === 'sweep') {
				assert.equal(edited.registers[12], 252);
				assert.equal(edited.registers[13] & 31, 7);
			}
			assert(render(engine, 1024).left.some((value) => value !== 0));
			assert.deepEqual(bytes, copy);
		} finally {
			engine.dispose();
		}
	}
	const source = await prepareAswanSongSource(
			createWonderSwanVgm({ mode: 'voice', seconds: 0.1, loop: false }),
		),
		engine = await createAswanSongEngine(source, { moduleFactory });
	try {
		const before = aswanSongLiveView(engine.snapshot(), 0).preset,
			next = structuredClone(before);
		next.left = 3;
		assert.throws(() => engine.editVoice(1, before, next), /rendered-ahead CH2/);
	} finally {
		engine.dispose();
	}
});
