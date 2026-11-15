// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeScspSsfSnapshot, SCSP_SSF_SNAPSHOT_WORDS } from './ssf_snapshot.js';
import { projectScspSsfLiveSlot, setupScspSsfLiveView } from './ssf_live_view.js';

function snapshot() {
	const words = new Uint32Array(SCSP_SSF_SNAPSHOT_WORDS);
	words[0] = 0x53534632;
	words[1] = 640;
	const ram = new Uint8Array(524288);
	const view = new DataView(ram.buffer);
	for (let index = 0; index < 32; index++) {
		const at = 16 + index * 32;
		words[at] = 0x1820;
		words[at + 1] = 0x1000 + index * 128;
		words[at + 2] = 8;
		words[at + 3] = 64;
		words[at + 4] = 27 | (8 << 6) | (4 << 11);
		words[at + 5] = 9 | (7 << 5) | (15 << 10);
		words[at + 6] = 12 + index;
		words[at + 7] = (9 << 12) | (63 << 6) | 31;
		words[at + 9] = (20 << 10) | (2 << 8) | (3 << 5) | (1 << 3) | 4;
		words[at + 11] = (7 << 13) | (8 << 8);
		words[at + 16] = index === 0 ? 1 : 0;
		words[at + 17] = 300;
		words[at + 18] = index === 0 ? 1 : 3;
		words[at + 21] = index < 2 ? 1 : 0;
		words[at + 28] = index < 2 ? 300 : 1023;
		for (let frame = 0; frame < 64; frame++)
			view.setInt16(0x1000 + index * 128 + frame * 2, (frame - 32) * (index + 1), false);
	}
	return decodeScspSsfSnapshot(words, ram);
}

class Node {
	constructor(tag = 'div', text = '') {
		this.tagName = tag.toUpperCase();
		this.children = [];
		this._text = text;
		this.hidden = false;
		this.dataset = {};
		this.attributes = new Map();
		this.events = new Map();
		this.style = { setProperty() {} };
		this.value = '';
		this.checked = false;
		this.disabled = false;
		this.textWrites = 0;
	}
	get textContent() {
		return this._text + this.children.map((child) => child.textContent).join('');
	}
	set textContent(value) {
		this.textWrites++;
		this._text = value;
		this.children = [];
	}
	get firstChild() {
		return this.children[0] ?? null;
	}
	append(...nodes) {
		for (const node of nodes) {
			const child = typeof node === 'string' ? new Node('#text', node) : node;
			child.parentElement = this;
			this.children.push(child);
		}
	}
	setAttribute(name, value) {
		this.attributes.set(name, value);
	}
	getAttribute(name) {
		return this.attributes.get(name) ?? null;
	}
	addEventListener(type, callback) {
		this.events.set(type, callback);
	}
	removeEventListener(type) {
		this.events.delete(type);
	}
	fire(type) {
		return this.events.get(type)?.();
	}
	blur() {
		this.blurred = true;
	}
	remove() {
		this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
	}
	closest(tag) {
		let node = this;
		while (node && node.tagName.toLowerCase() !== tag) node = node.parentElement;
		return node ?? null;
	}
	querySelectorAll(selector) {
		const descendants = this.children.flatMap((child) => [
			child,
			...child.querySelectorAll(selector),
		]);
		return descendants.filter((node) => node.tagName.toLowerCase() === selector);
	}
	querySelector(selector) {
		if (selector === ':scope > p') return this.children.find((child) => child.tagName === 'P');
		const data = /\[data-chip-(control|action)="([^"]+)"\]/.exec(selector);
		if (data) {
			const key = data[1] === 'control' ? 'chipControl' : 'chipAction';
			const walk = (node) =>
				node.dataset[key] === data[2] ? node : node.children.map(walk).find(Boolean);
			return walk(this) ?? null;
		}
		return this.querySelectorAll(selector)[0] ?? null;
	}
}

