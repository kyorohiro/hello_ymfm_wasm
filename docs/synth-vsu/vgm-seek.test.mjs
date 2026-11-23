// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createVgmSeekRenderer } from './vgm-seek.js';
import { createVgmTransport } from './vgm-transport.js';

const wasm = await WebAssembly.compile(await readFile(new URL('./vsu.wasm', import.meta.url)));
const makeCore = () => new WebAssembly.Instance(wasm).exports;
const frameAt = (tick, rate) => Math.round(tick * rate / 44100);

function makePlan() {
	const writes = [];
	for (let index = 0; index < 32; index++) {
		writes.push(0, index * 4, index * 2, 0, 0x280 + index * 4, (index - 16) & 255);
	}
	writes.push(
		0, 0x504, 0xF7, 0, 0x508, 0x46, 0, 0x50C, 5,
		0, 0x510, 0x3F, 0, 0x514, 0x73, 0, 0x51C, 0xB0, 0, 0x500, 0x80,
		1, 0x504, 0xD2, 2, 0x504, 0xAC, 137, 0x504, 0xFA,
		110250, 0x504, 0x8E, 176400, 0x508, 0x25, 176400, 0x50C, 3,
		216000, 0x510, 0xF4, 216001, 0x504, 0xBA,
	);
	return { writes: Uint32Array.from(writes), durationTicks: 265000, loopTick: null, loopIndex: -1 };
}

function liveVoice(plan, sampleRate, restoreState) {
	const core = makeCore();
	const stateAddress = core.__heap_base.value;
	const bytes = new Uint8Array(core.memory.buffer, stateAddress, core.vsu_size());
	const left = stateAddress + Math.ceil(bytes.length / 4) * 4;
	const right = left + 1024;
	const player = createVgmTransport({
		sampleRate,
		reset: () => core.vsu_reset(stateAddress),
		write: (address, value) => core.vsu_write(stateAddress, address, value),
		renderFrames(offset, frames) {
			core.vsu_render(stateAddress, left + offset * 4, right + offset * 4, frames, sampleRate);
		},
		setMask: mask => core.vsu_set_mix_mask(stateAddress, mask),
		readChannel: channel => core.vsu_get_channel(stateAddress, channel),
		onState() {},
	});
	player.play({ id: 1, plan, loop: false, mask: 63 });
	if (restoreState) bytes.set(restoreState);
	return {
		player,
		audio(frames) {
			core.vsu_render(stateAddress, left, right, frames, sampleRate);
			return [left, right].map(address => new Float32Array(core.memory.buffer, address, frames).slice());
		},
	};
}

test('VGM seek restores linear envelope, modulation and DAC phase at exact sample boundaries', async () => {
	const plan = makePlan();
	for (const sampleRate of [32000, 48000]) {
		let renderedFrames = 0;
		const core = makeCore();
		const renderer = createVgmSeekRenderer({ ...core, vsu_render(state, left, right, count, rate) {
			renderedFrames += count;
			return core.vsu_render(state, left, right, count, rate);
		} }, sampleRate);
		for (const tick of [0, 1, 137, 22051, 216001, 176400, 176800, 3800]) {
			const expected = liveVoice(plan, sampleRate);
			const frame = frameAt(tick, sampleRate);
			for (let remaining = frame; remaining > 0; ) {
				const count = Math.min(remaining, 256);
				assert.equal(expected.player.render(count), count);
				remaining -= count;
			}
			const before = renderedFrames;
			const checkpoint = await renderer.seek(plan, tick);
			assert.equal(checkpoint.tick, tick);
			assert.equal(checkpoint.frame, frame);
			if (tick === 176400) assert.equal(renderedFrames, before, 'reuse the 4-second cache point');
			if (tick === 176800) assert.equal(renderedFrames - before, frame - frameAt(176400, sampleRate));
			let cursor = 0;
			while (cursor < plan.writes.length && frameAt(plan.writes[cursor], sampleRate) <= frame) cursor += 3;
			assert.equal(checkpoint.cursor, cursor);
			// Continue rendering the chip without consuming future VGM writes.
			// Both copies must output the exact same samples from this state.
			const restored = liveVoice(plan, sampleRate, checkpoint.bytes);
			const continuation = expected.audio(127);
			if (tick === 176800) assert.ok(continuation[0].some(sample => sample !== 0));
			assert.deepEqual(restored.audio(127), continuation);
			checkpoint.bytes.fill(0xee);
		}
	}
});

test('aborting a seek does not poison the current plan or the next plan', async () => {
	const plan = makePlan();
	const renderer = createVgmSeekRenderer(makeCore(), 44100);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(renderer.seek(plan, 176400, { signal: controller.signal }), { name: 'AbortError' });
	const first = await renderer.seek(plan, 2);
	const changedPlan = { ...plan, writes: plan.writes.slice(0, 3) };
	const second = await renderer.seek(changedPlan, 2);
	assert.notDeepEqual(first.bytes, second.bytes);
	assert.equal(second.cursor, 3);
});
