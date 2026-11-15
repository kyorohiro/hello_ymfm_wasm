// SPDX-License-Identifier: BSD-3-Clause
// Native PCM / register evidence only. No AudioContext or output device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import { Scsp } from '../js/scsp.js';
import { SynthInstrument } from './instrument.js';
import { scspEffectiveReleaseIndex } from './release_guard.js';

const wasmBinary = await readFile(new URL('../generated/scsp_wasm.wasm', import.meta.url));
const module = await factory({ wasmBinary });
async function create(
	t,
	{
		rr = 31,
		krs = 15,
		ratio = 1,
		constant = false,
		enabled = true,
		loopLink = false,
		loopStart = 0,
	} = {},
) {
	const core = await Scsp.create({ moduleFactory: () => module }),
		writes = [];
	const write = core.write.bind(core);
	core.write = (...args) => {
		writes.push(args);
		return write(...args);
	};
	const i = new SynthInstrument(core);
	t.after(() => i.dispose());
	const pcm = Int16Array.from({ length: 256 }, (_, n) =>
		constant ? 8192 : Math.round(8192 * Math.sin((n * Math.PI) / 128)),
	);
	i.invoke('applyPCM', [
		0,
		pcm,
		{ baseFrequencyHz: 440, sourceSampleRate: 44100 * ratio, loopStartSamples: loopStart },
	]);
	i.invoke('setMix', [0, { totalLevel: 0, directLevel: 7, pan: 0 }]);
	i.invoke('setEnvelope', [
		0,
		{
			attackRate: 31,
			decay1Rate: 0,
			decay2Rate: 0,
			decayLevel: 0,
			releaseRate: rr,
			keyRateScaling: krs,
			loopLink,
		},
	]);
	i.setClickGuard(enabled);
	return { i, core, writes };
}
const peak = (pcm) => pcm.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
const capWrites = (entry, slot) =>
	entry.writes.filter(
		([address, value, mask]) => address === slot * 32 + 10 && value === 25 && mask === 31,
	);
function start(entry, id = 'held') {
	const slot = entry.i.noteOn(id, 69).slots.at(-1);
	const before = entry.i.synth.generateStereo(64).left;
	entry.writes.length = 0;
	return { slot, last: before.at(-1) };
}

test('effective release index follows the pinned native RR / KRS / signed OCT / FNS calculation', () => {
	assert.equal(scspEffectiveReleaseIndex((15 << 10) | 31, 0), 62);
	assert.equal(scspEffectiveReleaseIndex((15 << 10) | 0, 0x3bff), 0);
	assert.equal(scspEffectiveReleaseIndex(25, 0x6000), 46);
	assert.equal(scspEffectiveReleaseIndex(25, 0x2000), 54);
	assert.equal(scspEffectiveReleaseIndex(25, 0x2200), 55);
	assert.equal(scspEffectiveReleaseIndex((14 << 10) | 31, 0x3bff), 63);
	assert.equal(scspEffectiveReleaseIndex(0, 0x4000), 0);
});

test('fast Sine noteOff softens its edge using RR25 while requested ADSR, PCM and saved patch stay intact', async (t) => {
	const smooth = await create(t),
		raw = await create(t, { enabled: false });
	const a = start(smooth),
		b = start(raw),
		saved = smooth.i.exportPatch();
	const originalWord = smooth.core.read(a.slot * 32 + 10);
	assert(smooth.i.read().clickGuard);
	assert(smooth.i.noteOff('held'));
	assert(raw.i.noteOff('held'));
	assert.equal(smooth.core.read(a.slot * 32 + 10), (originalWord & ~31) | 25);
	assert.equal(raw.core.read(b.slot * 32 + 10), originalWord);
	assert.equal(smooth.i.read().slots[a.slot].envelope.releaseRate, 31);
	assert.deepEqual(smooth.i.exportPatch(), saved);
	assert.equal(capWrites(smooth, a.slot).length, 1);
	const guarded = smooth.i.synth.generateStereo(4096).left,
		unprotected = raw.i.synth.generateStereo(4096).left;
	const guardedStep = Math.abs(guarded[0] - a.last),
		rawStep = Math.abs(unprotected[0] - b.last);
	assert(guardedStep < rawStep * 0.3, `release edge ${guardedStep} vs ${rawStep}`);
	assert(
		guarded.subarray(2048).every((value) => value === 0),
		'native Release completes; no synthetic tail is left running',
	);
	assert.notDeepEqual(guarded, unprotected);
});