function rig(options = {}) {
	const nodes = new Map(
		[
			'scspSsfLive',
			'scspSsfLiveEnabled',
			'scspSsfSlot',
			'scspSsfSlots',
			'scspSsfLiveStatus',
			'scspSsfReference',
			'scspSsfCapture',
			'scspSsfCaptureStatus',
			'scspDspTab',
			'scspSaveSoundAs',
		].map((id) => [id, new Node()]),
	);
	nodes.get('scspSsfLiveEnabled').checked = true;
	nodes.get('scspSaveSoundAs').disabled = true;
	if (options.externalSelection) {
		nodes.delete('scspSsfSlot');
		nodes.delete('scspSsfSlots');
	}
	const authorSections = [new Node(), new Node()];
	const doc = {
		getElementById: (id) => nodes.get(id),
		querySelectorAll: () => authorSections,
		createElement: (tag) => new Node(tag),
	};
	const panelRoot = new Node();
	const memory = new Node('p', 'Authored RAM');
	panelRoot.append(memory);
	const waveform = new Node('fieldset'),
		legend = new Node('legend', 'PCM waveform');
	const canvas = new Node('canvas');
	canvas.dataset.chipControl = 'scsp-waveform';
	canvas.width = 800;
	canvas.height = 180;
	let pixels = 77;
	const context = {
		getImageData: () => ({ pixels }),
		putImageData: (value) => {
			pixels = value.pixels;
		},
		clearRect() {
			pixels = 0;
		},
		beginPath() {},
		moveTo() {},
		lineTo() {},
		stroke() {
			pixels++;
		},
	};
	canvas.getContext = () => context;
	canvas.setAttribute('aria-label', 'Author waveform');
	waveform.append(legend, canvas);
	const shapes = new Node();
	const sine = new Node('button');
	sine.dataset.chipAction = 'scsp-sine';
	shapes.append(sine);
	const draftStatus = new Node('p', 'Unapplied PCM draft');
	draftStatus.setAttribute('role', 'status');
	waveform.append(draftStatus);
	const help = new Node('p', 'Software waveform editor · Draw and apply.');
	waveform.append(shapes, help);
	const inputs = new Map();
	for (const name of ['root', 'rate', 'loop', 'bits']) {
		const label = new Node('label'),
			input = new Node('input');
		input.dataset.chipControl = 'scsp-' + name;
		input.value = { root: '147', rate: '22050', loop: '7', bits: '8' }[name];
		label.append(name + ' ', input);
		waveform.append(label);
		inputs.set(name, input);
	}
	const filePanel = new Node('fieldset'),
		fileInput = new Node('input');
	fileInput.dataset.chipControl = 'scsp-audio-file';
	filePanel.append(fileInput);
	waveform.append(filePanel);
	const apply = new Node('button');
	apply.dataset.chipAction = 'scsp-apply';
	waveform.append(apply);
	const copy = new Node('button');
	copy.dataset.chipAction = 'scsp-copy';
	panelRoot.append(waveform, copy);
	const parameters = new Node('fieldset');
	const originals = new Map();
	for (const name of [
		'attackRate',
		'decay1Rate',
		'decay2Rate',
		'decayLevel',
		'releaseRate',
		'keyRateScaling',
		'lfo-frequencyCode',
		'lfo-pitchWave',
		'lfo-pitchDepth',
		'lfo-amplitudeWave',
		'lfo-amplitudeDepth',
		'lfo-reset',
		'totalLevel',
		'directLevel',
		'pan',
	]) {
		const node = new Node('input');
		node.dataset.chipControl = 'scsp-' + name;
		node.value = name === 'pan' ? '5' : '11';
		if (name === 'lfo-reset') node.type = 'checkbox';
		inputs.set(name, node);
		originals.set(node, { value: node.value, checked: node.checked });
		parameters.append(node);
	}
	panelRoot.append(parameters);
	const states = [],
		connections = [];
	const panel = {
		update: (state) => states.push(state),
		setConnected: (value) => {
			connections.push(value);
			for (const node of inputs.values()) node.disabled = !value;
			if (value)
				for (const [node, original] of originals) {
					node.value = original.value;
					node.checked = original.checked;
				}
		},
	};
	let changed = 0;
	const ui = setupScspSsfLiveView({
		panel,
		panelRoot,
		document: doc,
		onChange: () => changed++,
		...options,
	});
	return {
		ui,
		doc,
		nodes,
		panelRoot,
		authorSections,
		inputs,
		legend,
		canvas,
		shapes,
		filePanel,
		states,
		connections,
		get changed() {
			return changed;
		},
		get pixels() {
			return pixels;
		},
		draftStatus,
	};
}

