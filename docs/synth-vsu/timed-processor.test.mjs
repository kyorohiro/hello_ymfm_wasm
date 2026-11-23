// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildVsuOperations } from './timed-operations.js';
import { vsuStartWrites } from './vsu.js';

const rate = 48000;
const owner = 'test:entry';
let Processor;
globalThis.sampleRate = rate;
globalThis.AudioWorkletProcessor = class {
	messages = [];
	port = { postMessage: data => this.messages.push(data) };
};
globalThis.registerProcessor = (_name, constructor) => { Processor = constructor; };
await import('./worklet.js');
const wasmBinary = await readFile(new URL('./vsu.wasm', import.meta.url));

function setup() {
	globalThis.currentFrame = 0;
	const worklet = new Processor({ processorOptions: { wasmBinary } });
	assert.deepEqual(worklet.messages, [{ type: 'ready' }]);
	const send = data => worklet.port.onmessage({ data });
	let id = 0;
	return {
		send,
		request(action, fields = {}, expectedError) {
			send({ type: 'timed-request', id: ++id, request: { action, owner, ...fields } });
			const reply = worklet.messages.at(-1);
			assert.equal(reply.type, 'timed-response');
			assert.equal(reply.id, id);
			if (expectedError) assert.match(reply.error, expectedError);
			else assert.equal(reply.error, undefined);
			return reply.value;
		},
		write: (offset, value) => send({ type: 'write', offset, value }),
		batch: pairs => send({ type: 'batch', writes: pairs.flat() }),
		render(frames = 128) {
			const left = new Float32Array(frames), right = new Float32Array(frames);
			assert.equal(worklet.process([], [[left, right]]), true);
			currentFrame += frames;
			return left;
		},
	};
}

const audible = samples => samples.some(value => value !== 0);
const wave = Array(32).fill(63);
const configure = chip => chip.batch([...wave.map((sample, index) => [index * 4, sample]), [0x404, 0xf0], [0x410, 0xf0]]);
const plan = callback => buildVsuOperations(callback, { referenceSampleRate: rate });

test('the Worklet splits WASM rendering at exact frames for repeated raw writes', () => {
	const period = 179, on = 35, off = 90, frames = 512;
	const scheduled = setup();
	configure(scheduled);
	const receipt = scheduled.request('schedule', { plan: plan(b => {
		b.atSample(on).write(0x400, 0x80);
		b.atSample(off).write(0x400, 0);
	}), options: { name: 'pulse', repeatSeconds: period / rate } });
	assert.equal(receipt.startFrame, 128);
	assert.equal(receipt.sampleRate, rate);
	const mixed = new Float32Array(frames);
	for (let offset = 0; offset < frames; offset += 128) mixed.set(scheduled.render(), offset);
	assert.ok(audible(mixed.subarray(receipt.startFrame + on, receipt.startFrame + off)));
	const immediate = setup();
	configure(immediate);
	const expected = new Float32Array(frames);
	let cursor = 0;
	for (let start = receipt.startFrame; start + on < frames; start += period) {
		for (const [frame, value] of [[start + on, 0x80], [Math.min(start + off, frames), 0]]) {
			expected.set(immediate.render(frame - cursor), cursor);
			cursor = frame;
			immediate.write(0x400, value);
		}
	}
	if (cursor < frames) expected.set(immediate.render(frames - cursor), cursor);
	assert.deepEqual(mixed, expected);
});

test('stage validates without firing and commit atomically anchors a new manifest', () => {
	const chip = setup();
	configure(chip);
	const phrase = plan(b => b.write(0x400, 0x80));
	const args = [phrase, { name: 'held' }];
	const tx = { transactionId: 'apply-1' };
	const staged = chip.request('stage', { ...tx, method: 'schedule', args });
	assert.equal(staged.staged, true);
	assert.equal(staged.startFrame, undefined);
	assert.equal(audible(chip.render(256)), false);
	const receipt = chip.request('commit', tx);
	assert.equal(receipt.reservations[0].startFrame, 384);
	assert.equal(audible(chip.render()), false);
	assert.equal(audible(chip.render()), true);
	const update = { transactionId: 'apply-2' };
	chip.request('stage', { ...update, method: 'clearSchedule', args: ['held'] });
	chip.request('stage', { ...update, method: 'schedule', args: [phrase, { name: '' }] }, /name/);
	assert.equal(chip.request('abort', update), true);
	assert.equal(audible(chip.render()), true);
	chip.request('commit', { transactionId: 'apply-without-patterns' });
	assert.equal(audible(chip.render(256).subarray(20)), false);
});

test('timed gate-off and cancellation keep a newer manual key, and VGM retires Synth reservations', () => {
	const chip = setup();
	configure(chip);
	const phrase = plan(b => {
		b.write(0x400, 0x80);
		b.atSample(200).write(0x400, 0);
	});
	chip.request('schedule', { plan: phrase, options: { name: 'pulse', repeatSeconds: 0.05 } });
	chip.render();
	assert.equal(audible(chip.render()), true);
	chip.send({ type: 'synth-key-on', channel: 0, owner: 99, writes: [[0x400, 0], ...vsuStartWrites(0, 2047)].flat() });
	assert.equal(audible(chip.render(160).subarray(100)), true);
	assert.equal(chip.request('clear', { name: 'pulse' }), true);
	assert.equal(audible(chip.render()), true);
	chip.send({ type: 'live-note-off', source: 'synth', playbackId: null, channel: 0, owner: 99 });
	assert.equal(audible(chip.render(128).subarray(20)), false);
	chip.request('schedule', { plan: phrase, options: { name: 'pulse', repeatSeconds: 0.05 } });
	chip.send({ type: 'vgm-play', id: 1, mask: 63, plan: {
		writes: new Uint32Array(), durationTicks: 1000, loopTick: null, loopIndex: 0,
	} });
	chip.request('schedule', { plan: phrase, options: { name: 'pulse' } }, /Stop the VGM/);
	assert.equal(audible(chip.render(256)), false);
	chip.send({ type: 'vgm-stop', id: 1 });
	assert.equal(audible(chip.render(4096)), false);
});
