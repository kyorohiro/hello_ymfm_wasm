// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import factory from '../../docs/generated/scsp_wasm.js';
import { Scsp } from '../../tetorica_src/runtime/scsp.js';
import { ScspSynth } from '../../tetorica_src/runtime/scspsynth.js';

const wasmBinary = await readFile(new URL('../../docs/generated/scsp_wasm.wasm', import.meta.url));
async function create(t, loopLink) {
	const core = await Scsp.create({ moduleFactory: factory, moduleOptions: { wasmBinary } });
	const synth = new ScspSynth(core);
	t.after(() => synth.dispose());
	const pcm = new Int16Array(2048).fill(16384);
	const sample = synth.loadPCM(pcm, { rootNote: 69, loopStartSamples: 512 });
	synth.setPreset(0, {
		sample,
		frequencyHz: 440,
		envelope: {
			attackRate: 31,
			decay1Rate: 20,
			decay2Rate: 0,
			decayLevel: 31,
			releaseRate: 31,
			keyRateScaling: 15,
			...(loopLink === undefined ? {} : { loopLink }),
		},
	});
	core.write(0x408, 0); // Select slot 0's existing latched hardware monitor.
	return { core, synth, pcm, sample };
}
const phase = (core) => (core.read(0x408) >> 5) & 3;
const peak = (pcm) => pcm.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

test('hardware loop link retains full-amplitude Attack until LSA, then starts decay', async (t) => {
	const linked = await create(t, true),
		plain = await create(t, false);
	linked.synth.keyOn(0);
	plain.synth.keyOn(0);
	assert.equal(linked.core.read(10) & 0x4000, 0x4000);
	assert.equal(plain.core.read(10) & 0x4000, 0);
	const held = linked.synth.generateStereo(511).left;
	const decaying = plain.synth.generateStereo(511).left;
	assert.equal(
		phase(linked.core),
		0,
		'LPSLNK keeps native Attack before the loop-start threshold',
	);
	assert.equal(phase(plain.core), 1, 'without link, reaching full amplitude starts Decay 1');
	assert(
		held.subarray(8).every((value) => value > 0.49),
		'Attack stays at full amplitude before LSA',
	);
	assert(peak(decaying.subarray(-32)) < 0.49, 'unlinked envelope is already decaying');
	linked.synth.generateStereo(1);
	assert.equal(phase(linked.core), 1, 'crossing LSA=512 starts native Decay 1');
	const after = linked.synth.generateStereo(2048).left;
	assert(after.every(Number.isFinite));
	assert(peak(after.subarray(-128)) < peak(after.subarray(0, 128)));
});

test('keyOff releases a linked Attack before LSA rather than waiting for the threshold', async (t) => {
	const { core, synth } = await create(t, true);
	synth.keyOn(0);
	synth.generateStereo(64);
	assert.equal(phase(core), 0);
	synth.keyOff(0);
	const released = synth.generateStereo(256).left;
	assert.equal(phase(core), 3);
	assert(released.subarray(-32).every((value) => value === 0));
	assert.equal(synth.getState().slots[0].gate, false);
});

test('legacy omission and explicit false retain identical native PCM and register behavior', async (t) => {
	const legacy = await create(t),
		explicit = await create(t, false);
	assert.equal(legacy.synth.getState().slots[0].envelope.loopLink, false);
	legacy.synth.keyOn(0);
	explicit.synth.keyOn(0);
	assert.equal(legacy.core.read(10), explicit.core.read(10));
	assert.deepEqual(legacy.synth.generateStereo(8192), explicit.synth.generateStereo(8192));
	legacy.synth.keyOff(0);
	explicit.synth.keyOff(0);
	assert.deepEqual(legacy.synth.generateStereo(512), explicit.synth.generateStereo(512));
});

test('strict loopLink validation is atomic; envelope edits remain pending until keyOn', async (t) => {
	const { core, synth } = await create(t, true);
	synth.keyOn(0);
	synth.generateStereo(8);
	synth.setEnvelope(0, { releaseRate: 20 });
	assert.equal(synth.getState().slots[0].envelope.loopLink, true);
	synth.setEnvelope(0, { loopLink: false });
	assert.equal(core.read(10) & 0x4000, 0x4000, 'held hardware retains its latched envelope');
	const before = synth.getState(),
		register = core.read(10);
	for (const loopLink of [null, undefined, 0, 1, 'true', {}, []]) {
		assert.throws(() => synth.setEnvelope(0, { loopLink }), /loopLink must be boolean/);
		assert.throws(
			() => synth.setPreset(0, { frequencyHz: 660, envelope: { loopLink } }),
			/loopLink must be boolean/,
		);
		assert.deepEqual(synth.getState(), before);
		assert.equal(core.read(10), register);
	}
	synth.keyOn(0);
	assert.equal(core.read(10) & 0x4000, 0);
});

test('state, editor and transport copies own loopLink; older snapshots normalize omission to false', async (t) => {
	const source = await create(t, true),
		target = await create(t, false);
	const state = source.synth.getState();
	target.synth._adoptState(state);
	assert.equal(target.synth.getState().slots[0].envelope.loopLink, true);
	state.slots[0].envelope.loopLink = false;
	assert.equal(target.synth.getState().slots[0].envelope.loopLink, true);
	for (const method of ['_adoptState', '_adoptEditorState']) {
		const legacy = source.synth.getState();
		for (const slot of legacy.slots) delete slot.envelope.loopLink;
		if (method === '_adoptState') target.synth[method](legacy);
		else target.synth[method](0, legacy);
		assert.equal(target.synth.getState().slots[0].envelope.loopLink, false);
	}
	target.synth._copyTransportState(source.synth);
	assert.equal(target.synth.getState().slots[0].envelope.loopLink, true);
	target.synth._editPCM(0, source.pcm, { rootNote: 69, loopStartSamples: 512 });
	assert.equal(target.synth.getState().slots[0].envelope.loopLink, true);
	source.synth.reset();
	assert.equal(source.synth.getState().slots[0].envelope.loopLink, false);
	assert.equal(source.core.read(10) & 0x4000, 0, 'reset clears the native high flag bit');
});