const playing = {
	kind: 'ssf',
	loaded: true,
	playing: true,
	paused: false,
	playback: 'playing',
};

test('a physical slot projects hardware fields and a same-time bounded raw PCM prefix', () => {
	const source = snapshot();
	const before = structuredClone(source);
	const projected = projectScspSsfLiveSlot(source, 1);
	assert.equal(projected.read.voice.totalLevel, 13);
	assert.equal(projected.read.voice.envelope.attackRate, 27);
	assert.equal(projected.read.voice.lfo.frequencyCode, 20);
	assert.equal(projected.read.voice.modulation.xOffset, 63);
	assert.equal(projected.read.voice.frequencyHz, 44100);
	assert.equal(projected.read.pcm.length, 64);
	assert.deepEqual(Array.from(projected.read.pcm.subarray(0, 3)), [-64, -62, -60]);
	assert.deepEqual(source, before);
});

test('Live shows native activity and frozen slot selection in the existing read-only panel, then restores authoring', () => {
	const r = rig(),
		source = snapshot();
	try {
		assert.equal(r.nodes.get('scspSsfSlot').children.length, 32);
		assert.equal(r.nodes.get('scspSsfSlots').children.length, 32);
		assert.equal(r.ui.isEnabled(), true);
		assert.equal(r.ui.update(playing, source), true);
		assert.equal(r.panelRoot.dataset.ssfLive, 'true');
		assert.equal(r.panelRoot.dataset.ssfSlot, '0');
		assert.equal(r.inputs.get('root').value, '44100');
		assert.equal(r.pixels, 2);
		assert.equal(r.draftStatus.textContent, '');
		assert(r.nodes.get('scspDspTab').disabled);
		assert.deepEqual(r.connections, [false]);
		assert.equal(r.states.length, 0, 'Live projection never replaces the panel private draft');
		assert(r.authorSections.every((node) => node.hidden));
		assert.match(r.inputs.get('root').closest('label').textContent, /Playback rate/);
		assert(r.inputs.get('rate').closest('label').hidden);
		const buttons = r.nodes.get('scspSsfSlots').children;
		assert.equal(buttons[0].dataset.active, 'true');
		assert.equal(buttons[1].dataset.active, 'true');
		assert.equal(buttons[1].dataset.gate, 'false');
		assert.equal(buttons[2].dataset.active, 'false');
		r.ui.update({ ...playing, playing: false, paused: true, playback: 'paused' }, source);
		const select = r.nodes.get('scspSsfSlot');
		select.value = '1';
		select.fire('change');
		assert.equal(r.nodes.get('scspSsfLive').dataset.frame, '640');
		assert.equal(r.panelRoot.dataset.ssfSlot, '1');
		assert.equal(r.ui.getPCM().voice.totalLevel, 13);
		assert.match(r.nodes.get('scspSsfLiveStatus').textContent, /Paused · frozen · Slot 2/);
		assert.equal(r.changed, 1);
		const checkbox = r.nodes.get('scspSsfLiveEnabled');
		checkbox.checked = false;
		checkbox.fire('change');
		assert.equal(r.ui.isActive(), false);
		assert.equal(r.ui.isEnabled(), false);
		assert.deepEqual(r.connections, [false, true]);
		assert(r.authorSections.every((node) => !node.hidden));
		assert.equal(r.inputs.get('root').closest('label').firstChild.textContent, 'root ');
		assert.equal(r.canvas.getAttribute('aria-label'), 'Author waveform');
		assert.equal(r.legend.textContent, 'PCM waveform');
		assert.equal(r.inputs.get('root').value, '147');
		assert.equal(r.inputs.get('bits').value, '8');
		assert.equal(r.pixels, 77);
		assert.equal(r.draftStatus.textContent, 'Unapplied PCM draft');
		assert.equal(r.nodes.get('scspDspTab').disabled, false);
		assert.equal(r.nodes.get('scspSaveSoundAs').disabled, true);
		assert(buttons.every((button) => button.dataset.active === 'false'));
		assert.throws(() => r.ui.getPCM(), /No selected SSF/);
	} finally {
		r.ui.dispose();
	}
});

