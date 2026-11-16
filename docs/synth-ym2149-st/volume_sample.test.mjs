import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { YM_CODE_EXAMPLES } from './code_examples.js';
import { AY8910Synth } from '../js/ay8910synth.js';
import { Ay8910 } from '../js/ay8910.js';
import { buildAyOperations, compileAyOperations } from '../js/ay8910_operations.js';
import ayFactory from '../generated/ay8910_wasm.js';

const clock = 2_000_000,
	wasmBinary = readFileSync(new URL('../generated/ay8910_wasm.wasm', import.meta.url));

// Independent oracle from third_party/mame-ay8910/ay8910.cpp: fixed-volume
// YM2149 resistors, 630/801 ohm pull-up/down, and the 1000 ohm output load.
// Codes are normalized above their zero-code baseline, not divided by 15.
const resistors = [73770, 37586, 27458, 21451, 15864, 12371, 8922, 6796,
	4763, 3521, 2403, 1737, 1123, 762, 438, 251];
const rawLevels = resistors.map(resistance => {
	const up = 1 / resistance + 1 / 630;
	return up / (up + 1 / 801 + 1 / 1000);
});
const gains = rawLevels.map(level => (level - rawLevels[0]) / (rawLevels[15] - rawLevels[0]));

function closestCode(sample) {
	let best = 0;
	for (let code = 1; code < gains.length; code++) {
		if (Math.abs(gains[code] - sample) < Math.abs(gains[best] - sample)) best = code;
	}
	return best;
}

async function runExample() {
	const writes = [], traces = [], schedules = [], cleanups = [], beats = [], tables = [],
		loops = new Map(),
		ym = new AY8910Synth({
			clock,
			transport: { writeRegister: (register, value) => writes.push({ register, value }) },
		});
	// Start from a sounding shared instrument, so setup must clear both the
	// hardware envelope selection and the other two voices explicitly.
	ym.initialize();
	for (let channel = 0; channel < 3; channel++) {
		ym.setVoice(channel, { tone: true, noise: true, volume: 12, envelope: true });
	}
	writes.length = 0;
	ym.build = buildAyOperations;
	ym.compile = async (plan, options) => {
		assert.deepEqual(options, { initialState: 'client' });
		const rows = compileAyOperations(plan, ym._getState(), { clock });
		traces.push({ plan, rows });
		return rows;
	};
	ym.schedule = async (plan, options) => {
		const rows = compileAyOperations(plan, ym._getState(), { clock });
		schedules.push({ plan, options, rows });
		return { name: options.name, entries: plan.operations.length };
	};
	const globals = {
		async useSoundChip(name) { assert.equal(name, 'ay8910'); return ym; },
		setBpm() {}, CH1: 0, CH2: 1, CH3: 2,
		liveLoop: (name, callback) => loops.set(name, callback),
		liveCleanup: (names, callback) => cleanups.push({ names, callback }),
		beat: async value => { beats.push(value); },
		console: { log() {}, table: rows => tables.push(rows) },
	};
	const source = YM_CODE_EXAMPLES['/examples/volume-sample.js'];
	assert.equal(typeof source, 'string', 'Files must supply the editable volume-sample example');
	const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
	// Inspect the generated data from the actual editable source, instead of
	// maintaining a second implementation of its percussion synthesizer here.
	const data = await new AsyncFunction(...Object.keys(globals),
		`${source}\n;return { samples, codes, sampleRate };`)(...Object.values(globals));
	return { source, data, ym, state: ym._getState(), writes, traces, schedules, cleanups, beats, tables, loops };
}

