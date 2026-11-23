// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createVgmSeekRenderer } from './vgm-seek.js';
import { buildVsuOperations } from './timed-operations.js';
import { createVsuClient, vsuFrequencyRegister, vsuNoteOnWrites, vsuStartWrites } from './vsu.js';

const rate = 48000;
const quantum = 128;
globalThis.sampleRate = rate;
globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class {
	messages = [];
	port = { postMessage: data => this.messages.push(data) };
};
let Processor;
globalThis.registerProcessor = (name, constructor) => {
	assert.equal(name, 'tetorica-vsu');
	Processor = constructor;
};
await import('./worklet.js');

const wasmBinary = await readFile(new URL('./vsu.wasm', import.meta.url));
const outputs = [[new Float32Array(quantum), new Float32Array(quantum)]];

function setup() {
	const processor = new Processor({ processorOptions: { wasmBinary } });
	assert.deepEqual(processor.messages, [{ type: 'ready' }]);
	currentFrame = 0;
	return {
		send: data => processor.port.onmessage({ data }),
		render(quanta = 1) {
			for (let index = 0; index < quanta; ++index) {
				assert.equal(processor.process([], outputs), true);
				currentFrame += quantum;
			}
		},
		live: () => processor.messages.filter(message => message.type === 'live-state'),
		envelopes: () => processor.messages.filter(message => message.type === 'envelope-state'),
		captures: () => processor.messages.filter(message => message.type === 'vgm-capture'),
		codeWave: () => processor.messages.filter(message => message.type === 'code-wave-state'),
	};
}

function liveKeyboard(send, source, playbackId, channel = 0, revision = 1) {
	return {
		on: (owner, note) => send({ type: 'live-note-on', source, playbackId, channel, revision, owner, writes: vsuNoteOnWrites(channel, note) }),
		off: owner => send({ type: 'live-note-off', source, playbackId, channel, owner }),
	};
}

test('envelope telemetry includes idle registers and follows physical gates and the output source', () => {
	const { send, render, envelopes } = setup();
	const idle = { ev0: 0, ev1: 0, level: 0, active: false };
	const latest = () => envelopes().at(-1).states;
	send({ type: 'batch', writes: [
		0x410, 0xf0, 0x414, 1, 0x400, 0x80,
		0x510, 0x70, 0x514, 0x60, 0x500, 0x80,
	] });
	send({ type: 'channel-gain', channel: 0, gain: 0 });
	render();
	assert.deepEqual(envelopes(), []);
	send({ type: 'envelope-watch', enabled: true, revision: 1 });
	render();
	const first = envelopes().at(-1);
	assert.deepEqual(first, { type: 'envelope-state', playbackId: null, revision: 1,
		states: [{ ev0: 0xf0, ev1: 1, level: 15, active: true }, idle, idle, idle,
			{ ev0: 0x70, ev1: 0, level: 7, active: true }, idle] });
	send({ type: 'batch', writes: [0x450, 0xa9, 0x454, 0x42] });
	render(8);
	const configured = { ev0: 0xa9, ev1: 2, level: 10, active: false };
	assert.deepEqual(latest()[1], configured);
	assert.deepEqual(first.states[1], idle);
	render(95);
	assert.deepEqual(latest()[0], { ev0: 0xf0, ev1: 1, level: 0, active: true });
	send({ type: 'batch', writes: [0x400, 0, 0x500, 0] });
	render(8);
	const stopped = [{ ev0: 0xf0, ev1: 1, level: 0, active: false }, configured, idle, idle,
		{ ev0: 0x70, ev1: 0, level: 7, active: false }, idle];
	assert.deepEqual(latest(), stopped);
	const unchanged = envelopes().length;
	render(16);
	assert.equal(envelopes().length, unchanged);

	send({ type: 'vgm-play', id: 8, mask: 63, plan: {
		writes: new Uint32Array([0, 0x450, 0x90, 0, 0x440, 0x80]), durationTicks: 8000, loopTick: null, loopIndex: 0,
	} });
	render(8);
	assert.deepEqual(envelopes().at(-1), { type: 'envelope-state', playbackId: 8, revision: 1,
		states: [idle, { ev0: 0x90, ev1: 0, level: 9, active: true }, idle, idle, idle, idle] });
	send({ type: 'envelope-watch', enabled: false, revision: 2 });
	const count = envelopes().length;
	send({ type: 'vgm-stop', id: 8 });
	render(8);
	assert.equal(envelopes().length, count);
	send({ type: 'envelope-watch', enabled: true, revision: 3 });
	render();
	assert.deepEqual(envelopes().at(-1), { type: 'envelope-state', playbackId: null, revision: 3,
		states: stopped });
});

