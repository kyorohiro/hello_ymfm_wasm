import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import { Scsp } from '../js/scsp.js';
import { ScspSynth } from '../js/scspsynth.js';
import { SynthInstrument } from './instrument.js';
import { readPreset, writePreset } from './preset.js';
import { readPatch } from './patch.js';
import { prepareScspSsfSource } from './ssf_source.js';
import { createScspSsfRenderer } from './ssf_renderer.js';
import { createScspSsfCapture, getScspSsfCaptureAvailability } from './ssf_capture.js';
import {
	createScspSsfPlaybackFixture,
	createScspSsfCaptureFixture,
	createScspSsfLiveFixture,
} from '../../test/helpers/scsp_ssf_fixture.mjs';

const binary = await readFile(new URL('../generated/scsp_wasm.wasm', import.meta.url));
const ssfBinary = await readFile(
	new URL('../generated/ssf-player/ssf_player.wasm', import.meta.url),
);
const core = () => Scsp.create({ moduleFactory: factory, moduleOptions: { wasmBinary: binary } });
async function observe(fixture = createScspSsfPlaybackFixture()) {
	const files = fixture.standaloneFiles ?? fixture.files;
	const prepared = await prepareScspSsfSource(files, files[0].path);
	const renderer = await createScspSsfRenderer(prepared, { wasmBinary: ssfBinary });
	try {
		renderer.process(new Float32Array(4096), new Float32Array(4096), 4096);
		return renderer.readSnapshot();
	} finally {
		renderer.dispose();
	}
}

test('ordinary capture copies the complete PCM, calibrated reference key and portable envelope / LFO', async () => {
	const snapshot = await observe(),
		before = structuredClone(snapshot);
	const capture = createScspSsfCapture(snapshot, 0);
	assert.deepEqual(snapshot, before);
	assert.equal(capture.preset.format, 'tetorica-scsp-voice');
	assert.equal(capture.preset.version, 1);
	assert.equal(capture.preset.bits, 16);
	assert.equal(capture.preset.pcm.length, 64);
	assert.equal(capture.preset.options.sourceSampleRate, 44100);
	assert.equal(capture.preset.options.baseFrequencyHz, 440 * 2 ** ((60 - 69) / 12));
	assert.equal(capture.preset.voice.frequencyHz, capture.preset.options.baseFrequencyHz);
	assert.deepEqual(capture.preset.voice.envelope, snapshot.slots[0].voice.envelope);
	assert.deepEqual(capture.preset.voice.lfo, snapshot.slots[0].voice.lfo);
	assert.equal(capture.origin.frame, snapshot.frame);
	assert.equal(capture.origin.slotIndex, 0);
	assert.equal(capture.origin.referenceMidi, 60);
	assert(capture.warnings.some((value) => /phase/.test(value)));
	const portable = JSON.parse(JSON.stringify(capture.preset));
	assert.equal(readPatch(portable).mode, 'pcm');
	const loaded = readPreset(portable);
	assert.equal(loaded.pcm.length, 64);
	for (let index = 0; index < loaded.pcm.length; index++)
		assert.equal(loaded.pcm[index], Math.round(8192 * Math.sin((index * Math.PI) / 32)));
});

test('actual WASM audition / preset round trip retain captured reference pitch and sustain the loop', async () => {
	const snapshot = await observe(createScspSsfPlaybackFixture({ pitch: 0x7800 }));
	const { preset } = createScspSsfCapture(snapshot, 0, { referenceMidi: 60 });
	const first = new SynthInstrument(await core()),
		second = new SynthInstrument(await core());
	try {
		first.loadPatch(preset);
		const roundtrip = first.exportPatch();
		second.loadPatch(JSON.parse(JSON.stringify(roundtrip)));
		first.noteOn('reference', 60);
		second.noteOn('reference', 60);
		const slot = first.read().voiceGroups[0].slots[0];
		assert.equal(first.core.read(slot * 32 + 16), 0x7800);
		assert.equal(first.core.read(slot * 32 + 4), 0);
		assert.equal(first.core.read(slot * 32 + 6), 64);
		const output = first.core.generateStereo(4096);
		assert.deepEqual(output, second.core.generateStereo(4096));
		assert(output.left.every(Number.isFinite));
		assert(output.left.subarray(3000).some((value) => Math.abs(value) > 0.01));
		// At half source advance, the copied 64-sample sine has period 128 frames.
		let crossings = 0;
		for (let index = 1025; index < 4096; index++)
			if (output.left[index - 1] <= 0 && output.left[index] > 0) crossings++;
		assert(Math.abs(crossings - 24) <= 1, `reference crossings ${crossings}`);
	} finally {
		first.dispose();
		second.dispose();
	}
});

