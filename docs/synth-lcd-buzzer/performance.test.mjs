// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBuzzerVoice } from './performance.js';

function fixture(ensureAudio = async () => {}, getChip, voiceOptions = {}) {
	const sources = [], changes = [], output = {};
	const context = {
		currentTime: 0,
		sampleRate: 48000,
		createBuffer(channels, length) {
			assert.equal(channels, 1);
			const data = new Float32Array(length);
			return { length, getChannelData: () => data };
		},
		createBufferSource() {
			const source = {
				playbackRate: {}, connect() {}, disconnect() {},
				start(time) { source.started = time; },
				stop(time) { source.stopped = time; },
			};
			sources.push(source);
			return source;
		},
		createGain() {
			return { gain: { cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} };
		},
	};
	const voice = createBuzzerVoice({
		ensureAudio,
		getChip,
		getOutput: chip => ({ chip, context, master: output }),
		onBeforeNote: () => {},
		onNoteChange: note => changes.push(note),
		...voiceOptions,
	});
	return { voice, sources, changes, context };
}

test('held notes use a two-level pulse and replacing the gate preserves the newer owner', async () => {
	const { voice, sources, changes, context } = fixture();
	const code = Symbol('code'), keyboard = Symbol('keyboard');
	assert.equal(await voice.noteOn('A4', code), true);
	assert.equal(voice.getNote(), 69);
	const waveform = sources[0].buffer;
	const level = Math.fround(.2);
	assert.deepEqual(new Set(waveform.getChannelData()), new Set([level, -level]));
	assert.equal(sources[0].loop, true);
	assert.equal(sources[0].playbackRate.value * context.sampleRate / waveform.length, 440);

	context.currentTime = .25;
	assert.equal(await voice.noteOn('D♯5', keyboard), true);
	assert.equal(voice.getNote(), 75);
	assert.equal(sources[0].stopped, sources[1].started);
	voice.noteOff(code);
	assert.equal(voice.getNote(), 75);
	assert.equal(sources[1].stopped, undefined);
	context.currentTime = .5;
	voice.noteOff(keyboard);
	assert.equal(voice.getNote(), null);
	assert.deepEqual(changes, [69, 75, null]);
	assert.equal(sources[1].stopped, .508);
});

test('releasing or stopping before audio resumes cancels the pending gate', async () => {
	const resume = [];
	const { voice, sources, changes } = fixture(() => new Promise(resolve => resume.push(resolve)));
	const owner = Symbol('key'), other = Symbol('code');
	const released = voice.noteOn(60, owner);
	voice.noteOff(owner);
	resume.shift()();
	assert.equal(await released, false);
	const superseded = voice.noteOn(60, owner);
	const stopped = voice.noteOn(64, other);
	voice.stopAll();
	for (const resolve of resume) resolve();
	assert.deepEqual(await Promise.all([superseded, stopped]), [false, false]);
	assert.deepEqual(sources, []);
	assert.deepEqual(changes, []);
});

test('a newer transport cancels a pending note only on its own chip', async () => {
	const resume = [];
	let selected = 'sm511';
	const { voice, sources } = fixture(() => new Promise(resolve => resume.push(resolve)), () => selected);
	const owner = Symbol('keyboard');
	const first = voice.noteOn(60, owner);
	selected = 'sm510';
	voice.cancelPending('sm510');
	resume.shift()();
	assert.equal(await first, true);
	const second = voice.noteOn(64, owner);
	voice.cancelPending('sm510');
	resume.shift()();
	assert.equal(await second, false);
	assert.equal(sources.length, 1);
	assert.equal(voice.getNote(), 60);
});

test('the note callback reports the mode of the prepared tone', async () => {
	const sounding = [];
	const { voice } = fixture(undefined, () => 'sm510', {
		prepareTone: (_frequency, context) => ({
			buffer: context.createBuffer(1, 8),
			toneMode: 'dk52',
		}),
		onNoteChange: (...args) => sounding.push(args),
	});
	const owner = Symbol('keyboard');
	assert.equal(await voice.noteOn('A4', owner), true);
	voice.noteOff(owner);
	assert.deepEqual(sounding, [[69, 'sm510', 'dk52'], [null]]);
});
