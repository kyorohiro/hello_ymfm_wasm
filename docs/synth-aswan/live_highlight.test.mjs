// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultPreset } from './preset.js';
import { ASWAN_LIVE_PARAMETERS, createAswanLiveHighlighter } from './live_highlight.js';

function element(parentElement = null) {
	const classes = new Set(),
		listeners = new Map(),
		writes = [];
	const node = {
		dataset: {},
		parentElement,
		hidden: false,
		tagName: 'OUTPUT',
		classList: {
			add(name) {
				classes.add(name);
				writes.push(['add', name]);
			},
			remove(name) {
				classes.delete(name);
				writes.push(['remove', name]);
			},
			contains: (name) => classes.has(name),
		},
		addEventListener(name, callback) {
			listeners.set(name, callback);
		},
		removeEventListener(name, callback) {
			assert.equal(listeners.get(name), callback);
			listeners.delete(name);
		},
		finish() {
			listeners.get('animationend')?.({ target: node, animationName: 'synth-live-change' });
		},
		get offsetWidth() {
			assert.fail('Live highlighting must not force layout');
		},
		getBoundingClientRect() {
			assert.fail('Live highlighting must not measure layout');
		},
		writes,
		listeners,
	};
	return node;
}
function fixture({ enabled = true, parent } = {}) {
	const controls = Object.fromEntries(
		ASWAN_LIVE_PARAMETERS.map((name) => [name, element(parent)]),
	);
	const highlighter = createAswanLiveHighlighter({ controls, enabled });
	const highlighted = () =>
		Object.entries(controls)
			.filter(([, node]) => node.classList.contains('is-live-changed'))
			.map(([name]) => name);
	const finish = () => Object.values(controls).forEach((node) => node.finish());
	return { controls, highlighter, highlighted, finish };
}
const view = (preset, options = {}) => ({
	snapshot: { preset: structuredClone(preset), frame: 128 },
	channel: 'vgm1:0',
	physicalChannel: 0,
	waveKnown: true,
	unknownFields: [],
	following: true,
	paused: false,
	...options,
});

test('only actual scalar/wave changes pulse; unrelated shared hardware values stay quiet', () => {
	const f = fixture(),
		p = createDefaultPreset();
	f.highlighter.update(view(p));
	assert.deepEqual(f.highlighted(), []);
	p.left--;
	p.wave[4] = (p.wave[4] + 1) % 16;
	p.sweep.step = 12;
	p.noise.type = 3;
	f.highlighter.update(view(p));
	assert.deepEqual(f.highlighted(), ['wave', 'volumeLeft']);
	assert.equal(f.controls.wave.dataset.liveParameter, 'wave');
	for (let index = 0; index < 50; index++) {
		p.left = index % 16;
		f.highlighter.update(view(p));
	}
	assert.equal(
		f.controls.volumeLeft.writes.filter(([kind]) => kind === 'add').length,
		1,
		'rapid changes share one bounded CSS pulse',
	);
	f.finish();
	assert.deepEqual(f.highlighted(), []);
	f.highlighter.update(view(p));
	assert.deepEqual(f.highlighted(), [], 'fresh arrays with unchanged samples do not pulse');
	p.right--;
	f.highlighter.update(view(p));
	assert.deepEqual(f.highlighted(), ['volumeRight']);
	f.highlighter.dispose();
});

test('source changes pulse Source while newly shown controls baseline independently', () => {
	const f = fixture(),
		p = createDefaultPreset();
	f.highlighter.update(view(p, { channel: 'vgm1:3', physicalChannel: 3 }));
	p.source = 'noise';
	p.noise.type = 4;
	f.highlighter.update(view(p, { channel: 'vgm1:3', physicalChannel: 3 }));
	assert.deepEqual(f.highlighted(), ['source']);
	f.finish();
	p.noise.type = 5;
	f.highlighter.update(view(p, { channel: 'vgm1:3', physicalChannel: 3 }));
	assert.deepEqual(f.highlighted(), ['noiseType']);
	p.source = 'wave';
	p.wave.fill(1);
	f.highlighter.update(view(p, { channel: 'vgm1:3', physicalChannel: 3 }));
	assert.deepEqual(
		f.highlighted(),
		['source'],
		'old hidden Noise pulse clears; newly shown Wave is a baseline',
	);
	f.highlighter.dispose();
});

test('only CH3 observes Sweep enable, step and time; channel and session switches reset pulses', () => {
	const f = fixture(),
		p = createDefaultPreset();
	const selected = { channel: 'vgm1:2', physicalChannel: 2 };
	f.highlighter.update(view(p, selected));
	p.sweep = { enabled: true, step: 3, time: 2 };
	f.highlighter.update(view(p, selected));
	assert.deepEqual(f.highlighted(), ['sweepEnabled', 'sweepStep', 'sweepTime']);
	f.highlighter.update(view(p, { channel: 'vgm1:0', physicalChannel: 0 }));
	assert.deepEqual(f.highlighted(), []);
	f.highlighter.update(view(p, selected));
	assert.deepEqual(f.highlighted(), []);
	p.sweep.step = -3;
	f.highlighter.update(view(p, selected));
	assert.deepEqual(f.highlighted(), ['sweepStep']);
	f.highlighter.update(view(p, { ...selected, channel: 'vgm2:2' }));
	assert.deepEqual(f.highlighted(), []);
	f.highlighter.dispose();
});