test('waiting snapshots, stopped playback and VGM keep the authored view available', () => {
	const r = rig(),
		source = snapshot();
	try {
		assert.equal(r.ui.update(playing, null), false);
		assert.match(r.nodes.get('scspSsfLiveStatus').textContent, /Waiting/);
		r.ui.update(playing, source);
		assert.equal(
			r.ui.update({ ...playing, playing: false, playback: 'stopped' }, source),
			false,
		);
		assert.equal(r.ui.update({ ...playing, kind: 'vgm' }, source), false);
		assert(r.nodes.get('scspSsfLive').hidden);
		assert.deepEqual(r.connections, [false, true]);
	} finally {
		r.ui.dispose();
	}
});

test('paused audition target follows slot and reference key without replacing the snapshot or draft', () => {
	const r = rig(),
		source = snapshot();
	const paused = {
		...playing,
		playing: false,
		paused: true,
		playback: 'paused',
	};
	try {
		assert.equal(r.ui.getAuditionTarget(), null);
		r.ui.update(playing, source);
		assert.equal(r.ui.getAuditionTarget(), null);
		assert.deepEqual(r.ui.getSelectedTarget(), {
			snapshot: source,
			slot: 0,
			referenceMidi: 60,
		});
		r.ui.update(paused, source);
		assert.equal(r.ui.getAuditionTarget().snapshot, source);
		r.nodes.get('scspSsfSlot').value = '1';
		r.nodes.get('scspSsfSlot').fire('change');
		r.nodes.get('scspSsfReference').value = '48';
		r.nodes.get('scspSsfReference').fire('change');
		assert.deepEqual(r.ui.getAuditionTarget(), {
			snapshot: source,
			slot: 1,
			referenceMidi: 48,
		});
		assert.equal(r.nodes.get('scspSsfLive').dataset.frame, '640');
		assert.match(
			r.nodes.get('scspSsfCaptureStatus').textContent,
			/Keyboard: selected SSF slot/,
		);
		assert.equal(r.changed, 2);
		assert.equal(r.states.length, 0);
		r.ui.setEnabled(false);
		assert.equal(r.ui.getAuditionTarget(), null);
		assert.equal(r.nodes.get('scspSsfCapture').disabled, true);
		r.ui.setEnabled(true);
		assert.equal(r.ui.getAuditionTarget().slot, 1);
		r.ui.update({ ...paused, playback: 'seeking' }, source);
		assert.equal(r.ui.getAuditionTarget(), null);
		assert.equal(r.ui.getSelectedTarget(), null);
	} finally {
		r.ui.dispose();
	}
});

