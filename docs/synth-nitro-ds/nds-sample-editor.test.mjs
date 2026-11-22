// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreNdsSound, setupNdsSampleEditor, snapshotNdsSound } from './nds-sample-editor.js';
import { makeNdsSample } from './nds-synth-api.js';

function editorFixture(t, initial) {
	const fields = new Map();
	const waveform = [];
	const get = id => {
		if (!fields.has(id)) fields.set(id, Object.assign(new EventTarget(), {
			dataset: {}, setAttribute() {}, blur() {}, width: 96, height: 80,
		}));
		return fields.get(id);
	};
	const canvas = get('ndsSampleCanvas');
	let pointer;
	Object.assign(canvas, {
		getContext: () => ({
			fillRect() {}, beginPath() {}, moveTo() {},
			lineTo(x, y) { waveform.push([x, y]); }, stroke() {},
		}),
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 96, height: 80 }),
		setPointerCapture(id) { pointer = id; },
		hasPointerCapture: id => pointer === id,
		releasePointerCapture() { pointer = undefined; },
	});
	const range = get('range'), draw = get('draw');
	range.dataset.ndsWaveTool = 'range';
	draw.dataset.ndsWaveTool = 'draw';
	get('ndsSampleEditor').querySelectorAll = () => [range, draw];
	const oldDocument = globalThis.document;
	globalThis.document = Object.assign(new EventTarget(), { getElementById: get });
	t.after(() => { globalThis.document = oldDocument; });
	const frames = new Map();
	let nextFrame = 0;
	const { requestAnimationFrame, cancelAnimationFrame } = globalThis;
	globalThis.requestAnimationFrame = callback => {
		frames.set(++nextFrame, callback);
		return nextFrame;
	};
	globalThis.cancelAnimationFrame = id => frames.delete(id);
	t.after(() => Object.assign(globalThis, { requestAnimationFrame, cancelAnimationFrame }));
	let sound = initial, target = 0;
	const errors = [], rangeChanges = [];
	const editor = setupNdsSampleEditor({ getSound: () => sound, getTarget: () => target,
		updateSound(next) { sound = next; editor.render(); }, onError: error => errors.push(error),
		onRangeChange: (target, asset, range) => rangeChanges.push({ target, asset, range }),
	});
	editor.render();
	draw.dispatchEvent(new Event('click'));
	return {
		get sound() { return sound; }, waveform, errors, rangeChanges, field: get,
		useRange() { range.dispatchEvent(new Event('click')); },
		setChannelView: editor.setChannelView,
		replace(next) { sound = next; target++; editor.render(); },
		tick() {
			for (const [id, callback] of [...frames]) {
				frames.delete(id);
				callback();
			}
		},
		pointer(type, x, y) {
			canvas.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
				button: 0, pointerId: 1, clientX: x, clientY: y,
			}));
		},
	};
}

const builtin = { mode: 'pcm16', shape: 'sine', volume: 96, pan: 64, divider: 0, duty: 3, loop: true, sample: null };

test('DS PCM editor previews a stroke and converts the built-in wave only on release', t => {
	const f = editorFixture(t, builtin);
	const pointsBefore = f.waveform.length;
	f.pointer('pointerdown', 0, 20);
	f.pointer('pointermove', 96, 60);
	assert.equal(f.sound.sample, null);
	assert(f.waveform.length > pointsBefore);
	f.pointer('pointerup', 96, 60);
	const { sample } = f.sound;
	assert.equal(sample.asset.frames, 64);
	assert.equal(sample.rootNote, 60);
	assert.equal(sample.range.loop, true);
	assert(sample.source[0] > .5 && sample.source.at(-1) < -.5);
	assert(sample.source[16] < sample.source[4], 'The editor interpolates skipped points');
	assert.deepEqual(f.errors, []);
});

test('DS PCM strokes retain each encoded format, byte count, tuning and loop markers', t => {
	const f = editorFixture(t, builtin);
	for (const mode of ['pcm8', 'pcm16', 'adpcm']) {
		const wave = makeNdsSample(mode, 'sine');
		const settings = { bytes: wave.bytes, sampleRate: 22050, rootNote: 53,
			loopStartWords: wave.loopStartWords + 1, lengthWords: wave.lengthWords - 2 };
		f.replace(restoreNdsSound({ ...builtin, mode, sample: settings }));
		f.pointer('pointerdown', 24, 76);
		f.pointer('pointermove', 48, 8);
		f.pointer('pointerup', 72, 76);
		const saved = snapshotNdsSound(f.sound);
		assert.equal(saved.mode, mode);
		assert.equal(saved.loop, true);
		assert.equal(saved.sample.bytes.length, settings.bytes.length);
		assert.notDeepEqual(saved.sample.bytes, settings.bytes);
		assert.deepEqual(saved.sample, { ...settings, bytes: saved.sample.bytes });
	}
	assert.deepEqual(f.errors, []);
});

