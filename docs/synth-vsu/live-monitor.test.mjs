// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
