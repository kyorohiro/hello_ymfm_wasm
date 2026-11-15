// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import { Scsp } from '../js/scsp.js';
import { SynthInstrument } from './instrument.js';
import { readPatch } from './patch.js';

const wasmBinary = await readFile(new URL('../generated/scsp_wasm.wasm', import.meta.url));
async function create(t) {
	const core = await Scsp.create({ moduleFactory: factory, moduleOptions: { wasmBinary } });
	const instrument = new SynthInstrument(core);
	t.after(() => instrument.dispose());
	return instrument;
}
const peak = (pcm) => pcm.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);

test('physical inspection is passive and only actual empty-slot noteOn copies source A', async (t) => {
	const i = await create(t),
		before = i.read(),
		ram = i.core.readRam(0, 524288);
	for (let slot = 0; slot < 32; slot++) {
		const selected = i.readPhysical(slot);
		assert.equal(selected.slot, slot);
		if (slot < 6) assert.equal(selected.pcm.length, 64);
		else {
			assert.equal(selected.pcm, null);
			assert.equal(selected.sample, null);
		}
	}
	assert.deepEqual(i.invokePhysical('getPCM', [31]), i.readPhysical(31));
	assert.deepEqual(i.read(), before);
	assert.deepEqual(i.core.readRam(0, 524288), ram);
	const result = i.physicalNoteOn('direct', 31, 69),
		after = i.read();
	assert.equal(result.initializedFromSource, 0);
	assert.deepEqual(result.slots, [31]);
	assert.equal(after.slots[31].sample.id, before.slots[0].sample.id);
	assert.equal(
		after.ramUsedBytes,
		before.ramUsedBytes,
		'copying a source reference needs no new PCM allocation',
	);
	assert.equal(after.slots[31].gate, true);
	assert.equal(after.voiceGroups.length, 0);
	assert(peak(i.synth.generateStereo(1024).left) > 0.01);
	assert(i.physicalNoteOff('direct'));
	assert.equal(i.read().manualVoices[0].held, false);
});

test('raw mix / LFO / modulation edits target one physical slot without A–F or grouped fanout', async (t) => {
	const i = await create(t);
	i.setConfig({ mode: 'fm2' });
	i.noteOn('auto', 69);
	const before = i.read();
	i.invokePhysical('setMix', [6, { directLevel: 7, totalLevel: 66, pan: 15 }]);
	i.invokePhysical('setLfo', [6, { frequencyCode: 17, pitchDepth: 3 }]);
	i.invokePhysical('setModulation', [
		6,
		{ depth: 5, xOffset: 1, yOffset: 3, writeInhibit: true },
	]);
	const after = i.read();
	for (const slot of [0, 1, 7]) assert.deepEqual(after.slots[slot], before.slots[slot]);
	assert.equal(after.slots[6].directLevel, 7);
	assert.equal(after.slots[6].totalLevel, 66);
	assert.equal(after.slots[6].lfo.frequencyCode, 17);
	assert.equal(after.slots[6].modulation.depth, 5);
	assert.equal(after.slots[6].modulation.writeInhibit, true);
	assert.equal(i.core.read(6 * 32 + 14), (5 << 12) | (1 << 6) | 3);
	assert.equal(i.readPhysical(6).voice.modulation.depth, 5);
	assert(i.noteOff('auto'));
	assert.equal(i.read().slots[7].gate, false);
});

test('physical PCM edits retain the held sample and use the replacement only on the next direct key', async (t) => {
	const i = await create(t);
	i.physicalNoteOn('old', 30, 69);
	const before = i.read(),
		old = before.playingSampleIds[30],
		nativeStart = i.core.read(30 * 32 + 2);
	const pcm = Int8Array.from({ length: 128 }, (_, n) => (n < 64 ? 32 : -32));
	const replacement = i.invokePhysical('applyPCM', [
		30,
		pcm,
		{ rootNote: 69, loopStartSamples: 0 },
	]);
	assert.notEqual(replacement.id, old);
	assert.equal(i.read().playingSampleIds[30], old);
	assert.equal(i.core.read(30 * 32 + 2), nativeStart);
	assert.equal(i.readPhysical(30).pcm.length, 128);
	const result = i.physicalNoteOn('new', 30, 72);
	assert.deepEqual(result.stolenManualIds, ['old']);
	assert.equal(result.initializedFromSource, null);
	assert.equal(i.physicalNoteOff('old'), false);
	assert(i.read().slots[30].gate);
	assert.equal(i.read().playingSampleIds[30], replacement.id);
	assert(peak(i.synth.generateStereo(1024).left) > 0.01);
});