test('Code monitoring reports configuration and the advancing envelope and pitch for one selected voice', () => {
	const { send, render, live } = setup();
	render(32);
	assert.deepEqual(live(), []);
	send({ type: 'batch', writes: [
		0, 41, 0x518, 0, 0x504, 0x24, 0x508, 0xb0, 0x50c, 4, 0x510, 0xd0, 0x514, 0x51, 0x51c, 0x10,
		...Array.from({ length: 32 }, (_, cell) => [0x280 + cell * 4, 0xe0]).flat(),
		0x500, 0x80,
	] });
	send({ type: 'live-watch', channel: 4, revision: 1 });
	render();
	const first = live().at(-1);
	assert.equal(first.source, 'synth');
	assert.equal(first.channel, 4);
	assert.equal(first.playbackId, null);
	assert.equal(first.revision, 1);
	assert.equal(first.voice.active, true);
	assert.deepEqual([first.voice.left, first.voice.right], [2, 4]);
	assert.equal(first.voice.frequency, 1200);
	assert.equal(first.voice.workingFrequency, 1168);
	assert.equal(first.voice.currentEnvelope, 13);
	assert.equal(first.voice.wave[0], 41);
	assert.equal(first.voice.modulation[0], -32);

	render(3);
	assert.equal(live().length, 1);
	render(15);
	assert.equal(live().length, 2);
	assert.ok(live().at(-1).voice.currentEnvelope < 13);
	send({ type: 'write', offset: 0x518, value: 7 });
	send({ type: 'live-watch', channel: 4, revision: 2 });
	render();
	assert.equal(live().at(-1).voice.waveBank, 7);
	assert.equal(live().at(-1).voice.wave, null);
	send({ type: 'live-watch', channel: null, revision: 3 });
	render(32);
	assert.equal(live().length, 3);
});

test('reference monitoring follows VGM playback identities and freezes the exact paused state', () => {
	const { send, render, live } = setup();
	send({ type: 'write', offset: 0x404, value: 0x14 });
	send({ type: 'live-watch', channel: 0, revision: 1 });
	render();
	assert.equal(live().at(-1).voice.right, 4);

	send({ type: 'vgm-play', id: 7, mask: 63, plan: {
		writes: new Uint32Array([
			0, 0, 57, 0, 0x404, 0xed, 0, 0x410, 0xd0, 0, 0x400, 0x80,
			25, 0x404, 0x21, 1750, 0x404, 0x34,
		]),
		durationTicks: 8000, loopTick: null, loopIndex: 0,
	} });
	render();
	const active = live().at(-1);
	assert.deepEqual([active.source, active.playbackId], ['vgm', 7]);
	assert.equal(active.voice.wave[0], 57);
	assert.deepEqual([active.voice.left, active.voice.right], [2, 1]);

	send({ type: 'vgm-pause', id: 7, paused: true });
	render();
	const paused = live().at(-1);
	assert.deepEqual(paused.voice, active.voice);
	render(40);
	assert.equal(live().at(-1), paused);
	send({ type: 'live-watch', channel: 5, revision: 2 });
	render();
	const switched = live().at(-1);
	assert.deepEqual([switched.source, switched.channel, switched.revision], ['vgm', 5, 2]);
	assert.equal(switched.voice.waveBank, null);

	send({ type: 'vgm-stop', id: 7 });
	send({ type: 'live-watch', channel: 0, revision: 3 });
	render();
	const author = live().at(-1);
	assert.deepEqual([author.source, author.playbackId, author.voice.right], ['synth', null, 4]);
});

test('Code live edits preserve the other stereo nibble and shared envelope bits', () => {
	const { send, render, live } = setup();
	send({ type: 'batch', writes: [
		0, 63, 0x4, 0, 0x504, 0x34, 0x510, 0x52,
		0x514, 0x53, 0x518, 0, 0x500, 0x80,
	] });
	send({ type: 'live-watch', channel: 4, revision: 1 });
	render();
	const edit = (sequence, register, mask, value, revision = 1) =>
		send({ type: 'live-write', source: 'synth', channel: 4, playbackId: null, revision, sequence, register, mask, value });

	edit(1, 'LRV', 0xf0, 0xa0);
	assert.deepEqual([live().at(-1).voice.left, live().at(-1).voice.right], [10, 4]);
	assert.deepEqual(live().at(-1).edit, { register: 'LRV', mask: 0xf0, value: 0xa4 });
	assert.equal(live().at(-1).sequence, 1);
	edit(2, 'EV0', 0xf0, 0xb0);
	assert.equal(live().at(-1).voice.ev0, 0xb2);
	edit(3, 'EV1', 2, 0);
	assert.equal(live().at(-1).voice.ev1, 0x51);
	assert.equal(live().at(-1).voice.currentEnvelope, 11);
	const accepted = live().length;
	edit(4, 'EV1', 0xf0, 0);
	edit(5, 'LRV', 0xf0, 0, 0);
	assert.equal(live().length, accepted);

	send({ type: 'write', offset: 0x504, value: 0xf0 });
	render(16);
	assert.deepEqual([live().at(-1).voice.left, live().at(-1).voice.right], [15, 0]);
	assert.equal(live().at(-1).edit, undefined);
	assert.equal(outputs[0][1].some(sample => sample !== 0), false);
});