test('PCM8 forward loop, nonzero loop start, KRS, LFO and direct mix survive an actual two-slot SSF capture', async () => {
	const snapshot = await observe(createScspSsfCaptureFixture());
	const capture = createScspSsfCapture(snapshot, 1, { referenceMidi: 57 });
	assert(getScspSsfCaptureAvailability(snapshot, 1, { referenceMidi: 57 }).available);
	const preset = readPreset(capture.preset);
	assert(preset.pcm instanceof Int8Array);
	assert.equal(preset.pcm.length, snapshot.slots[1].sample.loopEnd);
	assert.equal(preset.options.loopStartSamples, 8);
	assert.deepEqual(preset.voice.envelope, snapshot.slots[1].voice.envelope);
	assert.deepEqual(preset.voice.lfo, snapshot.slots[1].voice.lfo);
	for (const key of ['totalLevel', 'directLevel', 'pan'])
		assert.equal(preset.voice[key], snapshot.slots[1].voice[key]);
	const instrument = new SynthInstrument(await core());
	try {
		instrument.loadPatch(capture.preset);
		instrument.noteOn('pcm8', 57);
		const slot = instrument.read().voiceGroups[0].slots[0];
		assert.equal(instrument.core.read(slot * 32 + 16), snapshot.slots[1].registers[8]);
		assert.equal(instrument.core.read(slot * 32 + 4), 8);
		assert.equal(instrument.core.read(slot * 32 + 6), 64);
		const output = instrument.core.generateStereo(4096);
		assert(output.left.every(Number.isFinite));
		assert(output.left.subarray(3000).some((value) => Math.abs(value) > 0.0001));
	} finally {
		instrument.dispose();
	}
});

test('full LEA waveform and native 20-bit address / dummy RAM rules are copied without a preview limit', async () => {
	const snapshot = await observe(),
		slot = snapshot.slots[0];
	slot.sample.bits = 8;
	slot.sample.startAddress = 0xffff0;
	slot.sample.loopEnd = 1024;
	snapshot.ram.set([127, 128, 255, 1], 0);
	const { preset } = createScspSsfCapture(snapshot, 0);
	assert.equal(preset.pcm.length, 1024);
	assert.deepEqual(preset.pcm.slice(0, 16), Array(16).fill(0));
	assert.deepEqual(preset.pcm.slice(16, 20), [127, -128, -1, 1]);
	slot.sample.bits = 16;
	slot.sample.startAddress = 0xfffff;
	snapshot.ram.set([0x80, 1, 0x7f, 0xfe], 0);
	const aligned = createScspSsfCapture(snapshot, 0).preset;
	assert.deepEqual(aligned.pcm.slice(0, 3), [0, -32767, 32766]);
	slot.sample.startAddress = 0x7fffe;
	snapshot.ram.set([0x12, 0x34], 0x7fffe);
	assert.deepEqual(createScspSsfCapture(snapshot, 0).preset.pcm.slice(0, 3), [0x1234, 0, 0]);
});

test('native STWINH alone permits independent direct PCM capture with an outgoing-stack warning', async () => {
	const snapshot = await observe(createScspSsfLiveFixture());
	assert.equal(snapshot.slots[1].voice.modulation.depth, 0);
	assert.equal(snapshot.slots[1].voice.modulation.writeInhibit, true);
	const before = structuredClone(snapshot);
	const captured = createScspSsfCapture(snapshot, 1);
	assert(getScspSsfCaptureAvailability(snapshot, 1).available);
	assert(captured.warnings.some((value) => /outgoing writes/.test(value)));
	assert.equal(captured.origin.modulation.writeInhibit, true);
	const withoutInhibit = structuredClone(snapshot);
	withoutInhibit.slots[1].voice.modulation.writeInhibit = false;
	withoutInhibit.slots[1].registers[6] &= ~0x200;
	assert.deepEqual(captured.preset, createScspSsfCapture(withoutInhibit, 1).preset);
	assert.deepEqual(snapshot, before);
	const linked = structuredClone(snapshot);
	linked.slots[1].voice.modulation.depth = 5;
	assert.equal(getScspSsfCaptureAvailability(linked, 1).available, false);
	assert.throws(() => createScspSsfCapture(linked, 1), /linked slots/);
});

