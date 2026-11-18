// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeScspSsfSnapshot, SCSP_SSF_SNAPSHOT_WORDS } from './ssf_snapshot.js';
import { describeScspSsfSlotRoutes, setupScspSsfSlotRoutesView } from './ssf_slot_routes_view.js';

function snapshot() {
	const words = new Uint32Array(SCSP_SSF_SNAPSHOT_WORDS);
	words[0] = 0x53534632;
	words[1] = 44100;
	const at = 16 + 31 * 32;
	words[at] = 16; // PCM8, with distinct observed activity and requested Gate.
	words[at + 6] = 0x200;
	words[at + 7] = (15 << 12) | (63 << 6) | 63;
	words[at + 10] = (15 << 3) | 7;
	words[at + 11] = (7 << 13) | (31 << 8) | (5 << 5) | 17;
	words[at + 18] = 3;
	words[at + 21] = 1;
	return decodeScspSsfSnapshot(words, new Uint8Array(512 * 1024));
}

test('physical CH32 retains two repeated raw stack references and separate configured output branches', () => {
	const value = snapshot(), before = structuredClone(value);
	const model = describeScspSsfSlotRoutes(value, { slot: 31, playback: 'paused' });
	assert(model.available);
	assert.equal(model.slot, 31);
	assert.equal(model.frame, 44100);
	assert.equal(model.playback, 'Paused');
	assert.deepEqual(model.references, [{ input: 'X', offset: 63 }, { input: 'Y', offset: 63 }]);
	assert.deepEqual(model.receiver, { sourceMode: 0, bits: 8, source: 'PCM8', depth: 15, modulationEnabled: true, writeInhibit: true });
	assert.deepEqual(model.outputs, { direct: { level: 7, pan: 31 }, dsp: { input: 15, send: 7 } });
	assert.deepEqual(model.activity, { requestedGate: false, runtimeActive: true, envelopePhase: 3, envelopePhaseLabel: 'Release' });
	assert.deepEqual(value, before, 'Describing routes never changes the captured machine');
	assert(Object.isFrozen(model) && Object.isFrozen(model.references) && Object.isFrozen(model.references[0]));
	assert(Object.isFrozen(model.outputs.direct) && Object.isFrozen(model.activity));
	value.slots[31].voice.modulation.xOffset = 7;
	value.slots[31].voice.directLevel = 1;
	assert.equal(model.references[0].offset, 63);
	assert.equal(model.outputs.direct.level, 7);
});

test('captured zero values remain available and renderer modulation switches only above MDL4', () => {
	const value = snapshot();
	let model = describeScspSsfSlotRoutes(value);
	assert(model.available);
	assert.equal(model.slot, 0);
	assert.equal(model.receiver.source, 'PCM16');
	assert.deepEqual(model.references, [{ input: 'X', offset: 0 }, { input: 'Y', offset: 0 }]);
	assert.deepEqual(model.outputs, { direct: { level: 0, pan: 0 }, dsp: { input: 0, send: 0 } });
	assert.deepEqual(model.activity, { requestedGate: false, runtimeActive: false, envelopePhase: 0, envelopePhaseLabel: 'Attack' });
	for (const depth of [0, 1, 4, 5, 15]) {
		value.slots[0].voice.modulation.depth = depth;
		model = describeScspSsfSlotRoutes(value);
		assert.equal(model.receiver.depth, depth, 'Configured MDL is retained even when bypassed');
		assert.equal(model.receiver.modulationEnabled, depth > 4);
	}
	value.slots[0].voice.modulation.xOffset = 63;
	value.slots[0].voice.modulation.yOffset = 0;
	assert.deepEqual(describeScspSsfSlotRoutes(value).references, [{ input: 'X', offset: 63 }, { input: 'Y', offset: 0 }]);
});