test('AUTO envelope edits reach sounding Code voices and preserve unrelated register bits', () => {
	const { send, render, live } = setup();
	send({ type: 'batch', writes: [
		...Array.from({ length: 32 }, (_, index) => [index * 4, 63]).flat(),
		0x404, 0xf0, 0x410, 0xa4, 0x400, 0x80,
		0x504, 0x0f, 0x510, 0xb6, 0x514, 0x52, 0x500, 0x80,
		0x550, 0x91, 0x554, 0x50,
	] });
	render();
	assert(outputs[0][0].at(-1) > 0 && outputs[0][1].at(-1) > 0);
	send({ type: 'code-envelope-write', channels: [0, 1, 2, 3, 4], register: 'EV0', mask: 0xf0, value: 0 });
	send({ type: 'code-envelope-write', channels: [4], register: 'EV1', mask: 1, value: 1 });
	render();
	assert(outputs[0].every(side => side.at(-1) === 0));
	function read(channel, revision) {
		send({ type: 'live-watch', channel, revision });
		render();
		const { active, ev0, ev1 } = live().at(-1).voice;
		return { active, ev0, ev1 };
	}
	assert.deepEqual(read(0, 1), { active: true, ev0: 0x04, ev1: 0 });
	assert.deepEqual(read(4, 2), { active: true, ev0: 0x06, ev1: 0x53 });
	assert.deepEqual(read(5, 3), { active: false, ev0: 0x91, ev1: 0x50 });
	send({ type: 'write', offset: 0x410, value: 0x94 });
	assert.deepEqual(read(0, 4), { active: true, ev0: 0x94, ev1: 0 });
	assert(outputs[0][0].at(-1) > 0);
});

test('immediate envelope controls preserve Noise tap and can restart a decayed envelope', () => {
	const { send, render, live } = setup();
	const voice = () => live().at(-1).voice;
	send({ type: 'batch', writes: [0x544, 0xff, 0x554, 0x60, 0x540, 0x80] });
	send({ type: 'envelope-writes', writes: [[0x550, 0x40], [0x554, 1, 3]] });
	send({ type: 'live-watch', channel: 5, revision: 1 });
	render();
	assert.deepEqual([voice().active, voice().ev0, voice().ev1, voice().currentEnvelope], [true, 0x40, 0x61, 4]);
	render(48);
	assert.equal(voice().currentEnvelope, 0);
	send({ type: 'envelope-writes', writes: [[0x550, 0, 0]] });
	render();
	assert.deepEqual([voice().active, voice().ev0, voice().ev1, voice().currentEnvelope], [true, 0x40, 0x61, 4]);
});

test('scheduled envelope writes merge EV1 with the state at their playback frame', () => {
	const { send, render, live } = setup();
	const plan = buildVsuOperations(b => b.setEnvelope(4, {
		level: 9, rate: 3, direction: 'up', enabled: true, repeat: false,
	}));
	send({ type: 'batch', writes: [0x510, 0x10, 0x514, 0x40, 0x500, 0x80] });
	send({ type: 'timed-request', id: 1, request: { action: 'schedule', plan, options: { name: 'envelope' } } });
	send({ type: 'write', offset: 0x514, value: 0x72 });
	render(2);
	send({ type: 'live-watch', channel: 4, revision: 1 });
	render();
	const { active, ev0, ev1, currentEnvelope } = live().at(-1).voice;
	assert.deepEqual([active, ev0, ev1, currentEnvelope], [true, 0x9b, 0x71, 9]);
});

test('partial envelope writes preserve later raw settings both immediately and at the scheduled frame', () => {
	const { send, render, live } = setup();
	const api = createVsuClient({
		write(offset, value) { send({ type: 'write', offset, value }); },
		writeEnvelope(writes) { send({ type: 'envelope-writes', writes }); },
	});
	const plan = buildVsuOperations(b => b.atSample(64).setEnvelope(4, { level: 15, repeat: true }), { referenceSampleRate: rate });
	const state = () => {
		const { active, ev0, ev1, currentEnvelope } = live().at(-1).voice;
		return [active, ev0, ev1, currentEnvelope];
	};
	send({ type: 'batch', writes: [0x510, 0x12, 0x514, 0x40, 0x500, 0x80] });
	send({ type: 'live-watch', channel: 4, revision: 1 });
	render();
	assert.deepEqual(state(), [true, 0x12, 0x40, 1]);
	send({ type: 'timed-request', id: 1, request: { action: 'schedule', plan, options: { name: 'partial-envelope' } } });
	api.write(0x510, 0x3c);
	api.write(0x514, 0x51);
	send({ type: 'live-watch', channel: 4, revision: 2 });
	render();
	assert.deepEqual(state(), [true, 0x3c, 0x51, 3]);
	send({ type: 'live-watch', channel: 4, revision: 3 });
	render();
	assert.deepEqual(state(), [true, 0xfc, 0x53, 15]);
	api.write(0x510, 0xab);
	api.write(0x514, 0x72);
	api.setEnvelope(4, { level: 5, enabled: true });
	render();
	assert.deepEqual(state(), [true, 0x5b, 0x73, 5]);
});

