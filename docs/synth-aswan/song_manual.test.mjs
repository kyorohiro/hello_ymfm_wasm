// Actual native output arrays only; no device or AudioContext is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import factory from '../generated/wonderswan_wasm.js';
import { createAswanSongEngine, prepareAswanSongSource } from './song_engine.js';
import { aswanSongLiveView } from './song_live.js';
import { createWonderSwanVgm } from '../../test/helpers/wonderswan_vgm_fixture.mjs';
import { createAswanPausedSongFixture } from '../../test/helpers/aswan_synth_paused_fixture.mjs';
const wasmBinary = await readFile(new URL('../generated/wonderswan_wasm.wasm', import.meta.url)),
	module = await factory({ wasmBinary }),
	moduleFactory = async () => module;
async function make(t, bytes) {
	const source = await prepareAswanSongSource(bytes),
		engine = await createAswanSongEngine(source, { moduleFactory });
	t.after(() => engine.dispose());
	return { engine, source };
}
const code = (snapshot, ch) =>
	snapshot.registers[ch * 2] | ((snapshot.registers[ch * 2 + 1] & 7) << 8);
const expectedCode = (clock, hz) =>
	2048 - Math.max(1, Math.min(2048, Math.round((Math.floor(clock / 128) * 128) / (32 * hz))));
function render(engine, length, sizes = [256]) {
	const left = new Float32Array(length),
		right = left.slice();
	for (let at = 0, i = 0; at < length; i++) {
		const size = Math.min(length - at, sizes[i % sizes.length]),
			pcm = engine.processFrames(size);
		assert.equal(pcm.left.length, size);
		left.set(pcm.left, at);
		right.set(pcm.right, at);
		at += size;
	}
	return { left, right };
}