test('normal and infinite releases remain bit-exact, including a slow keyOn rate retuned into a fast current pitch', async (t) => {
	for (const options of [
		{ rr: 0 },
		{ rr: 16 },
		{ rr: 20 },
		{ rr: 25 },
		{ rr: 25, krs: 0, ratio: 1 / 16, retune: 440 * 256 },
	]) {
		const smooth = await create(t, { ...options, constant: true }),
			raw = await create(t, { ...options, constant: true, enabled: false });
		const sessions = [smooth.i.beginCode().session, raw.i.beginCode().session];
		for (const [index, entry] of [smooth, raw].entries()) {
			entry.i.code(sessions[index], 'noteOn', [0, 69]);
			entry.i.synth.generateStereo(64);
			if (options.retune) entry.i.code(sessions[index], 'setFrequency', [0, options.retune]);
			entry.writes.length = 0;
		}
		const slot = smooth.i.read().codeLanes[0].slots.at(-1),
			word = smooth.core.read(slot * 32 + 10);
		smooth.i.code(sessions[0], 'noteOff', [0]);
		raw.i.code(sessions[1], 'noteOff', [0]);
		assert.equal(capWrites(smooth, slot).length, 0, JSON.stringify(options));
		assert.equal(smooth.core.read(slot * 32 + 10), word);
		assert.deepEqual(
			smooth.i.synth.generateStereo(8192),
			raw.i.synth.generateStereo(8192),
			JSON.stringify(options),
		);
	}
});

test('a fast keyOn rate is still guarded after a slow live retune even when its RR register already says25', async (t) => {
	const smooth = await create(t, { rr: 25, krs: 0, ratio: 16, constant: true }),
		raw = await create(t, { rr: 25, krs: 0, ratio: 16, constant: true, enabled: false });
	const sessions = [smooth.i.beginCode().session, raw.i.beginCode().session];
	for (const [index, entry] of [smooth, raw].entries()) {
		entry.i.code(sessions[index], 'noteOn', [0, 69]);
		entry.i.synth.generateStereo(64);
		entry.i.code(sessions[index], 'setFrequency', [0, 440 / 256]);
		entry.writes.length = 0;
	}
	const slot = smooth.i.read().codeLanes[0].slots.at(-1);
	smooth.i.code(sessions[0], 'noteOff', [0]);
	raw.i.code(sessions[1], 'noteOff', [0]);
	assert.equal(smooth.core.read(slot * 32 + 10), raw.core.read(slot * 32 + 10));
	assert.equal(
		capWrites(smooth, slot).length,
		1,
		'a masked same-word write intentionally recomputes Get_DR(0,25)',
	);
	assert.notDeepEqual(smooth.i.synth.generateStereo(4096), raw.i.synth.generateStereo(4096));
});