test('Code live Wave bank selection switches the sounding data without taking the manual gate', () => {
	const { send, render, live } = setup();
	const upperWave = Array(32).fill(63);
	send({ type: 'batch', writes: [
		...upperWave.flatMap((value, cell) => [cell * 4, value]),
		0x404, 0xff, 0x410, 0xf0, 0x418, 0,
	] });
	send({ type: 'live-watch', channel: 0, revision: 1 });
	const keyboard = liveKeyboard(send, 'synth', null);
	keyboard.on(1, 'A4');
	render();
	assert.ok(outputs[0][0].at(-1) > 0);
	const before = live().at(-1).voice;
	const edit = (sequence, value, mask = 7, revision = 1) =>
		send({ type: 'live-write', source: 'synth', channel: 0, playbackId: null, revision,
			sequence, register: 'RAM', mask, value });
	const count = live().length;
	edit(1, 5);
	edit(2, 1, 1);
	edit(3, 1, 7, 0);
	assert.equal(live().length, count);
	edit(4, 1);
	assert.deepEqual(live().at(-1).edit, { register: 'RAM', mask: 7, value: 1 });
	assert.deepEqual(live().at(-1).voice, { ...before, waveBank: 1, wave: Array(32).fill(0) });
	render();
	assert.ok(outputs[0][0].at(-1) < 0);

	send({ type: 'write', offset: 0x418, value: 0 });
	render(16);
	assert.equal(live().at(-1).voice.waveBank, 0);
	assert.deepEqual(live().at(-1).voice.wave, upperWave);
	assert.ok(outputs[0][0].at(-1) > 0);
	keyboard.off(1);
	render(16);
	assert.equal(live().at(-1).voice.active, false);
	assert.equal(outputs[0][0].at(-1), 0);

	send({ type: 'live-watch', channel: 5, revision: 2 });
	render();
	const noise = live().at(-1);
	send({ type: 'live-write', source: 'synth', channel: 5, playbackId: null, revision: 2,
		sequence: 5, register: 'RAM', mask: 7, value: 2 });
	assert.equal(live().at(-1), noise);
});

test('VGM Wave banks remain read-only in live controls and continue to follow song writes', () => {
	const { send, render, live, captures } = setup();
	send({ type: 'live-watch', channel: 2, revision: 1 });
	send({ type: 'vgm-play', id: 4, mask: 63, plan: {
		writes: new Uint32Array([
			0, 0, 20, 0, 0x100, 45, 0, 0x498, 2,
			0, 0x484, 0xae, 0, 0x490, 0xf0, 0, 0x480, 0x80,
			1750, 0x498, 0,
		]),
		durationTicks: 8000, loopTick: null, loopIndex: 0,
	} });
	render();
	send({ type: 'vgm-pause', id: 4, paused: true });
	render();
	const previous = live().at(-1);
	assert.equal(previous.voice.wave[0], 45);
	send({ type: 'live-write', source: 'vgm', channel: 2, playbackId: 4,
		revision: 1, sequence: 1, register: 'RAM', mask: 7, value: 0 });
	assert.equal(live().at(-1), previous);
	send({ type: 'vgm-capture', id: 4, request: 1, channel: 2 });
	assert.equal(captures().at(-1).voice.waveBank, 2);
	assert.equal(captures().at(-1).voice.wave[0], 45);
	send({ type: 'vgm-pause', id: 4, paused: false });
	render(32);
	assert.equal(live().at(-1).voice.waveBank, 0);
	assert.equal(live().at(-1).voice.wave[0], 20);
});

test('shared Wave RAM waits for all VSU gates, including muted Noise, and coalesces edits', () => {
	const { send, render, live, codeWave } = setup();
	send({ type: 'live-watch', channel: 0, revision: 1 });
	send({ type: 'batch', writes: [0, 1, 4, 1, 0x400, 0x80, 0x540, 0x80] });
	send({ type: 'channel-gain', channel: 5, gain: 0 });
	render();
	send({ type: 'code-wave-write', editId: 1, writes: Uint16Array.of(0, 22, 4, 42) });
	send({ type: 'code-wave-write', editId: 2, writes: Uint16Array.of(0, 63, 0x27c, 18) });
	send({ type: 'code-wave-write', editId: 1, writes: Uint16Array.of(0, 10) });
	assert.equal(codeWave().length, 2);
	const locked = codeWave().at(-1);
	assert.deepEqual(locked, { type: 'code-wave-state', editId: 2,
		pendingWrites: [[0, 63], [4, 42], [0x27c, 18]], appliedWrites: [] });
	send({ type: 'write', offset: 0x400, value: 0 });
	send({ type: 'write', offset: 0, value: 12 });
	render(20);
	assert.equal(codeWave().at(-1), locked);
	assert.deepEqual(live().at(-1).voice.wave.slice(0, 2), [1, 1]);
	send({ type: 'write', offset: 0x540, value: 0 });
	assert.deepEqual(codeWave().at(-1), { type: 'code-wave-state', editId: 2,
		pendingWrites: [], appliedWrites: [[0, 63], [4, 42], [0x27c, 18]] });
	render();
	assert.deepEqual(live().at(-1).voice.wave.slice(0, 2), [63, 42]);
});

