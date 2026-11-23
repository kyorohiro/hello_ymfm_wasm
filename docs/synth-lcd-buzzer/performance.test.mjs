// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBuzzerVoice } from './performance.js';

function fixture(ensureAudio = async () => {}, getChip, voiceOptions = {}) {
	const sources = [], changes = [], output = {};
	const buffer = { length: 76, sampleRate: 32768 };
	const context = {
		currentTime: 0,
		sampleRate: 48000,
		createBufferSource() {
			const source = {
				playbackRate: { value: 1 }, connect() {},
				disconnect() { source.disconnected = true; },
				start(time) { source.started = time; },
				stop(time) { source.stopped = time; },
			};
			sources.push(source);
			return source;
		},
		createGain() {
			return {
				gain: { cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} },
				connect() {},
				disconnect() {},
			};
		},
	};
	const voice = createBuzzerVoice({
		ensureAudio,
		getChip,
		getOutput: chip => ({ chip, context, master: output }),
		prepareTone: () => ({ buffer }),
		onBeforeNote: () => {},
		onNoteChange: note => changes.push(note),
		...voiceOptions,
	});
	return { voice, sources, changes, context, buffer };
}

test('held notes play prepared chip buffers and replacing the gate preserves the newer owner', async () => {
	const { voice, sources, changes, context, buffer } = fixture();
	const code = Symbol('code'), keyboard = Symbol('keyboard');
	assert.equal(await voice.noteOn('A4', code), true);
	assert.equal(voice.getNote(), 69);
	assert.equal(sources[0].buffer, buffer);
	assert.equal(sources[0].loop, true);
	assert.equal(sources[0].playbackRate.value, 1);

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

test('an explicit chip takes ownership independently of the selected chip', async () => {
	let resume;
	const sounding = [], requests = [], prepared = [];
	const tone = { buffer: { length: 8 }, toneMode: 'dk52' };
	const { voice } = fixture(() => new Promise(resolve => { resume = resolve; }), () => 'sm511', {
		prepareTone(frequency, _context, note, chip, options) {
			prepared.push([frequency, note, chip, options]);
			return tone;
		},
		onRequestNote: chip => requests.push(chip),
		onNoteChange: (...args) => sounding.push(args),
	});
	const owner = Symbol('code');
	const start = voice.noteOn('A4', owner, { chip: 'sm510' });
	voice.cancelPending('sm511');
	resume();
	assert.equal(await start, true);
	voice.noteOff(owner);
	assert.deepEqual(requests, ['sm510']);
	assert.deepEqual(prepared, [[440, 69, 'sm510', { keyboard: false }]]);
	assert.deepEqual(sounding, [[69, 'sm510', 'dk52', tone], [null]]);
});

test('finite keyboard slots end naturally and retiring sources leave the current note active', async () => {
	const keyboard = Symbol('key'), code = Symbol('code');
	const contexts = [];
	const { voice, sources, changes } = fixture(undefined, () => 'sm511', {
		prepareTone(_frequency, _context, _note, _chip, options) {
			contexts.push(options);
			return { buffer: { length: 3000, sampleRate: 48000 }, loop: !options.keyboard };
		},
	});
	assert.equal(await voice.noteOn(60, keyboard, { keyboard: true }), true);
	assert.equal(sources[0].loop, false);
	assert.equal(await voice.retune('sm511'), true);
	assert.equal(sources[1].loop, false);
	sources[0].onended();
	assert.equal(sources[0].disconnected, true);
	assert.equal(voice.getNote(), 60);
	sources[1].onended();
	assert.equal(sources[1].disconnected, true);
	assert.equal(voice.isIdle(), true);
	voice.noteOff(keyboard);
	assert.equal(await voice.noteOn(64, code), true);
	assert.equal(sources[2].loop, true);
	assert.deepEqual(contexts, [{ keyboard: true }, { keyboard: true }, { keyboard: false }]);
	assert.deepEqual(changes, [60, 60, null, 64]);
});

test('retuning replaces the held tone without changing note ownership', async () => {
	const owner = Symbol('keyboard'), other = Symbol('code');
	const callbacks = [], prepared = [];
	let settings = { buffer: { length: 8 }, toneMode: 'dk52' };
	const { voice, sources, context } = fixture(undefined, () => 'sm510', {
		prepareTone(frequency, _context, note, chip) {
			prepared.push([frequency, note, chip]);
			return settings;
		},
		onRequestNote: chip => callbacks.push(['request', chip]),
		onBeforeNote: chip => { callbacks.push(['before', chip]); },
	});
	await voice.noteOn('A4', owner);
	settings = { buffer: { length: 32 }, toneMode: 'direct' };
	context.currentTime = .25;
	assert.equal(await voice.retune('sm510'), true);
	assert.deepEqual(prepared, [[440, 69, 'sm510'], [440, 69, 'sm510']]);
	assert.deepEqual(callbacks, [['request', 'sm510'], ['before', 'sm510']]);
	assert.equal(sources[0].stopped, sources[1].started);
	assert.equal(sources[1].buffer, settings.buffer);
	voice.noteOff(other);
	assert.equal(voice.getNote(), 69);
	voice.noteOff(owner);
	assert.equal(voice.getNote(), null);
});

test('switching the selected SM510 mask preserves a fixed Code note and its later retunes', async () => {
	const prepared = [];
	const { voice, sources, buffer } = fixture(undefined, () => 'sm510', {
		prepareTone(_frequency, _context, _note, _chip, options) {
			prepared.push(options.toneMode);
			return { buffer, toneMode: options.toneMode };
		},
	});
	await voice.noteOn('A4', Symbol('Code'), { chip: 'sm510', toneMode: 'direct' });
	assert.equal(await voice.retune('sm510', { followSelectionOnly: true }), false);
	assert.equal(sources.length, 1);
	assert.equal(await voice.retune('sm510'), true);
	assert.deepEqual(prepared, ['direct', 'direct']);

	await voice.noteOn('A4', Symbol('Keyboard'), { keyboard: true });
	assert.equal(await voice.retune('sm510', { followSelectionOnly: true }), true);
	assert.deepEqual(prepared, ['direct', 'direct', undefined, undefined]);
});

test('retune ignores other chips, pending notes, and preparations superseded or released', async () => {
	const owner = Symbol('keyboard'), other = Symbol('code');
	const preparations = [];
	let selected = 'sm510', defer = false;
	const tone = { buffer: { length: 8 } };
	const { voice, sources } = fixture(undefined, () => selected, {
		prepareTone: () => defer ? new Promise(resolve => preparations.push(resolve)) : tone,
	});
	await voice.noteOn(60, owner);
	selected = 'sm511';
	assert.equal(await voice.retune('sm510'), false);
	assert.equal(await voice.retune('sm511'), false);
	selected = 'sm510';
	defer = true;
	const first = voice.retune('sm510');
	const latest = voice.retune('sm510');
	preparations.shift()(tone);
	assert.equal(await first, false);
	preparations.shift()(tone);
	assert.equal(await latest, true);

	const obsolete = voice.retune('sm510');
	const next = voice.noteOn(64, other);
	assert.equal(await voice.retune('sm510'), false);
	voice.noteOff(other);
	preparations.shift()(tone);
	preparations.shift()(tone);
	assert.equal(await obsolete, false);
	assert.equal(await next, false);

	const released = voice.retune('sm510');
	voice.noteOff(owner);
	preparations.shift()(tone);
	assert.equal(await released, false);
	assert.equal(voice.getNote(), null);
	assert.equal(sources.length, 2);
});