test('fresh Code keyOff bypasses the guard, while noteOff follows the host preference', async (t) => {
	const guarded = await create(t),
		raw = await create(t, { enabled: false });
	const sessions = [guarded.i.beginCode().session, raw.i.beginCode().session];
	for (const [index, entry] of [guarded, raw].entries()) {
		entry.i.code(sessions[index], 'noteOn', [0, 69]);
		entry.i.synth.generateStereo(64);
		entry.writes.length = 0;
	}
	const slot = guarded.i.read().codeLanes[0].slots.at(-1);
	guarded.i.code(sessions[0], 'keyOff', [0]);
	raw.i.code(sessions[1], 'keyOff', [0]);
	assert.equal(capWrites(guarded, slot).length, 0);
	assert.equal(guarded.core.read(slot * 32 + 10) & 31, 31);
	assert.deepEqual(guarded.i.synth.generateStereo(4096), raw.i.synth.generateStereo(4096));
	for (const [index, entry] of [guarded, raw].entries()) {
		entry.i.code(sessions[index], 'keyOn', [0]);
		entry.i.synth.generateStereo(64);
	}
	guarded.i.code(sessions[0], 'noteOff', [0]);
	raw.i.code(sessions[1], 'noteOff', [0]);
	assert.equal(guarded.core.read(slot * 32 + 10) & 31, 25);
	assert.equal(raw.core.read(slot * 32 + 10) & 31, 31);
});

test('preference changes leave held phase and registers intact, and keyOn latches even while preference is off', async (t) => {
	const entry = await create(t, { enabled: false, loopLink: true, loopStart: 128 });
	const { slot } = start(entry);
	entry.core.write(0x408, slot << 11);
	entry.i.synth.generateStereo(1);
	const word = entry.core.read(slot * 32 + 10),
		phase = entry.core.read(0x408),
		saved = entry.i.exportPatch();
	entry.writes.length = 0;
	assert.equal(entry.i.setClickGuard(true), true);
	assert.equal(entry.core.read(slot * 32 + 10), word);
	assert.equal(entry.core.read(0x408), phase);
	assert.deepEqual(entry.writes, []);
	assert.equal((phase >> 5) & 3, 0, 'the linked native voice is still in Attack');
	for (const value of [0, 1, null, 'true'])
		assert.throws(() => entry.i.setClickGuard(value), /must be boolean/);
	assert.equal(entry.i.read().clickGuard, true);
	assert.deepEqual(entry.i.exportPatch(), saved);
	entry.i.noteOff('held');
	assert.equal(entry.core.read(slot * 32 + 10) & 0x4000, 0x4000);
	assert.equal(entry.core.read(slot * 32 + 10) & 31, 25);
	entry.i.synth.generateStereo(1);
	assert.equal(
		(entry.core.read(0x408) >> 5) & 3,
		3,
		'only normal keyOff changes the phase to Release',
	);
});

test('only the released physical owner is modified; a different panned note remains bit-exact', async (t) => {
	const smooth = await create(t),
		raw = await create(t, { enabled: false });
	for (const entry of [smooth, raw]) {
		const sample = entry.i.readPhysical(0).sample;
		entry.i.invokePhysical('setPreset', [
			30,
			{ sample, frequencyHz: 440, totalLevel: 0, directLevel: 7, pan: 31 },
		]);
		entry.i.invokePhysical('setPreset', [
			31,
			{ sample, frequencyHz: 440, totalLevel: 0, directLevel: 7, pan: 15 },
		]);
		entry.i.physicalNoteOn('left', 30, 69);
		entry.i.physicalNoteOn('right', 31, 69);
		entry.i.synth.generateStereo(64);
		entry.writes.length = 0;
		entry.i.physicalNoteOff('left');
	}
	const a = smooth.i.synth.generateStereo(4096),
		b = raw.i.synth.generateStereo(4096);
	assert.deepEqual(a.right, b.right);
	assert.notDeepEqual(a.left, b.left);
	assert.equal(smooth.core.read(31 * 32 + 10) & 31, 31);
	assert.equal(smooth.i.read().slots[31].gate, true);
});