test('one-shot capture stays one-shot through real WASM and does not silently turn into a forward loop', async () => {
	const snapshot = await observe(),
		slot = snapshot.slots[0];
	slot.sample.loopMode = 0;
	slot.sample.loopStart = 0;
	const captured = createScspSsfCapture(snapshot, 0).preset;
	assert(!Object.hasOwn(captured.options, 'loopStartSamples'));
	const loaded = readPreset(captured),
		synth = new ScspSynth(await core());
	try {
		const sample = synth.loadPCM(loaded.pcm, loaded.options);
		synth.setPreset(0, { ...loaded.voice, sample });
		synth.noteOn(0, 60);
		const out = synth.generateStereo(4096);
		assert(out.left.some((value) => Math.abs(value) > 0.01));
		assert(out.left.subarray(1024).every((value) => value === 0));
		const json = writePreset({ pcm: loaded.pcm, sample, voice: synth.getState().slots[0] });
		assert.equal(readPreset(json).options.loopStartSamples, undefined);
	} finally {
		synth.dispose();
	}
});

test('unsupported dependencies and malformed snapshots fail before replacing the current preset', async () => {
	const snapshot = await observe();
	const cases = [
		[(s) => (s.slots[0].sample.sourceMode = 1), /Noise/],
		[(s) => (s.slots[0].sample.sourceMode = 2), /Zero source/],
		[(s) => (s.slots[0].sample.sourceBitControl = 1), /Source-bit/],
		[(s) => (s.slots[0].sample.loopMode = 2), /Reverse/],
		[(s) => (s.slots[0].sample.loopMode = 3), /alternating/],
		[(s) => (s.slots[0].sample.loopEnd = 0), /at least 2/],
		[(s) => (s.slots[0].sample.loopEnd = 1), /at least 2/],
		[(s) => (s.slots[0].sample.loopStart = 64), /start before/],
		[(s) => (s.slots[0].registers[8] |= 0x8000), /Short-wave/],
		[(s) => (s.slots[0].registers[8] |= 0x400), /Extended FNS/],
		...['attackHold', 'loopLink', 'envelopeBypass', 'soundDirect'].map((key) => [
			(s) => (s.slots[0].flags[key] = true),
			/not supported/,
		]),
		[(s) => (s.slots[0].voice.modulation.depth = 5), /linked slots/],
		[(s) => (s.slots[0].voice.directLevel = 0), /no direct output/],
		[(s) => (s.slots[0].voice.totalLevel = 255), /attenuation/],
		[(s) => (s.slots[0].voice.frequencyHz = 0), /zero or invalid/],
		[(s) => (s.slots[0].sample.loopStart = 63), /short forward loop/],
		[(s) => (s.ram = new Uint8Array(1)), /same-time/],
	];
	const current = createScspSsfCapture(snapshot, 0).preset;
	for (const [change, reason] of cases) {
		const invalid = structuredClone(snapshot);
		change(invalid);
		let replacement = current;
		const availability = getScspSsfCaptureAvailability(invalid, 0);
		assert.equal(availability.available, false, availability.reason);
		assert.match(availability.reason, reason);
		assert.throws(() => {
			replacement = createScspSsfCapture(invalid, 0).preset;
		}, reason);
		assert.equal(replacement, current);
	}
	assert.throws(() => createScspSsfCapture(snapshot, 32), /Slot/);
	assert.throws(() => createScspSsfCapture(snapshot, 0, { referenceMidi: 128 }), /Reference/);
});

test('shared DSP and global master are explicitly reported as dry-capture limitations', async () => {
	const snapshot = await observe();
	snapshot.slots[0].dsp.send = 5;
	snapshot.slots[0].dsp.returnLevel = 3;
	snapshot.globals.masterVolume = 8;
	const available = getScspSsfCaptureAvailability(snapshot, 0);
	assert(available.available);
	const { warnings, origin } = createScspSsfCapture(snapshot, 0);
	assert(warnings.some((value) => /shared DSP/.test(value)));
	assert(warnings.some((value) => /MVOL 8/.test(value)));
	assert.equal(origin.dsp.send, 5);
	assert.equal(origin.masterVolume, 8);
});
