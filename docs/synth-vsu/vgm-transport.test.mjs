// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createVgmTransport } from './vgm-transport.js';

function transportFixture(sampleRate = 48000) {
	let frame = 0;
	const calls = [];
	const messages = [];
	const player = createVgmTransport({
		sampleRate,
		reset: () => calls.push([frame, 'reset']),
		write: (address, value) => calls.push([frame, address, value]),
		renderFrames: (_offset, count) => { frame += count; },
		setMask: mask => calls.push([frame, 'mask', mask]),
		readChannel: channel => channel === 4 ? 0x4f1 : 0,
		onState: message => messages.push(message),
	});
	return { player, calls, messages };
}

function plan(writes, durationTicks, loopTick = null, loopIndex = -1) {
	return { writes: Uint32Array.from(writes.flat()), durationTicks, loopTick, loopIndex };
}

test('VGM clock splits render at sample-timed writes and stops at the duration', () => {
	const track = plan([[0, 0x400, 0x80], [1, 0x404, 0xf0], [137, 0x404, 0x0f], [224, 0x400, 0]], 225);
	for (const block of [1, 29, 128, 256]) {
		const { player, calls, messages } = transportFixture();
		player.play({ id: 17, plan: track, loop: false, mask: 63 });
		let rendered = 0;
		while (player.ownsOutput) rendered += player.render(block);

		assert.equal(rendered, 245);
		assert.deepEqual(calls, [
			[0, 'reset'], [0, 'mask', 63], [0, 0x400, 0x80], [1, 0x404, 0xf0],
			[149, 0x404, 0x0f], [244, 0x400, 0], [245, 0x580, 1],
		]);
		assert.equal(messages[0].state, 'playing');
		assert.equal(messages[0].id, 17);
		assert.deepEqual(messages[0].channels[4], { active: false, left: 15, right: 1, mode: 'modulation' });
		assert.equal(messages.at(-1).state, 'ended');
		assert.equal(messages.at(-1).positionTicks, 225);
	}
});

test('a native loop continues chip state and keeps its fractional sample phase across many repetitions', () => {
	const { player, calls } = transportFixture();
	// The loop starts inside a wait, before its first register write.
	player.play({
		id: 1, plan: plan([[0, 0x400, 0x80], [5, 0x404, 0xF0], [8, 0x404, 0x0F]], 9, 4, 1),
		loop: true, mask: 63,
	});
	for (let block = 0; block < 70; block++) assert.equal(player.render(128), 128);
	assert.deepEqual(calls.filter(call => call[1] === 'reset'), [[0, 'reset']]);
	assert.deepEqual(calls.filter(call => call[1] === 0x400), [[0, 0x400, 0x80]]);
	const loopWrites = calls.filter(call => call[2] === 0xf0);
	assert.ok(loopWrites.length > 1000);
	for (const [index, [frame]] of loopWrites.entries()) {
		assert.equal(frame, Math.round((5 + index * 5) * 48000 / 44100));
	}
});

test('pause holds position, replay without a native loop resets the same mix and stop relinquishes output', () => {
	const { player, calls, messages } = transportFixture(44100);
	player.play({ id: 1, plan: plan([[0, 0x400, 0x80]], 8), loop: false, mask: 63 });
	player.render(3);
	player.pause(1, true);
	assert.equal(player.ownsOutput, true);
	assert.equal(player.render(128), 0);
	assert.equal(messages.at(-1).state, 'paused');
	assert.equal(messages.at(-1).positionTicks, 3);
	player.setLoop(1, true);
	player.setMask(1, 10);
	player.pause(1, false);
	player.render(6);
	assert.deepEqual(calls.slice(3), [[3, 'mask', 10], [8, 'reset'], [8, 'mask', 10], [8, 0x400, 0x80]]);
	player.stop(9);
	assert.equal(player.ownsOutput, true);
	player.stop(1);
	assert.equal(player.ownsOutput, false);
	assert.equal(messages.at(-1).state, 'stopped');
	assert.equal(messages.at(-1).positionTicks, 0);
});

test('native mix masking preserves voice and DAC phase and keeps register monitoring independent', async () => {
	const bytes = await readFile(new URL('./vsu.wasm', import.meta.url));
	const { instance: { exports: core } } = await WebAssembly.instantiate(bytes);
	const size = Math.ceil(core.vsu_size() / 4) * 4;
	const normal = core.__heap_base.value, masked = normal + size, output = masked + size;
	const render = (state, frames) => {
		core.vsu_render(state, output, output + 4 * frames, frames, 48000);
		return new Float32Array(core.memory.buffer, output, 2 * frames).slice();
	};
	for (const state of [normal, masked]) {
		core.vsu_reset(state);
		for (let cell = 0; cell < 32; cell++) core.vsu_write(state, cell * 4, cell < 16 ? 63 : 0);
		for (const [base, level] of [[0x400, 0xf0], [0x500, 0x0f]]) {
			core.vsu_write(state, base + 4, level);
			core.vsu_write(state, base + 8, 0xc0);
			core.vsu_write(state, base + 12, 5);
			core.vsu_write(state, base + 16, 0xf0);
			core.vsu_write(state, base, 0x80);
		}
		core.vsu_write(state, 0x51c, 0x90);
		core.vsu_write(state, 0x514, 0x70);
	}
	core.vsu_set_mix_mask(masked, 1);
	const frames = 197;
	const audible = render(normal, frames);
	const leftOnly = render(masked, frames);
	assert.ok(audible.slice(frames).some(sample => sample !== 0));
	assert.deepEqual(leftOnly.slice(0, frames), audible.slice(0, frames));
	assert.ok(leftOnly.slice(frames).every(sample => sample === 0));
	assert.equal(core.vsu_get_channel(masked, 4), 0x50f);
	core.vsu_set_mix_mask(masked, 63);
	assert.deepEqual(render(masked, 199), render(normal, 199));
	core.vsu_write(masked, 0x580, 1);
	assert.equal(core.vsu_get_channel(masked, 4), 0x40f);
});