test('DS PCM editor discards an unfinished gesture on cancellation or target change', t => {
	const f = editorFixture(t, builtin);
	f.pointer('pointerdown', 8, 60);
	f.pointer('pointercancel', 8, 60);
	f.pointer('pointerup', 80, 20);
	assert.equal(f.sound, builtin);
	f.pointer('pointerdown', 8, 60);
	const next = { ...builtin, shape: 'triangle' };
	f.replace(next);
	f.pointer('pointerup', 80, 20);
	assert.equal(f.sound, next);
	assert.deepEqual(f.errors, []);
});

test('DS Range previews the latest word-aligned point once per frame and commits it on release', t => {
	const wave = makeNdsSample('pcm16', 'sine');
	const preset = { ...builtin, sample: { ...wave, rootNote: 60, sampleRate: 32000,
		loopStartWords: 2, lengthWords: wave.lengthWords - 2 } };
	const original = restoreNdsSound(preset);
	const f = editorFixture(t, original);
	f.useRange();
	f.pointer('pointerdown', 96, 0);
	f.pointer('pointermove', 60, 0);
	f.pointer('pointermove', 72, 0);
	assert.equal(f.sound, original);
	assert.deepEqual(f.rangeChanges, []);
	f.tick();
	assert.equal(f.rangeChanges.length, 1);
	assert.equal(f.rangeChanges[0].range.endFrame, 48);
	assert.equal(f.sound, original);
	f.pointer('pointerup', 72, 0);
	assert.equal(f.sound.sample.asset, original.sample.asset);
	assert.deepEqual(f.rangeChanges.map(edit => edit.range), [f.sound.sample.range]);
	assert.equal(f.sound.sample.range.endFrame, 48);

	f.pointer('pointerdown', 72, 0);
	f.pointer('pointermove', 84, 0);
	f.tick();
	f.pointer('pointermove', 90, 0);
	f.pointer('pointercancel', 90, 0);
	f.tick();
	assert.deepEqual(f.rangeChanges.map(edit => edit.range.endFrame), [48, 56, 48]);
	assert.equal(f.sound.sample.range.endFrame, 48);

	f.pointer('pointerdown', 6, 0);
	f.pointer('pointermove', 18, 0);
	f.pointer('pointerup', 24, 0);
	f.tick();
	assert.equal(f.rangeChanges.length, 4, 'Only the final loop start applies when release comes before the next frame');
	assert.equal(f.sound.sample.range.startFrame, 16);
	assert.deepEqual(f.rangeChanges.at(-1).range, f.sound.sample.range);

	f.replace(restoreNdsSound({ ...preset, loop: false }));
	assert.equal(f.field('ndsSampleStart').disabled, true);
	const end = f.field('ndsSampleEnd');
	end.valueAsNumber = 40;
	end.dispatchEvent(new Event('change'));
	assert.equal(f.sound.sample.range.loopStartWords, 2);
	assert.equal(f.sound.sample.range.endFrame, 40);
	assert.deepEqual(f.rangeChanges.at(-1).range, f.sound.sample.range);
	assert.deepEqual(f.errors, []);
});

test('DS reference PCM shows bounded live peaks and the full paused sample', t => {
	const f = editorFixture(t, builtin);
	const state = { mode: 'pcm8', active: true, loop: true, byteLength: 64, loopStartWords: 0, lengthWords: 16 };
	f.setChannelView({ kind: 'reference', channel: 0, state, phase: 'Playing' });
	assert.equal(f.field('ndsSampleCanvas').hidden, true);
	assert.match(f.field('ndsSampleStatus').textContent, /64 PCM bytes.*Waiting for waveform data/);
	assert.equal(f.field('ndsSampleRangeFields').hidden, true);
	const waveform = { peaks: Float32Array.of(-.5, -.2, .25, .5), frameCount: 64, previewFrames: 32 };
	f.setChannelView({ kind: 'reference', channel: 0, state, waveform, phase: 'Playing' });
	assert.equal(f.field('ndsSampleCanvas').hidden, false);
	assert.match(f.field('ndsSampleStatus').textContent, /64 decoded frames.*First 32 frames shown/);
	const previewPoints = f.waveform.length;
	f.setChannelView({ kind: 'reference', channel: 0, state: { ...state, volume: 4 }, waveform, phase: 'Playing' });
	assert.equal(f.waveform.length, previewPoints);
	const preset = { ...builtin, ...state, sample: { ...makeNdsSample('pcm8', 'square'), sampleRate: 32000, rootNote: 60 } };
	f.setChannelView({ kind: 'reference', channel: 0, state, preset, phase: 'Paused' });
	assert.equal(f.field('ndsSampleCanvas').hidden, false);
	assert.match(f.field('ndsSampleStatus').textContent, /64 decoded frames.*64 PCM bytes/);
	const points = f.waveform.length;
	f.setChannelView({ kind: 'reference', channel: 0, state: { ...state, pan: 0 }, preset: { ...preset, pan: 0 }, phase: 'Paused' });
	assert.equal(f.waveform.length, points);
	f.pointer('pointerdown', 0, 20);
	f.pointer('pointerup', 96, 60);
	assert.equal(f.sound, builtin);
	f.setChannelView(null);
	assert.equal(f.field('ndsLoadWav').hidden, false);
	assert.equal(f.field('draw').hidden, false);
});
