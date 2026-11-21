// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeNdsSample, NdsSynth, ndsTimerForFrequency } from './nds-synth-api.js';
import { NdsSoundCore } from './nds-core.js';

let Processor;
globalThis.AudioWorkletProcessor = class { port = { postMessage() {} }; };
globalThis.registerProcessor = (name, implementation) => {
	assert.equal(name, 'tetorica-nds-synth');
	Processor = implementation;
};
try {
	await import('./nds-worklet.js');
} finally {
	delete globalThis.AudioWorkletProcessor;
	delete globalThis.registerProcessor;
}

function endpoint() {
	let worklet;
	globalThis.sampleRate = 48000;
	try {
		worklet = new Processor();
	} finally {
		delete globalThis.sampleRate;
	}
	const owners = Array(16).fill(null), pending = new Map();
	let id = 0;
	worklet.port.postMessage = (message) => {
		const { id, owners: next, value, error, name } = structuredClone(message);
		const { resolve, reject } = pending.get(id);
		pending.delete(id);
		if (next) owners.splice(0, owners.length, ...next);
		if (error) {
			const failure = new Error(error);
			failure.name = name;
			reject(failure);
		} else resolve(value);
	};
	function request(method, args = []) {
		const message = structuredClone({ id: ++id, method, args });
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			queueMicrotask(() => worklet.port.onmessage({ data: message }));
		});
	}
	return { chip: new NdsSynth(request, { owners }), worklet };
}

test('built-in DS sample formats and shapes load as word-aligned loops', () => {
	const core = new NdsSoundCore(48000);
	for (const mode of ['pcm8', 'pcm16', 'adpcm']) {
		for (const shape of ['sine', 'triangle', 'saw', 'square']) {
			const { frames, ...sample } = makeNdsSample(mode, shape);
			assert.equal(frames, 64);
			assert.equal((sample.loopStartWords + sample.lengthWords) * 4, sample.bytes.length);
			if (mode === 'adpcm') assert.equal(sample.loopStartWords, 1);
			core.configure(0, { ...sample, mode, timer: ndsTimerForFrequency(440, frames).timer });
			core.keyOn(0);
			const left = new Float32Array(4096), right = new Float32Array(4096);
			core.render(left, right);
			assert(left.some((sample) => sample > .025));
			assert(left.some((sample) => sample < -.025));
		}
	}
});

test('DS Worklet tunes loaded samples and exposes zero-based physical channels', async () => {
	const { chip } = endpoint();
	const initial = await chip.getState();
	assert.equal(initial.length, 16);
	assert(initial.every((row, channel) => row.channel === channel && !row.active && row.mode === 'pcm16'));
	const pcm = await chip.noteOn(0, 'A4', { mode: 'adpcm', shape: 'triangle', loop: false });
	assert.equal(pcm.timer, ndsTimerForFrequency(440, 64).timer);
	assert.equal((await chip.getState(0)).shape, 'triangle');
	assert.equal((await chip.configure(0, { shape: 'square' })).loop, false);
	const pulse = await chip.noteOn(8, 69, { mode: 'pulse' });
	assert.equal(pulse.timer, ndsTimerForFrequency(440, 8).timer);
	const noise = await chip.noteOn(14, 69, { mode: 'noise' });
	assert.equal(noise.timer, ndsTimerForFrequency(440, 1).timer);
	await assert.rejects(chip.noteOn(0, 'C4', { mode: 'noise' }), /channels 14–15/);
	assert.equal((await chip.getState(0)).token, pcm.token);
	await assert.rejects(chip.setFrequency(0, undefined), /positive finite Hz/);
});

