// SPDX-License-Identifier: BSD-3-Clause
// Actual WASM with an inert graph. No physical audio device is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import factory from '../generated/wonderswan_wasm.js';
import { createAswanSongEngine } from './song_engine.js';
import { createAswanSongPlayer } from './song_player.js';
import { aswanSongLiveView } from './song_live.js';
import { createAswanPausedSongFixture } from '../../test/helpers/aswan_synth_paused_fixture.mjs';
import { createWonderSwanVgm } from '../../test/helpers/wonderswan_vgm_fixture.mjs';
import { fakeAudio, deferred } from '../synth-huc6280/song_test_helpers.mjs';
const wasmBinary = await readFile(new URL('../generated/wonderswan_wasm.wasm', import.meta.url));
const module = await factory({ wasmBinary }),
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
function scheduled(graph, count, channel) {
	const parts = graph
		.sources()
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
	assert.equal(at, count);
	return result;
}
function advanceNative(f, target) {
	let ticks = 0;
	while (f.engines.at(-1).frame < target) {
		assert(ticks++ < 500);
		f.graph.tick(0.005);
	}
}
test('playing sparse edits retain queued PCM/phase, keep run identity and yield to subsequent VGM bytes', async (t) => {
	const bytes = createAswanPausedSongFixture(),
		original = bytes.slice(),
		a = setup(t),
		b = setup(t);
	for (const f of [a, b]) {
		await f.player.load(bytes);
		await f.player.play();
		f.graph.tick(0.02);
	}
	const session = a.player.getEditSession(),
		before = aswanSongLiveView(a.player.getState().liveState, 0).preset,
		next = structuredClone(before);
	next.left = 0;
	const buffers = a.graph.buffers.map((buffer) => buffer.data.map((data) => data.slice())),
		position = a.player.getState().positionFrames;
	const result = a.player.editVoice(0, before, next, { session });
	assert(a.player.getState().playing);
	assert.equal(a.player.getState().positionFrames, position);
	assert.equal(a.player.getEditSession(), session);
	assert.deepEqual(
		a.graph.buffers.map((buffer) => buffer.data),
		buffers,
	);
	a.graph.tick(0.02);
	b.graph.tick(0.02);
	const length = result.nativeFrame + 256,
		actual = scheduled(a.graph, length, 0),
		reference = scheduled(b.graph, length, 0);
	assert.deepEqual(
		actual.subarray(0, result.nativeFrame),
		reference.subarray(0, result.nativeFrame),
	);
	assert(actual.subarray(result.nativeFrame).every((value) => value === 0));
	assert(reference.subarray(result.nativeFrame).some((value) => value !== 0));
	assert.deepEqual(
		scheduled(a.graph, length, 1),
		scheduled(b.graph, length, 1),
		'right phase survives the left-only write',
	);
	for (let i = 0; i < 20; i++) a.graph.tick(0.01);
	assert.equal(a.player.getState().liveState.registers[8], 0xa5);
	assert.equal(a.player.getEditSession(), session);
	assert.deepEqual(bytes, original);
});
test('native playing keys own gate/pitch fields until later driver writes; stale release cannot cut a new owner', async (t) => {
	const bytes = createAswanPausedSongFixture({
			changes: [
				[8000, 0x80, 4],
				[8000, 0x81, 6],
				[12000, 0x90, 1],
			],
		}),
		f = setup(t);
	await f.player.load(bytes);
	await f.player.play();
	f.graph.tick(0.02);
	const { session, epoch } = f.player.getManualState(),
		point = f.player.getState().positionFrames;
	const on = f.player.manualNoteOn('A', 60, 0, { session, epoch });
	assert.equal(on.channel, 0);
	assert.equal(f.player.getState().positionFrames, point);
	assert(
		f.player
			.getManualState()
			.voices.some((voice) => voice.id === 'A' && voice.gateOwned && voice.pitchOwned),
	);
	const raw = on.changes.find((change) => change.channel === 0).periodCode;
	assert.equal(raw, 2048 - Math.round(3072000 / (32 * (440 * 2 ** ((60 - 69) / 12)))));
	const firstRevision = f.player.getState().manualRevision;
	f.player.setManualPitch(2, { session, epoch });
	assert(f.player.getState().manualRevision > firstRevision);
	advanceNative(f, 8100);
	assert.equal(f.player.getManualState().voices[0].pitchOwned, false);
	const gamePitch = f.engines[0].snapshot().registers.slice(0, 2),
		revision = f.player.getState().manualRevision;
	f.player.setManualPitch(3, { session, epoch });
	assert.equal(f.player.getState().manualRevision, revision);
	assert.deepEqual(f.engines[0].snapshot().registers.slice(0, 2), gamePitch);
	advanceNative(f, 12100);
	assert.equal(f.player.manualNoteOff('A', { session, epoch }), false);
	assert(f.engines[0].snapshot().registers[16] & 1);
	f.player.manualNoteOn('B', 64, 0, { session, epoch });
	assert.equal(f.player.manualNoteOff('A', { session, epoch }), false);
	assert.equal(f.player.getManualState().voices[0].id, 'B');
	assert(f.engines[0].snapshot().registers[16] & 1);
	assert(f.player.manualNoteOff('B', { session, epoch }));
	assert.equal(f.engines[0].snapshot().registers[16] & 1, 0);
	assert.equal(f.graph.context.closes, 0);
});
test('Auto update Off retains frozen view/frame while explicit hardware/key fields still commit', async (t) => {
	const f = setup(t);
	await f.player.load(createAswanPausedSongFixture());
	await f.player.play();
	f.player.setLiveEnabled(false);
	const frozen = structuredClone(f.player.getState().liveState);
	f.graph.tick(0.03);
	const before = aswanSongLiveView(frozen, 0).preset,
		next = structuredClone(before);
	next.left = 7;
	f.player.editVoice(0, before, next);
	let view = f.player.getState().liveState;
	assert.equal(f.player.getState().liveEnabled, false);
	assert.equal(view.frame, frozen.frame);
	assert.equal(view.registers[8], 0x7f, 'frozen right15 stays displayed');
	assert.equal(f.engines[0].snapshot().registers[8], 0x73, 'native right3 is preserved');
	assert.deepEqual(view.waveforms, frozen.waveforms);
	assert.deepEqual(view.registers.slice(9), frozen.registers.slice(9));
	f.player.manualNoteOn('Off-view', 60, 0);
	view = f.player.getState().liveState;
	assert.equal(view.frame, frozen.frame);
	assert.equal(view.registers[8], 0x7f);
	assert.notDeepEqual(view.registers.slice(0, 2), frozen.registers.slice(0, 2));
	f.player.manualNoteOff('Off-view');
	assert.equal(f.player.getState().liveState.registers[16] & 1, 0);
	assert.equal(f.player.getState().liveEnabled, false);
	f.player.setLiveEnabled(true);
	assert(f.player.getState().liveState.frame > frozen.frame);
	assert.equal(f.player.getState().liveState.registers[8] & 15, 3);
});
test('Pause and cleanup fence keyboard epochs independently of the stable edit run', async (t) => {
	const f = setup(t);
	await f.player.load(createAswanPausedSongFixture());
	await f.player.play();
	const { session, epoch } = f.player.getManualState();
	f.player.manualNoteOn('A', 60, 0, { session, epoch });
	f.player.setManualPitch(1, { session, epoch });
	f.player.pause();
	const paused = f.player.getManualState();
	assert.equal(paused.session, session);
	assert(paused.epoch > epoch);
	assert.equal(paused.voices.length, 0);
	assert.equal(paused.pitch, 0);
	assert.equal(f.player.manualNoteOff('A', { session, epoch }), false);
	assert(await f.player.resume());
	assert.equal(f.player.getEditSession(), session);
	assert.throws(() => f.player.manualNoteOn('stale', 60, 0, { session, epoch }), {
		name: 'AbortError',
	});
	const current = f.player.getManualState();
	f.player.manualNoteOn('B', 64, 0, current);
	const released = f.player.releaseKeyboard(current);
	assert(released.epoch > current.epoch);
	assert.equal(f.player.getManualState().voices.length, 0);
	assert.equal(f.player.manualNoteOff('B', current), false);
});
test('seek, Stop and EOF retire native keyboard leases without changing original VGM bytes', async (t) => {
	const gate = deferred();
	let delay = false;
	const f = setup(t, {
			beforePlay: async () => {
				if (delay) await gate.promise;
			},
		}),
		bytes = createAswanPausedSongFixture(),
		copy = bytes.slice();
	await f.player.load(bytes);
	await f.player.play();
	const lease = f.player.getManualState();
	f.player.manualNoteOn('A', 60, 0, lease);
	delay = true;
	const seeking = f.player.seek(0.2);
	await Promise.resolve();
	assert.equal(f.player.getEditSession(), null);
	assert.equal(f.player.manualNoteOff('A', lease), false);
	assert.throws(() => f.player.manualNoteOn('late', 60, 0, lease), { name: 'AbortError' });
	f.player.stop();
	gate.resolve();
	assert.equal(await seeking, false);
	assert.equal(f.player.getManualState().voices.length, 0);
	assert.deepEqual(bytes, copy);
	delay = false;
	await f.player.play();
	f.player.manualNoteOn('end', 60, 0);
	for (let i = 0; i < 100 && f.player.getState().playing; i++) f.graph.tick(0.01);
	assert.equal(f.player.getState().playback, 'ended');
	assert.equal(f.player.getManualState().voices.length, 0);
});
test('playing controls support the actual source clock; transient PCM stays explicitly unavailable', async (t) => {
	const bytes = createAswanPausedSongFixture();
	new DataView(bytes.buffer).setUint32(0xc0, 3579545, true);
	const f = setup(t);
	await f.player.load(bytes);
	await f.player.play();
	const view = aswanSongLiveView(f.player.getState().liveState, 0);
	assert(view.canEditPlaying);
	assert(view.canPlayLive);
	assert(!view.canAudition);
	assert(f.player.manualNoteOn('clock', 60, 0));
	const g = setup(t);
	await g.player.load(createWonderSwanVgm({ mode: 'voice', seconds: 0.1, loop: false }));
	await g.player.play();
	const raw = g.engines[0].snapshot(),
		revision = g.player.getState().manualRevision;
	assert.throws(() => g.player.manualNoteOn('pcm', 60, 1), /Transient Voice PCM/);
	assert.deepEqual(g.engines[0].snapshot(), raw);
	assert.equal(g.player.getState().manualRevision, revision);
});