test('Capture uses the clicked snapshot, prevents duplicate requests and preserves Live on failure', async () => {
	let resolveCapture,
		calls = [],
		unsupported = false;
	const r = rig({
		onCapture: (target) => {
			calls.push(target);
			return new Promise((resolve) => {
				resolveCapture = resolve;
			});
		},
		getCaptureAvailability: () => ({
			available: !unsupported,
			reason: unsupported ? 'Noise is not a PCM sample.' : '',
		}),
	});
	const source = snapshot(),
		button = r.nodes.get('scspSsfCapture');
	try {
		r.ui.update(playing, source);
		assert.equal(button.disabled, false);
		const work = button.fire('click');
		assert.equal(button.disabled, true);
		assert.equal(r.nodes.get('scspSsfReference').disabled, true);
		await button.fire('click');
		assert.equal(calls.length, 1);
		const newer = snapshot();
		newer.frame = 1280;
		r.ui.update(playing, newer);
		assert.equal(calls[0].snapshot, source);
		resolveCapture();
		await work;
		assert.equal(button.disabled, false);
		assert.equal(r.ui.isActive(), true, 'root owns the successful switch into authored Synth');
		unsupported = true;
		r.ui.update();
		assert.equal(button.disabled, true);
		assert.match(r.nodes.get('scspSsfCaptureStatus').textContent, /Noise/);
		assert.equal(r.ui.isActive(), true);
		assert.equal(r.states.length, 0);
	} finally {
		r.ui.dispose();
	}
	const failed = rig({
		onCapture: async () => {
			throw Error('Capture rejected; previous instrument kept.');
		},
	});
	try {
		failed.ui.update(playing, source);
		await failed.nodes.get('scspSsfCapture').fire('click');
		assert.match(failed.nodes.get('scspSsfCaptureStatus').textContent, /Capture rejected/);
		assert.equal(failed.ui.isActive(), true);
		assert.equal(failed.nodes.get('scspSsfCapture').disabled, false);
		assert.equal(failed.nodes.get('scspSsfLive').dataset.frame, '640');
	} finally {
		failed.ui.dispose();
	}
});

test('external channel selection needs no duplicate SSF chooser and preserves frozen targets', () => {
	const r = rig({ externalSelection: true }),
		source = snapshot();
	try {
		assert.equal(r.nodes.has('scspSsfSlot'), false);
		assert.equal(r.nodes.has('scspSsfSlots'), false);
		r.ui.update({ ...playing, playing: false, paused: true, playback: 'paused' }, source);
		assert.equal(r.ui.selectSlot(7), true);
		assert.equal(r.ui.getSelectedSlot(), 7);
		assert.equal(r.ui.getAuditionTarget().slot, 7);
		assert.equal(r.panelRoot.dataset.ssfSlot, '7');
		assert.equal(r.nodes.get('scspSsfLive').dataset.frame, '640');
		assert.match(r.nodes.get('scspSsfLiveStatus').textContent, /Paused · frozen · CH8/);
		assert.equal(r.changed, 0, 'root synchronization avoids recursive change notifications');
		assert.equal(r.ui.selectSlot(8, { notify: true }), true);
		assert.equal(r.changed, 1);
		assert.equal(r.ui.selectSlot(8, { notify: true }), false);
		assert.equal(r.changed, 1);
		for (const invalid of [-1, 32, 0.5, null])
			assert.throws(() => r.ui.selectSlot(invalid), /physical SSF/);
		assert.equal(r.ui.getSelectedSlot(), 8);
		r.ui.setEnabled(false);
		assert.equal(r.ui.getAuditionTarget(), null);
		assert.equal(r.ui.getSelectedSlot(), 8);
		assert.equal(r.inputs.get('root').value, '147');
		assert.equal(r.pixels, 77);
		r.ui.setEnabled(true);
		assert.equal(r.ui.getAuditionTarget().slot, 8);
		assert.equal(r.states.length, 0);
	} finally {
		r.ui.dispose();
	}
});

test('periodic Live updates retain the unchanged Capture button child text during pointer gestures', () => {
	const r = rig({ onCapture: async () => {} }),
		source = snapshot();
	try {
		r.ui.update(playing, source);
		const button = r.nodes.get('scspSsfCapture'),
			writes = button.textWrites;
		assert.equal(button.textContent, 'Capture to Synth');
		for (let tick = 0; tick < 8; tick++) r.ui.update(playing, source);
		assert.equal(
			button.textWrites,
			writes,
			'unchanged text must not be replaced between trusted down/up',
		);
	} finally {
		r.ui.dispose();
	}
});

