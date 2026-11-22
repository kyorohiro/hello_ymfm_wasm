import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import factory from '../generated/wonderswan_wasm.js';
import { WonderSwanAudioEngine } from '../js/wonderswanaudioengine.js';
import { AswanInstrument } from './instrument.js';
import {
	createDefaultPreset,
	readPreset,
	waveShape,
	decodePcmData,
	encodePcmData,
} from './preset.js';
const wasmBinary = await readFile(new URL('../generated/wonderswan_wasm.wasm', import.meta.url));
async function make(t, rate = 48000) {
	const core = await WonderSwanAudioEngine.create({
		moduleFactory: factory,
		moduleOptions: { wasmBinary },
		outputSampleRate: rate,
	});
	const instrument = new AswanInstrument(core);
	t.after(() => instrument.dispose());
	return instrument;
}
const peak = (values) => values.reduce((n, value) => Math.max(n, Math.abs(value)), 0);
test('Code keyOn keeps the hardware period and level while noteOn uses the software envelope', async (t) => {
	const i = await make(t), p = i.read().preset;
	p.envelope = { enabled: true, attack: .25, decay: 0, sustain: 1, release: .25 };
	i.setPreset(p);
	const { session } = i.beginCode();
	assert(Math.abs(i.code(session, 'setNote', [0, 'A4']) - 440) < 1);
	const before = i.synth._getState().registers;
	assert.equal(i.code(session, 'keyOn', [0]), 0);
	assert.deepEqual(i.synth._getState().registers.slice(0, 9), before.slice(0, 9));
	assert.equal(i.code(session, 'keyOff', [0]), true);
	assert.equal(i.code(session, 'noteOn', [0, 'A4']), 0);
	assert.equal(i.synth._getState().registers[8], 0);
	assert.equal(i.code(session, 'noteOff', [0]), true);
});
test('portable ASWAN presets detach nested fields and strictly validate complete PCM/wave data', () => {
	const p = createDefaultPreset(),
		read = readPreset(p);
	assert.deepEqual(read, p);
	read.wave[0] = 0;
	assert.notEqual(read.wave[0], p.wave[0]);
	for (const mutate of [
		(p) => p.wave.pop(),
		(p) => (p.wave[1] = 16),
		(p) => (p.left = 16),
		(p) => (p.sweep.step = -129),
		(p) => (p.envelope.enabled = 1),
		(p) => (p.pcm.data = '?==='),
		(p) => (p.pcm.rootNote = 128),
		(p) => (p.pcm.sampleRate = 0),
		(p) => (p.extra = true),
	]) {
		const bad = createDefaultPreset();
		mutate(bad);
		assert.throws(() => readPreset(bad));
	}
	const bytes = Uint8Array.from([0, 127, 128, 255]);
	assert.deepEqual(decodePcmData(encodePcmData(bytes)), bytes);
});
test('actual WASM four-voice round robin, physical channel independence and stale keyup ownership', async (t) => {
	const i = await make(t),
		p = i.read().preset;
	p.envelope.enabled = false;
	i.setPreset(p);
	assert.equal(peak(i.generateStereo(128).left), 0);
	for (let ch = 0; ch < 4; ch++) assert.equal(i.noteOn(`key${ch}`, 60 + ch).channel, ch);
	assert(peak(i.generateStereo(1024).left) > 0.01);
	assert.equal(i.noteOn('steal', 72).channel, 0);
	assert.equal(i.noteOff('key0'), false);
	assert(i.read().channels[0].active);
	const auto = i.read().preset,
		physical = { ...p, wave: waveShape('square'), left: 15, right: 0 };
	i.setPreset(physical, 2);
	assert.deepEqual(i.read().preset, auto);
	assert.equal(i.read().channels[2].preset.left, 15);
	assert.equal(i.read().channels[1].preset.left, 9);
	const before = i.read();
	assert.throws(() => i.setPreset({ ...physical, source: 'noise' }, 0));
	assert.deepEqual(i.read(), before);
});
test('wave / preset edits keep held native gates and change the next rendered timbre without a retrigger', async (t) => {
	const i = await make(t),
		p = i.read().preset;
	p.envelope.enabled = false;
	i.setPreset(p);
	i.noteOn('held', 69);
	const before = i.generateStereo(1024);
	i.setPreset({ ...p, wave: waveShape('square') });
	assert(i.read().channels[0].active);
	assert.equal(i.read().voices[0].id, 'held');
	const after = i.generateStereo(1024);
	assert.notDeepEqual(after.left, before.left);
	assert.equal(i.noteOff('held'), true);
	assert(i.generateStereo(256).left.every((v) => v === 0));
});
test('Noise / Sweep / Voice PCM use only their real physical channels and emit finite audio', async (t) => {
	for (const [source, ch] of [
		['noise', 3],
		['wave', 2],
		['pcm', 1],
	]) {
		const i = await make(t),
			p = i.read().preset;
		p.source = source;
		p.envelope.enabled = false;
		p.sweep.enabled = source === 'wave';
		p.sweep.step = 2;
		i.setPreset(p);
		assert.equal(i.noteOn('note', 60).channel, ch);
		const pcm = i.generateStereo(8192);
		assert(pcm.left.every(Number.isFinite));
		assert(peak(pcm.left) > 0.001, source);
		assert.equal(i.read().capacity, 1);
		i.stop();
		assert(i.generateStereo(128).left.every((v) => v === 0));
	}
});
test('software envelope and PCM feed are invariant across render partitions / host rates', async (t) => {
	for (const rate of [44100, 48000, 96000])
		for (const source of ['wave', 'pcm']) {
			const a = await make(t, rate),
				b = await make(t, rate),
				p = a.read().preset;
			p.source = source;
			for (const i of [a, b]) {
				i.setPreset(p);
				i.noteOn('note', 60);
			}
			const whole = a.generateStereo(4096),
				left = new Float32Array(4096),
				right = left.slice();
			for (let at = 0; at < 4096; at += 37) {
				const next = b.generateStereo(Math.min(37, 4096 - at));
				left.set(next.left, at);
				right.set(next.right, at);
			}
			assert.deepEqual(whole, { left, right });
			a.noteOff('note');
			b.noteOff('note');
			assert.deepEqual(a.generateStereo(4096), b.generateStereo(4096));
			assert(a.generateStereo(128).left.every((v) => v === 0));
		}
});
test('Code shares actual physical channels and preserves session / held sound across editor changes', async (t) => {
	const i = await make(t),
		p = i.read().preset;
	p.envelope.enabled = false;
	i.setPreset(p);
	i.noteOn('keyboard', 60, 0);
	const { session } = i.beginCode();
	i.code(session, 'noteOn', [0, 'A4']);
	assert.equal(i.noteOff('keyboard'), false);
	assert.equal(i.read().channels[0].owner, 'code');
	i.setPreset({ ...p, wave: waveShape('saw') }, 0);
	assert.equal(i.read().codeActive, true);
	assert(i.read().channels[0].gate);
	assert(peak(i.generateStereo(1024).left) > 0.01);
	i.noteOn('new-keyboard', 60, 0);
	assert.equal(i.code(session, 'keyOff', [0]), false);
	assert(i.read().channels[0].gate);
	i.code(session, 'writeRegister', [0x90, 1]);
	assert.equal(i.noteOff('new-keyboard'), false);
	assert(i.read().channels[0].gate);
	i.endCode(session);
	assert.throws(() => i.code(session, 'keyOff', [0]), { name: 'AbortError' });
	i.stop();
	assert(i.generateStereo(128).left.every((v) => v === 0));
});
test('native monitoring mute leaves registers and waveform RAM unchanged', async (t) => {
	const i = await make(t),
		p = i.read().preset;
	p.envelope.enabled = false;
	i.setPreset(p);
	i.noteOn('held', 69, 0);
	i.generateStereo(1024);
	const before = i.read();
	i.setChannelEnabled(0, false);
	assert(i.generateStereo(1024).left.every((v) => v === 0));
	assert.deepEqual(i.read().registers, before.registers);
	assert.deepEqual(i.read().memory, before.memory);
	i.setChannelEnabled(0, true);
	assert(peak(i.generateStereo(1024).left) > 0.01);
});
test('successive Code notes retain authored volume after software release, and manual Voice latch is not replaced by a default PCM loop', async (t) => {
	const i = await make(t),
		{ session } = i.beginCode();
	for (let n = 0; n < 5; n++) {
		i.code(session, 'noteOn', [0, 'A4']);
		assert(peak(i.generateStereo(1024).left) > 0.001);
		i.code(session, 'noteOff', [0]);
		i.generateStereo(4096);
	}
	i.code(session, 'setVoiceMode', [true]);
	i.code(session, 'writeVoice', [200]);
	i.code(session, 'keyOn', [1]);
	i.generateStereo(1024);
	assert.equal(i.read().registers[9], 200);
	i.endCode(session);
	assert(i.generateStereo(128).left.every((v) => v === 0));
});
test('sparse physical editor commit preserves newer Code values and does not turn a released envelope volume into the next note base', async (t) => {
	const i = await make(t),
		{ session } = i.beginCode();
	i.code(session, 'noteOn', [0, 69]);
	i.generateStereo(512);
	i.code(session, 'noteOff', [0]);
	i.generateStereo(4096);
	const before = i.read().channels[0].preset;
	assert.equal(before.left, 0);
	assert.equal(i.read().channels[0].authoredPreset.left, 9);
	const next = structuredClone(before);
	next.envelope.attack = 0.02;
	i.code(session, 'setWaveform', [0, waveShape('square')]);
	i.code(session, 'setVolume', [0, 12, 4]);
	i.editPreset(before, next, 0);
	const after = i.read().channels[0];
	assert.equal(after.authoredPreset.left, 12);
	assert.equal(after.authoredPreset.right, 4);
	assert.deepEqual(after.preset.wave, waveShape('square'));
	assert.equal(after.preset.envelope.attack, 0.02);
	i.code(session, 'noteOn', [0, 'A4']);
	assert(peak(i.generateStereo(2048).left) > 0.001);
	assert(i.read().codeActive);
	const held = i.read(),
		bad = structuredClone(next);
	bad.wave[0] = 16;
	assert.throws(() => i.editPreset(before, bad, 0));
	assert.deepEqual(i.read(), held);
});
test('Code Voice PCM reports hardware routing rather than decoding its sample byte as a volume', async (t) => {
	const i = await make(t),
		{ session } = i.beginCode();
	i.code(session, 'setVoiceMode', [true]);
	i.code(session, 'writeRegister', [0x94, 5]);
	i.code(session, 'setVolume', [1, 2, 3]);
	let channel = i.read().channels[1];
	assert.equal(i.read().registers[9], 0x23);
	assert.equal(channel.left, 7);
	assert.equal(channel.right, 7);
	assert.equal(channel.authoredPreset.left, 7);
	assert.equal(channel.authoredPreset.right, 7);
	i.code(session, 'writeRegister', [0x94, 8]);
	channel = i.read().channels[1];
	assert.equal(channel.left, 15);
	assert.equal(channel.right, 0);
});