test('a later accepted Code write supersedes only its queued Wave RAM sample within a batch', () => {
	const { send, render, live, codeWave } = setup();
	send({ type: 'live-watch', channel: 0, revision: 1 });
	send({ type: 'batch', writes: [0, 1, 4, 1, 0x400, 0x80] });
	render();
	send({ type: 'code-wave-write', editId: 1, writes: Uint16Array.of(0, 63, 4, 33) });
	send({ type: 'batch', writes: [0x580, 1, 0, 12, 0x400, 0x80] });
	assert.deepEqual(codeWave().at(-1), { type: 'code-wave-state', editId: 1,
		pendingWrites: [[4, 33]], appliedWrites: [] });
	render();
	assert.equal(live().at(-1).voice.active, true);
	assert.deepEqual(live().at(-1).voice.wave.slice(0, 2), [12, 1]);
	send({ type: 'write', offset: 0x580, value: 1 });
	render();
	assert.deepEqual(codeWave().at(-1), { type: 'code-wave-state', editId: 1,
		pendingWrites: [], appliedWrites: [[4, 33]] });
	assert.deepEqual(live().at(-1).voice.wave.slice(0, 2), [12, 33]);
});

test('a queued Wave RAM edit can apply in the idle interval between render-timed notes', () => {
	const { send, render, live, codeWave } = setup();
	send({ type: 'live-watch', channel: 0, revision: 1 });
	send({ type: 'batch', writes: [0, 1, 0x400, 0xa0] });
	send({ type: 'code-wave-write', editId: 1, writes: Uint16Array.of(0, 63) });
	const plan = buildVsuOperations(b => b.atSample(96).noteOn(0, 'C5'), { referenceSampleRate: rate });
	send({ type: 'timed-request', id: 1, request: { action: 'schedule', plan, options: { name: 'next' } } });
	render(2);
	assert.deepEqual(codeWave().at(-1), { type: 'code-wave-state', editId: 1,
		pendingWrites: [], appliedWrites: [[0, 63]] });
	assert.equal(live().at(-1).voice.wave[0], 63);
	render(16);
	assert.equal(live().at(-1).voice.active, true);
});

test('Wave RAM edits are cleared on reset and acknowledged without writing while VGM owns output', () => {
	const { send, render, live, codeWave } = setup();
	const queue = (editId, value) => send({ type: 'code-wave-write', editId, writes: Uint16Array.of(0, value) });
	send({ type: 'live-watch', channel: 0, revision: 1 });
	send({ type: 'write', offset: 0x400, value: 0x80 });
	queue(1, 56);
	send({ type: 'reset' });
	assert.deepEqual(codeWave().at(-1), { type: 'code-wave-state', editId: 1,
		pendingWrites: [], appliedWrites: [] });
	send({ type: 'write', offset: 0x400, value: 0x80 });
	queue(2, 61);
	send({ type: 'vgm-play', id: 1, mask: 63, paused: true, plan: {
		writes: Uint32Array.of(0, 0, 13), durationTicks: 8000, loopTick: null, loopIndex: 0,
	} });
	assert.deepEqual(codeWave().at(-1), { type: 'code-wave-state', editId: 2,
		pendingWrites: [], appliedWrites: [] });
	queue(3, 10);
	assert.deepEqual(codeWave().at(-1), { type: 'code-wave-state', editId: 3,
		pendingWrites: [], appliedWrites: [] });
	render();
	assert.equal(live().at(-1).voice.wave[0], 13);
	send({ type: 'vgm-stop', id: 1 });
	send({ type: 'write', offset: 0x580, value: 1 });
	render();
	assert.equal(live().at(-1).voice.wave[0], 0);
});

test('VGM live edits affect the active timeline and a paused capture before later writes take over', () => {
	const { send, render, live, captures } = setup();
	send({ type: 'write', offset: 0x544, value: 0x81 });
	send({ type: 'live-watch', channel: 5, revision: 1 });
	const plan = {
		writes: new Uint32Array([
			0, 0x544, 0x47, 0, 0x550, 0xb5, 0, 0x554, 0x70, 0, 0x540, 0xa2,
			200, 0x544, 0xab, 200, 0x550, 0x23, 200, 0x554, 0x30,
		]),
		durationTicks: 8000, loopTick: null, loopIndex: 0,
	};
	send({ type: 'vgm-play', id: 3, mask: 63, plan });
	render();
	const edit = (sequence, register, mask, value, playbackId = 3, source = 'vgm') =>
		send({ type: 'live-write', source, channel: 5, playbackId, revision: 1, sequence, register, mask, value });
	const playing = live().at(-1);
	edit(1, 'LRV', 15, 13, null, 'synth');
	edit(2, 'LRV', 15, 13, 2);
	assert.equal(live().at(-1), playing);
	edit(3, 'LRV', 15, 13);
	assert.deepEqual([live().at(-1).voice.left, live().at(-1).voice.right], [4, 13]);
	send({ type: 'vgm-pause', id: 3, paused: true });
	edit(4, 'EV0', 7, 2);
	edit(5, 'EV1', 1, 1);
	send({ type: 'vgm-capture', id: 3, request: 1, channel: 5 });
	const { voice } = captures().at(-1);
	assert.deepEqual([voice.left, voice.right, voice.ev0, voice.ev1], [4, 13, 0xb2, 0x71]);
	assert.equal(voice.interval, 2);
	render(32);
	assert.equal(live().at(-1).voice.ev1, 0x71);

	send({ type: 'vgm-pause', id: 3, paused: false });
	render(32);
	const later = live().at(-1).voice;
	assert.deepEqual([later.left, later.right, later.ev0, later.ev1], [10, 11, 0x23, 0x30]);
	send({ type: 'vgm-stop', id: 3 });
	render();
	assert.deepEqual([live().at(-1).source, live().at(-1).voice.left, live().at(-1).voice.right], ['synth', 8, 1]);
});