test('PCM formats, Noise, Zero and Reserved retain their source mode without inferring activity', () => {
	const value = snapshot(), slot = value.slots[0];
	for (const [mode, bits, label] of [[0, 8, 'PCM8'], [0, 16, 'PCM16'], [1, undefined, 'Noise'], [2, undefined, 'Zero'], [3, undefined, 'Reserved']]) {
		slot.sample.sourceMode = mode;
		slot.sample.bits = bits;
		slot.gate = true;
		slot.active = false;
		slot.envelopePhase = 1;
		const model = describeScspSsfSlotRoutes(value);
		assert(model.available);
		assert.equal(model.receiver.sourceMode, mode);
		assert.equal(model.receiver.source, label);
		assert.equal(model.activity.requestedGate, true);
		assert.equal(model.activity.runtimeActive, false);
		assert.equal(model.activity.envelopePhaseLabel, 'Decay 1');
	}
	slot.envelopePhase = 2;
	assert.equal(describeScspSsfSlotRoutes(value).activity.envelopePhaseLabel, 'Decay 2');
});

test('missing and invalid selected fields are unavailable instead of fabricated zero, false or a route', () => {
	const cases = [
		['X offset', slot => delete slot.voice.modulation.xOffset, model => model.references[0].offset],
		['Y offset', slot => { slot.voice.modulation.yOffset = 64; }, model => model.references[1].offset],
		['source', slot => { slot.sample.sourceMode = 4; }, model => model.receiver.sourceMode],
		['source', slot => { slot.sample.bits = 24; }, model => model.receiver.bits],
		['MDL', slot => { slot.voice.modulation.depth = -1; }, model => model.receiver.modulationEnabled],
		['MDL', slot => { slot.voice.modulation.depth = 16; }, model => model.receiver.depth],
		['STWINH', slot => { slot.voice.modulation.writeInhibit = 0; }, model => model.receiver.writeInhibit],
		['Direct level', slot => { slot.voice.directLevel = 8; }, model => model.outputs.direct.level],
		['Direct pan', slot => { slot.voice.pan = 32; }, model => model.outputs.direct.pan],
		['MIXS input', slot => { slot.dsp.input = 16; }, model => model.outputs.dsp.input],
		['IMXL send', slot => { slot.dsp.send = '0'; }, model => model.outputs.dsp.send],
		['Gate', slot => { slot.gate = 1; }, model => model.activity.requestedGate],
		['observed activity', slot => delete slot.active, model => model.activity.runtimeActive],
		['ENV phase', slot => { slot.envelopePhase = 4; }, model => model.activity.envelopePhase],
	];
	for (const [missing, change, read] of cases) {
		const value = snapshot();
		change(value.slots[0]);
		const model = describeScspSsfSlotRoutes(value);
		assert(!model.available, missing);
		assert(model.missing.includes(missing), missing);
		assert.equal(read(model), null, missing);
		assert.match(model.reason, /missing fields are unavailable/);
	}
	const value = snapshot();
	delete value.slots[0].voice;
	delete value.slots[0].dsp;
	const model = describeScspSsfSlotRoutes(value);
	assert.equal(model.references[0].offset, null);
	assert.equal(model.receiver.depth, null);
	assert.equal(model.outputs.direct.level, null);
	assert.equal(model.outputs.dsp.input, null);
	assert.equal(model.activity.requestedGate, false, 'Unrelated captured state is retained');
});

