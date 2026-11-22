import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buzzerCodeDeclarations } from './code.js';
import {
	DIRECT_R, DK52_R, MACHINE_CYCLE_HZ, MASTER_CLOCK_HZ, MAX_PULSE_HALF_CYCLES, MIN_PULSE_HALF_CYCLES,
	R1_DIVISOR, R1_HZ, buildSm510Pulse,
	createSm510AudioCore, createSm510CodeChip, directPitchHz, readRAtTick, renderR1Pattern, renderR1Timeline, renderSm510Notes,
} from './sm510.js';

const { instance } = await WebAssembly.instantiate(await readFile(new URL('./sm510.wasm', import.meta.url)));
const core = createSm510AudioCore(instance.exports);
const render = core.renderR1;

test('Code declarations expose the note client and both R output masks', () => {
	const types = buzzerCodeDeclarations('');
	assert.match(types, /'lcd-buzzer': BuzzerCodeChip/);
	assert.match(types, /sm510: Sm510CodeChip<'sm510'>/);
	assert.match(types, /'sm510-direct': Sm510CodeChip<'sm510-direct'>/);
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

test('the two R pins preserve their clock phase and independent latch bits', () => {
	// R2 alone, then both pins, then R1 alone. Writes occur inside a half wave.
	const writes = Uint32Array.of(2, 2, 7, 3, 12, 1, 17, 0);
	const high = Math.fround(.16), low = -high;
	assert.deepEqual([...core.renderR1(writes, 18, MASTER_CLOCK_HZ)], [
		0, 0, 0, 0, 0, 0, 0, high, low, low, low, low, high, high, high, high, low, 0,
	]);
	assert.deepEqual([...core.renderR2(writes, 18, MASTER_CLOCK_HZ)], [
		0, 0, high, high, low, low, low, low, high, high, high, high, 0, 0, 0, 0, 0, 0,
	]);
	assert.deepEqual([...core.renderDirectR1(writes, 18, MASTER_CLOCK_HZ)], [
		0, 0, 0, 0, 0, 0, 0, high, high, high, high, high, high, high, high, high, high, 0,
	]);
	assert.deepEqual([...core.renderDirectR2(writes, 18, MASTER_CLOCK_HZ)], [
		0, 0, high, high, high, high, high, high, high, high, high, high, 0, 0, 0, 0, 0, 0,
	]);
});

test('R2 uses the same write boundaries at fractional browser sample positions', () => {
	// The last write at an equal timestamp takes precedence.
	const writes = Uint32Array.of(2, 2, 7, 0, 7, 3, 13, 1, 17, 0);
	const reference = Uint32Array.of(2, 1, 13, 0);
	for (const rate of [44100, 48000]) {
		const inverted = core.renderR1(reference, 32, rate).map(sample => sample === 0 ? 0 : -sample);
		assert.deepEqual(core.renderR2(writes, 32, rate), inverted);
		assert.deepEqual(core.renderDirectR2(writes, 32, rate), core.renderDirectR1(reference, 32, rate));
	}
	assert.deepEqual([...writes], [2, 2, 7, 0, 7, 3, 13, 1, 17, 0]);
});

test('Direct R CPU pulses start after LAX and ATR and alternate the enabled pins', () => {
	const halfCycles = MIN_PULSE_HALF_CYCLES;
	for (const mask of [0, 1, 2, 3]) {
		const pulse = buildSm510Pulse(DIRECT_R, halfCycles, mask);
		assert.deepEqual(pulse, { end: 20, writes: Uint32Array.of(4, mask & 1, 12, mask & 2), loopStart: 4, halfTicks: 8 });
		const pin1 = renderR1Timeline(pulse, MASTER_CLOCK_HZ, core.renderDirectR1);
		const pin2 = renderR1Timeline(pulse, MASTER_CLOCK_HZ, core.renderDirectR2);
		const level = Math.fround(.16);
		assert(pin1.slice(0, pulse.loopStart).every(sample => sample === 0));
		assert(pin2.slice(0, pulse.loopStart).every(sample => sample === 0));
		assert(pin1.slice(4, 12).every(sample => sample === (mask & 1 ? level : 0)));
		assert(pin2.slice(4, 12).every(sample => sample === 0));
		assert(pin1.slice(12).every(sample => sample === 0));
		assert(pin2.slice(12).every(sample => sample === (mask & 2 ? level : 0)));
	}
});

test('DK-52 CPU pulses retain divider phase when the loop wraps', () => {
	assert.deepEqual(buildSm510Pulse(DK52_R, 4, 2), {
		end: 20, writes: Uint32Array.of(4, 2, 12, 0), loopStart: 4, halfTicks: 8,
	});
	const pulse = buildSm510Pulse(DK52_R, 5, 3);
	assert.deepEqual(pulse, {
		end: 44, writes: Uint32Array.of(4, 3, 14, 0, 24, 3, 34, 0), loopStart: 4, halfTicks: 10,
	});
	const loopLength = pulse.end - pulse.loopStart;
	const nextWrites = pulse.writes.map((value, index) => index % 2 === 0 ? value + loopLength : value);
	const repeated = { end: pulse.end + loopLength, writes: Uint32Array.from([...pulse.writes, ...nextWrites]) };
	const pin1 = renderR1Timeline(repeated, MASTER_CLOCK_HZ, core.renderR1);
	const pin2 = renderR1Timeline(repeated, MASTER_CLOCK_HZ, core.renderR2);
	const level = Math.fround(.16);
	assert.equal(pin1[4], level);
	assert.equal(pin2[4], -level);
	assert.equal(pin1[24], -level);
	assert.equal(pin2[24], level);
	for (const samples of [pin1, pin2]) {
		assert(samples.slice(14, 24).every(sample => sample === 0));
		assert.deepEqual(samples.slice(pulse.loopStart, pulse.end), samples.slice(pulse.end));
	}
});

test('SM510 CPU pulse inputs are limited to executable half-periods and two-pin masks', () => {
	assert.equal(buildSm510Pulse(DK52_R, MAX_PULSE_HALF_CYCLES, 1).halfTicks, 126);
	for (const halfCycles of [MIN_PULSE_HALF_CYCLES - 1, 4.5, MAX_PULSE_HALF_CYCLES + 1]) {
		assert.throws(() => buildSm510Pulse(DIRECT_R, halfCycles, 1), /machine cycles/);
	}
	for (const driveMask of [-1, .5, 4]) {
		assert.throws(() => buildSm510Pulse(DK52_R, 4, driveMask), /two-bit/);
	}
	assert.throws(() => buildSm510Pulse('equal', 4, 1), /Direct R or the DK-52 divider/);
});

test('Code immediate writes latch the two low bits of a four-bit operand', () => {
	const latched = [];
	const chip = createSm510CodeChip({ write: value => latched.push(value) });
	assert.equal(chip.clock, 32768);
	assert.equal(chip.machineCycleHz, 16384);
	for (const value of [0x1, 0x3, 0x2, 0xf, 0x0]) chip.write(chip.REG_R, value);
	assert.deepEqual(latched, [1, 3, 2, 3, 0]);
	assert.throws(() => chip.write('R', 1), /REG_R/);
	assert.throws(() => chip.write(chip.REG_R, 16), /4-bit/);
	assert.throws(() => chip.write(chip.REG_R, 0.5), /4-bit/);
});

test('cycle sequences place writes at exact master ticks without executing instructions', () => {
	let timeline;
	const chip = createSm510CodeChip({ playCycles: value => { timeline = value; } });
	const pulse = chip.build(b => {
		b.atCycle(2).write(chip.REG_R, 3).write(chip.REG_R, 0xe);
		b.atCycle(3).write(chip.REG_R, 1);
		b.atCycle(5).write(chip.REG_R, 0);
		b.atCycle(6);
	});
	assert.equal(pulse.machineCycles, 6);
	chip.playCycles(pulse);
	assert.deepEqual([...timeline.writes], [4, 3, 4, 14, 6, 1, 10, 0, 12, 0]);
	assert.deepEqual([-1, 3, 4, 5, 6, 10, 12].map(tick => readRAtTick(timeline, tick)), [0, 0, 2, 2, 1, 0, 0]);
	const pcm = renderR1Timeline(timeline, MACHINE_CYCLE_HZ * 2, render);
	const level = Math.fround(.16);
	assert.deepEqual([...pcm], [0, 0, 0, 0, 0, 0, level, level, -level, -level, 0, 0]);
	assert.throws(() => chip.build(b => b.atCycle(3).atCycle(2)), /nondecreasing/);
	assert.throws(() => chip.build(async b => b.atCycle(3)), /synchronous/);
	assert.throws(() => chip.playCycles({ machineCycles: 6 }), /from build/);
});

test('direct note half-periods fit executable SM510 instruction loops', () => {
	// ROM addresses advance via the SM510 polynomial counter, not linearly.
	const nextAddress = address => {
		const bits = address & 63;
		const feedback = (bits & 1) === ((bits >> 1) & 1) ? 32 : 0;
		return (address & ~63) | feedback | (bits >> 1);
	};
	for (let half = 4; half <= 63; half++) {
		const rom = new Map();
		for (const [page, value, branch] of [[0, 1, 0x71], [64, 0, 0x70]]) {
			let address = page;
			const program = [0x20 + value, 0x61, ...Array(half - 4).fill(0x00), branch, 0x00];
			for (const opcode of program) {
				assert(!rom.has(address));
				rom.set(address, opcode);
				address = nextAddress(address);
			}
		}
		let pc = 0, cycle = 0, acc = 0;
		const writes = [];
		while (writes.length < 5) {
			const opcode = rom.get(pc);
			assert.notEqual(opcode, undefined);
			pc = nextAddress(pc);
			cycle++;
			if ((opcode & 0xf0) === 0x20) acc = opcode & 0xf;
			else if (opcode === 0x61) writes.push([cycle, acc]);
			else if (opcode === 0x70 || opcode === 0x71) {
				const operand = rom.get(pc);
				assert.equal(operand, 0x00);
				pc = (opcode & 1) * 64;
				cycle++;
			} else assert.equal(opcode, 0x00);
		}
		assert.deepEqual(writes, [1, 0, 1, 0, 1].map((value, i) => [2 + i * half, value]));
		assert.equal(core.directHalfCycles(directPitchHz(half)), half);
	}
	assert.equal(core.directHalfCycles(440), 19);
	assert.equal(directPitchHz(19).toFixed(2), '431.16');
	assert.equal(core.directHalfCycles(130.81278265), 63);
	assert.equal(core.directHalfCycles(1046.5022612), 8);
	assert.equal(core.directHalfCycles(1830), 5);
});

test('hardware steps and sustained notes share the direct pin waveform at native timing', () => {
	const stepSeconds = 80 / MACHINE_CYCLE_HZ;
	const { samples } = renderSm510Notes(core, DIRECT_R, [440, null, 440], { stepSeconds, sampleRate: MASTER_CLOCK_HZ });
	const half = core.directHalfCycles(440);
	const loop = core.renderDirectNote(half, half * 4, MASTER_CLOCK_HZ);
	assert(samples.slice(0, 4).every(sample => sample === 0));
	assert.deepEqual(samples.slice(4, 4 + loop.length), loop);
	assert.deepEqual(samples.slice(4 + loop.length, 4 + 2 * loop.length), loop);
	assert(samples.slice(160, 320).every(sample => sample === 0));
	assert.deepEqual(samples.slice(324, 324 + loop.length), loop);

	const divider = renderSm510Notes(core, DK52_R, [440, 250], { stepSeconds, sampleRate: MASTER_CLOCK_HZ }).samples;
	assert.deepEqual(divider.slice(4, 12), new Float32Array([
		.16, .16, .16, .16, -.16, -.16, -.16, -.16,
	]));
	assert.deepEqual(divider.slice(4, 12), divider.slice(164, 172));
});