test('CH6 live keys keep the configured noise clock and one-shot length', () => {
	const { send, render, live } = setup();
	const voice = () => live().at(-1).voice;
	const keyboard = liveKeyboard(send, 'synth', null, 5);
	send({ type: 'batch', writes: [0x544, 0xff, 0x548, 0xce, 0x54c, 7, 0x550, 0xf0, 0x540, 0x20] });
	send({ type: 'live-watch', channel: 5, revision: 1 });
	keyboard.on(1, 'A4');
	render();
	assert.deepEqual([voice().active, voice().frequency, voice().interval], [true, 1998, 0]);
	keyboard.off(1);
	render();
	assert.deepEqual([voice().active, voice().interval], [false, 0]);
	keyboard.on(2, 'C6');
	render();
	assert.deepEqual([voice().active, voice().frequency, voice().interval], [true, 1998, 0]);
	render(16);
	assert.deepEqual([voice().active, voice().interval], [false, 0]);
});

test('authored AUTO keys program CH5 and CH6 without a watch or interrupting other Code channels', () => {
	const { send, render, live } = setup();
	const off = (channel, owner) => liveKeyboard(send, 'synth', null, channel).off(owner);
	const on = (channel, owner, writes) => send({ type: 'synth-key-on', channel, owner, writes: Uint16Array.from(writes.flat()) });
	send({ type: 'batch', writes: [0, 63, 0x404, 0xf0, 0x410, 0xf0, 0x400, 0x80, 0x500, 0x80] });

	// Code left CH5 on. AUTO turns it off before uploading its own Modulation RAM.
	on(4, 1, [
		[0x500, 0], [0x504, 0x0f], [0x510, 0xf0], [0x514, 0x52], [0x51c, 0x10],
		[0x280, 0x7f], ...vsuNoteOnWrites(4, 'C5'),
	]);
	render();
	assert.deepEqual(live(), []);
	assert.ok(outputs[0].every(samples => samples.some(value => value !== 0)));
	send({ type: 'live-watch', channel: 4, revision: 1 });
	render();
	const voice = () => live().at(-1).voice;
	assert.equal(voice().modulation[0], 127);
	assert.equal(voice().frequency, vsuFrequencyRegister(4, 'C5'));
	assert.equal(voice().ev1, 0x52);
	off(4, 1);
	render();
	assert.equal(voice().active, false);
	assert.ok(outputs[0][0].some(value => value !== 0));

	send({ type: 'live-watch', channel: null, revision: 2 });
	on(5, 2, [[0x540, 0], [0x544, 0x0f], [0x550, 0xf0], [0x554, 0x60], ...vsuStartWrites(5, 1998, 4)]);
	send({ type: 'live-watch', channel: 5, revision: 3 });
	render();
	assert.deepEqual([voice().active, voice().frequency, voice().interval, voice().ev1], [true, 1998, 4, 0x60]);
	send({ type: 'batch', writes: vsuStartWrites(5, 2001).flat() });
	off(5, 2);
	render(13);
	assert.deepEqual([voice().active, voice().frequency, voice().interval], [true, 2001, null]);

	send({ type: 'vgm-play', id: 1, mask: 63, plan: {
		writes: new Uint32Array(), durationTicks: 500, loopTick: null, loopIndex: 0,
	} });
	on(5, 3, [[0x540, 0], [0x544, 0xff], ...vsuStartWrites(5, 1600)]);
	send({ type: 'vgm-stop', id: 1 });
	render();
	assert.deepEqual([voice().frequency, voice().left, voice().right], [2001, 0, 15]);
});

