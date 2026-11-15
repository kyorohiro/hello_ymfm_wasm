// SPDX-License-Identifier: BSD-3-Clause
// Real WASM into an inert Web Audio graph; never opens a physical device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import factory from '../generated/wonderswan_wasm.js';
import { createAswanSongEngine } from './song_engine.js';
import { createAswanSongPlayer } from './song_player.js';
import { aswanSongLiveView } from './song_live.js';
import { createAswanPausedSongFixture } from '../../test/helpers/aswan_synth_paused_fixture.mjs';
import { fakeAudio, deferred } from '../synth-huc6280/song_test_helpers.mjs';
const binary = await readFile(new URL('../generated/wonderswan_wasm.wasm', import.meta.url));
const module = await factory({ wasmBinary: binary }),
	moduleFactory = async () => module;
function setup(t, options = {}) {
	const graph = fakeAudio(),
		engines = [];
	const player = createAswanSongPlayer({
		getAudio: async () => graph.audio,
		createEngine: async (source) => {
			const engine = await createAswanSongEngine(source, { moduleFactory });
			engines.push(engine);
			return engine;
		},
		schedule: graph.schedule,
		cancel: graph.cancel,
		nowMs: () => 0,
		...options,
	});
	t.after(() => player.dispose());
	return { player, graph, engines };
}
function scheduled(graph, start, count, channel) {
	const parts = graph
		.sources()
		.slice(start)
		.filter((node) => !node.stopped)
		.sort((a, b) => a.at - b.at)
		.map((node) => node.buffer.data[channel].subarray(Math.round(node.offset * 44100)));
	const result = new Float32Array(count);
	let at = 0;
	for (const part of parts) {
		const n = Math.min(part.length, count - at);
		result.set(part.subarray(0, n), at);
		at += n;
		if (at === count) break;
	}
	assert.equal(at, count, 'enough queued audio exists');
	return result;
}
test('paused edits preserve exact queued PCM, frozen frame, phase and source, then appear after the native-ahead boundary', async (t) => {
	const bytes = createAswanPausedSongFixture(),
		original = bytes.slice(),
		a = setup(t),
		b = setup(t);
	for (const f of [a, b]) {
		await f.player.load(bytes, 'Original');
		assert(await f.player.play());
		f.graph.tick(0.02);
		assert(f.player.pause());
	}
	const before = a.player.getState(),
		session = a.player.getEditSession(),
		leftBefore = aswanSongLiveView(before.liveState, 0).preset,
		next = structuredClone(leftBefore);
	next.left = 0;
	const buffers = a.graph.buffers.map((buffer) => buffer.data.map((data) => data.slice()));
	const result = a.player.editVoice(0, leftBefore, next, { session });
	assert.equal(result.session, session);
	assert.equal(result.manualRevision, 1);
	assert(result.nativeFrame > before.positionFrames);
	const after = a.player.getState();
	assert.equal(after.positionFrames, before.positionFrames);
	assert.equal(after.liveState.frame, before.liveState.frame);
	assert.equal(after.liveState.registers[8] & 0xf0, 0);
	assert.equal(before.liveState.registers[8] >> 4, 15);
	assert.deepEqual(bytes, original);
	assert.deepEqual(
		a.graph.buffers.map((buffer) => buffer.data),
		buffers,
		'rendered buffers are byte-exact after editing',
	);
	const oldFrames = result.nativeFrame - before.positionFrames,
		indices = [a.graph.sources().length, b.graph.sources().length];
	assert(await a.player.resume());
	assert(await b.player.resume());
	assert.equal(a.player.getEditSession(), session);
	a.graph.tick(0.02);
	b.graph.tick(0.02);
	const leftA = scheduled(a.graph, indices[0], oldFrames + 256, 0),
		leftB = scheduled(b.graph, indices[1], oldFrames + 256, 0),
		rightA = scheduled(a.graph, indices[0], oldFrames + 256, 1),
		rightB = scheduled(b.graph, indices[1], oldFrames + 256, 1);
	assert.deepEqual(
		leftA.subarray(0, oldFrames),
		leftB.subarray(0, oldFrames),
		'Resume first consumes the unchanged audio queued before Pause',
	);
	assert(
		leftA.subarray(oldFrames).every((value) => value === 0),
		'left0 reaches actual native output after the already-rendered prefix',
	);
	assert(leftB.subarray(oldFrames).some((value) => value !== 0));
	assert.deepEqual(
		rightA,
		rightB,
		'unmodified right output retains sample phase across the edit and Resume',
	);
	for (let i = 0; i < 20; i++) {
		a.graph.tick(0.01);
		b.graph.tick(0.01);
	}
	assert.equal(
		a.player.getState().liveState.registers[8],
		0xa5,
		'later recorded hardware write replaces manual settings',
	);
	assert.equal(a.player.getState().liveState.channels[0].manualEdited, undefined);
});
test('per-channel sparse overlays survive selection-style reads and failed seek, but never leak into a new run', async (t) => {
	let fail = false;
	const f = setup(t, {
			beforePlay: async () => {
				if (fail) throw Error('Temporary output failure');
			},
		}),
		bytes = createAswanPausedSongFixture();
	await f.player.load(bytes);
	await f.player.play();
	f.graph.tick(0.02);
	f.player.pause();
	const session = f.player.getEditSession();
	for (const [channel, left] of [
		[0, 4],
		[1, 7],
	]) {
		const before = aswanSongLiveView(f.player.getState().liveState, channel).preset,
			next = structuredClone(before);
		next.left = left;
		f.player.editVoice(channel, before, next, { session });
	}
	assert.equal(f.player.getState().manualRevision, 2);
	assert.equal(aswanSongLiveView(f.player.getState().liveState, 0).preset.left, 4);
	assert.equal(aswanSongLiveView(f.player.getState().liveState, 1).preset.left, 7);
	const frozen = f.player.getState(),
		oldNative = f.engines[0].snapshot();
	fail = true;
	assert.equal(await f.player.seek(0.2), false);
	assert.equal(f.player.getEditSession(), session);
	assert.deepEqual(f.player.getState().liveState, frozen.liveState);
	assert.deepEqual(f.engines[0].snapshot(), oldNative);
	fail = false;
	assert(await f.player.seek(0.1));
	assert.notEqual(f.player.getEditSession(), session);
	assert.equal(f.player.getState().manualRevision, 0);
	assert.equal(f.player.getState().liveState.registers[8], 0xf3);
	const before = aswanSongLiveView(f.player.getState().liveState, 0).preset,
		next = structuredClone(before);
	next.left = 1;
	const state = f.engines.at(-1).snapshot();
	assert.throws(() => f.player.editVoice(0, before, next, { session }), { name: 'AbortError' });
	assert.deepEqual(f.engines.at(-1).snapshot(), state);
	f.player.stop();
	assert.equal(f.player.getEditSession(), null);
	assert(await f.player.play());
	assert.notEqual(f.player.getEditSession(), session);
	assert.throws(() => f.player.editVoice(0, before, next, { session }), { name: 'AbortError' });
});
test('software Envelope remains preview-only and stale edits cannot enter a pending seek or stopped run', async (t) => {
	const gate = deferred();
	let delay = false;
	const f = setup(t, {
			beforePlay: async () => {
				if (delay) await gate.promise;
			},
		}),
		bytes = createAswanPausedSongFixture();
	await f.player.load(bytes);
	await f.player.play();
	f.graph.tick(0.02);
	f.player.pause();
	const session = f.player.getEditSession(),
		before = aswanSongLiveView(f.player.getState().liveState, 0).preset,
		next = structuredClone(before);
	next.envelope = { enabled: true, attack: 0.3, decay: 0.2, sustain: 0.5, release: 0.4 };
	const raw = f.engines[0].snapshot();
	const result = f.player.editVoice(0, before, next, { session });
	assert.equal(result.manualRevision, 0);
	assert.deepEqual(f.engines[0].snapshot(), raw);
	delay = true;
	const seek = f.player.seek(0.2);
	await Promise.resolve();
	assert.equal(f.player.getEditSession(), null);
	const hardware = structuredClone(before);
	hardware.right = 1;
	assert.throws(() => f.player.editVoice(0, before, hardware, { session }), {
		name: 'AbortError',
	});
	f.player.stop();
	gate.resolve();
	assert.equal(await seek, false);
	assert.equal(f.player.getEditSession(), null);
	assert.equal(f.player.getState().playback, 'stopped');
});