test('a valid frame and all 32 physical records are needed; missing snapshots never produce a zero route', () => {
	for (const frame of [undefined, null, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
		const value = snapshot();
		value.frame = frame;
		const model = describeScspSsfSlotRoutes(value);
		assert(!model.available);
		assert.equal(model.frame, null);
		assert.equal(model.references[0].offset, null);
		assert.match(model.reason, /frame unavailable/);
	}
	for (const mutate of [value => value.slots.pop(), value => delete value.slots[8], value => { value.slots[8] = null; }]) {
		const value = snapshot();
		mutate(value);
		const model = describeScspSsfSlotRoutes(value);
		assert(!model.available);
		assert.equal(model.outputs.direct.level, null);
		assert.match(model.reason, /32-slot SSF snapshot unavailable/);
	}
	for (const slot of [-1, 32, 1.5, '1', NaN]) {
		const model = describeScspSsfSlotRoutes(snapshot(), { slot });
		assert(!model.available);
		assert.equal(model.slot, null);
		assert.match(model.reason, /CH1–32/);
	}
	assert(!describeScspSsfSlotRoutes().available);
	const value = snapshot();
	value.frame = 0;
	assert(describeScspSsfSlotRoutes(value).available, 'Frame zero is a captured frame');
	assert.equal(describeScspSsfSlotRoutes(value, { playback: 'seeking' }).playback, 'Seeking');
	assert.equal(describeScspSsfSlotRoutes(value, { playback: 'other' }).playback, 'Live');
});

class Node extends EventTarget {
	constructor(doc, tag) {
		super();
		this.ownerDocument = doc;
		this.tagName = tag.toUpperCase();
		this.children = [];
		this.dataset = {};
		this.attributes = new Map();
		this.content = '';
		this.open = false;
	}
	set textContent(value) { this.content = value; this.ownerDocument.writes++; }
	get textContent() { return this.content; }
	append(...children) { this.children.push(...children); this.ownerDocument.writes++; }
	replaceChildren(...children) { this.children = children; this.ownerDocument.writes++; }
	setAttribute(name, value) { this.attributes.set(name, value); this.ownerDocument.writes++; }
	getAttribute(name) { return this.attributes.get(name) ?? null; }
	focus() { throw Error('Passive observation must preserve focus'); }
}
function fixture() {
	const doc = { writes: 0, createElement: tag => new Node(doc, tag) };
	Object.defineProperty(doc, 'activeElement', { get() { throw Error('Passive observation must not inspect focus'); } });
	const root = new Node(doc, 'section');
	const walk = node => [node, ...node.children.flatMap(walk)];
	const all = () => walk(root);
	const find = id => all().find(value => value.id === id);
	return { doc, root, all, find, view: setupScspSsfSlotRoutesView({ root }) };
}

test('read-only DOM has three ordered route stages, separate branches and scoped hooks', () => {
	const { root, view, all, find } = fixture();
	view.update(snapshot(), { slot: 31, playback: 'paused' });
	assert.deepEqual(root.dataset, { available: 'true', frame: '44100', slot: '31', playback: 'Paused' });
	assert.equal(find('scspSsfRouteBadge').textContent, 'Paused');
	assert.equal(find('scspSsfRouteSelected').textContent, 'CH32 · receiver');
	assert.equal(find('scspSsfRouteX').textContent, 'X · offset 63');
	assert.equal(find('scspSsfRouteY').textContent, 'Y · offset 63');
	assert.equal(find('scspSsfRouteSource').textContent, 'Source PCM8');
	assert.equal(find('scspSsfRouteDepth').textContent, 'MDL 15 · enabled');
	assert.equal(find('scspSsfRouteWrite').textContent, 'STWINH On · writes inhibited');
	assert.equal(find('scspSsfRouteDirect').textContent, 'Level 7 · Pan 31 · Left only');
	assert.equal(find('scspSsfRouteSend').textContent, 'MIXS15 · IMXL 7');
	assert.equal(find('scspSsfRouteActivity').textContent, 'Gate Off · Observed active · ENV Release');
	assert.deepEqual(find('scspSsfRouteDiagram').children.filter(value => value.className.includes('scsp-ssf-route-stage')).map(value => value.className), [
		'scsp-ssf-route-stage scsp-ssf-route-references', 'scsp-ssf-route-stage scsp-ssf-route-selected', 'scsp-ssf-route-stage scsp-ssf-route-outputs',
	]);
	assert.equal(find('scspSsfRouteDiagram').children[4].children.length, 2);
	assert(!all().some(value => ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'METER', 'PROGRESS'].includes(value.tagName)));
	assert(all().every(value => !value.id || value.id.startsWith('scspSsfRoute')));
	assert(all().every(value => !value.className || value.className.split(' ').every(name => name.startsWith('scsp-ssf-route-'))));
	const help = find('scspSsfRouteHelp');
	assert.equal(help.tagName, 'DETAILS');
	assert.equal(help.children[0].tagName, 'SUMMARY');
	assert.equal(help.children[0].textContent, '?');
	assert.match(help.children[0].getAttribute('aria-label'), /SSF routes/);
	assert.match(help.children[1].textContent, /not measured audio output.*Inactive does not mean a slot is free/);
	assert.match(help.children[1].textContent, /raw 0–63.*immediate CH producer.*renderer limitation.*exact return path is unavailable/);
	assert(!help.open, 'Detailed caveats begin behind native help');
});