test('Auto may immediately reuse a manual physical slot and stale direct keyOff cannot release it', async (t) => {
	const i = await create(t);
	i.physicalNoteOn('direct', 6, 60);
	const result = i.noteOn('auto', 69);
	assert.deepEqual(result.slots, [6]);
	assert.deepEqual(i.read().manualVoices, []);
	assert.equal(i.physicalNoteOff('direct'), false);
	assert(i.read().slots[6].gate);
	assert.equal(i.read().slots[6].frequencyHz, 440);
});

test('a direct replacement retires the touched Code group and its stale noteOff / Stop cannot erase the replacement', async (t) => {
	const i = await create(t);
	i.setConfig({ mode: 'fm4' });
	const session = i.beginCode().session;
	i.code(session, 'noteOn', [0, 69]);
	const old = i.read(),
		target = 9,
		voice = old.slots[target];
	const result = i.physicalNoteOn('direct', target, 72),
		after = i.read();
	assert.deepEqual(result.retiredGroupIds, [`code:${session}:0`]);
	assert.equal(after.voiceGroups.length, 0);
	assert.equal(after.codeLanes[0].groupId, null);
	assert.equal(after.slots[target].sample.id, voice.sample.id);
	assert.equal(after.slots[target].totalLevel, voice.totalLevel);
	assert.equal(after.slots[target].modulation.depth, voice.modulation.depth);
	for (const slot of [6, 7, 8]) {
		assert.equal(after.slots[slot].gate, false);
		assert.equal(after.slots[slot].directLevel, 0);
		assert.equal(after.slots[slot].totalLevel, 255);
	}
	assert.equal(i.code(session, 'noteOff', [0]), false);
	assert(i.endCode(session));
	assert(i.read().slots[target].gate);
	assert.equal(i.noteOff(`code:${session}:0`), false);
});

test('inactive Code pitch staging preserves a direct replacement until its next real Auto attack', async (t) => {
	const i = await create(t);
	i.setConfig({ mode: 'fm4' });
	const session = i.beginCode().session;
	i.code(session, 'noteOn', [0, 69]);
	i.physicalNoteOn('direct', 9, 72);
	const manual = i.readPhysical(9);
	i.code(session, 'setNote', [0, 60]);
	assert.deepEqual(i.readPhysical(9), manual);
	assert.equal(i.read().manualVoices[0].id, 'direct');
	i.code(session, 'keyOn', [0]);
	assert.deepEqual(i.read().voiceGroups[0].slots, [6, 7, 8, 9]);
	assert.deepEqual(i.read().manualVoices, []);
	assert.equal(i.physicalNoteOff('direct'), false);
	assert(i.read().slots[9].gate);
	assert.equal(i.read().slots[9].frequencyHz, 440 * 2 ** ((60 - 69) / 12));
});

test('physical release and Code Stop preserve unrelated owners and shared Delay routes', async (t) => {
	const i = await create(t);
	i.setEffect({ enabled: true });
	const session = i.beginCode().session;
	i.code(session, 'noteOn', [0, 69]);
	i.physicalNoteOn('direct', 31, 60);
	assert.equal(i.core.read(6 * 32 + 20) & 7, 7);
	assert.equal(i.core.read(31 * 32 + 20) & 7, 7);
	i.invokePhysical('setMix', [31, { directLevel: 0 }]);
	assert.equal(
		i.core.read(31 * 32 + 20) & 7,
		0,
		'a silent physical modulator has no automatic effect send',
	);
	assert.equal(i.core.read(6 * 32 + 20) & 7, 7);
	i.invokePhysical('setMix', [31, { directLevel: 7 }]);
	i.stopPhysicalVoices();
	assert.equal(i.read().slots[31].gate, false);
	assert.equal(i.read().slots[6].gate, true);
	i.physicalNoteOn('another', 30, 64);
	i.endCode(session);
	assert.equal(i.read().slots[30].gate, true);
	assert.equal(i.read().slots[6].gate, false);
	i.stopVoices();
	assert.deepEqual(i.read().manualVoices, []);
	assert(i.synth.generateStereo(128).left.every((value) => value === 0));
});

