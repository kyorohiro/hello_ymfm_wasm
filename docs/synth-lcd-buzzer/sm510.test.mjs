import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeWav } from '../js/wav.js';
import { BUZZER_STARTER, buzzerCodeDeclarations } from './code.js';
import { BUZZER_EXAMPLES } from './code_examples.js';
import {
	DIRECT_R, DK52_R, MACHINE_CYCLE_HZ, MASTER_CLOCK_HZ, MAX_PULSE_HALF_CYCLES, MIN_PULSE_HALF_CYCLES,
	R1_DIVISOR, R1_HZ, buildSm510Pulse,
	createSm510AudioCore, createSm510CodeChip, directPitchHz, readRAtTick, readSm510CycleSequence,
	renderR1Pattern, renderR1Timeline, renderSm510Notes,
} from './sm510.js';

const { instance } = await WebAssembly.instantiate(await readFile(new URL('./sm510.wasm', import.meta.url)));
const core = createSm510AudioCore(instance.exports);
const render = core.renderR1;

test('Code declarations expose the note, R output, and timed playback clients', () => {
	const types = buzzerCodeDeclarations('');
	assert.match(types, /'lcd-buzzer': BuzzerCodeChip/);
	assert.match(types, /sm510: Sm510CodeChip<'sm510'> & BuzzerPerformance/);
	assert.match(types, /'sm510-direct': Sm510DirectCodeChip/);
	assert.match(types, /'sm510-dk52': Sm510CodeChip<'sm510-dk52'> & BuzzerPerformance/);
	assert.match(types, /interface Sm510DirectCodeChip extends Sm510CodeChip<'sm510-direct'>, BuzzerPerformance/);
	assert.match(types, /interface Sm511CodeChip extends BuzzerTimedPlayback<Sm511MelodySequence \| Sm511InstructionSequence>, BuzzerNotePerformance/);
	assert.match(types, /pulseTiming\(frequencyHz: number, duty\?: number\): Sm510PulseTiming/);
	assert.match(types, /readonly REG_R: 0/);
	assert.match(types, /noteOn\(channel: typeof CH1/);
	assert.match(types, /atCycle\(machineCycle: number\)/);
	assert.match(types, /compile\(sequence: Sm510CycleSequence\): Sm510CycleWrite\[\]/);
	assert.match(types, /compile\(sequence: Sm511MelodySequence\): Sm511MelodySlot\[\]/);
	assert.match(types, /schedule\(sequence: Sequence, options: BuzzerScheduleOptions\)/);
	assert.match(types, /clearSchedule\(name: string\): Promise<boolean>/);
});

test('the starter and SM510 examples specify their tone source in Code', () => {
	assert.match(BUZZER_STARTER, /useSoundChip\("sm510-direct"\)/);
	const clients = {
		'/examples/short-beep.js': 'sm510-dk52',
		'/examples/chirp.js': 'sm510-direct',
		'/examples/trill.js': 'sm510-direct',
		'/examples/sm510-r1.js': 'sm510-dk52',
		'/examples/sm510-cycles.js': 'sm510-dk52',
	};
	for (const [path, name] of Object.entries(clients)) {
		const example = BUZZER_EXAMPLES.find(example => example.path === path);
		assert(example?.data.includes(`useSoundChip("${name}")`), path);
	}
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

test('DK-52 interval zero holds the selected R bits and loops the continuous carrier', () => {
	const level = Math.fround(.16);
	const carrier = Float32Array.of(level, level, level, level, -level, -level, -level, -level);
	for (const driveMask of [0, 1, 2, 3]) {
		const pulse = buildSm510Pulse(DK52_R, 0, driveMask);
		assert.deepEqual(pulse, { end: 12, writes: Uint32Array.of(4, driveMask), loopStart: 4, halfTicks: 0 });
		const loopLength = pulse.end - pulse.loopStart;
		const continuous = { ...pulse, end: pulse.end + loopLength };
		for (const [bit, renderPin] of [[1, core.renderR1], [2, core.renderR2]]) {
			const expected = driveMask & bit ? carrier.map(sample => bit === 1 ? sample : -sample) : new Float32Array(8);
			const pcm = renderR1Timeline(continuous, MASTER_CLOCK_HZ, renderPin);
			assert(pcm.slice(0, 4).every(sample => sample === 0));
			assert.deepEqual(pcm.slice(4, 12), expected);
			assert.deepEqual(pcm.slice(12), expected);
		}
	}
	assert.throws(() => buildSm510Pulse(DIRECT_R, 0, 1), /machine cycles/);
});

test('DK-52 at 126 cycles uses exact closed and continuous duty endpoints', () => {
	const halfCycles = 63;
	const closed = core.dividerPulseTiming(halfCycles, 0);
	const open = core.dividerPulseTiming(halfCycles, 1);
	assert.deepEqual(closed, { highCycles: 0, lowCycles: 126, periodCycles: 126, frequency: 0, duty: 0 });
	assert.deepEqual(open, { highCycles: 126, lowCycles: 0, periodCycles: 126, frequency: 0, duty: 1 });

	const mask = 3;
	const closedPlan = buildSm510Pulse(DK52_R, halfCycles, mask, closed.highCycles);
	const openPlan = buildSm510Pulse(DK52_R, halfCycles, mask, open.highCycles);
	assert.deepEqual([...openPlan.writes], [4, mask]);
	assert.equal(openPlan.end - openPlan.loopStart, R1_DIVISOR);
	const continuous = buildSm510Pulse(DK52_R, 0, mask);
	// Listen beyond the configured interval to catch a falling edge at wrap.
	const end = 4 + 2 * open.periodCycles + 2 * R1_DIVISOR;
	for (const renderPin of [core.renderR1, core.renderR2]) {
		const silence = renderR1Timeline({ ...closedPlan, end }, MASTER_CLOCK_HZ, renderPin);
		assert(silence.every(sample => sample === 0));
		assert.deepEqual(renderR1Timeline({ ...openPlan, end }, MASTER_CLOCK_HZ, renderPin),
			renderR1Timeline({ ...continuous, end }, MASTER_CLOCK_HZ, renderPin));
	}
	assert.equal(core.dividerPulseTiming(halfCycles, .001).highCycles, 2);
	assert.equal(core.dividerPulseTiming(halfCycles, .999).lowCycles, 2);
});

test('DK-52 gate duty changes the R-write width and preserves carrier phase across an odd loop', () => {
	const timing = core.pulseTiming(5, .3);
	assert.deepEqual(timing, {
		highCycles: 3, lowCycles: 7, periodCycles: 10, frequency: MACHINE_CYCLE_HZ / 10, duty: .3,
	});
	const pulse = buildSm510Pulse(DK52_R, 5, 3, timing.highCycles);
	assert.deepEqual(pulse, {
		end: 44, writes: Uint32Array.of(4, 3, 10, 0, 24, 3, 30, 0), loopStart: 4, halfTicks: 10,
	});
	const cpuWrites = pulseRomWrites(buildPulseRom(3, 7, 3, 0), 22);
	assert.deepEqual([...pulse.writes], cpuWrites.slice(0, -1).flatMap(([cycle, value]) => [2 * cycle, value]));

	const loopTicks = pulse.end - pulse.loopStart;
	const nextWrites = pulse.writes.map((value, index) => index % 2 === 0 ? value + loopTicks : value);
	const repeated = { end: pulse.end + loopTicks, writes: Uint32Array.from([...pulse.writes, ...nextWrites]) };
	const level = Math.fround(.16);
	const expected = Float32Array.from({ length: loopTicks }, (_, offset) => {
		if (offset % 20 >= 6) return 0;
		return (pulse.loopStart + offset) % 8 >= 4 ? level : -level;
	});
	for (const [renderPin, pinLoop] of [
		[core.renderR1, expected], [core.renderR2, expected.map(sample => sample === 0 ? 0 : -sample)],
	]) {
		const pcm = renderR1Timeline(repeated, MASTER_CLOCK_HZ, renderPin);
		assert(pcm.slice(0, pulse.loopStart).every(sample => sample === 0));
		assert.deepEqual(pcm.slice(pulse.loopStart, pulse.end), pinLoop);
		assert.deepEqual(pcm.slice(pulse.end), pinLoop);
	}
});

test('DK-52 pulse timing clamps to executable gate widths and preserves the pattern gate', () => {
	assert.equal(core.pulseTiming(4, .001).highCycles, 2);
	assert.equal(core.pulseTiming(4, .999).lowCycles, 2);
	assert.deepEqual(core.pulseTiming(5, .3), core.directPulseTiming(5, .3));
	for (const duty of [-.01, 1.01, NaN]) assert.throws(() => core.pulseTiming(4, duty), /duty/i);
	for (const highCycles of [1, 7, 2.5])
		assert.throws(() => buildSm510Pulse(DK52_R, 4, 1, highCycles), /machine cycles/);
	const notes = [440, null, 220], settings = { stepSeconds: .1, gate: .65, sampleRate: MASTER_CLOCK_HZ };
	assert.deepEqual(renderSm510Notes(core, DK52_R, notes, { ...settings, duty: .25 }),
		renderSm510Notes(core, DK52_R, notes, settings));
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

test('SM510 compilation preserves authored write order and keeps playback data detached', () => {
	const direct = createSm510CodeChip({ id: 'sm510-direct' });
	const dk52 = createSm510CodeChip({});
	const plan = direct.build(b => {
		b.atCycle(2).write(direct.REG_R, 3).write(direct.REG_R, 0xe);
		b.atCycle(6).write(direct.REG_R, 0);
	});
	assert(Object.isFrozen(plan));
	const expected = [
		{ offsetSeconds: 4 / MASTER_CLOCK_HZ, machineCycle: 2, masterTick: 4, register: 0, value: 3, operationIndex: 0, writeIndex: 0 },
		{ offsetSeconds: 4 / MASTER_CLOCK_HZ, machineCycle: 2, masterTick: 4, register: 0, value: 14, operationIndex: 1, writeIndex: 0 },
		{ offsetSeconds: 12 / MASTER_CLOCK_HZ, machineCycle: 6, masterTick: 12, register: 0, value: 0, operationIndex: 2, writeIndex: 0 },
	];
	const trace = direct.compile(plan);
	assert.deepEqual(trace, expected);
	trace[0].value = 0;
	const { id, end, writes } = readSm510CycleSequence(plan, direct);
	assert.equal(id, 'sm510-direct');
	assert.equal(end, 12);
	assert.deepEqual([...writes], [4, 3, 4, 14, 12, 0, 12, 0]);
	writes.fill(0);
	assert.deepEqual(direct.compile(plan), expected);
	assert.deepEqual([...readSm510CycleSequence(plan).writes], [4, 3, 4, 14, 12, 0, 12, 0]);
	assert.throws(() => readSm510CycleSequence(plan, dk52), /from build/);
	assert.throws(() => dk52.compile(plan), /from build/);
	assert.throws(() => dk52.playCycles(plan), /from build/);
});

// Sharp Microcomputers Data Book (1990), SM510 pp. 149–157. Opcodes
// and their operand bytes follow the same 63-position page counter.
function nextAddress(address) {
	const withinPage = address & 63;
	const prepend = withinPage % 2 === Math.floor(withinPage / 2) % 2 ? 32 : 0;
	return address - withinPage + prepend + Math.floor(withinPage / 2);
}

function buildPulseRom(high, low, highValue, lowValue) {
	const rom = new Map();
	function writePage(page, bytes) {
		assert(bytes.length <= 63);
		const addresses = [];
		let address = page * 64;
		for (const byte of bytes) {
			assert(!rom.has(address));
			addresses.push(address);
			rom.set(address, byte);
			address = nextAddress(address);
		}
		return addresses;
	}
	const pad = cycles => Array(cycles).fill(0x00); // SKIP
	const latch = value => [0x20 + value, 0x61]; // LAX, ATR
	const jump = page => [0x70 + page, 0]; // TL to a page in the same bank
	const highFirst = high <= low;
	const short = Math.min(high, low), long = Math.max(high, low);
	const period = high + low;
	const shortLatch = latch(highFirst ? highValue : lowValue), longLatch = latch(highFirst ? lowValue : highValue);
	const shortBody = [...shortLatch, ...pad(short - 2)];
	let longEntry;
	if (period <= 63) {
		// T fits in one cycle and returns to the start of this page.
		const addresses = writePage(0, [...shortBody, ...longLatch, ...pad(long - 3), 0x80]);
		longEntry = addresses[short];
	} else if (short <= 59) {
		// Put both writes in the first page. Two TLs are inside the longer phase.
		const firstPage = Math.min(63, period - 2);
		const addresses = writePage(0, [...shortBody, ...longLatch, ...pad(firstPage - short - 4), ...jump(1)]);
		writePage(1, [...pad(period - firstPage - 2), ...jump(0)]);
		longEntry = addresses[short];
	} else {
		writePage(0, [...shortLatch, ...pad(short - 4), ...jump(1)]);
		if (long <= 63) {
			writePage(1, [...longLatch, ...pad(long - 4), ...jump(0)]);
		} else {
			// Leave at least two cycles for the final TL in the third page.
			const firstLongPage = Math.min(63, long - 2);
			writePage(1, [...longLatch, ...pad(firstLongPage - 4), ...jump(2)]);
			writePage(2, [...pad(long - firstLongPage - 2), ...jump(0)]);
		}
		longEntry = 64;
	}
	return { rom, entry: highFirst ? 0 : longEntry };
}

function pulseRomWrites({ rom, entry }, endCycle) {
	let pc = entry, cycle = 0, acc = 0, previousLax = false;
	const writes = [];
	function fetch() {
		const byte = rom.get(pc);
		assert.notEqual(byte, undefined, `unpopulated ROM address ${pc.toString(16)}`);
		cycle++;
		pc = nextAddress(pc);
		return byte;
	}
	while (cycle < endCycle) {
		const opcode = fetch();
		const lax = opcode >= 0x20 && opcode <= 0x2f;
		if (lax) {
			if (!previousLax) acc = opcode - 0x20;
		} else if (opcode === 0x61) {
			writes.push([cycle, acc & 3]);
		} else if (opcode >= 0x80 && opcode <= 0xbf) {
			pc = pc - pc % 64 + opcode - 0x80;
		} else if (opcode >= 0x70 && opcode <= 0x7b) {
			const operand = fetch();
			pc = Math.floor(operand / 64) * 1024 + (opcode - 0x70) * 64 + operand % 64;
		} else assert.equal(opcode, 0x00);
		previousLax = lax;
	}
	return writes;
}

test('each allowed Direct R HIGH/LOW split has an executable SM510 ROM loop', () => {
	for (let half = MIN_PULSE_HALF_CYCLES; half <= MAX_PULSE_HALF_CYCLES; half++) {
		const period = 2 * half;
		for (let high = 2; high <= period - 2; high++) {
			const writes = pulseRomWrites(buildPulseRom(high, period - high, 1, 2), 2 + 2 * period);
			assert.deepEqual(writes, [
				[2, 1], [2 + high, 2], [2 + period, 1], [2 + period + high, 2], [2 + 2 * period, 1],
			], `${high}/${period - high} cycles`);
			const pulse = buildSm510Pulse(DIRECT_R, half, 3, high);
			assert.deepEqual([...pulse.writes], [4, 1, 2 * (2 + high), 2]);
			assert.equal(pulse.end, 2 * (2 + period));
		}
	}
});

test('Direct R duty rounds to machine cycles without moving the existing pitch', () => {
	for (let half = MIN_PULSE_HALF_CYCLES; half <= MAX_PULSE_HALF_CYCLES; half++) {
		const period = 2 * half;
		assert.equal(core.directHalfCycles(directPitchHz(half)), half);
		assert.deepEqual(core.directPulseTiming(half), {
			highCycles: half, lowCycles: half, periodCycles: period, frequency: directPitchHz(half), duty: .5,
		});
		for (const duty of [.01, .237, .681, .99]) {
			const highCycles = Math.max(2, Math.min(period - 2, Math.round(period * duty)));
			assert.deepEqual(core.directPulseTiming(half, duty), {
				highCycles, lowCycles: period - highCycles, periodCycles: period,
				frequency: directPitchHz(half), duty: highCycles / period,
			});
		}
	}
	assert.equal(core.directHalfCycles(440), 19);
	assert.equal(directPitchHz(19).toFixed(2), '431.16');
	assert.equal(core.directHalfCycles(130.81278265), 63);
	assert.equal(core.directHalfCycles(1046.5022612), 8);
	assert.equal(core.directHalfCycles(1830), 5);
});

test('Direct R exact duty endpoints hold one phase without periodic R writes', () => {
	const halfCycles = 63, periodCycles = 2 * halfCycles;
	const level = Math.fround(.16);
	for (const duty of [0, 1]) {
		const timing = core.directPulseTiming(halfCycles, duty);
		assert.deepEqual(timing, { highCycles: duty * periodCycles, lowCycles: (1 - duty) * periodCycles, periodCycles, frequency: 0, duty });
		assert.deepEqual(core.pulseTiming(halfCycles, duty), timing);
		for (const driveMask of [0, 1, 2, 3]) {
			const plan = buildSm510Pulse(DIRECT_R, halfCycles, driveMask, timing.highCycles);
			const latch = driveMask & (duty === 1 ? 1 : 2);
			assert.deepEqual([...plan.writes], [4, latch]);
			assert.equal(plan.end - plan.loopStart, 2 * periodCycles);
			for (const [pin, renderPin] of [[1, core.renderDirectR1], [2, core.renderDirectR2]]) {
				const pcm = renderR1Timeline(plan, MASTER_CLOCK_HZ, renderPin);
				assert(pcm.slice(0, plan.loopStart).every(sample => sample === 0));
				assert(pcm.slice(plan.loopStart).every(sample => sample === (latch & pin ? level : 0)));
			}
		}
	}
});

test('Direct R patterns and WAV are silent at exact duty endpoints and retain a tone near them', () => {
	const halfCycles = 63, sampleRate = 48000;
	const frequencies = [directPitchHz(halfCycles), null];
	const settings = { stepSeconds: .1, gate: 1, sampleRate };
	const near = renderSm510Notes(core, DIRECT_R, frequencies, { ...settings, duty: .99 });
	assert.equal(near.directPulses[0].lowCycles, 2);
	assert.equal(near.directPulses[0].frequency, directPitchHz(halfCycles));
	assert(near.samples.some(sample => sample > 0));
	for (const duty of [0, 1]) {
		const { samples, directPulses } = renderSm510Notes(core, DIRECT_R, frequencies, { ...settings, duty });
		assert.equal(directPulses[0].frequency, 0);
		assert.equal(samples.length, near.samples.length);
		assert(samples.every(sample => sample === 0));
		const wav = encodeWav({ sampleRate, channels: [samples] });
		assert(wav.subarray(44).every(byte => byte === 0));
	}
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

test('Direct R note and sequence playback write the asymmetric falling edge at the same cycle', () => {
	const stepSeconds = 80 / MACHINE_CYCLE_HZ;
	const duty = .32;
	const options = { duty, stepSeconds, sampleRate: MASTER_CLOCK_HZ };
	const half = core.directHalfCycles(440);
	const timing = core.directPulseTiming(half, duty);
	const { samples, directPulses } = renderSm510Notes(core, DIRECT_R, [440, null, 440], options);
	assert.deepEqual(directPulses, [timing, null, timing]);

	const pulse = buildSm510Pulse(DIRECT_R, half, 3, timing.highCycles);
	const pin1 = renderR1Timeline(pulse, MASTER_CLOCK_HZ, core.renderDirectR1);
	const pin2 = renderR1Timeline(pulse, MASTER_CLOCK_HZ, core.renderDirectR2);
	const level = Math.fround(.16), firstFall = pulse.loopStart + 2 * timing.highCycles;
	assert.deepEqual(samples.subarray(pulse.loopStart, pulse.end), pin1.subarray(pulse.loopStart));
	assert.equal(samples[firstFall - 1], level);
	assert.equal(samples[firstFall], 0);
	assert.equal(pin2[firstFall - 1], 0);
	assert.equal(pin2[firstFall], level);
	assert.equal(samples[firstFall + 2 * timing.periodCycles - 1], level);
	assert.equal(samples[firstFall + 2 * timing.periodCycles], 0);
	assert(samples.slice(160, 320).every(sample => sample === 0));

	const divider = renderSm510Notes(core, DK52_R, [440, null, 440], options);
	const original = renderSm510Notes(core, DK52_R, [440, null, 440], { stepSeconds, sampleRate: MASTER_CLOCK_HZ });
	assert.deepEqual(divider.samples, original.samples);
});