test('eligible paused audition enables only parameters and projects its draft without changing snapshot PCM or authoring', () => {
	const source = snapshot(),
		original = structuredClone(source);
	const edited = structuredClone(source.slots[0].voice);
	edited.envelope = { ...edited.envelope, attackRate: 15, loopLink: true };
	edited.lfo = { ...edited.lfo, pitchDepth: 6 };
	edited.totalLevel = 42;
	edited.pan = 7;
	// Only audition parameters may be projected, even if a caller returns more.
	edited.frequencyHz = 123;
	edited.modulation = { depth: 15 };
	const r = rig({ getAuditionEditState: () => ({ voice: edited, edited: true, pending: true }) });
	const paused = { ...playing, playing: false, paused: true, playback: 'paused' };
	try {
		r.ui.update(playing, source);
		assert.equal(r.ui.isEditable(), false);
		assert.equal(r.inputs.get('attackRate').disabled, true);
		r.ui.update(paused, source);
		assert.equal(r.ui.isEditable(), true);
		assert.deepEqual(r.ui.getEditableTarget(), {
			snapshot: source,
			slot: 0,
			referenceMidi: 60,
		});
		assert.equal(r.nodes.get('scspSsfLive').dataset.editable, 'true');
		assert.equal(r.nodes.get('scspSsfLive').dataset.edited, 'true');
		assert.equal(r.panelRoot.dataset.ssfEditable, 'true');
		for (const name of [
			'attackRate',
			'releaseRate',
			'keyRateScaling',
			'lfo-frequencyCode',
			'lfo-reset',
			'totalLevel',
			'directLevel',
			'pan',
		])
			assert.equal(
				r.inputs.get(name).disabled,
				false,
				name + ' remains editable while pending',
			);
		for (const name of ['root', 'rate', 'loop', 'bits'])
			assert.equal(r.inputs.get(name).disabled, true, name);
		assert.equal(r.inputs.get('attackRate').value, '15');
		assert.equal(r.inputs.get('lfo-pitchDepth').value, '6');
		assert.equal(r.inputs.get('pan').value, '7');
		assert.equal(r.ui.getPCM().voice.envelope.loopLink, true);
		assert.equal(r.ui.getPCM().voice.frequencyHz, source.slots[0].voice.frequencyHz);
		assert.deepEqual(r.ui.getPCM().voice.modulation, source.slots[0].voice.modulation);
		assert.equal(r.ui.getPCM().sample, source.slots[0].sample);
		assert.deepEqual(r.ui.getPCM().pcm, projectScspSsfLiveSlot(source, 0).read.pcm);
		assert.match(
			r.nodes.get('scspSsfLiveStatus').textContent,
			/audition parameters edited · source frozen/,
		);
		assert.match(r.nodes.get('scspSsfCaptureStatus').textContent, /Updating/);
		assert.deepEqual(source, original);
		assert.equal(r.states.length, 0);
		r.ui.update(playing, source);
		assert.equal(r.ui.isEditable(), false);
		assert.equal(r.ui.getEditableTarget(), null);
		assert.equal(r.inputs.get('pan').disabled, true);
		assert.equal(r.ui.getPCM().voice.pan, source.slots[0].voice.pan);
		r.ui.update(paused, source);
		r.ui.setEnabled(false);
		assert.equal(r.ui.isEditable(), false);
		assert.equal(r.inputs.get('pan').value, '5');
		assert.equal(r.inputs.get('root').value, '147');
		assert.equal(r.pixels, 77);
		assert.deepEqual(r.connections, [false, true]);
	} finally {
		r.ui.dispose();
	}
});