test('physical source edits retain Auto preset/export invariants without fanout', async (t) => {
	const i = await create(t);
	i.setConfig({ mode: 'fm2' });
	i.noteOn('auto', 69);
	const before = i.read();
	for (const change of [
		() => i.invokePhysical('setPreset', [0, { sample: null }]),
		() => i.invokePhysical('applyPCM', [0, new Int16Array(64), { rootNote: 69 }]),
	]) {
		assert.throws(change);
		assert.deepEqual(i.read(), before);
	}
	i.invokePhysical('setEnvelope', [0, { loopLink: true, releaseRate: 20 }]);
	i.invokePhysical('setMix', [0, { totalLevel: 30 }]);
	assert.equal(i.read().slots[7].totalLevel, before.slots[7].totalLevel);
	assert.equal(i.read().slots[7].envelope.loopLink, before.slots[7].envelope.loopLink);
	assert.equal(readPatch(i.exportPatch()).operators.carrier.voice.envelope.loopLink, true);
});

test('physical CH1 can be a silent hardware modulator for CH2 while Auto saves only its declared graph', async (t) => {
	const modulated = await create(t),
		dry = await create(t);
	for (const i of [modulated, dry]) {
		i.invokePhysical('setMix', [0, { directLevel: 0, totalLevel: 0 }]);
		i.invokePhysical('setMix', [1, { directLevel: 7, totalLevel: 12 }]);
		i.invokePhysical('setModulation', [
			1,
			{ depth: i === modulated ? 9 : 0, xOffset: 63, yOffset: 63 },
		]);
		i.physicalNoteOn('source', 0, 81);
		i.physicalNoteOn('carrier', 1, 69);
	}
	assert.equal(modulated.read().slots[0].directLevel, 0);
	assert.equal(modulated.read().slots[1].modulation.depth, 9);
	const output = modulated.synth.generateStereo(4096),
		plain = dry.synth.generateStereo(4096);
	assert(output.left.every(Number.isFinite));
	assert(peak(output.left) > 0.001);
	assert.notDeepEqual(output, plain);
	modulated.invokePhysical('setModulation', [0, { writeInhibit: true }]);
	assert.equal(modulated.read().slots[0].modulation.writeInhibit, true);
	const portable = readPatch(modulated.exportPatch());
	assert.equal(portable.mode, 'pcm');
	assert.equal(portable.operators.modulator.voice.modulation.depth, 0);
});

test('physical source PCM preserves requested MDL15 padding while Auto source edits retain their existing policy', async (t) => {
	const i = await create(t);
	i.setConfig({ mode: 'fm2' });
	const pcm = Int16Array.from({ length: 64 }, (_, index) =>
		Math.round(8192 * Math.sin((index * Math.PI) / 32)),
	);
	const options = { baseFrequencyHz: 44100 / 64, loopStartSamples: 0, modulationDepth: 15 };
	for (const slot of [0, 1]) {
		const sample = i.invokePhysical('applyPCM', [slot, pcm, options]);
		assert.equal(
			sample.modulationDepth,
			15,
			`physical source ${slot} keeps the requested guard range`,
		);
		assert.equal(sample.address - sample.allocationAddress, 2 ** 14 * 2);
		assert.deepEqual(i.readPhysical(slot).pcm, pcm);
	}
	i.invokePhysical('setMix', [0, { directLevel: 0, totalLevel: 0 }]);
	i.invokePhysical('setMix', [1, { directLevel: 7, totalLevel: 12 }]);
	i.invokePhysical('setModulation', [1, { depth: 15, xOffset: 63, yOffset: 63 }]);
	i.physicalNoteOn('source', 0, 81);
	i.physicalNoteOn('carrier', 1, 69);
	assert.equal(i.core.read(32 + 14), (15 << 12) | (63 << 6) | 63);
	const output = i.synth.generateStereo(4096);
	assert(output.left.every(Number.isFinite));
	assert(peak(output.left) > 0.001);
	// The Auto graph still validates and computes its own bounded FM routing.
	i.noteOn('auto', 69);
	assert.deepEqual(i.read().voiceGroups[0].slots, [6, 7]);
	assert.equal(i.read().slots[7].modulation.depth, 9);
	assert.equal(i.read().slots[1].modulation.depth, 15);
	assert.equal(readPatch(i.exportPatch()).mode, 'fm2');
	const legacy = i.invoke('applyPCM', [2, pcm, options]);
	assert.equal(legacy.modulationDepth, 12, 'the A–F editing API keeps its existing Auto policy');
	const before = i.read(),
		ram = i.core.readRam(0, 524288);
	for (const change of [
		{ ...options, modulationDepth: 16 },
		{ ...options, modulationDepth: false },
		{ ...options, modulationDepth: NaN },
		{ ...options, loopStartSamples: 1 },
		{ rootNote: 69, modulationDepth: 15 },
	]) {
		assert.throws(() => i.invokePhysical('applyPCM', [0, pcm, change]));
		assert.deepEqual(i.read(), before);
		assert.deepEqual(i.core.readRam(0, 524288), ram);
	}
});

