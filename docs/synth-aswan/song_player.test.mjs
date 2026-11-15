// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAswanSongPlayer } from './song_player.js';
import { prepareAswanSongSource } from './song_engine.js';
import { createWonderSwanVgm } from '../../test/helpers/wonderswan_vgm_fixture.mjs';
import { fakeAudio, deferred } from '../synth-huc6280/song_test_helpers.mjs';

const bytes = createWonderSwanVgm({ seconds: 0.2, loop: false });
function setup(t, options = {}) {
	const graph = fakeAudio(),
		engines = [],
		states = [],
		statuses = [];
	let hosts = 0;
	const createEngine = async (source) => {
		let frame = 0;
		const engine = {
			disposed: false,
			mutes: [],
			sampleRate: () => 44100,
			get ended() {
				return frame >= source.totalSamples;
			},
			process(left, right, count) {
				const n = Math.min(count, source.totalSamples - frame);
				for (let i = 0; i < n; i++) {
					left[i] = frame / 44100;
					right[i] = -left[i];
					frame++;
				}
				return n;
			},
			snapshot: () => ({
				frame,
				registers: Array(32).fill(0),
				channels: Array.from({ length: 4 }, (_, channel) => ({ channel })),
				waveforms: Array.from({ length: 4 }, () => Array(32).fill(0)),
			}),
			setChannelMuted(channel, muted) {
				engine.mutes[channel] = muted;
			},
			dispose() {
				engine.disposed = true;
			},
		};
		engines.push(engine);
		return engine;
	};
	const player = createAswanSongPlayer({
		getAudio: async () => {
			hosts++;
			return graph.audio;
		},
		createEngine,
		schedule: graph.schedule,
		cancel: graph.cancel,
		onState: (value) => states.push(value),
		onStatus: (value) => statuses.push(value),
		...options,
	});
	t.after(() => player.dispose());
	return { player, graph, engines, states, statuses, hosts: () => hosts };
}
test('passive load is transactional and never acquires an AudioContext', async (t) => {
	const f = setup(t);
	await f.player.load(bytes, 'Original');
	assert.equal(f.hosts(), 0);
	assert.equal(f.engines.length, 0);
	assert.equal(f.player.getState().durationSeconds, 0.2);
	assert.equal(f.player.getState().name, 'Original');
	await f.player.play();
	const active = f.engines[0];
	await assert.rejects(f.player.load(Uint8Array.of(0, 1, 2), 'Broken'));
	assert.equal(f.player.getState().name, 'Original');
	assert.equal(f.player.getState().playing, true);
	assert.equal(active.disposed, false);
});
test('Pause freezes Live and all scheduled nodes, Resume keeps exact unconsumed PCM and one host context', async (t) => {
	const f = setup(t);
	await f.player.load(bytes);
	assert(await f.player.play());
	f.graph.tick(0.02);
	const first = f.player.getState();
	assert(first.positionFrames > 0);
	assert(first.liveState.frame <= first.positionFrames);
	assert(f.player.pause());
	const frozen = f.player.getState();
	assert.equal(frozen.paused, true);
	assert(
		f.graph
			.sources()
			.filter(
				(node) =>
					node.at + node.buffer.duration - node.offset > f.graph.context.currentTime,
			)
			.every((node) => node.stopped),
	);
	f.graph.tick(0.1);
	assert.equal(f.player.getState().positionFrames, frozen.positionFrames);
	assert.deepEqual(f.player.getState().liveState, frozen.liveState);
	const count = f.graph.sources().length;
	assert(await f.player.resume());
	const resumed = f.graph
			.sources()
			.slice(count)
			.filter((node) => !node.stopped),
		firstNode = resumed[0];
	assert(firstNode);
	const at = Math.round(firstNode.offset * 44100);
	assert.equal(firstNode.buffer.data[0][at], Math.fround(frozen.positionFrames / 44100));
	assert.equal(f.engines.length, 1);
	assert.equal(f.hosts(), 2);
	assert.equal(f.graph.context.closes, 0);
	f.graph.tick(0.03);
	assert(f.player.getState().positionFrames > frozen.positionFrames);
	f.player.stop();
	assert.equal(f.player.getState().positionFrames, 0);
	assert(f.engines[0].disposed);
	assert.equal(f.graph.timers.size, 0);
});
test('mute and gain remain separate from native pitch/phase and the shared Master', async (t) => {
	const f = setup(t);
	await f.player.load(bytes);
	f.player.setChannelEnabled(2, false);
	f.player.setVolume(0.7);
	await f.player.play();
	assert.deepEqual(f.engines[0].mutes, [false, false, true, false]);
	assert.equal(f.graph.audio.songInputNode.gain.value, 1);
	assert.equal(f.graph.audio.master.gain.value, 0.7);
	f.player.setVolume(1.4);
	assert.equal(f.graph.audio.master.gain.value, 0.7);
	assert.equal(f.player.getState().volume, 1.4);
	f.player.setChannelEnabled(2, true);
	assert.equal(f.engines[0].mutes[2], false);
	assert.throws(() => f.player.setChannelEnabled(4, true));
	assert.throws(() => f.player.setVolume(Infinity));
});
test('seek silently rebuilds native time without resetting the audible position on failure', async (t) => {
	let fail = false;
	const f = setup(t, {
		beforePlay: async () => {
			if (fail) throw Error('output unavailable');
		},
	});
	await f.player.load(bytes);
	await f.player.play();
	f.graph.tick(0.03);
	f.player.pause();
	assert(await f.player.seek(0.1));
	assert.equal(f.player.getState().positionFrames, 4410);
	assert.equal(f.player.getState().paused, true);
	assert.equal(f.player.getState().liveState.frame, 4410);
	assert.equal(f.engines[0].disposed, true);
	fail = true;
	assert.equal(await f.player.seek(0.15), false);
	assert.equal(f.player.getState().positionFrames, 4410);
	assert.equal(f.engines[1].disposed, false);
	assert.match(f.statuses.at(-1), /output unavailable/);
	assert.equal(f.graph.context.closes, 0);
});
test('Stop and latest-load fencing reject stale prepared sources', async (t) => {
	const first = deferred(),
		second = deferred();
	let calls = 0;
	const f = setup(t, {
		prepareSource: async (input, options) => {
			const parsed = await prepareAswanSongSource(input, options);
			await (++calls === 1 ? first.promise : second.promise);
			return parsed;
		},
	});
	const a = f.player.load(bytes, 'A');
	const rejectedA = assert.rejects(a, { name: 'AbortError' });
	await new Promise((resolve) => setImmediate(resolve));
	const b = f.player.load(bytes, 'B');
	await new Promise((resolve) => setImmediate(resolve));
	second.resolve();
	await b;
	first.resolve();
	await rejectedA;
	assert.equal(f.player.getState().name, 'B');
	assert.equal(f.hosts(), 0);
	const gate = deferred();
	const g = setup(t, {
		prepareSource: async (input) => {
			const parsed = await prepareAswanSongSource(input);
			await gate.promise;
			return parsed;
		},
	});
	const pending = g.player.load(bytes, 'Late'),
		rejected = assert.rejects(pending, { name: 'AbortError' });
	await new Promise((resolve) => setImmediate(resolve));
	g.player.stop();
	gate.resolve();
	await rejected;
	assert.equal(g.player.getState().loaded, false);
	assert.equal(g.hosts(), 0);
});
test('borrowed audio requires the calibrated song input and never closes the host context', async (t) => {
	const f = setup(t, {
		getAudio: async () => ({ context: f.graph.context, outputNode: f.graph.audio.master }),
	});
	await f.player.load(bytes);
	assert.equal(await f.player.play(), false);
	assert.match(f.player.getState().errorMessage, /songInputNode/);
	f.player.dispose();
	assert.equal(f.graph.context.closes, 0);
});
