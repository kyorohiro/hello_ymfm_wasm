// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupScspEnvelopeControls } from './scsp_envelope_controls.js';

class Node {
	constructor(tagName, doc) {
		this.tagName = tagName;
		this.ownerDocument = doc;
		this.children = [];
		this.dataset = {};
		this.events = new Map();
		this.attributes = new Map();
	}
	append(...children) {
		for (const child of children) {
			if (typeof child === 'object') child.parentElement = this;
			this.children.push(child);
		}
	}
	setAttribute(name, value) {
		this.attributes.set(name, value);
	}
	addEventListener(name, callback) {
		this.events.set(name, callback);
	}
	removeEventListener(name) {
		this.events.delete(name);
	}
	fire(name) {
		return this.events.get(name)?.();
	}
	closest(tag) {
		return this.tagName === tag ? this : this.parentElement?.closest(tag);
	}
	remove() {
		this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
	}
	blur() {
		this.blurred = true;
	}
	querySelector(selector) {
		const name = /\[data-chip-control="([^"]+)"\]/.exec(selector)?.[1];
		const walk = (node) =>
			node.dataset?.chipControl === name ? node : node.children?.map(walk).find(Boolean);
		return walk(this) ?? null;
	}
}
function rig(overrides = {}) {
	const doc = { createElement: (tag) => new Node(tag, doc) };
	const root = new Node('div', doc),
		envelope = new Node('fieldset', doc),
		attack = new Node('input', doc);
	attack.dataset.chipControl = 'scsp-attackRate';
	envelope.append(attack);
	root.append(envelope);
	const calls = [],
		errors = [];
	const ui = setupScspEnvelopeControls({
		root,
		invoke: async (...args) => calls.push(args),
		onError: (error) => errors.push(error),
		...overrides,
	});
	const input = root.querySelector('[data-chip-control="scsp-loopLink"]');
	return { root, envelope, input, ui, calls, errors };
}

test('hardware checkbox shares the Envelope fieldset and observes authored / read-only values', async () => {
	const r = rig();
	try {
		assert.equal(r.root.children.length, 1);
		assert.equal(r.input.closest('fieldset'), r.envelope);
		assert(r.input.disabled);
		r.ui.update({ voice: { envelope: {} } });
		assert.equal(r.input.checked, false);
		assert.equal(r.input.disabled, false);
		const live = { envelope: { loopLink: true } },
			original = structuredClone(live);
		r.ui.update({ voice: live, readOnly: true });
		assert.equal(r.input.checked, true);
		assert.equal(r.input.disabled, true);
		r.input.checked = false;
		await r.input.fire('change');
		assert.equal(r.input.checked, true);
		assert.deepEqual(live, original);
		assert.deepEqual(r.calls, []);
		r.ui.update({ voice: { envelope: { loopLink: false } } });
		assert.equal(r.input.checked, false);
		assert.equal(r.input.disabled, false);
	} finally {
		r.ui.dispose();
	}
});

test('editing sends the event-time source slot, waits for refresh and does not mutate input state', async () => {
	let selected = 2,
		resolve,
		r;
	r = rig({
		getSelectedSlot: () => selected,
		invoke: (...args) => {
			r.calls.push(args);
			return new Promise((done) => {
				resolve = done;
			});
		},
	});
	const voice = { envelope: { loopLink: false } };
	try {
		r.ui.update({ voice });
		r.input.checked = true;
		const changing = r.input.fire('change');
		assert.equal(r.input.disabled, true);
		assert.deepEqual(r.calls, [['setEnvelope', [2, { loopLink: true }]]]);
		assert.equal(voice.envelope.loopLink, false);
		selected = 3;
		r.ui.update({ voice: { envelope: { loopLink: true } } });
		resolve();
		await changing;
		assert.equal(r.input.checked, true);
		assert.equal(r.input.disabled, false);
		assert.equal(r.input.blurred, true);
	} finally {
		r.ui.dispose();
	}
});

test('failed mutation restores observed state and disposed pending work cannot change the view', async () => {
	const rejected = Error('Unsupported envelope');
	const r = rig({
		invoke: async () => {
			throw rejected;
		},
	});
	r.ui.update({ voice: { envelope: { loopLink: false } } });
	r.input.checked = true;
	await r.input.fire('change');
	assert.deepEqual(r.errors, [rejected]);
	assert.equal(r.input.checked, false);
	assert.equal(r.input.disabled, false);
	r.ui.dispose();
	assert.equal(r.envelope.children.length, 1);
	assert.equal(r.input.events.size, 0);
	let reject;
	const pending = rig({
		invoke: () =>
			new Promise((_done, failed) => {
				reject = failed;
			}),
	});
	pending.ui.update({ voice: { envelope: {} } });
	pending.input.checked = true;
	const work = pending.input.fire('change');
	pending.ui.dispose();
	reject(rejected);
	await work;
	assert.deepEqual(pending.errors, []);
});