test('idle migration retains all 32 requested physical slots, full PCM and aliases without new allocations or autoplay', async (t) => {
	const source = await create(t),
		target = await create(t);
	source.setEffect({ enabled: true, timeMs: 80, feedback: 0.2 });
	source.setPitchBend(1);
	const pcm = Int8Array.from({ length: 128 }, (_, n) => (n < 64 ? 48 : -48));
	const sample = source.invokePhysical('applyPCM', [
		31,
		pcm,
		{ rootNote: 69, loopStartSamples: 0, modulationDepth: 6 },
	]);
	source.invokePhysical('setPreset', [30, { sample }]);
	source.invokePhysical('setMix', [31, { totalLevel: 37, directLevel: 6, pan: 8 }]);
	source.invokePhysical('setEnvelope', [31, { loopLink: true, releaseRate: 21 }]);
	source.invokePhysical('setLfo', [31, { frequencyCode: 17, pitchDepth: 2 }]);
	source.invokePhysical('setModulation', [
		31,
		{ depth: 5, xOffset: 1, yOffset: 3, writeInhibit: true },
	]);
	source.invokePhysical('setModulation', [1, { depth: 7, xOffset: 63, yOffset: 63 }]);
	const snapshot = source.exportIdleState(),
		owned = structuredClone(snapshot);
	assert(target.loadIdleState(snapshot));
	assert.deepEqual(target.exportIdleState(), snapshot);
	assert.deepEqual(target.readPhysical(31).pcm, pcm);
	const state = target.read();
	assert.equal(state.slots[30].sample, state.slots[31].sample);
	assert.equal(state.ramUsedBytes, snapshot.synthState.ramUsedBytes);
	assert.equal(state.samples.length, source.read().samples.length);
	assert.equal(state.pitchBend, 0);
	assert.deepEqual(state.slots[31], source.read().slots[31]);
	assert.equal(state.slots[1].modulation.depth, 7);
	assert.deepEqual(state.manualVoices, []);
	assert.deepEqual(state.voiceGroups, []);
	assert(state.slots.every((voice) => voice.gate === false));
	assert(target.synth.generateStereo(1024).left.every((value) => value === 0));
	snapshot.ram.fill(255);
	snapshot.synthState.slots[31].envelope.releaseRate = 0;
	assert.deepEqual(target.readPhysical(31).pcm, pcm);
	assert.equal(target.read().slots[31].envelope.releaseRate, 21);
	assert.deepEqual(source.exportIdleState(), owned);
	// The preserved linked full-loop starts Decay at address0. Use a normal
	// Attack for this independent audible-PCM check after confirming that flag.
	target.invokePhysical('setEnvelope', [31, { loopLink: false }]);
	target.physicalNoteOn('migrated', 31, 69);
	assert.equal(target.read().playingSampleIds[31], sample.id);
	const audition = target.synth.generateStereo(1024);
	assert(Math.max(peak(audition.left), peak(audition.right)) > 0.001);
});

test('idle export rejects owned or previously playing state until an explicit Stop', async (t) => {
	for (const kind of ['manual', 'auto', 'code']) {
		const i = await create(t);
		if (kind === 'manual') i.physicalNoteOn('held', 31, 69);
		if (kind === 'auto') i.noteOn('held', 69);
		if (kind === 'code') i.beginCode();
		assert.throws(() => i.exportIdleState(), /Idle migration/);
		if (kind === 'code') i.endCode(i.codeSession);
		i.stopVoices();
		assert.equal(i.exportIdleState().format, 'tetorica-scsp-idle-state');
	}
});

