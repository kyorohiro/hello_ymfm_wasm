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
	const draw = get('draw');
	draw.dataset.ndsWaveTool = 'draw';
	get('ndsSampleEditor').querySelectorAll = () => [draw];
	const oldDocument = globalThis.document;
	globalThis.document = Object.assign(new EventTarget(), { getElementById: get });
	t.after(() => { globalThis.document = oldDocument; });
	let sound = initial, target = 0;
	const errors = [];
	const editor = setupNdsSampleEditor({ getSound: () => sound, getTarget: () => target,
		updateSound(next) { sound = next; editor.render(); }, onError: error => errors.push(error),
	});
	editor.render();
	draw.dispatchEvent(new Event('click'));
	return {
		get sound() { return sound; }, waveform, errors,
		replace(next) { sound = next; target++; editor.render(); },
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