test('the editable volume sample quantizes generated percussion to the nonlinear YM2149 DAC', async () => {
	const { source, data, ym, state, traces, tables, loops, schedules, beats, cleanups, writes } = await runExample(),
		{ samples, codes, sampleRate } = data;
	assert.equal(sampleRate, 8000);
	assert.equal(samples.length, 640);
	assert.equal(codes.length, samples.length);
	assert.equal(samples[0], 0);
	assert.equal(samples.at(-1), 0);
	assert(samples.every(sample => Number.isFinite(sample) && sample >= 0 && sample <= 1));
	assert(Math.max(...samples) > 0.5, 'the generated hit has a substantial attack');
	assert(samples.slice(80, 160).some(sample => sample > 0.01));
	assert.equal(codes[0], 0);
	assert.deepEqual(Array.from(codes.slice(-4)), [0, 0, 0, 0], 'the fade reaches code-zero silence before the terminal write');
	assert(codes.every(code => Number.isInteger(code) && code >= 0 && code <= 15));
	assert.deepEqual(Array.from(codes), Array.from(samples, closestCode));
	const nearestError = samples.reduce((sum, sample, index) => sum + (gains[codes[index]] - sample) ** 2, 0),
		linearError = samples.reduce((sum, sample) => sum + (gains[Math.round(sample * 15)] - sample) ** 2, 0);
	assert(nearestError < linearError * 0.25,
		'inverting the nonlinear DAC must reconstruct the sample substantially better than rounding sample * 15');
	assert.doesNotMatch(source, /\b(?:import|fetch|file|loadSample|setSample|playFromSample)\s*(?:\(|["'])/,
		'the percussion is generated locally and does not load a PCM sample or another module');

	assert.deepEqual(Array.from(state.registers.slice(8, 11)), [0, 0, 0]);
	assert.equal(state.registers[7] & 9, 9, 'CH1 tone and noise are disabled for volume-only output');
	assert.equal(state.registers[7] & 0x36, 0, 'setup preserves the other voices\' mixer bits');
	assert.equal(state.levels[0] & 16, 0, 'CH1 starts in fixed-volume mode');
	assert.equal(traces.length, 1);
	const { plan, rows } = traces[0];
	assert.equal(plan.referenceSampleRate, sampleRate);
	assert.equal(plan.operations.length, 641);
	assert.equal(rows.length, 641);
	for (let index = 0; index <= samples.length; index++) {
		const code = index < codes.length ? codes[index] : 0;
		assert.deepEqual(plan.operations[index], {
			time: { unit: 'sample', value: index }, order: index,
			method: 'setVolume', args: [0, code, false],
		});
		assert.equal(rows[index].offsetSeconds, index / sampleRate);
		assert.equal(rows[index].register, 8);
		assert.equal(rows[index].value, code);
	}
	assert.equal(rows.at(-1).offsetSeconds, 0.08);
	assert.deepEqual(tables, [rows.slice(0, 24)], 'console output previews only the first 24 compiled rows');
	assert.deepEqual([...loops.keys()], ['drums']);
	assert.equal(schedules.length, 0, 'selecting/evaluating setup does not start the live loop');
	for (let hit = 0; hit < 2; hit++) {
		ym.setVolume(0, 9, true);
		await loops.get('drums')();
		const scheduled = schedules.at(-1);
		assert.deepEqual(scheduled.options, { name: 'volume-sample' }, 'each beat installs one named one-shot');
		assert.deepEqual(scheduled.plan, plan);
		assert.deepEqual(scheduled.rows, rows, 'every sample write clears a later hardware-envelope edit');
	}
	assert.deepEqual(beats, [1, 1]);
	assert.equal(cleanups.length, 1);
	assert.deepEqual(cleanups[0].names, ['drums']);
	// The lifecycle cancels the loop's reservation; its cleanup must also
	// silence a last positive DAC level when the loop is removed on Apply.
	ym.setVolume(0, 12, false);
	writes.length = 0;
	await cleanups[0].callback();
	assert.deepEqual(writes, [{ register: 8, value: 0 }]);
});

async function renderRows(rows, state, sampleRate, frames) {
	const chip = await Ay8910.create({
		moduleFactory: ayFactory, moduleOptions: { wasmBinary },
		clock, type: 0x10, flags: 1, sampleRate,
	});
	try {
		state.registers.forEach((value, register) => chip.writeRegister(register, value));
		// Raw chip PCM retains a zero-code baseline. Exclude CH2/CH3 through
		// the real channel mask so their electrical baselines cannot mask a bug.
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

for (const sampleRate of [44100, 48000]) {
	test(`shipped YM2149 WASM renders the 80 ms volume sample and zero-code tail at ${sampleRate} Hz`, async () => {
		const example = await runExample(),
			{ rows } = example.traces[0],
			tailFrame = Math.round(0.08 * sampleRate),
			{ pcm, writes } = await renderRows(rows, example.state, sampleRate,
				tailFrame + Math.round(sampleRate * 0.01));
		assert.equal(writes.length, 641);
		assert.equal(writes.at(-1).frame, tailFrame);
		assert.equal(tailFrame, sampleRate === 44100 ? 3528 : 3840);
		assert(pcm.every(Number.isFinite));
		assert(Math.max(...pcm) - Math.min(...pcm) > 0.08, 'the real volume DAC produces a substantial varying waveform');
		const intervals = new Set(), observedCodes = new Set();
		let squaredError = 0, linearSquaredError = 0, comparedFrames = 0;
		for (let index = 0; index < writes.length; index++) {
			const write = writes[index], nextFrame = writes[index + 1]?.frame ?? pcm.length,
				idealFrame = index * sampleRate / 8000,
				expected = Math.fround(Math.fround((gains[write.value] - 0.25) * 0.5) / 3),
				linear = (write.value / 15 - 0.25) * 0.5 / 3;
			assert.equal(write.frame, Math.round(idealFrame));
			assert(Math.abs(write.frame - idealFrame) <= 0.500001);
			assert.equal(write.register, 8);
			if (index + 1 < writes.length) intervals.add(nextFrame - write.frame);
			observedCodes.add(write.value);
			// A chip tick can straddle the first output frame after a register
			// write. Subsequent frames must settle to the source-derived DAC level.
			for (let frame = write.frame + 1; frame < nextFrame; frame++) {
				assert(Math.abs(pcm[frame] - expected) < 2e-8,
					`code ${write.value} must settle to its nonlinear DAC output at frame ${frame}`);
				squaredError += (pcm[frame] - expected) ** 2;
				linearSquaredError += (pcm[frame] - linear) ** 2;
				comparedFrames++;
			}
		}
		assert.deepEqual([...intervals].sort(), sampleRate === 44100 ? [5, 6] : [6]);
		assert(observedCodes.size >= 10, 'the hit exercises a useful range of fixed-volume codes');
		assert(Math.sqrt(squaredError / comparedFrames) < 2e-8);
		assert(Math.sqrt(linearSquaredError / comparedFrames) > 0.01,
			'the actual DAC waveform measurably differs from equally spaced volume codes');
		const rawZero = Math.fround(-0.125 / 3);
		assert(pcm.subarray(tailFrame + 1).every(value => value === rawZero),
			'the terminal write restores the raw zero-code baseline without a held positive level');
	});
}