test('unknown Wave and transient PCM never flash invented sample settings', () => {
	const f = fixture(),
		p = createDefaultPreset();
	f.highlighter.update(view(p, { unknownFields: ['source'] }));
	p.left--;
	f.highlighter.update(view(p, { unknownFields: ['source'] }));
	assert.deepEqual(
		f.highlighted(),
		[],
		'unknown mode cannot lend meaning to source-dependent defaults',
	);
	f.highlighter.update(view(p));
	p.wave.fill(2);
	f.highlighter.update(view(p, { waveKnown: false, unknownFields: ['wave'] }));
	assert.deepEqual(f.highlighted(), []);
	p.wave.fill(3);
	f.highlighter.update(view(p));
	assert.deepEqual(f.highlighted(), [], 'becoming known is a baseline');
	p.wave[2] = 4;
	f.highlighter.update(view(p));
	assert.deepEqual(f.highlighted(), ['wave']);
	f.finish();
	p.source = 'pcm';
	p.pcm.data = 'AAAA';
	const unknown = ['pcm.data', 'pcm.rootNote', 'pcm.sampleRate', 'pcm.loop'];
	f.highlighter.update(
		view(p, { physicalChannel: 1, channel: 'vgm1:1', unknownFields: unknown }),
	);
	p.pcm.rootNote++;
	p.pcm.sampleRate += 100;
	p.pcm.loop = !p.pcm.loop;
	p.left = 0;
	f.highlighter.update(
		view(p, { physicalChannel: 1, channel: 'vgm1:1', unknownFields: unknown }),
	);
	assert.deepEqual(f.highlighted(), []);
	const code = { physicalChannel: 1, channel: 'code1:1' };
	f.highlighter.update(view(p, code));
	p.pcm.rootNote++;
	p.pcm.sampleRate += 100;
	p.pcm.loop = !p.pcm.loop;
	p.left = 15;
	f.highlighter.update(view(p, code));
	assert.deepEqual(f.highlighted(), ['pcmLeftGain', 'pcmRootNote', 'pcmSampleRate', 'pcmLoop']);
	f.highlighter.dispose();
});

test('Pause, frozen view, frame zero and unavailable observation clear effects and rebaseline', () => {
	const f = fixture(),
		p = createDefaultPreset();
	for (const state of [
		{ paused: true },
		{ following: false },
		{ snapshot: { preset: p, frame: 0 } },
		null,
	]) {
		f.highlighter.update(view(p));
		p.left = (p.left + 1) % 16;
		f.highlighter.update(view(p));
		assert.deepEqual(f.highlighted(), ['volumeLeft']);
		f.highlighter.update(state === null ? null : view(p, state));
		assert.deepEqual(f.highlighted(), []);
		p.left = (p.left + 1) % 16;
		f.highlighter.update(view(p));
		assert.deepEqual(f.highlighted(), []);
	}
	f.highlighter.dispose();
});

test('Off reads no snapshot and does no comparison/DOM work; re-enable and disposal cleanly rebase', () => {
	const f = fixture(),
		p = createDefaultPreset();
	f.highlighter.update(view(p));
	p.left--;
	f.highlighter.update(view(p));
	f.highlighter.setEnabled(false);
	assert.deepEqual(f.highlighted(), []);
	const unreadable = new Proxy(
		{},
		{
			get() {
				assert.fail('Off must not inspect the view');
			},
		},
	);
	const writes = Object.values(f.controls).map((node) => node.writes.length);
	for (let index = 0; index < 100; index++) f.highlighter.update(unreadable);
	assert.deepEqual(
		Object.values(f.controls).map((node) => node.writes.length),
		writes,
	);
	f.highlighter.setEnabled(true);
	p.left--;
	f.highlighter.update(view(p));
	assert.deepEqual(f.highlighted(), []);
	p.left--;
	f.highlighter.update(view(p));
	assert.deepEqual(f.highlighted(), ['volumeLeft']);
	f.highlighter.dispose();
	assert.deepEqual(f.highlighted(), []);
	assert(Object.values(f.controls).every((node) => node.listeners.size === 0));
	f.highlighter.update(unreadable);
});

test('closed details and hidden panels clear pulses without layout reads or replay on reopen', () => {
	const panel = { tagName: 'SECTION', hidden: false, parentElement: null },
		details = { tagName: 'DETAILS', open: true, hidden: false, parentElement: panel };
	const f = fixture({ parent: details }),
		p = createDefaultPreset();
	f.highlighter.update(view(p));
	p.left--;
	f.highlighter.update(view(p));
	assert.deepEqual(f.highlighted(), ['volumeLeft']);
	details.open = false;
	p.left--;
	f.highlighter.update(view(p));
	assert.deepEqual(f.highlighted(), []);
	details.open = true;
	f.highlighter.update(view(p));
	assert.deepEqual(f.highlighted(), []);
	p.left--;
	f.highlighter.update(view(p));
	assert.deepEqual(f.highlighted(), ['volumeLeft']);
	panel.hidden = true;
	f.highlighter.update(view(p));
	assert.deepEqual(f.highlighted(), []);
	panel.hidden = false;
	f.highlighter.update(view(p));
	assert.deepEqual(f.highlighted(), []);
	f.highlighter.dispose();
});
