// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createVgmSeekRenderer } from './vgm-seek.js';
import { vsuFrequencyRegister, vsuNoteOnWrites } from './vsu.js';

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
		captures: () => processor.messages.filter(message => message.type === 'vgm-capture'),
	};
}

function liveKeyboard(send, source, playbackId, channel = 0, revision = 1) {
	return {
		on: (owner, note) => send({ type: 'live-note-on', source, playbackId, channel, revision, owner, writes: vsuNoteOnWrites(channel, note) }),
		off: owner => send({ type: 'live-note-off', source, playbackId, channel, owner }),
	};
}

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

test('VGM live edits affect the active timeline and a paused capture before later writes take over', () => {
	const { send, render, live, captures } = setup();
	send({ type: 'write', offset: 0x544, value: 0x81 });
	send({ type: 'live-watch', channel: 5, revision: 1 });
	const plan = {
		writes: new Uint32Array([
			0, 0x544, 0x47, 0, 0x550, 0xb5, 0, 0x554, 0x70, 0, 0x540, 0x80,
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