test('held AUTO edits and retriggers belong to the current keyboard gate', () => {
	const { send, render, live } = setup();
	const voice = () => live().at(-1).voice;
	const keyWrites = (type, owner, writes) => send({ type, channel: 4, owner, writes: Uint16Array.from(writes.flat()) });
	const on = (owner, note) => keyWrites('synth-key-on', owner, [[0x500, 0], [0x510, 0xf0], ...vsuNoteOnWrites(4, note)]);
	const edit = (owner, writes) => keyWrites('synth-key-edit', owner, writes);
	const off = owner => liveKeyboard(send, 'synth', null, 4).off(owner);
	const retrigger = [[0x500, 0], [0x280, 0x20], [0x514, 0x50], ...vsuNoteOnWrites(4, 'C5')];
	send({ type: 'live-watch', channel: 4, revision: 1 });
	on(1, 'A4');
	edit(1, [[0x510, 0x78], [0x51c, 0x10]]);
	edit(2, [[0x510, 0xf0]]);
	render();
	assert.deepEqual([voice().active, voice().ev0, voice().swp], [true, 0x78, 0x10]);
	edit(1, retrigger);
	render();
	assert.deepEqual([voice().active, voice().frequency, voice().modulation[0], voice().ev1],
		[true, vsuFrequencyRegister(4, 'C5'), 0x20, 0x50]);
	off(1);
	render();
	assert.equal(voice().active, false);

	on(2, 'D5');
	send({ type: 'batch', writes: [[0x510, 0xa1], ...vsuNoteOnWrites(4, 'F5')].flat() });
	edit(2, retrigger);
	off(2);
	render();
	assert.deepEqual([voice().active, voice().frequency, voice().ev0], [true, vsuFrequencyRegister(4, 'F5'), 0xa1]);

	on(3, 'D5');
	const plan = buildVsuOperations(b => b.write(0x510, 0x93).noteOn(4, 'G5'));
	send({ type: 'timed-request', id: 1, request: { action: 'schedule', plan, options: { name: 'CH5' } } });
	render(3);
	edit(3, retrigger);
	off(3);
	render(15);
	assert.deepEqual([voice().active, voice().frequency, voice().ev0], [true, vsuFrequencyRegister(4, 'G5'), 0x93]);

	on(4, 'D5');
	send({ type: 'vgm-play', id: 1, mask: 63, plan: {
		writes: Uint32Array.of(0, 0x510, 0xb0, 0, 0x500, 0x80), durationTicks: 500, loopTick: null, loopIndex: 0,
	} });
	edit(4, retrigger);
	render();
	assert.deepEqual([live().at(-1).source, voice().active, voice().ev0], ['vgm', true, 0xb0]);
	send({ type: 'vgm-stop', id: 1 });
	render();
	assert.deepEqual([live().at(-1).source, voice().active, voice().ev0], ['synth', false, 0xf0]);
});

test('live Code keys preserve the programmed voice and only the latest owner can release it', () => {
	const { send, render, live } = setup();
	const voice = () => live().at(-1).voice;
	const keyboard = liveKeyboard(send, 'synth', null);
	send({ type: 'batch', writes: [
		...Array.from({ length: 32 }, (_, cell) => [0x100 + cell * 4, cell < 16 ? 63 : 0]).flat(),
		0x404, 0xed, 0x410, 0xb0, 0x414, 1, 0x418, 2,
	] });
	send({ type: 'live-watch', channel: 0, revision: 1 });
	keyboard.on(1, 'C5');
	render();
	assert.equal(voice().active, true);
	assert.equal(voice().frequency, vsuFrequencyRegister(0, 'C5'));
	assert.deepEqual([voice().waveBank, voice().left, voice().right, voice().ev0, voice().ev1], [2, 14, 13, 0xb0, 1]);
	assert.ok(outputs[0][0].some(value => value !== 0));
	render(16);
	assert.ok(voice().currentEnvelope < 11);

	keyboard.on(2, 'D5');
	keyboard.off(1);
	render();
	assert.equal(voice().active, true);
	assert.equal(voice().currentEnvelope, 11);
	assert.equal(voice().frequency, vsuFrequencyRegister(0, 'D5'));
	send({ type: 'live-watch', channel: 1, revision: 2 });
	keyboard.off(2);
	send({ type: 'live-watch', channel: 0, revision: 3 });
	render();
	assert.equal(voice().active, false);
	assert.ok(outputs[0][0].every(value => value === 0));
	keyboard.on(3, 'E5');
	render();
	assert.equal(voice().active, false);
});

test('raw Code pitch changes retain keyboard ownership and gate writes take it over', () => {
	const { send, render, live } = setup();
	const voice = () => live().at(-1).voice;
	const keyboard = liveKeyboard(send, 'synth', null);
	send({ type: 'live-watch', channel: 0, revision: 1 });
	keyboard.on(1, 69);
	send({ type: 'write', offset: 0x580, value: 0 });
	send({ type: 'write', offset: 0x408, value: 0x57 });
	keyboard.off(1);
	render();
	assert.equal(voice().active, false);
	assert.equal(voice().frequency & 255, 0x57);

	keyboard.on(2, 69);
	send({ type: 'batch', writes: [0x408, 0x34, 0x40c, 0x07, 0x400, 0x80] });
	keyboard.off(2);
	render();
	assert.equal(voice().active, true);
	assert.equal(voice().frequency, 0x734);

	keyboard.on(3, 69);
	send({ type: 'batch', writes: [0x580, 1, 0x400, 0x80] });
	keyboard.off(3);
	render();
	assert.equal(voice().active, true);
});