test('malformed idle state fails before changing target RAM, gates, ownership or configuration', async (t) => {
	const source = await create(t),
		target = await create(t);
	const sample = source.invokePhysical('applyPCM', [
		31,
		new Int16Array(128).fill(4000),
		{ rootNote: 69, loopStartSamples: 0 },
	]);
	const valid = source.exportIdleState();
	target.physicalNoteOn('keep', 30, 69);
	const state = target.read(),
		ram = target.core.readRam(0, 524288),
		register = target.core.read(30 * 32);
	const changes = [
		(value) => (value.version = 2),
		(value) => (value.ram = new Uint8Array(1)),
		(value) => (value.synthState.slots[31].gate = true),
		(value) => (value.synthState.playingSampleIds[31] = sample.id),
		(value) => (value.synthState.nextSampleId = sample.id),
		(value) => value.synthState.samples.push({ ...value.synthState.samples[0] }),
		(value) => (value.synthState.samples.at(-1).address = 524288),
		(value) => (value.synthState.samples.at(-1).address = 0),
		(value) => value.synthState.samples.at(-1).byteLength++,
		(value) =>
			(value.synthState.slots[31].sample = {
				...value.synthState.slots[31].sample,
				address: 0,
			}),
		(value) => (value.synthState.slots[31].lfo.pitchDepth = 8),
		(value) => (value.synthState.slots[31].envelope.loopLink = 1),
		(value) => (value.synthState.slots[0].sample = null),
		(value) => (value.reserved = value.synthState.slots[31].sample),
		(value) => (value.config.fm.depth = 16),
		(value) => (value.manualVoices = [{ id: 'unexpected', slot: 31 }]),
	];
	for (const change of changes) {
		const invalid = structuredClone(valid);
		change(invalid);
		assert.throws(() => target.loadIdleState(invalid));
		assert.deepEqual(target.read(), state);
		assert.deepEqual(target.core.readRam(0, 524288), ram);
		assert.equal(target.core.read(30 * 32), register);
	}
});

test('migrated editor reservations stay allocated until reset and new edits use fresh pages', async (t) => {
	const source = await create(t),
		target = await create(t);
	const options = { rootNote: 69, loopStartSamples: 0 },
		pcm = new Int16Array(64).fill(4000);
	const original = source.invokePhysical('applyPCM', [31, pcm, options]);
	const snapshot = source.exportIdleState();
	target.loadIdleState(snapshot);
	const migrated = target.readPhysical(31).sample,
		used = target.read().ramUsedBytes;
	const next = target.invokePhysical('applyPCM', [31, pcm.map((value) => -value), options]);
	assert.equal(migrated.id, original.id);
	assert(next.address >= used);
	assert(target.read().samples.some((sample) => sample.id === migrated.id));
	assert.equal(target.read().ramUsedBytes, used + 256);
});

test('global Stop retains physical PCM and requested settings, clears leases and retriggers that same instrument', async (t) => {
	const i = await create(t);
	const pcm = Int8Array.from({ length: 128 }, (_, index) => (index < 64 ? 48 : -48));
	const sample = i.invokePhysical('applyPCM', [
		31,
		pcm,
		{
			rootNote: 69,
			loopStartSamples: 0,
			modulationDepth: 6,
		},
	]);
	i.invokePhysical('setMix', [31, { totalLevel: 17, directLevel: 6, pan: 2 }]);
	i.invokePhysical('setEnvelope', [31, { releaseRate: 0 }]);
	i.invokePhysical('setLfo', [31, { frequencyCode: 17, amplitudeDepth: 2 }]);
	i.invokePhysical('setModulation', [31, { depth: 5, xOffset: 1, yOffset: 3 }]);
	i.physicalNoteOn('before', 31, 69);
	const physical = i.readPhysical(31);
	i.noteOn('auto', 69);
	const autoSlot = i.read().voiceGroups[0].slots[0];
	assert(peak(i.synth.generateStereo(1024).left) > 0.001);
	i.stopVoices();
	const stopped = i.readPhysical(31);
	assert.deepEqual(stopped.pcm, physical.pcm);
	assert.deepEqual(stopped.voice, { ...physical.voice, gate: false });
	assert.equal(stopped.sample.id, sample.id);
	assert.equal(i.readPhysical(autoSlot).sample, null);
	assert.deepEqual(i.read().manualVoices, []);
	assert(i.synth.generateStereo(1024).left.every((value) => value === 0));
	assert.equal(i.physicalNoteOff('before'), false);
	const result = i.physicalNoteOn('after', 31, 69);
	assert.equal(result.initializedFromSource, null);
	assert.equal(i.read().playingSampleIds[31], sample.id);
	assert.deepEqual(i.readPhysical(31), physical);
	const retriggered = i.synth.generateStereo(1024);
	assert(Math.max(peak(retriggered.left), peak(retriggered.right)) > 0.001);
});

