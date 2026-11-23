// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const wasm = await WebAssembly.compile(await readFile(new URL('../../docs/synth-vsu/vsu.wasm', import.meta.url)));
const testRate = 125_000; // Three 40-clock host samples per VSU DAC sample.

function createVsu() {
	const {
		memory, __heap_base, vsu_size, vsu_reset, vsu_write, vsu_render,
	} = new WebAssembly.Instance(wasm).exports;
	const state = __heap_base.value;
	const output = state + Math.ceil(vsu_size() / 4) * 4;
	vsu_reset(state);
	const write = (address, value) => vsu_write(state, address, value);
	const register = (channel, offset, value) => write(0x400 + channel * 0x40 + offset, value);
	return {
		write, register,
		wave(bank, contents) {
			for (const [index, value] of contents.entries()) write(bank * 0x80 + index * 4, value);
		},
		frequency(channel, value) {
			register(channel, 0x08, value & 0xff);
			register(channel, 0x0c, value >> 8);
		},
		render(frames, rate = testRate) {
			const right = output + frames * 4;
			const needed = right + frames * 4 - memory.buffer.byteLength;
			if (needed > 0) memory.grow(Math.ceil(needed / 65536));
			vsu_render(state, output, right, frames, rate);
			return [output, right].map(address => new Float32Array(memory.buffer, address, frames).slice());
		},
	};
}

function square() {
	return Array.from({ length: 32 }, (_, index) => index < 16 ? 63 : 0);
}

test('VSU uses all five physical wave banks, stereo levels and a shared write lock', () => {
	const chip = createVsu();
	for (let channel = 0; channel < 5; channel++) {
		chip.wave(channel, square());
		chip.register(channel, 0x04, channel & 1 ? 0x0f : 0xf0);
		chip.register(channel, 0x10, 0xf0);
		chip.register(channel, 0x18, channel);
		chip.frequency(channel, 2048 - 120);
	}
	for (let channel = 0; channel < 5; channel++) chip.register(channel, 0, 0x80);
	chip.wave(4, Array(32).fill(31));
	const [left, right] = chip.render(96);
	assert(left[0] > right[0] && right[0] > 0);
	assert(left.subarray(0, 48).every(value => value === left[0]));
	assert(right.subarray(0, 48).every(value => value === right[0]));
	assert(left.subarray(48).every(value => value < 0));
	assert(right.subarray(48).every(value => value < 0));
	chip.write(0x580, 1);
	assert.deepEqual(chip.render(3), [new Float32Array(3), new Float32Array(3)]);

	chip.wave(4, Array(32).fill(0x7f)); // Wave writes keep only six bits.
	chip.register(4, 0, 0x80);
	assert(chip.render(3)[0][0] > 0);
	chip.register(4, 0x18, 5); // Unmapped bank cannot activate sound.
	assert.deepEqual(chip.render(3), [new Float32Array(3), new Float32Array(3)]);
});

test('VSU counts 3.84 ms intervals and 15.36 ms envelope steps', () => {
	const chip = createVsu();
	chip.wave(0, Array(32).fill(63));
	chip.register(0, 0x04, 0xf0);
	chip.register(0, 0x10, 0xf0);
	chip.register(0, 0, 0xa0);
	const [gated, silent] = chip.render(490);
	assert(gated.subarray(0, 480).every(sample => sample > 0));
	assert(gated.subarray(480).every(sample => sample === 0));
	assert(silent.every(sample => sample === 0));

	chip.render(2); // Align the next write with a DAC sample.
	chip.register(0, 0x10, 0x20);
	chip.register(0, 0x14, 1);
	chip.register(0, 0, 0x80);
	const [decay] = chip.render(5760);
	assert(decay[0] > decay[1920] && decay[1920] > 0);
	assert(decay.subarray(0, 1920).every(sample => sample === decay[0]));
	assert(decay.subarray(1920, 3840).every(sample => sample === decay[1920]));
	assert(decay.subarray(3840).every(sample => sample === 0));
	chip.register(0, 0, 0x80); // An INT write retains the current level.
	assert(chip.render(3)[0].every(sample => sample === 0));
	chip.register(0, 0x10, 0x28); // Rewrite the level and start growing in place.
	const [grow] = chip.render(3840);
	assert(grow[1920] > grow[0] && grow[0] > 0);
});

test('VSU channel 5 sweep accumulates and modulation uses signed base-relative values', () => {
	function setup(mode, period) {
		const chip = createVsu();
		chip.wave(0, Array.from({ length: 32 }, (_, index) => index % 2 === 0 ? 63 : 0));
		chip.register(4, 0x04, 0xff);
		chip.register(4, 0x10, 0xf0);
		chip.register(4, 0x14, mode);
		chip.register(4, 0x1c, period);
		return chip;
	}
	for (const setting of [
		{ mode: 0x40, period: 0x11, values: [1024, 512, 256] },
		{ mode: 0x50, period: 0x10, values: [1024, 1151, 897] },
	]) {
		const automatic = setup(setting.mode, setting.period), manual = setup(0, 0);
		automatic.write(0x280, 0x7f);
		automatic.write(0x284, 0x81);
		for (const chip of [automatic, manual]) {
			chip.frequency(4, setting.values[0]);
			chip.register(4, 0, 0x80);
		}
		for (const value of setting.values.slice(1)) {
			assert.deepEqual(automatic.render(120), manual.render(120));
			manual.frequency(4, value);
		}
		assert.deepEqual(automatic.render(120), manual.render(120));
	}

	const overflow = setup(0x40, 0x18);
	overflow.frequency(4, 2040);
	overflow.register(4, 0, 0x80);
	const [pulse] = overflow.render(180);
	assert(pulse.subarray(0, 120).some(sample => sample !== 0));
	assert(pulse.subarray(120).every(sample => sample === 0));
});

test('VSU noise tap 0 matches the recorded opening bits and rendering survives chunk splits', () => {
	function noise() {
		const chip = createVsu();
		chip.register(5, 0x04, 0x0f);
		chip.register(5, 0x10, 0xf0);
		chip.register(5, 0x14, 0x00);
		chip.frequency(5, 2048 - 12);
		chip.register(5, 0, 0x80);
		return chip;
	}
	const [left, right] = noise().render(57);
	assert(left.every(sample => sample === 0));
	const bits = right.filter((sample, index) => index >= 3 && index % 3 === 0);
	assert.deepEqual(Array.from(bits, sample => Number(sample > 0)), [
		1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0,
	]);
	const whole = noise().render(512, 44100);
	const split = noise();
	const initial = split.render(79, 44100), tail = split.render(433, 44100);
	assert.deepEqual(initial.map((channel, side) => [...channel, ...tail[side]]), whole.map(channel => [...channel]));
});
