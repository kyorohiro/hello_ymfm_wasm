import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { YM_CODE_EXAMPLES } from './code_examples.js';
import { AY8910Synth } from '../js/ay8910synth.js';
import { Ay8910 } from '../js/ay8910.js';
import {
	buildAyOperations,
	compileAyOperations,
	createAyOperationResetState,
} from '../js/ay8910_operations.js';
import ayFactory from '../generated/ay8910_wasm.js';

const clock = 2_000_000,
	levels = [0, 2, 4, 6, 8, 10, 12, 14, 15, 14, 12, 10, 8, 6, 4, 2],
	wasmBinary = readFileSync(new URL('../generated/ay8910_wasm.wasm', import.meta.url));

async function runExample() {
	const writes = [], traces = [], schedules = [], cleanups = [], beats = [],
		loops = new Map(), melody = [52, 55, 57, 59],
		ym = new AY8910Synth({
			clock,
			transport: { writeRegister: (register, value) => writes.push({ register, value }) },
		});
	// Exercise setup against an already configured, audible shared instrument.
	ym.initialize();
	for (let channel = 0; channel < 3; channel++) {
		ym.setVoice(channel, { tone: true, noise: true, volume: 12, envelope: true });
	}
	writes.length = 0;
	ym.build = buildAyOperations;
	ym.compile = async (plan, options) => {
		assert.equal(options.initialState, 'client');
		const rows = compileAyOperations(plan, ym._getState(), { clock });
		traces.push(rows);
		return rows;
	};
	ym.schedule = async (plan, options) => {
		const rows = compileAyOperations(plan, ym._getState(), { clock });
		schedules.push({ plan, options, rows });
		return { name: options.name, entries: plan.operations.length };
	};
	const globals = {
		async useSoundChip(name) { assert.equal(name, 'ay8910'); return ym; },
		setBpm() {},
		CH1: 0, CH2: 1, CH3: 2,
		scale: () => melody,
		liveLoop: (name, callback) => loops.set(name, callback),
		liveCleanup: (names, callback) => cleanups.push({ names, callback }),
		beat: async value => { beats.push(value); },
		console: { log() {}, table() {} },
	};
	const source = YM_CODE_EXAMPLES['/examples/volume-modulation.js'];
	assert.equal(typeof source, 'string', 'the editable volume example must be supplied in Files');
	const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
	await new AsyncFunction(...Object.keys(globals), source)(...Object.values(globals));
	return { ym, writes, traces, schedules, cleanups, beats, loops, melody };
}

test('the editable volume example keeps melody pitch independent of its scheduled R8 motion', async () => {
	const example = await runExample(),
		{ ym, writes, traces, schedules, cleanups, beats, loops, melody } = example;
	assert.deepEqual([...loops.keys()].sort(), ['melody', 'volume-motion']);
	assert.equal(traces.length, 1, 'setup compiles one initial diagnostic pass');
	assert.deepEqual(traces[0].map(row => [row.register, row.value]), levels.map(level => [8, level]));
	const setup = ym.getRegisterSnapshot();
	assert.equal(setup[7] & 9, 8, 'CH1 tone is enabled and its noise is disabled');
	assert.deepEqual(Array.from(setup.slice(8, 11)), [0, 0, 0]);
	assert.equal(ym._getState().levels[0] & 16, 0, 'setup leaves CH1 in fixed-volume mode');

	writes.length = 0;
	await loops.get('melody')();
	await loops.get('melody')();
	assert.deepEqual(writes.map(row => row.register), [0, 1, 0, 1],
		'melody updates pitch without an R8 gate that recurring volume writes would reopen');
	assert.deepEqual(beats, [0.5, 0.5]);
	assert.equal(schedules.length, 0, 'notes do not replace or restart modulation');
	const pitch = ym.getRegisterSnapshot().slice(0, 2);
	const reference = new AY8910Synth({ clock, transport: { writeRegister() {} } });
	reference.setNote(0, melody[1]);
	assert.deepEqual(pitch, reference.getRegisterSnapshot().slice(0, 2));

	beats.length = 0;
	for (const hz of [25, 50, 100]) {
		// A later shared-instrument edit must not turn the fixed-volume plan into
		// hardware-envelope modulation by preserving its previous envelope bit.
		ym.setVolume(0, 9, true);
		await loops.get('volume-motion')();
		const scheduled = schedules.at(-1);
		assert.deepEqual(scheduled.options, { name: 'volume-modulation', repeatSeconds: 1 / hz });
		assert.equal(scheduled.plan.operations.length, 16);
		assert.deepEqual(scheduled.rows.map(row => [row.register, row.value]),
			levels.map(level => [8, level]), 'every authored step clears envelope mode in R8');
		assert.deepEqual(scheduled.rows.map(row => row.offsetSeconds),
			levels.map((_level, index) => index / (hz * levels.length)));
		assert.equal(scheduled.rows.length / scheduled.options.repeatSeconds, hz * 16);
	}
	assert.equal(schedules.length, 3, 'each slow rate change installs one compact reservation');
	assert.deepEqual(beats, [2, 2, 2]);
	assert.equal(traces.length, 1, 'rate changes reuse the diagnostic result');
	assert.deepEqual(ym.getRegisterSnapshot().slice(0, 2), pitch);

	assert.equal(cleanups.length, 1);
	assert.deepEqual(cleanups[0].names, ['volume-motion'], 'motion removal releases its last amplitude');
	ym.setVolume(0, 12, false);
	writes.length = 0;
	await cleanups[0].callback();
	assert.deepEqual(writes, [{ register: 8, value: 0 }]);
	assert.equal(ym.getRegisterSnapshot()[8], 0);
});