test('live VGM keys apply to the running transport and respect scheduled gate writes and pause', () => {
	const { send, render, live, captures } = setup();
	const voice = () => live().at(-1).voice;
	const keyboard = liveKeyboard(send, 'vgm', 11);
	const plan = {
		writes: new Uint32Array([
			0, 0x404, 0xfe, 0, 0x410, 0xd0,
			200, 0x408, 0x52, 550, 0x400, 0x80, 800, 0x580, 1, 800, 0x400, 0x80,
		]),
		durationTicks: 8000, loopTick: null, loopIndex: 0,
	};
	send({ type: 'live-watch', channel: 0, revision: 1 });
	send({ type: 'vgm-play', id: 11, mask: 63, plan });
	keyboard.on(1, 69);
	render(2);
	assert.equal(voice().active, true);
	keyboard.off(1);
	render();
	assert.equal(voice().active, false);
	assert.equal(voice().frequency & 255, 0x52);

	keyboard.on(2, 71);
	render(2);
	keyboard.off(2);
	render();
	assert.equal(voice().active, true);
	keyboard.on(3, 72);
	render(2);
	keyboard.off(3);
	render();
	assert.equal(voice().active, true);

	keyboard.on(4, 73);
	send({ type: 'vgm-pause', id: 11, paused: true });
	keyboard.on(5, 74);
	send({ type: 'vgm-capture', id: 11, request: 1, channel: 0 });
	assert.equal(captures().at(-1).voice.active, false);
	assert.equal(captures().at(-1).voice.frequency, vsuFrequencyRegister(0, 73));
	send({ type: 'vgm-pause', id: 11, paused: false });
	render();
	assert.equal(voice().active, false);

	send({ type: 'vgm-play', id: 12, mask: 63, plan });
	const nextKeyboard = liveKeyboard(send, 'vgm', 12);
	nextKeyboard.on(4, 75);
	keyboard.off(4);
	render();
	assert.deepEqual([live().at(-1).playbackId, voice().active, voice().frequency], [12, true, vsuFrequencyRegister(0, 75)]);
});

const mixerVoiceWrites = [
	...Array.from({ length: 32 }, (_, cell) => [cell * 4, cell < 16 ? 63 : 0]),
	[0x404, 0xf0], [0x410, 0xf0], ...vsuNoteOnWrites(0, 'A4'),
	[0x544, 0x0f], [0x550, 0xf0], ...vsuNoteOnWrites(5, 'A4'),
];

function stereoPeaks() {
	return outputs[0].map(channel => Math.max(...channel.map(Math.abs)));
}

test('the output mixer changes one channel without changing its stereo registers or its gate', () => {
	const { send, render, live } = setup();
	send({ type: 'batch', writes: mixerVoiceWrites.flat() });
	send({ type: 'live-watch', channel: 0, revision: 1 });
	render();
	const [left, right] = stereoPeaks();
	assert.ok(left > 0 && right > 0);
	send({ type: 'channel-gain', channel: 0, gain: 0.5 });
	render();
	const [quieter, unaffected] = stereoPeaks();
	assert.ok(Math.abs(quieter * 2 - left) <= 1 / 512);
	assert.equal(unaffected, right);
	send({ type: 'channel-gain', channel: 0, gain: 0 });
	render(24);
	assert.deepEqual(stereoPeaks(), [0, right]);
	const { active, left: lrvLeft, right: lrvRight } = live().at(-1).voice;
	assert.deepEqual([active, lrvLeft, lrvRight], [true, 15, 0]);

	send({ type: 'reset' });
	send({ type: 'batch', writes: mixerVoiceWrites.flat() });
	render();
	assert.deepEqual(stereoPeaks(), [0, right]);
	send({ type: 'channel-gain', channel: 0, gain: 1 });
	render();
	assert.deepEqual(stereoPeaks(), [left, right]);
});

test('VGM play and seek retain output gain alongside the VGM audition mask', async () => {
	const { send, render, live } = setup();
	const plan = {
		writes: new Uint32Array(mixerVoiceWrites.flatMap(([offset, value]) => [0, offset, value])),
		durationTicks: 8000, loopTick: null, loopIndex: 0,
	};
	const { instance } = await WebAssembly.instantiate(wasmBinary);
	const checkpoint = await createVgmSeekRenderer(instance.exports, rate).seek(plan, 1200);
	send({ type: 'channel-gain', channel: 0, gain: 0 });
	send({ type: 'vgm-play', id: 1, mask: 63, plan });
	render();
	const [muted, right] = stereoPeaks();
	assert.equal(muted, 0);
	assert.ok(right > 0);
	send({ type: 'vgm-mask', id: 1, mask: 1 });
	render();
	assert.deepEqual(stereoPeaks(), [0, 0]);

	send({ type: 'vgm-play', id: 2, mask: 63, checkpoint });
	send({ type: 'live-watch', channel: 0, revision: 1 });
	render();
	assert.deepEqual(stereoPeaks(), [0, right]);
	const { active, left } = live().at(-1).voice;
	assert.deepEqual([active, left], [true, 15]);
	send({ type: 'channel-gain', channel: 0, gain: 0.4 });
	render();
	const [quieter] = stereoPeaks();
	assert.ok(quieter > 0);
	send({ type: 'channel-gain', channel: 0, gain: 1 });
	render();
	const [full] = stereoPeaks();
	assert.ok(full > quieter);
});
