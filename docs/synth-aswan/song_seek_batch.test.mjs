// SPDX-License-Identifier: BSD-3-Clause
// An inert native-counter/Web Audio graph: no device or real timers are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAswanSongPlayer } from './song_player.js';
import { fakeAudio, deferred } from '../synth-huc6280/song_test_helpers.mjs';

function setup(t, { samples, onProcess = () => {}, ...options }) {
	const graph = fakeAudio(),
		engines = [],
		states = [],
		statuses = [];
	const player = createAswanSongPlayer({
		getAudio: async () => graph.audio,
		prepareSource: async () => ({
			clock: 3072000,
			totalSamples: samples,
			warnings: [],
			format: 'vgm',
		}),
		createEngine: async () => {
			const engine = {
				frame: 0,
				calls: [],
				disposed: false,
				sampleRate: () => 44100,
				get ended() {
					return this.frame >= samples;
				},
				process(left, right, count) {
					const length = Math.min(count, samples - this.frame);
					this.calls.push(length);
					left.fill(0.125, 0, length);
					right.fill(-0.125, 0, length);
					this.frame += length;
					onProcess(this, length);
					return length;
				},
				snapshot() {
					return {
						frame: this.frame,
						clock: 3072000,
						registers: Array(32).fill(0),
						registerKnown: Array(32).fill(1),
						waveforms: Array.from({ length: 4 }, () => Array(32).fill(0)),
						waveKnown: Array(4).fill(true),
					};
				},
				setChannelMuted() {},
				dispose() {
					this.disposed = true;
				},
			};
			engines.push(engine);
			return engine;
		},
		schedule: graph.schedule,
		cancel: graph.cancel,
		onState: (state) => states.push(state),
		onStatus: (status) => statuses.push(status),
		...options,
	});
	t.after(() => player.dispose());
	return { graph, engines, states, statuses, player };
}

test('long-track seek avoids one browser-clamped timer per native block', async (t) => {
	const samples = 20650022;
	let now = 0,
		yields = 0;
	const f = setup(t, {
		samples,
		nowMs: () => now,
		yieldTask: async () => {
			yields++;
			now += 4;
		},
	});
	await f.player.load(Uint8Array.of(1));
	assert(await f.player.seek(samples / 44100));
	assert.equal(f.player.getState().positionFrames, samples);
	assert.equal(f.player.getState().paused, true);
	assert.equal(f.engines[0].frame, samples);
	assert.equal(f.engines[0].calls.length, Math.ceil(samples / 2048));
	assert(f.engines[0].calls.every((count) => count > 0 && count <= 2048));
	assert.equal(yields, Math.ceil(Math.ceil(samples / 2048) / 64));
	assert(now < 1000, 'simulated 4ms timer clamping is bounded instead of exceeding 30s');
	const progress = f.states.filter((state) => state.seeking).map((state) => state.seekProgress);
	assert.equal(progress[0], 0);
	assert.equal(progress.at(-1), 1);
	assert(
		progress.every(
			(value, index) => value >= 0 && value <= 1 && (!index || value >= progress[index - 1]),
		),
	);
	assert.equal(f.graph.sources().length, 0, 'silent seek schedules no audible PCM');
	assert.equal(f.graph.context.closes, 0);
});

test('seek yields after a short wall-time budget even before the block cap', async (t) => {
	const samples = 2048 * 10 + 17,
		batches = [];
	let now = 0,
		calls = 0,
		lastYieldCalls = 0;
	const f = setup(t, {
		samples,
		nowMs: () => now,
		onProcess: () => {
			calls++;
			now += 3;
		},
		yieldTask: async () => {
			batches.push(calls - lastYieldCalls);
			lastYieldCalls = calls;
		},
	});
	await f.player.load(Uint8Array.of(1));
	assert(await f.player.seek(samples / 44100));
	assert.deepEqual(batches, [3, 3, 3, 2]);
	assert.equal(f.engines[0].calls.at(-1), 17, 'batching retains exact final native length');
	assert.equal(f.player.getState().positionFrames, samples);
});

test('Stop during a cooperative batch yield cancels the pending seek before commit', async (t) => {
	const entered = deferred(),
		release = deferred(),
		samples = 2048 * 130;
	const f = setup(t, {
		samples,
		nowMs: () => 0,
		yieldTask: async () => {
			entered.resolve();
			await release.promise;
		},
	});
	await f.player.load(Uint8Array.of(1));
	const seeking = f.player.seek(samples / 44100);
	await entered.promise;
	assert.equal(f.engines[0].frame, 2048 * 64);
	f.player.stop();
	release.resolve();
	assert.equal(await seeking, false);
	assert.equal(f.engines[0].disposed, true);
	assert.equal(f.player.getState().playback, 'stopped');
	assert.equal(f.player.getState().positionFrames, 0);
	assert.equal(f.graph.sources().length, 0);
});

test('deadline failure after a batch yield preserves the previous paused or playing run', async (t) => {
	for (const paused of [true, false]) {
		let now = 0;
		const samples = 2048 * 130,
			f = setup(t, {
				samples,
				nowMs: () => now,
				yieldTask: async () => {
					now += 31000;
				},
			});
		await f.player.load(Uint8Array.of(1));
		assert(await f.player.play());
		f.graph.tick(0.025);
		if (paused) assert(f.player.pause());
		const previous = f.player.getState(),
			engine = f.engines[0];
		assert.equal(await f.player.seek(samples / 44100), false);
		const after = f.player.getState();
		assert.equal(after.positionFrames, previous.positionFrames);
		assert.equal(after.paused, paused);
		assert.equal(after.playing, !paused);
		assert.equal(engine.disposed, false);
		assert.equal(f.engines[1].disposed, true);
		assert.match(f.statuses.at(-1), /seek exceeded 30 seconds/);
		assert.equal(f.graph.context.closes, 0);
	}
});