test('runtime-only slots do not change the saved six-source Auto patch and invalid edits preserve every owner', async (t) => {
	const i = await create(t),
		saved = i.exportPatch();
	i.physicalNoteOn('direct', 31, 69);
	i.invokePhysical('setMix', [31, { totalLevel: 77 }]);
	assert.deepEqual(i.exportPatch(), saved);
	const before = i.read(),
		ram = i.core.readRam(0, 524288);
	for (const fn of [
		() => i.readPhysical(32),
		() => i.invokePhysical('getPCM', [31, 0]),
		() => i.invokePhysical('unknown', [31, {}]),
		() => i.invokePhysical('setMix', [31, { directLevel: 8 }]),
		() => i.invokePhysical('setEnvelope', [31, { loopLink: 1 }]),
		() => i.invokePhysical('setModulation', [31, { depth: 16 }]),
		() => i.invokePhysical('setFrequency', [31, 0]),
		() => i.invokePhysical('setPreset', [31, { sample: i.reserved }]),
		() => i.physicalNoteOn('direct', 31, 69),
		() => i.physicalNoteOn('invalid', 31, 128),
		() => i.invokePhysical('applyPCM', [31, new Float32Array(64), { rootNote: 69 }]),
	]) {
		assert.throws(fn);
		assert.deepEqual(i.read(), before);
		assert.deepEqual(i.core.readRam(0, 524288), ram);
	}
});

test('physical keyboard uses transient bend without Auto transpose and explicit Hz edits retain a relative wheel base', async (t) => {
	const i = await create(t);
	i.setConfig({ transpose: 12 });
	i.setPitchBend(1);
	i.physicalNoteOn('direct', 31, 69);
	assert(Math.abs(i.read().slots[31].frequencyHz - 440 * 2 ** (1 / 12)) < 1e-8);
	i.setPitchBend(-1);
	assert(Math.abs(i.read().slots[31].frequencyHz - 440 * 2 ** (-1 / 12)) < 1e-8);
	i.invokePhysical('setFrequency', [31, 330]);
	const base = 330 / 2 ** (-1 / 12);
	assert.equal(i.read().manualVoices[0].baseFrequencyHz, base);
	i.setPitchBend(0);
	assert.equal(i.read().slots[31].frequencyHz, base);
	i.setConfig({ transpose: -12 });
	assert.equal(i.read().slots[31].frequencyHz, base);
	i.physicalNoteOff('direct');
	i.setPitchBend(2);
	assert(Math.abs(i.read().slots[31].frequencyHz - base * 2 ** (2 / 12)) < 1e-8);
	const before = i.read();
	assert.throws(() => i.setPitchBend(3));
	assert.deepEqual(i.read(), before);
});

test('Auto connection changes retire only Auto groups while physical requested voices remain owned', async (t) => {
	const i = await create(t);
	i.physicalNoteOn('direct', 31, 60);
	i.noteOn('auto', 69);
	const frequency = i.read().slots[31].frequencyHz;
	i.setConfig({ mode: 'fm2' });
	assert.equal(i.read().voiceGroups.length, 0);
	assert(i.read().slots[31].gate);
	assert.equal(i.read().manualVoices[0].id, 'direct');
	assert.equal(i.read().slots[31].frequencyHz, frequency);
	assert(peak(i.synth.generateStereo(1024).left) > 0.01);
	i.noteOn('fm', 69);
	assert.deepEqual(i.read().voiceGroups[0].slots, [6, 7]);
	assert(i.read().slots[31].gate);
});
