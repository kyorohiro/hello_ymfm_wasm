// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupScspChannelView } from './channel_view.js';

class Node {
	constructor() {
		this.children = [];
		this.dataset = {};
		this.attributes = new Map();
		this.events = new Map();
		this.style = {
			values: new Map(),
			setProperty(key, value) {
				this.values.set(key, value);
			},
		};
		this._text = '';
		this.textWrites = 0;
	}
	get textContent() {
		return this._text;
	}
	set textContent(value) {
		this._text = value;
		this.textWrites++;
	}
	append(child) {
		child.parentElement = this;
		this.children.push(child);
	}
	remove() {
		this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
	}
	setAttribute(key, value) {
		this.attributes.set(key, value);
	}
	getAttribute(key) {
		return this.attributes.get(key) ?? null;
	}
	addEventListener(key, callback) {
		this.events.set(key, callback);
	}
	removeEventListener(key) {
		this.events.delete(key);
	}
	fire(key, value) {
		return this.events.get(key)?.(value);
	}
	blur() {
		this.blurred = true;
	}
	focus() {
		this.focused = true;
	}
}
function rig() {
	const tabs = new Node(),
		summary = new Node(),
		legend = new Node(),
		changes = [];
	const doc = {
		getElementById: (id) => ({ scspChannelTabs: tabs, scspChannelSummary: summary, scspSsfSlotLegend: legend })[id],
		createElement: () => new Node(),
	};
	const ui = setupScspChannelView({ document: doc, onChange: (value) => changes.push(value) });
	return { ui, tabs, summary, legend, changes };
}
function state() {
	const slots = Array.from({ length: 32 }, (_, index) => ({
		gate: index === 6,
		sample: index < 7 ? { id: index + 1 } : null,
		directLevel: 0,
	}));
	return {
		slots,
		codeLanes: [
			{ channel: 0, groupId: 'code:1:0', slots: [6, 7] },
			{ channel: 31, groupId: null, slots: [] },
		],
	};
}

test('one Auto / 32-channel row changes only its selected target and supports quiet synchronization', () => {
	const r = rig();
	try {
		assert.equal(r.tabs.children.length, 33);
		assert.equal(r.ui.getSelected(), null);
		assert.equal(r.tabs.children[0].getAttribute('aria-selected'), 'true');
		r.tabs.children[7].fire('click');
		assert.equal(r.ui.getSelected(), 6);
		assert.deepEqual(r.changes, [6]);
		assert(r.tabs.children[7].blurred);
		r.tabs.children[7].fire('click');
		assert.deepEqual(r.changes, [6], 'selecting the same CH cannot reapply an instrument');
		assert.equal(r.ui.setSelected(31, { notify: false }), true);
		assert.deepEqual(r.changes, [6]);
		assert.equal(r.ui.setSelected(31), false);
		r.ui.setSelected(null);
		assert.deepEqual(r.changes, [6, null]);
		for (const invalid of [-1, 32, 0.5, 'auto', undefined])
			assert.throws(() => r.ui.setSelected(invalid), /physical SCSP/);
	} finally {
		r.ui.dispose();
	}
	assert.equal(r.tabs.children.length, 0);
});

test('authored requested gates show silent modulators and logical-Code to physical-slot mapping', () => {
	const r = rig(),
		value = state(),
		original = structuredClone(value);
	try {
		r.ui.update({ state: value });
		assert.equal(r.tabs.dataset.source, 'authored');
		assert.equal(r.tabs.children[7].dataset.active, 'true');
		assert.equal(r.tabs.children[7].dataset.gate, 'true');
		assert.match(r.summary.textContent, /Code CH1 → CH7–CH8/);
		r.ui.setSelected(6);
		assert.match(r.summary.textContent, /CH7 · physical slot/);
		assert.match(r.summary.textContent, /requested Gate On/);
		assert.match(r.summary.textContent, /Code CH1 → CH7–CH8/);
		r.ui.setSelected(31);
		assert.match(r.summary.textContent, /CH32 · physical slot · No PCM/);
		assert.deepEqual(value, original);
		assert.deepEqual(r.changes, [6, 31], 'state observation never selects a target');
		const writes = r.summary.textWrites;
		r.ui.update({ state: value });
		assert.equal(r.summary.textWrites, writes);
		assert(
			r.tabs.children.every((button) => button.textWrites === 1),
			'activity never replaces a button text node',
		);
	} finally {
		r.ui.dispose();
	}
});