test('polling, selection and unavailable transitions retain nodes, disclosure and focus', () => {
	const { root, doc, view, all, find } = fixture(), value = snapshot();
	view.update(value, { slot: 31 });
	const nodes = all();
	const help = find('scspSsfRouteHelp');
	help.open = true;
	const writes = doc.writes;
	view.update(structuredClone(value), { slot: 31 });
	assert.equal(doc.writes, writes, 'Identical polling does not rewrite DOM text');
	value.frame++;
	view.update(value, { slot: 0, playback: 'seeking' });
	assert.equal(root.dataset.playback, 'Seeking');
	assert.equal(find('scspSsfRouteDepth').textContent, 'MDL 0 · bypassed');
	assert.equal(find('scspSsfRouteWrite').textContent, 'STWINH Off · writes allowed');
	assert.equal(find('scspSsfRouteDirect').textContent, 'Level 0 · Pan 0 · Center');
	assert.equal(find('scspSsfRouteSend').textContent, 'MIXS0 · IMXL 0');
	delete value.slots[0].voice.modulation;
	view.update(value, { slot: 0, playback: 'paused' });
	assert.equal(root.dataset.available, 'false');
	assert.equal(find('scspSsfRouteX').textContent, 'X · offset Unavailable');
	assert.equal(find('scspSsfRouteDepth').textContent, 'MDL Unavailable');
	assert.equal(find('scspSsfRouteWrite').textContent, 'STWINH Unavailable');
	view.update(undefined);
	assert.equal(root.dataset.frame, '');
	assert.equal(find('scspSsfRouteSource').textContent, 'Source Unavailable');
	assert.equal(find('scspSsfRouteSend').textContent, 'MIXS Unavailable · IMXL Unavailable');
	assert.deepEqual(all(), nodes, 'Every node stays mounted across updates');
	assert(help.open, 'A native disclosure is never reset by polling');
});

test('pan labels preserve raw pan codes and disposal prevents later updates', () => {
	const { root, doc, view, find } = fixture(), value = snapshot();
	for (const [pan, label] of [[0, 'Center'], [16, 'Center'], [1, 'Right'], [15, 'Right only'], [17, 'Left'], [31, 'Left only']]) {
		value.slots[0].voice.pan = pan;
		view.update(value);
		assert.equal(find('scspSsfRouteDirect').textContent, `Level 0 · Pan ${pan} · ${label}`);
	}
	const writes = doc.writes, dataset = { ...root.dataset };
	view.dispose();
	view.dispose();
	value.frame++;
	view.update(value, { slot: 31 });
	assert.equal(doc.writes, writes);
	assert.deepEqual(root.dataset, dataset);
});

test('an older page without the route root can initialize and dispose safely', () => {
	for (const options of [undefined, {}, { root: null }, { root: {} }]) {
		const view = setupScspSsfSlotRoutesView(options);
		assert.doesNotThrow(() => { view.update(snapshot()); view.dispose(); view.update(); });
	}
});