test('retrigger and Auto reuse restore authored RR and stale physical noteOff cannot affect the new owner', async (t) => {
	const entry = await create(t),
		sample = entry.i.readPhysical(0).sample;
	entry.i.invokePhysical('setPreset', [6, { sample }]);
	entry.i.physicalNoteOn('old', 6, 69);
	entry.i.synth.generateStereo(64);
	entry.i.physicalNoteOff('old');
	assert.equal(entry.core.read(6 * 32 + 10) & 31, 25);
	entry.i.physicalNoteOn('replacement', 6, 69);
	assert.equal(entry.core.read(6 * 32 + 10) & 31, 31);
	assert.equal(entry.i.physicalNoteOff('old'), false);
	entry.i.noteOn('auto', 69);
	assert.equal(entry.core.read(6 * 32 + 10) & 31, 31);
	assert.equal(entry.i.physicalNoteOff('replacement'), false);
	entry.i.noteOff('auto');
	assert.equal(entry.core.read(6 * 32 + 10) & 31, 25);
});

test('native guarded tails are independent of host render partitioning', async (t) => {
	const first = await create(t),
		second = await create(t);
	start(first);
	start(second);
	first.i.noteOff('held');
	second.i.noteOff('held');
	const expected = first.i.synth.generateStereo(4096),
		left = new Float32Array(4096),
		right = new Float32Array(4096);
	for (let offset = 0; offset < 4096; ) {
		const count = Math.min(1 + ((offset * 17) % 131), 4096 - offset),
			part = second.i.synth.generateStereo(count);
		left.set(part.left, offset);
		right.set(part.right, offset);
		offset += count;
	}
	assert.deepEqual({ left, right }, expected);
});

test('a running Code preset replacement retains the original held release latch', async (t) => {
	const changed = await create(t),
		control = await create(t);
	const sessions = [changed.i.beginCode().session, control.i.beginCode().session];
	for (const [index, entry] of [changed, control].entries()) {
		entry.i.code(sessions[index], 'noteOn', [0, 69]);
		entry.i.synth.generateStereo(64);
	}
	const patch = changed.i.exportPatch();
	patch.operators.carrier.voice.envelope.releaseRate = 0;
	changed.i.loadPatch(patch);
	const slot = changed.i.read().codeLanes[0].slots.at(-1);
	assert.equal(changed.core.read(slot * 32 + 10) & 31, 31);
	changed.i.code(sessions[0], 'noteOff', [0]);
	control.i.code(sessions[1], 'noteOff', [0]);
	assert.equal(changed.core.read(slot * 32 + 10) & 31, 25);
	assert.deepEqual(changed.i.synth.generateStereo(4096), control.i.synth.generateStereo(4096));
});

test('guarded release keeps shared DSP configured and allows its later echo to continue', async (t) => {
	const entry = await create(t);
	entry.i.setEffect({ enabled: true, timeMs: 20, feedback: 0 });
	const { slot } = start(entry);
	entry.i.noteOff('held');
	assert(
		entry.writes.every(([address]) => address === slot * 32 || address === slot * 32 + 10),
		'no master, DSP program or unrelated voice is changed',
	);
	const tail = entry.i.synth.generateStereo(4096).left;
	assert(peak(tail.subarray(882, 1500)) > 0.001);
	assert.equal(entry.i.read().config.effect.enabled, true);
});

test('Stop and preset / idle loads clear stale latches but retain the host preference outside saved state', async (t) => {
	const entry = await create(t, { enabled: false });
	start(entry);
	assert.equal(entry.i.releaseGuard.latched.size, 1);
	entry.i.stopVoices();
	assert.equal(entry.i.releaseGuard.latched.size, 0);
	assert.equal(entry.i.read().clickGuard, false);
	const patch = entry.i.exportPatch(),
		idle = entry.i.exportIdleState();
	assert(!Object.hasOwn(patch, 'clickGuard'));
	assert(!Object.hasOwn(patch, 'config'));
	assert(!Object.hasOwn(idle, 'clickGuard'));
	assert(!Object.hasOwn(idle.synthState, 'clickGuard'));
	entry.i.loadPatch(patch);
	assert.equal(entry.i.read().clickGuard, false);
	entry.i.loadIdleState(idle);
	assert.equal(entry.i.read().clickGuard, false);
	assert(entry.i.synth.generateStereo(128).left.every((value) => value === 0));
});
