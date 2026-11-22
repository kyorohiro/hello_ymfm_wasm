import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buzzerCodeDeclarations } from './code.js';
import {
	MACHINE_CYCLE_HZ, MASTER_CLOCK_HZ, R1_DIVISOR, R1_HZ,
	createR1Renderer, createSm510CodeChip, renderR1Pattern, renderR1Timeline,
} from './sm510.js';

const { instance } = await WebAssembly.instantiate(await readFile(new URL('./sm510.wasm', import.meta.url)));
const render = createR1Renderer(instance.exports);

test('Code declarations expose both chip clients and the R register constant', () => {
	const types = buzzerCodeDeclarations('');
	assert.match(types, /'lcd-buzzer': BuzzerCodeChip; sm510: Sm510CodeChip/);
	assert.match(types, /readonly REG_R: 0/);
	assert.match(types, /noteOn\(channel: typeof CH1/);
	assert.match(types, /atCycle\(machineCycle: number\)/);
});

test('DK-52 R1 uses the same 4,096 Hz carrier at different step times and browser sample rates', () => {
	assert.equal(MASTER_CLOCK_HZ / R1_DIVISOR, 4096);
	assert.equal(R1_HZ, 4096);
	for (const sampleRate of [44100, 48000]) {
		for (const stepMs of [85, 150]) {
			const { samples } = renderR1Pattern(Array(8).fill(true), { stepMs, sampleRate }, render);
			assert(Math.abs(samples.length - sampleRate * stepMs * 8 / 1000) < 2);
			let crossings = 0;
			const start = sampleRate / 20;
			for (let frame = start; frame < start + sampleRate / 2; frame++) {
				if (samples[frame - 1] <= 0 && samples[frame] > 0) crossings++;
			}
			assert.equal(crossings, 2048);
		}
	}
});

test('off gates are silent and adjacent on gates produce one continuous pulse', () => {
	const options = { stepMs: 85, sampleRate: 44100 };
	const { samples, stepFrames } = renderR1Pattern([true, true, false, true, false, false, false, false], options, render);
	const continuous = renderR1Pattern(Array(8).fill(true), options, render).samples;
	const first = Math.round(stepFrames);
	const second = Math.round(stepFrames * 2);
	const third = Math.round(stepFrames * 3);
	assert.deepEqual(samples.slice(first - 8, first + 8), continuous.slice(first - 8, first + 8));
	assert(samples.slice(first - 8, first + 8).some(sample => Math.abs(sample) > .1));
	assert(samples.slice(second + 1, third - 1).every(sample => sample === 0));
	assert.deepEqual(samples.slice(third + 48, third + 80), continuous.slice(third + 48, third + 80));
	assert(samples.slice(Math.round(stepFrames * 4) + 1).every(sample => sample === 0));
});

test('Code immediate writes gate only R1 and accept the complete 4-bit register', () => {
	const gates = [];
	const chip = createSm510CodeChip({ write: value => gates.push(value) });
	assert.equal(chip.clock, 32768);
	assert.equal(chip.machineCycleHz, 16384);
	for (const value of [0x1, 0x3, 0x2, 0xf, 0x0]) chip.write(chip.REG_R, value);
	assert.deepEqual(gates, [true, true, false, true, false]);
	assert.throws(() => chip.write('R', 1), /REG_R/);
	assert.throws(() => chip.write(chip.REG_R, 16), /4-bit/);
	assert.throws(() => chip.write(chip.REG_R, 0.5), /4-bit/);
});

test('cycle sequences place writes at exact master ticks without executing instructions', () => {
	let timeline;
	const chip = createSm510CodeChip({ playCycles: value => { timeline = value; } });
	const pulse = chip.build(b => {
		b.atCycle(2).write(chip.REG_R, 3).write(chip.REG_R, 2);
		b.atCycle(3).write(chip.REG_R, 1);
		b.atCycle(5).write(chip.REG_R, 0);
		b.atCycle(6);
	});
	assert.equal(pulse.machineCycles, 6);
	chip.playCycles(pulse);
	assert.deepEqual([...timeline.writes], [4, 3, 4, 2, 6, 1, 10, 0, 12, 0]);
	const pcm = renderR1Timeline(timeline, MACHINE_CYCLE_HZ * 2, render);
	const level = Math.fround(.16);
	assert.deepEqual([...pcm], [0, 0, 0, 0, 0, 0, level, level, -level, -level, 0, 0]);
	assert.throws(() => chip.build(b => b.atCycle(3).atCycle(2)), /nondecreasing/);
	assert.throws(() => chip.build(async b => b.atCycle(3)), /synchronous/);
	assert.throws(() => chip.playCycles({ machineCycles: 6 }), /from build/);
});