test('SSF activity uses native Active separately from Gate and changes back to requested authored state', () => {
	const r = rig(),
		value = state();
	try {
		const snapshot = {
			slots: Array.from({ length: 32 }, (_, index) => ({
				active: index === 1,
				gate: false,
				envelopeLevel: index === 1 ? 0.5 : 0,
			})),
		};
		r.ui.setSelected(1);
		r.ui.update({ state: value, ssfSnapshot: snapshot, ssfActive: true });
		assert.equal(r.tabs.dataset.source, 'ssf');
		assert.equal(r.tabs.children[2].dataset.active, 'true');
		assert.equal(r.tabs.children[2].dataset.gate, 'false');
		assert.equal(r.tabs.children[2].style.values.get('--scsp-env'), '0.5');
		assert.match(r.summary.textContent, /SSF Live · CH2 · Active · Gate Off · ENV 50%/);
		r.ui.update({ state: value });
		assert.equal(r.tabs.dataset.source, 'authored');
		assert.equal(r.tabs.children[2].dataset.active, 'false');
		assert.equal(r.tabs.children[2].style.values.get('--scsp-env'), '0');
	} finally {
		r.ui.dispose();
	}
});

test('keyboard navigation selects a channel without sending musical arrow keys to the page', () => {
	const r = rig();
	try {
		let prevented = 0,
			stopped = 0;
		const event = (key) => ({
			key,
			preventDefault() {
				prevented++;
			},
			stopPropagation() {
				stopped++;
			},
		});
		r.tabs.children[0].fire('keydown', event('ArrowLeft'));
		assert.equal(r.ui.getSelected(), 31);
		assert(r.tabs.children[32].focused);
		r.tabs.children[32].fire('keydown', event('Home'));
		assert.equal(r.ui.getSelected(), null);
		assert.equal(prevented, 2);
		assert.equal(stopped, 2);
	} finally {
		r.ui.dispose();
	}
});

test('SSF overview labels Release by observed phase, not merely a low Gate, and never marks slots free', () => {
	const r = rig(), value = state();
	const snapshot = {
		slots: Array.from({ length: 32 }, () => ({active: false, gate: false, envelopeLevel: 0, envelopePhase: 3})),
	};
	// A key bit can change before the envelope follows it. Only native phase
	// identifies Release; ENV is an observed envelope value, not output volume.
	snapshot.slots[0] = {active: true, gate: false, envelopeLevel: 0.75, envelopePhase: 0};
	snapshot.slots[1] = {active: true, gate: true, envelopeLevel: 0.25, envelopePhase: 3};
	const before = structuredClone(snapshot);
	try {
		r.ui.update({state: value, ssfSnapshot: snapshot, ssfActive: true});
		assert.equal(r.legend.hidden, false);
		assert.equal(r.tabs.children[1].dataset.phase, 'attack');
		assert.equal(r.tabs.children[2].dataset.phase, 'release');
		assert.equal(r.tabs.children[3].dataset.phase, 'inactive');
		assert.equal(r.tabs.children[0].dataset.phase, '');
		assert.match(r.tabs.children[1].getAttribute('aria-label'), /CH1 · Active · Gate Off · Attack · ENV 75%/);
		r.ui.setSelected(1);
		assert.match(r.summary.textContent, /ENV 25% · Release/);
		assert.doesNotMatch(r.summary.textContent, /free|empty|A\/B|pair/i);
		assert.equal(r.tabs.children.length, 33);
		assert.deepEqual(snapshot, before);
		r.ui.update({state: value});
		assert.equal(r.legend.hidden, true);
		assert(r.tabs.children.every(button => button.dataset.phase === ''));
		assert.doesNotMatch(r.tabs.children[2].getAttribute('aria-label'), /Release|ENV/);
	} finally { r.ui.dispose(); }
});
