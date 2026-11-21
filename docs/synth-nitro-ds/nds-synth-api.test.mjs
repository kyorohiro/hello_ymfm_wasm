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