test('live keyboard changes only selected gate / pitch and preserves the other native channel phase and original source', async (t) => {
	const bytes = createAswanPausedSongFixture({
			changes: [
				[0, 0x88, 0xf0],
				[0, 0x89, 0x0f],
				[0, 0x90, 3],
			],
		}),
		original = bytes.slice(),
		a = (await make(t, bytes)).engine,
		b = (await make(t, bytes)).engine;
	assert.deepEqual(render(a, 512), render(b, 512));
	const before = a.snapshot(),
		result = a.manualNoteOn('human', 81, 0);
	assert.equal(result.nativeFrame, 512);
	assert.equal(a.frame, 512);
	assert.equal(result.channel, 0);
	assert.equal(result.stolenId, null);
	assert.equal(result.manualState.voices[0].pitchOwned, true);
	const after = a.snapshot();
	assert.equal(code(after, 0), expectedCode(a.clock, 880));
	assert.equal(after.registers[16], before.registers[16]);
	assert.deepEqual(after.waveforms, before.waveforms);
	assert.deepEqual(after.registers.slice(2), before.registers.slice(2));
	const changed = render(a, 2048),
		control = render(b, 2048);
	assert.notDeepEqual(changed.left, control.left);
	assert.deepEqual(changed.right, control.right);
	assert(changed.left.every(Number.isFinite));
	assert.deepEqual(bytes, original);
});
test('physical stealing and repeated VGM gate/control On writes make stale key-up harmless', async (t) => {
	const { engine } = await make(t, createAswanPausedSongFixture({ changes: [[1024, 0x90, 1]] }));
	engine.manualNoteOn('old', 60, 0);
	assert.equal(engine.manualNoteOn('new', 72, 0).stolenId, 'old');
	const state = engine.snapshot();
	assert.equal(engine.manualNoteOff('old'), false);
	assert.deepEqual(engine.snapshot(), state);
	render(engine, 1024);
	assert.equal(engine.getManualState().voices.length, 0);
	const ownedByDriver = engine.snapshot();
	assert.equal(engine.manualNoteOff('new'), false);
	assert.deepEqual(engine.snapshot(), ownedByDriver);
	assert.deepEqual(engine.setManualPitch(12).changes, []);
	assert.equal(engine.snapshot().registers[16] & 1, 1);
});
test('recorded frequency takes pitch ownership only; wheel does not fight the driver and owned key-up still gates off', async (t) => {
	const { engine } = await make(
		t,
		createAswanPausedSongFixture({
			changes: [
				[512, 0x80, 77],
				[512, 0x81, 3],
			],
		}),
	);
	engine.manualNoteOn('human', 69, 0);
	render(engine, 600);
	const owner = engine.getManualState().voices[0];
	assert.equal(owner.gateOwned, true);
	assert.equal(owner.pitchOwned, false);
	assert.equal(code(engine.snapshot(), 0), 0x34d);
	assert.deepEqual(engine.setManualPitch(12).changes, []);
	assert.equal(code(engine.snapshot(), 0), 0x34d);
	const off = engine.manualNoteOff('human');
	assert.deepEqual(off.changes, [{ channel: 0, gate: false }]);
	assert.equal(code(engine.snapshot(), 0), 0x34d);
});
test('Wave RAM and volume automation / manual same-source edits preserve gate ownership; source change releases only its owned gate', async (t) => {
	const bytes = createAswanPausedSongFixture({ channel: 3, changes: [[512, 0x8b, 0x73]] }),
		source = await prepareAswanSongSource(bytes),
		base = (0x48 << 6) + 3 * 16;
	source.timeline = {
		...source.timeline,
		events: [...source.timeline.events, [600, 1, base, 0xa5]].sort((a, b) => a[0] - b[0]),
	};
	const engine = await createAswanSongEngine(source, { moduleFactory });
	t.after(() => engine.dispose());
	engine.manualNoteOn('held', 69, 3);
	render(engine, 700);
	assert.equal(engine.getManualState().voices[0].id, 'held');
	assert.equal(engine.getManualState().voices[0].pitchOwned, true);
	let before = aswanSongLiveView(engine.snapshot(), 3).preset,
		next = structuredClone(before);
	next.left = 12;
	next.wave.fill(7);
	engine.editVoice(3, before, next);
	assert.equal(engine.getManualState().voices[0].id, 'held');
	assert(engine.snapshot().registers[16] & 8);
	before = aswanSongLiveView(engine.snapshot(), 3).preset;
	next = structuredClone(before);
	next.source = 'noise';
	next.noise.type = 3;
	const receipt = engine.editVoice(3, before, next);
	assert.equal(receipt.changes.gate, false);
	assert.equal(engine.getManualState().voices.length, 0);
	assert.equal(engine.snapshot().registers[16] & 8, 0);
	assert.equal(engine.manualNoteOff('held'), false);
	const driver = (await make(t, bytes)).engine;
	before = aswanSongLiveView(driver.snapshot(), 3).preset;
	next = structuredClone(before);
	next.source = 'noise';
	driver.editVoice(3, before, next);
	assert(driver.snapshot().registers[16] & 8, 'an editor must not release a driver-owned gate');
});
test('absolute MIDI, optional recorded reference, Noise clock and Sweep work at source clocks without replacing waveform or stereo settings', async (t) => {
	for (const mode of ['wave', 'noise', 'sweep']) {
		const { engine } = await make(
				t,
				createWonderSwanVgm({ mode, clock: 4000000, seconds: 0.2, loop: false }),
			),
			ch = mode === 'noise' ? 3 : mode === 'sweep' ? 2 : 0,
			before = engine.snapshot();
		engine.manualNoteOn('human', 69, ch);
		assert.equal(code(engine.snapshot(), ch), expectedCode(4000000, 440));
		assert.equal(engine.getManualState().voices[0].source, mode === 'noise' ? 'noise' : 'wave');
		engine.setManualPitch(12);
		assert.equal(code(engine.snapshot(), ch), expectedCode(4000000, 880));
		assert.deepEqual(engine.snapshot().waveforms, before.waveforms);
		assert.equal(engine.snapshot().registers[8 + ch], before.registers[8 + ch]);
		assert.equal(engine.snapshot().registers[12], before.registers[12]);
		assert.equal(engine.snapshot().registers[13], before.registers[13]);
		assert.equal(engine.snapshot().registers[14], before.registers[14]);
		assert(render(engine, 1024).left.some((value) => value !== 0));
		engine.releaseKeyboard();
		engine.manualNoteOn('reference', 72, ch, { referenceMidi: 60, frequencyHz: 750 });
		assert.equal(code(engine.snapshot(), ch), expectedCode(4000000, 1500));
	}
});
test('incomplete current native settings and rendered-ahead Voice PCM reject before writes', async (t) => {
	const base = await prepareAswanSongSource(createWonderSwanVgm({ seconds: 0.2, loop: false }));
	for (const omit of [
		(event) => event[1] === 0 && event[2] === 0x90,
		(event) => event[1] === 0 && event[2] === 0x80,
		(event) => event[1] === 0 && event[2] === 0x91,
		(event) => event[1] === 1 && event[2] === 0x1200,
	]) {
		const source = {
				...base,
				timeline: {
					...base.timeline,
					events: base.timeline.events.filter((event) => !omit(event)),
				},
			},
			engine = await createAswanSongEngine(source, { moduleFactory });
		t.after(() => engine.dispose());
		const before = engine.snapshot();
		assert.equal(engine.getManualState().channels[0].playable, false);
		assert.throws(() => engine.manualNoteOn('invalid', 60, 0));
		assert.deepEqual(engine.snapshot(), before);
		assert.equal(engine.getManualState().voices.length, 0);
	}
	const { engine } = await make(
		t,
		createAswanPausedSongFixture({ channel: 1, changes: [[512, 0x90, 0x22]] }),
	);
	assert(engine.getManualState().channels[1].playable);
	render(engine, 600);
	const before = engine.snapshot();
	assert.throws(() => engine.manualNoteOn('PCM', 60, 1), /Voice PCM/);
	assert.deepEqual(engine.snapshot(), before);
});
test('manual note / wheel / release receipts are only real byte changes and cleanup restores no stale driver values', async (t) => {
	const { engine } = await make(t, createAswanPausedSongFixture({ changes: [] }));
	assert.deepEqual(engine.manualNoteOn('same', 57, 0).changes, []);
	assert.deepEqual(engine.setManualPitch(0).changes, []);
	engine.setManualPitch(12);
	const heldCode = code(engine.snapshot(), 0);
	const release = engine.releaseKeyboard();
	assert.deepEqual(release.changes, [{ channel: 0, gate: false }]);
	assert.equal(code(engine.snapshot(), 0), heldCode);
	assert.equal(release.manualState.pitch, 0);
	assert.deepEqual(engine.releaseKeyboard().changes, []);
	const before = engine.snapshot();
	for (const call of [
		() => engine.manualNoteOn('', 60, 0),
		() => engine.manualNoteOn('bad', 128, 0),
		() => engine.manualNoteOn('bad', 60, 4),
		() => engine.manualNoteOn('bad', 60, 0, { pitch: NaN }),
		() => engine.manualNoteOn('bad', 60, 0, { frequencyHz: Infinity }),
		() => engine.setManualPitch(49),
	]) {
		assert.throws(call);
		assert.deepEqual(engine.snapshot(), before);
	}
	engine.reset();
	assert.equal(engine.frame, 0);
	assert.equal(engine.getManualState().voices.length, 0);
	assert.equal(engine.getManualState().pitch, 0);
});
test('native manual interception and later driver takeover are bit exact across render partitions', async (t) => {
	const bytes = createAswanPausedSongFixture({
			changes: [
				[1600, 0x80, 33],
				[1600, 0x81, 4],
				[3000, 0x90, 1],
			],
		}),
		a = (await make(t, bytes)).engine,
		b = (await make(t, bytes)).engine;
	for (const engine of [a, b]) {
		render(engine, 512);
		engine.manualNoteOn('human', 69, 0);
	}
	assert.deepEqual(render(a, 1024, [1024]), render(b, 1024, [1, 7, 113]));
	for (const engine of [a, b]) engine.setManualPitch(2);
	assert.deepEqual(render(a, 2048, [2048]), render(b, 2048, [37, 256, 9]));
	assert.deepEqual(a.snapshot(), b.snapshot());
	assert.deepEqual(a.getManualState(), b.getManualState());
	assert.equal(a.manualNoteOff('human'), false);
});
test('manual pitch preserves unused high-byte bits and releases preserve other gates plus Voice / Sweep / Noise modes', async (t) => {
	const { engine } = await make(
		t,
		createAswanPausedSongFixture({
			changes: [
				[0, 0x81, 0xe3],
				[0, 0x90, 0xe5],
			],
		}),
	);
	engine.manualNoteOn('held', 69, 0);
	assert.equal(engine.snapshot().registers[1] & 0xf8, 0xe0);
	assert.equal(code(engine.snapshot(), 0), expectedCode(engine.clock, 440));
	engine.manualNoteOff('held');
	assert.equal(engine.snapshot().registers[16], 0xe4);
});
