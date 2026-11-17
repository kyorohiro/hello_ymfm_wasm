// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceScspNumberControls } from './controls.js';

class Node extends EventTarget {
	constructor(tagName, ownerDocument) {
		super();
		this.tagName = tagName;
		this.ownerDocument = ownerDocument;
		this.children = [];
		this.dataset = {};
		this.attributes = new Map();
		this.className = '';
		this.classList = {
			contains: (name) => this.className.split(' ').includes(name),
			add: (name) => { this.className = [...new Set([...this.className.split(' '), name])].join(' '); },
			remove: (name) => { this.className = this.className.split(' ').filter(value => value !== name).join(' '); },
		};
	}
	append(...nodes) {
		for (const node of nodes) {
			if (node.parentElement)
				node.parentElement.children = node.parentElement.children.filter(child => child !== node);
			node.parentElement = this;
			this.children.push(node);
		}
	}
	before(node) {
		const index = this.parentElement.children.indexOf(this);
		node.parentElement = this.parentElement;
		this.parentElement.children.splice(index, 0, node);
	}
	closest(selector) {
		return this.classList.contains(selector.slice(1)) ? this : this.parentElement?.closest(selector);
	}
	setAttribute(name, value) { this.attributes.set(name, value); }
	getAttribute(name) { return this.attributes.get(name) ?? null; }
	setPointerCapture(id) { this.capturedPointer = id; }
	blur() { this.ownerDocument.activeElement = null; }
	querySelectorAll() {
		return this.children.flatMap(child => [
			...(child.tagName === 'input' ? [child] : []), ...child.querySelectorAll(),
		]);
	}
	fire(type, properties = {}) {
		const event = new Event(type, { cancelable: true });
		Object.assign(event, properties);
		this.dispatchEvent(event);
		return event;
	}
}

function rig(values = {}) {
	const observers = [];
	const doc = {
		createElement: tag => new Node(tag, doc),
		defaultView: {
			Event,
			MutationObserver: class {
				constructor(callback) { this.callback = callback; observers.push(this); }
				observe() {}
				disconnect() { this.disconnected = true; }
			},
		},
	};
	const root = new Node('div', doc), input = new Node('input', doc);
	Object.assign(input, { id: 'feedback', type: 'number', min: '-1', max: String(4095 / 4096),
		step: String(1 / 4096), value: '0', disabled: false, ...values });
	root.append(input);
	const changes = [];
	for (const type of ['input', 'change']) input.addEventListener(type, () => changes.push(type));
	const ui = enhanceScspNumberControls(root);
	const [minus, , plus] = input.parentElement.children;
	return { input, minus, plus, changes, ui, observers };
}

test('Q12 buttons preserve one coefficient step and both exact hardware limits', () => {
	const r = rig();
	try {
		r.plus.fire('click');
		assert.equal(r.input.value, String(1 / 4096));
		assert.equal(Math.floor(Number(r.input.value) * 4096), 1);
		assert.deepEqual(r.changes, ['input', 'change']);
		r.minus.fire('click');
		assert.equal(r.input.value, '0');
		r.minus.fire('click');
		assert.equal(r.input.value, String(-1 / 4096));
		r.input.value = String(4094 / 4096);
		r.plus.fire('click');
		assert.equal(r.input.value, String(4095 / 4096));
		assert.equal(r.plus.disabled, true);
		r.input.value = String(-4095 / 4096);
		r.minus.fire('click');
		assert.equal(r.input.value, '-1');
		assert.equal(r.minus.disabled, true);
	} finally { r.ui.dispose(); }
});

test('Q12 pointer dragging and arrow keys send precise changes through existing handlers', () => {
	const r = rig();
	try {
		const down = r.input.fire('pointerdown', { button: 0, pointerId: 7, clientX: 10 });
		assert.equal(down.defaultPrevented, true);
		assert.equal(r.input.capturedPointer, 7);
		assert.equal(r.input.classList.contains('is-dragging'), true);
		r.input.fire('pointermove', { pointerId: 7, clientX: 22 });
		assert.equal(r.input.value, String(2 / 4096));
		r.input.fire('pointermove', { pointerId: 7, clientX: 16 });
		assert.equal(r.input.value, String(1 / 4096));
		r.input.fire('pointerup', { pointerId: 7 });
		assert.equal(r.input.classList.contains('is-dragging'), false);
		const key = r.input.fire('keydown', { key: 'ArrowLeft' });
		assert.equal(key.defaultPrevented, true);
		assert.equal(r.input.value, '0');
		assert.deepEqual(r.changes, ['input', 'change', 'input', 'change', 'input', 'change']);
		r.input.value = String(4095 / 4096);
		r.input.fire('keydown', { key: 'ArrowRight' });
		assert.equal(r.input.value, String(4095 / 4096));
	} finally { r.ui.dispose(); }
});

test('decimal, scientific and integer controls retain their step precision and disposal', () => {
	for (const [values, expected] of [
		[{ min: '0', max: '1', step: '0.01', value: '0.29' }, '0.3'],
		[{ min: '0', max: '1', step: '1e-7' }, '1e-7'],
		[{ min: '0', max: '1', step: '1.25e-7' }, '1.25e-7'],
		[{ min: '-4096', max: '4095', step: '1', value: '4094' }, '4095'],
	]) {
		const r = rig(values);
		r.plus.fire('click');
		assert.equal(r.input.value, expected);
		r.ui.dispose();
		r.minus.fire('click');
		assert.equal(r.input.value, expected);
		assert.equal(r.observers[0].disconnected, true);
	}
	const boundary = rig({ min: '0', max: String(4095 / 4096), step: '0.01', value: '0.99' });
	try {
		boundary.plus.fire('click');
		assert.equal(boundary.input.value, String(4095 / 4096));
	} finally { boundary.ui.dispose(); }
});