function isolatedState() {
	const setup = new AY8910Synth({ clock, transport: { writeRegister() {} } });
	setup.setVoice(0, { tone: false, noise: false, volume: 0, envelope: false });
	setup.keyOff(1);
	setup.keyOff(2);
	return setup._getState();
}

async function renderRows(rows, state, sampleRate, frames) {
	const chip = await Ay8910.create({
		moduleFactory: ayFactory, moduleOptions: { wasmBinary },
		clock, type: 0x10, flags: 1, sampleRate,
	});
	try {
		state.registers.forEach((value, register) => chip.writeRegister(register, value));
		// The raw normalized DAC has an offset at code zero. Isolate CH1 through
		// the native channel mask instead of assuming zeroed CH2/CH3 contribute zero.
		chip.setMuteMask(6);
		const pcm = new Float32Array(frames), writes = [];
		let frame = 0;
		for (const row of rows) {
			const targetFrame = Math.round(row.offsetSeconds * sampleRate);
			assert(targetFrame >= frame && targetFrame < frames);
			if (targetFrame > frame) pcm.set(chip.generateStereo(targetFrame - frame).left, frame);
			chip.writeRegister(row.register, row.value);
			writes.push({ frame: targetFrame, register: row.register, value: row.value });
			frame = targetFrame;
		}
		if (frame < frames) pcm.set(chip.generateStereo(frames - frame).left, frame);
		return { pcm, writes };
	} finally {
		chip.dispose();
	}
}

function rmsDifference(left, right, lag = 0, start = 0) {
	let sum = 0, count = 0;
	for (let index = start; index + lag < right.length && index < left.length; index++) {
		sum += (left[index] - right[index + lag]) ** 2;
		count++;
	}
	return Math.sqrt(sum / count);
}

for (const sampleRate of [44100, 48000]) {
	test(`shipped YM2149 WASM renders the example's isolated 100 Hz volume motion at ${sampleRate} Hz`, async () => {
		const example = await runExample();
		for (let rate = 0; rate < 3; rate++) await example.loops.get('volume-motion')();
		const { plan, options } = example.schedules.at(-1),
			state = isolatedState(),
			periodFrames = sampleRate / 100,
			cycles = 20,
			frames = periodFrames * cycles,
			periodRows = compileAyOperations(plan, state, { clock }),
			rows = Array.from({ length: cycles }, (_unused, cycle) => periodRows.map(row => ({
				...row, offsetSeconds: cycle * options.repeatSeconds + row.offsetSeconds,
			}))).flat(),
			fixedPlan = buildAyOperations(b => b.setVolume(0, 8, false)),
			fixedRows = compileAyOperations(fixedPlan, createAyOperationResetState(), { clock }),
			fixed = await renderRows(fixedRows, state, sampleRate, frames),
			modulated = await renderRows(rows, state, sampleRate, frames);
		assert.equal(options.repeatSeconds, 0.01);
		assert.equal(periodFrames, sampleRate === 44100 ? 441 : 480);
		assert.equal(modulated.writes.length, levels.length * cycles);
		for (let cycle = 0; cycle < cycles; cycle++) {
			const writes = modulated.writes.slice(cycle * 16, (cycle + 1) * 16);
			assert.equal(writes[0].frame, cycle * periodFrames);
			assert.deepEqual(writes.map(row => [row.register, row.value]), levels.map(level => [8, level]));
			for (let index = 0; index < writes.length; index++) {
				const idealFrame = cycle * periodFrames + index * periodFrames / 16;
				assert(Math.abs(writes[index].frame - idealFrame) <= 0.500001,
					'volume writes occur at the nearest output sample throughout repeated cycles');
			}
		}
		assert(fixed.pcm.every(Number.isFinite) && modulated.pcm.every(Number.isFinite));
		const range = Math.max(...modulated.pcm) - Math.min(...modulated.pcm),
			start = periodFrames * 2,
			fixedRange = Math.max(...fixed.pcm.slice(start)) - Math.min(...fixed.pcm.slice(start));
		assert(range > 0.01, 'fixed-volume register motion produces a varying DAC waveform');
		assert(fixedRange < range * 1e-6, 'the fixed-volume control has constant output');
		assert(new Set(modulated.pcm.slice(start).map(value => Math.round(value * 1e6))).size >= 9,
			'the waveform retains the distinct authored volume codes');
		assert(rmsDifference(modulated.pcm, fixed.pcm, 0, start) > range * 0.1,
			'periodic R8 writes measurably change the constant-volume control');
		// Codes select nonlinear hardware DAC levels. Compare repetition and range,
		// without treating the integer code spacing as linear PCM amplitude spacing.
		assert(rmsDifference(modulated.pcm, modulated.pcm, periodFrames, start) < range * 0.015,
			'the waveform repeats at 100 Hz within output-sample rounding');
		assert(rmsDifference(modulated.pcm, modulated.pcm, Math.round(periodFrames / 2), start) > range * 0.1,
			'the imposed waveform has a full-cycle period instead of a half-cycle period');
	});
}