test('unsupported and seeking slots stay read-only, and focused / dragged paused values are not overwritten', () => {
	let allowed = true,
		reads = 0;
	const source = snapshot(),
		voice = structuredClone(source.slots[0].voice);
	voice.pan = 9;
	voice.envelope.attackRate = 20;
	const r = rig({
		getCaptureAvailability: () => ({
			available: allowed,
			reason: allowed ? '' : 'Noise cannot be independently captured.',
		}),
		getAuditionEditState: () => {
			reads++;
			return { voice, edited: true };
		},
	});
	const paused = { ...playing, playing: false, paused: true, playback: 'paused' };
	try {
		r.ui.update(paused, source);
		const pan = r.inputs.get('pan'),
			attack = r.inputs.get('attackRate');
		pan.value = '13';
		r.doc.activeElement = pan;
		attack.value = '29';
		attack.classList = { contains: (value) => value === 'is-dragging' };
		r.ui.update(paused, source);
		assert.equal(pan.value, '13');
		assert.equal(attack.value, '29');
		r.doc.activeElement = null;
		attack.classList = { contains: () => false };
		r.ui.update(paused, source);
		assert.equal(pan.value, '9');
		assert.equal(attack.value, '20');
		allowed = false;
		const before = reads;
		r.ui.update(paused, source);
		assert.equal(reads, before);
		assert.equal(r.ui.isEditable(), false);
		assert.equal(pan.disabled, true);
		assert.equal(pan.value, String(source.slots[0].voice.pan));
		assert.match(r.nodes.get('scspSsfCaptureStatus').textContent, /Noise/);
		allowed = true;
		r.ui.update({ ...paused, playback: 'seeking' }, source);
		assert.equal(r.ui.getEditableTarget(), null);
		assert.equal(pan.disabled, true);
		assert.equal(reads, before);
	} finally {
		r.ui.dispose();
	}
});

test('host edit eligibility can allow playing Noise independently from Capture support, but never seeking', () => {
	const source = snapshot();
	source.slots[0].sample.sourceMode = 1;
	const original = structuredClone(source),
		checks = [];
	const voice = structuredClone(source.slots[0].voice);
	voice.totalLevel = 52;
	let editState = { voice, edited: true, pending: true };
	const r = rig({
		onCapture: async () => {},
		getCaptureAvailability: () => ({
			available: false,
			reason: 'Noise cannot be independently captured.',
		}),
		getEditAvailability: (target, state) => {
			checks.push({ target, state });
			return { available: true };
		},
		getAuditionEditState: () => editState,
	});
	try {
		r.ui.update(playing, source);
		assert.equal(r.ui.isEditable(), true);
		assert.equal(r.ui.getEditableTarget().snapshot, source);
		assert.equal(r.inputs.get('totalLevel').disabled, false);
		assert.equal(r.inputs.get('totalLevel').value, '52');
		assert.equal(r.panelRoot.dataset.ssfEditing, 'true');
		assert.equal(r.panelRoot.dataset.ssfEdited, 'true');
		assert.match(r.nodes.get('scspSsfLiveStatus').textContent, /Live .* editable parameters$/);
		assert.doesNotMatch(
			r.nodes.get('scspSsfLiveStatus').textContent,
			/audition parameters|source frozen/,
		);
		assert.equal(r.inputs.get('bits').disabled, true);
		assert.equal(r.nodes.get('scspSsfCapture').disabled, true);
		assert.match(r.nodes.get('scspSsfCaptureStatus').textContent, /Noise/);
		assert.equal(r.ui.getPCM().pcm.length, 0);
		assert.equal(checks[0].state, playing);
		const later = structuredClone(source);
		later.frame += 128;
		later.slots[0].voice.totalLevel = 31;
		editState = { voice: later.slots[0].voice, edited: false, pending: false };
		r.ui.update(playing, later);
		assert.equal(
			r.inputs.get('totalLevel').value,
			'31',
			'new driver state replaces the completed manual overlay',
		);
		assert.equal(r.panelRoot.dataset.ssfEdited, 'false');
		r.ui.update({ ...playing, playing: false, paused: true, playback: 'paused' }, later);
		assert.equal(r.ui.isEditable(), true);
		assert.match(
			r.nodes.get('scspSsfLiveStatus').textContent,
			/Paused .* editable parameters$/,
		);
		const count = checks.length;
		r.ui.update({ ...playing, playback: 'seeking' }, source);
		assert.equal(r.ui.getEditableTarget(), null);
		assert.equal(r.inputs.get('totalLevel').disabled, true);
		assert.equal(checks.length, count);
		assert.equal(r.panelRoot.dataset.ssfEditing, 'false');
		assert.equal(r.panelRoot.dataset.ssfEdited, 'false');
		assert.deepEqual(source, original);
	} finally {
		r.ui.dispose();
	}
});