test('Imported sample pitch follows source rate and root independently of loop length', async () => {
	const { chip } = endpoint();
	const { bytes } = makeNdsSample('pcm16');
	const sound = { mode: 'pcm16', bytes, sampleRate: 32000, rootNote: 69, loopStartWords: 4, lengthWords: 13 };
	const root = await chip.noteOn(0, 'A4', sound);
	assert.equal(root.timer, ndsTimerForFrequency(32000, 1).timer);
	assert(Math.abs(root.frequencyHz - 440) < 1);
	const state = await chip.getState(0);
	assert.equal(state.sampleRate, 32000);
	assert.equal(state.rootNote, 69);
	assert.equal(state.loopStartWords, 4);
	assert.equal(state.lengthWords, 13);
	await chip.configure(0, { loopStartWords: 7, lengthWords: 5 });
	assert.equal((await chip.setNote(0, 'A5')).timer, ndsTimerForFrequency(64000, 1).timer);
	assert.equal((await chip.setFrequency(0, 220)).timer, ndsTimerForFrequency(16000, 1).timer);
	assert.equal((await chip.getState(0)).loopStartWords, 7);
	const raw = await chip.noteOn(0, 'A5', { timer: 0xc000 });
	assert.equal(raw.timer, 0xc000);
	assert.equal((await chip.keyOn(0)).timer, 0xc000);
	assert.equal((await chip.setFrequency(0, Number.MAX_VALUE)).timer, 65535);
	assert.equal((await chip.setFrequency(0, Number.MIN_VALUE)).timer, 0);

	await assert.rejects(chip.configure(0, { sampleRate: 44100 }), /rootNote together/);
	await assert.rejects(chip.configure(0, { rootNote: 'R4', sampleRate: 44100 }), /note name/);
	await assert.rejects(chip.configure(0, { rootNote: 'A4', sampleRate: 44100, frames: 32 }), /source tuning or a sample-cycle length/);
	assert.equal((await chip.getState(0)).sampleRate, 32000);
	await chip.configure(0, { bytes });
	assert.equal((await chip.getState(0)).rootNote, null);
	assert.equal((await chip.noteOn(0, 'A4')).timer, ndsTimerForFrequency(440, 64).timer);
	await chip.configure(0, { rootNote: 'A3', sampleRate: 44100 });
	assert.equal((await chip.getState(0)).rootNote, 'A3');
	await chip.configure(0, { shape: 'saw' });
	assert.equal((await chip.getState(0)).sampleRate, null);
	await assert.rejects(chip.configure(0, { rootNote: 'A3', sampleRate: 44100 }), /requires imported/);
});

test('Identical imported ADPCM retriggers reuse prepared bytes until the data or range changes', async () => {
	const { chip, worklet } = endpoint();
	const { bytes, loopStartWords, lengthWords } = makeNdsSample('adpcm');
	const sound = { mode: 'adpcm', bytes, loop: true, loopStartWords, lengthWords, rootNote: 'C4', sampleRate: 22050 };
	const configure = worklet.core.configure.bind(worklet.core);
	const updates = [];
	worklet.core.configure = (channel, patch) => {
		updates.push(Object.hasOwn(patch, 'bytes'));
		return configure(channel, patch);
	};
	await chip.noteOn(0, 'C4', sound);
	const transposed = await chip.noteOn(0, 'C5', sound);
	assert.equal(transposed.timer, ndsTimerForFrequency(44100, 1).timer);
	assert.deepEqual(updates, [true, false]);
	bytes[4] ^= 1;
	await chip.noteOn(0, 'C4', sound);
	await chip.noteOn(0, 'C4', { ...sound, loopStartWords: loopStartWords + 1, lengthWords: lengthWords - 1 });
	assert.equal((await chip.getState(0)).loopStartWords, loopStartWords + 1);
	const { loopStartWords: _start, lengthWords: _length, ...soundWithoutRange } = sound;
	await chip.noteOn(0, 'C4', soundWithoutRange);
	assert.deepEqual(updates, [true, false, true, true, true]);
	assert.equal((await chip.getState(0)).loopStartWords, loopStartWords);
});

test('DS owner-scoped releases and live edits cannot change a replaced voice', async () => {
	const { chip, worklet } = endpoint();
	const keyboard = chip.forOwner('keyboard'), code = chip.forOwner('code');
	assert.equal(chip.forOwner('code'), code);
	const original = await keyboard.noteOn(0, 'A4', { volume: 100 });
	assert(keyboard.owns(0, original.token));
	const [replacement, staleEdit] = await Promise.all([
		code.noteOn(0, 'C5', { volume: 80 }),
		keyboard.configureOwned(0, original.token, { volume: 23 }),
	]);
	assert.equal(staleEdit, false);
	assert.equal((await code.getState(0)).volume, 80);
	assert(!keyboard.owns(0, original.token));
	assert.equal(await keyboard.noteOff(0, original.token), false);
	assert.equal(await keyboard.stopOwned(), 0);
	assert(code.owns(0, replacement.token));
	const retrigger = await code.noteOn(0, 'A4', { volume: 96 });
	assert.equal(await code.noteOff(0, replacement.token), false);
	assert.equal(await code.noteOff(0, retrigger.token), true);
	assert.equal((await code.getState(0)).releasing, true);
	const left = new Float32Array(512), right = new Float32Array(512);
	worklet.process([], [[left, right]]);
	assert(left.some((value) => value !== 0));
	assert(left.slice(384).every((value) => value === 0));
	assert.equal((await code.getState(0)).active, false);
	const key = await code.keyOn(0);
	assert.equal(await code.keyOff(0, key.token), true);
	assert.equal((await code.getState(0)).active, false);
});
