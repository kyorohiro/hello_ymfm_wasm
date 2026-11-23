import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buzzerCodeDeclarations } from './code.js';
import { BUZZER_EXAMPLES } from './code_examples.js';
import { createSm510AudioCore, MASTER_CLOCK_HZ } from './sm510.js';
import {
	SM511_PRE, SM511_SME, SM511_RME, SM511_TMEL,
	buildSm511MelodySequence, compileSm511MelodySequence, createSm511CodeChip, createSm511Controller,
	formatSm511MelodyCode, readSm511InstructionSequence, readSm511MelodySequence,
	renderSm511Melody, renderSm511CommandCycle, renderSm511Pattern,
	sm511Command, sm511CommandLabel, sm511Label, traceSm511Melody, validateMelody,
} from './sm511.js';

const { instance, module } = await WebAssembly.instantiate(await readFile(new URL('./sm510.wasm', import.meta.url)));
const core = createSm510AudioCore(instance.exports);
const newController = () => createSm511Controller(new WebAssembly.Instance(module).exports);

test('SM511 instruction control keeps the ROM cursor clocked while R is disabled', () => {
	const controller = newController();
	const render = ticks => {
		const samples = new Float32Array(ticks);
		controller.renderInto(samples, MASTER_CLOCK_HZ);
		return samples;
	};
	controller.load([0x12, 0x01, 0x29]);
	controller.apply(SM511_PRE, 0);
	controller.apply(SM511_SME);
	assert(render(64).some(value => value > 0));
	controller.apply(SM511_RME);
	assert(render(2048 - 64).every(value => value === 0));
	assert.equal(controller.getState().address, 1);
	assert.equal(controller.getState().enabled, false);
	assert.equal(controller.apply(SM511_TMEL), 0);
	render(1);
	assert.equal(controller.getState().stopFlag, true);
	assert.equal(controller.getState().stopFlag, true, 'observing state retains MES');
	assert.equal(controller.apply(SM511_TMEL), 1);
	assert.equal(controller.apply(SM511_TMEL), 0);
	render(1);
	assert.equal(controller.apply(SM511_TMEL), 1, 'Stop can set MES again');
	controller.apply(SM511_PRE, 2);
	controller.apply(SM511_SME);
	assert.equal(controller.getState().address, 2);
	assert(render(64).some(value => value > 0));
});

test('SM511 timed instructions reserve two cycles and render a detached ROM snapshot', () => {
	const chip = createSm511CodeChip({});
	chip.setMelody([0x01, 0x12, 0x01]);
	const plan = chip.build(b => b.pre(1).sme().atCycle(22).rme().atCycle(30));
	chip.setMelody([0x01]);
	const trace = chip.compile(plan);
	assert.deepEqual(trace.map(({ operation, address, machineCycle, masterTick }) =>
		[operation, address, machineCycle, masterTick]), [['PRE', 1, 2, 8], ['SME', undefined, 4, 16], ['RME', undefined, 24, 96]]);
	const { words, events, end } = readSm511InstructionSequence(plan);
	assert.deepEqual([...words.slice(0, 4)], [0x01, 0x12, 0x01, 0x01]);
	assert.equal(end, 120);
	const samples = new Float32Array(end), controller = newController();
	controller.load(words);
	controller.renderInto(samples, MASTER_CLOCK_HZ, events);
	assert(samples.subarray(0, 16).every(sample => sample === 0));
	assert(samples.subarray(16, 96).some(sample => sample > 0));
	assert(samples.subarray(96).every(sample => sample === 0));
	assert.throws(() => chip.build(b => b.pre(0).atCycle(1)), /two cycles/);
	assert.throws(() => chip.build(b => b.pre(256)), /0x00 to 0xFF/);
});

test('the bundled SM511 timed example resumes at a later ROM pitch after a muted slot', async () => {
	const { data } = BUZZER_EXAMPLES.find(({ path }) => path === '/examples/sm511-timed.js');
	const chip = createSm511CodeChip({});
	let sequence, trace;
	chip.schedule = (plan, options) => {
		assert.deepEqual(options, { name: 'sm511-timed', repeatSeconds: 1 });
		sequence = readSm511InstructionSequence(plan);
	};
	const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
	await new AsyncFunction('useSoundChip', 'console', data)(async name => {
		assert.equal(name, 'sm511');
		return chip;
	}, { table(rows) { trace = rows; } });
	assert.deepEqual(trace.map(({ operation, address, masterTick }) => [operation, address, masterTick]), [
		['PRE', 1, 8], ['SME', undefined, 16], ['RME', undefined, 4096],
		['SME', undefined, 8192], ['RME', undefined, 12288],
	]);
	assert.equal(sequence.end, MASTER_CLOCK_HZ / 2);
	const samples = new Float32Array(sequence.end), controller = newController();
	controller.load(sequence.words);
	controller.renderInto(samples, MASTER_CLOCK_HZ, sequence.events);
	function measuredPitch(from, to) {
		let risingEdges = 0;
		for (let i = from + 1; i < to; i++) {
			if (samples[i] > 0 && samples[i - 1] === 0) risingEdges++;
		}
		return risingEdges * MASTER_CLOCK_HZ / (to - from);
	}
	assert(Math.abs(measuredPitch(128, 4096) - core.sm511PitchHz(0x2d)) < 10);
	assert(samples.subarray(4096, 8192).every(sample => sample === 0));
	assert(Math.abs(measuredPitch(8192, 12288) - core.sm511PitchHz(0x32)) < 10);
	assert(samples.subarray(12288).every(sample => sample === 0));
});

test('SM511 live Code forwards instruction operands and reads TMEL independently', async () => {
	const operations = [];
	const state = { address: 2, enabled: true, stopFlag: true, pin: 0, masterTick: 24 };
	const chip = createSm511CodeChip({ control: {
		reset() { operations.push('load'); },
		command(rom, operation, operand) { operations.push([rom[0], operation, operand]); return operation === SM511_TMEL ? 1 : 0; },
		captureState() { return state; },
	} });
	chip.setMelody([0x12, 0x01]);
	await chip.pre(0);
	await chip.sme();
	assert.equal(await chip.tmel(), true);
	await chip.rme();
	assert.equal(await chip.captureState(), state);
	assert.deepEqual(operations, ['load', [0x12, SM511_PRE, 0], [0x12, SM511_SME, undefined],
		[0x12, SM511_TMEL, undefined], [0x12, SM511_RME, undefined]]);
});

test('SM511 maps legacy note values to the two real ROM octaves', () => {
	assert.deepEqual([48, 49, 60, 61, 72, 84].map(sm511Label), ['C6', 'C♯5', 'C6', 'C♯6', 'C7', 'C7']);
	assert.deepEqual(Array.from({ length: 24 }, (_, index) => sm511Command(49 + index)),
		[13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18]);
	for (let midi = 49; midi <= 72; midi++) {
		const command = sm511Command(midi);
		assert.equal(sm511CommandLabel(command | 0x20), sm511Label(midi));
	}
	const loop = renderSm511CommandCycle(core, 0x02);
	assert.equal(loop.length, 62);
	assert.deepEqual([...loop], Array.from({ length: 62 }, (_, i) => i >= 14 && i < 30 || i >= 46 ? Math.fround(.16) : 0));
	assert.equal(core.sm511PitchHz(0x12), 2 * MASTER_CLOCK_HZ / 31);
});

test('SM511 melody playback respects ROM rests, slot lengths, and first stop', () => {
	const commands = validateMelody([0x12, 0x20, 0x0c, 0x01, 0x15]);
	const samples = renderSm511Melody(core, commands, MASTER_CLOCK_HZ);
	assert.equal(samples.length, 8192);
	assert(samples.subarray(0, 2048).some(value => value !== 0));
	assert(samples.subarray(2048, 6144).every(value => value === 0));
	assert(samples.subarray(6144, 8192).some(value => value !== 0));
	assert.equal(renderSm511Melody(core, validateMelody([0x01, 0x12]), 44100).length, 0);
	assert.throws(() => validateMelody([0x0e]), /6-bit/);
	assert.throws(() => validateMelody(new Uint8Array(257)), /1–256/);
	const declarations = buzzerCodeDeclarations('');
	assert.match(declarations, /sm511: Sm511CodeChip/);
	assert.match(declarations, /setMelody\(words: readonly number\[\] \| Uint8Array\): void/);
	assert.match(declarations, /play\(startAddress\?: number\): Promise<boolean>/);
	assert.match(declarations, /stop\(\): void/);
	assert.match(declarations, /build\(startAddress\?: number\): Sm511MelodySequence/);
	assert.match(declarations, /build\(commands: readonly number\[\] \| Uint8Array\): Sm511MelodySequence/);
});

test('SM511 compilation traces playback through Stop while preserving the full ROM', () => {
	const input = Uint8Array.of(0x12, 0x20, 0x2c, 0x21, 0x15);
	const plan = buildSm511MelodySequence(input);
	assert(Object.isFrozen(plan));
	assert.equal(plan.commandCount, 5);
	input.fill(0);
	const commands = readSm511MelodySequence(plan);
	assert.deepEqual([...commands], [0x12, 0x20, 0x2c, 0x21, 0x15]);
	const expected = [
		{ address: 0, command: 0x12, masterTick: 0, durationTicks: 2048, offsetSeconds: 0, durationSeconds: .0625 },
		{ address: 1, command: 0x20, masterTick: 2048, durationTicks: 4096, offsetSeconds: .0625, durationSeconds: .125 },
		{ address: 2, command: 0x2c, masterTick: 6144, durationTicks: 4096, offsetSeconds: .1875, durationSeconds: .125 },
		{ address: 3, command: 0x21, masterTick: 10240, durationTicks: 0, offsetSeconds: .3125, durationSeconds: 0 },
	];
	const trace = compileSm511MelodySequence(plan);
	assert.deepEqual(trace, expected);
	assert.equal(renderSm511Melody(core, commands, MASTER_CLOCK_HZ).length, trace.at(-1).masterTick);
	trace[0].command = 0;
	commands.fill(0);
	assert.deepEqual(compileSm511MelodySequence(plan), expected);
	assert.throws(() => compileSm511MelodySequence({ commandCount: 5 }), /from build/);
	assert.throws(() => buildSm511MelodySequence([0x01, 0x0f]), /6-bit/);
});

test('SM511 Code loads privately, snapshots playback, and pads short ROM data with Stop', async () => {
	const played = [];
	let finish;
	let stops = 0;
	const chip = createSm511CodeChip({
		play(words) {
			played.push(words);
			return new Promise(resolve => { finish = resolve; });
		},
		stop() { stops++; finish?.(false); },
	});
	assert.deepEqual([...readSm511MelodySequence(chip.build(0xff))], [0x01]);
	const input = Uint8Array.of(0x01, 0x12, 0x20, 0x0c);
	chip.setMelody(input);
	input.fill(0);
	assert.equal(played.length, 0);
	const playing = chip.play(1);
	assert.equal(played[0].length, 255);
	chip.setMelody([0x2d]);
	assert.deepEqual([...played[0].slice(0, 5)], [0x12, 0x20, 0x0c, 0x01, 0x01]);
	chip.stop();
	assert.equal(await playing, false);
	assert.equal(stops, 1);
	assert.throws(() => chip.setMelody([0x0e]), /6-bit/);
	assert.deepEqual([...readSm511MelodySequence(chip.build()).slice(0, 4)], [0x2d, 0x01, 0x01, 0x01]);
	for (const address of [-1, 256, 1.5, NaN]) {
		assert.throws(() => chip.play(address), /0x00 to 0xFF/);
		assert.throws(() => chip.build(address), /0x00 to 0xFF/);
	}
	const legacy = chip.playMelody([0x1d]);
	assert.deepEqual([...played[1]], [0x1d]);
	chip.stopMelody();
	assert.equal(await legacy, false);
	assert.equal(stops, 2);
	assert.equal(chip.compile(chip.build())[0].command, 0x2d);
});

test('SM511 build(address) keeps a schedulable ROM suffix and absolute trace addresses', () => {
	const chip = createSm511CodeChip({});
	const rom = new Uint8Array(256).fill(0x01);
	rom.set([0x1d, 0x20, 0x02, 0x01, 0x2c], 0xfb);
	chip.setMelody(rom);
	const plan = chip.build(0xfb);
	chip.setMelody([0x2d]);
	assert.equal(plan.commandCount, 5);
	const suffix = readSm511MelodySequence(plan);
	assert.deepEqual([...suffix], [0x1d, 0x20, 0x02, 0x01, 0x2c]);
	const trace = chip.compile(plan);
	assert.deepEqual(trace, traceSm511Melody(suffix, 0xfb));
	assert.deepEqual(trace.map(row => [row.address, row.command, row.masterTick, row.durationTicks]), [
		[0xfb, 0x1d, 0, 2048], [0xfc, 0x20, 2048, 4096], [0xfd, 0x02, 6144, 2048], [0xfe, 0x01, 8192, 0],
	]);
	assert.equal(renderSm511Melody(core, suffix, MASTER_CLOCK_HZ).length, trace.at(-1).masterTick);
	assert.deepEqual(chip.compile(chip.build([0x1d])).map(row => row.address), [0]);
});

test('repeating the SM511 waveform matches adjacent identical ROM commands', () => {
	for (const command of [0x02, 0x1d, 0x22, 0x3d]) {
		const cycle = renderSm511CommandCycle(core, command);
		const phrase = renderSm511Melody(core, Array(4).fill(command), MASTER_CLOCK_HZ);
		assert(phrase.every((sample, frame) => sample === cycle[frame % cycle.length]));
	}
});

test('SM511 playback at a Stop is silent even when a later ROM address has a note', () => {
	const rom = Uint8Array.of(0x01, 0x21, 0x12, 0x01, 0x2d);
	for (const address of [0, 1]) {
		const words = rom.subarray(address);
		assert.deepEqual(traceSm511Melody(words, address).map(row => [row.address, row.durationTicks]), [[address, 0]]);
		assert.equal(renderSm511Melody(core, words, MASTER_CLOCK_HZ).length, 0);
	}
	const c7 = renderSm511Melody(core, rom.subarray(2), MASTER_CLOCK_HZ);
	assert.equal(c7.length, 2048);
	assert(c7.some(sample => sample > 0));
});

test('a full SM511 ROM can play its last address without a trailing Stop', () => {
	const rom = new Uint8Array(256);
	rom[0xff] = 0x22;
	const framesBeforeLast = 255 * 2048;
	const samples = renderSm511Melody(core, validateMelody(rom), MASTER_CLOCK_HZ);
	assert.equal(samples.length, framesBeforeLast + 4096);
	assert(samples.subarray(0, framesBeforeLast).every(sample => sample === 0));
	assert(samples.subarray(framesBeforeLast).some(sample => sample > 0));
	assert.deepEqual(samples.subarray(framesBeforeLast), renderSm511Melody(core, rom.subarray(0xff), MASTER_CLOCK_HZ));
});

test('Copy as Code runs with the entire SM511 ROM, including edits after Stop', async () => {
	const rom = new Uint8Array(256).fill(0x01);
	rom[0] = 0x1d;
	rom[0x80] = 0x20;
	rom[0xff] = 0x3d;
	const source = formatSm511MelodyCode(rom, 0xff);
	assert.match(source, /^const sm511 = await useSoundChip\("sm511"\);\nsm511\.setMelody\(\[/);
	assert.match(source, /await sm511\.play\(0xFF\);\n$/);
	const rows = source.split('\n').filter(line => /^  0x/.test(line));
	assert.equal(rows.length, 16);
	assert(rows.every(row => row.match(/0x[\dA-F]{2}/g)?.length === 16));
	assert(rows.at(-1).endsWith('0x3D,'));
	const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
	let played;
	const chip = createSm511CodeChip({ play(words) { played = words; } });
	await new AsyncFunction('useSoundChip', source)(async name => {
		assert.equal(name, 'sm511');
		return chip;
	});
	assert.deepEqual(played, Uint8Array.of(0x3d));
	assert.deepEqual(readSm511MelodySequence(chip.build()), rom);
	assert.equal(renderSm511Melody(core, played, MASTER_CLOCK_HZ).length, 4096);
	assert.match(formatSm511MelodyCode(rom), /await sm511\.play\(0x00\);\n$/);
	const example = BUZZER_EXAMPLES.find(({ path }) => path === '/examples/sm511-melody.js');
	assert.match(example.data, /sm511\.setMelody\(\[/);
	assert.match(example.data, /await sm511\.play\(0x00\);\n$/);
	assert.throws(() => formatSm511MelodyCode(Uint8Array.of(0x40)), /6-bit/);
	assert.throws(() => formatSm511MelodyCode([0x2e]), /6-bit/);
	assert.throws(() => formatSm511MelodyCode(new Uint8Array(257)), /1–256/);
	assert.throws(() => formatSm511MelodyCode(rom, 256), /0x00 to 0xFF/);
});

test('SM511 pattern timing keeps each quantized step and gives short notes one ROM command', () => {
	const { samples, boundaries } = renderSm511Pattern(core, [60, null, 61], {
		stepSeconds: .125, gate: .1, sampleRate: MASTER_CLOCK_HZ,
	});
	assert.deepEqual(boundaries, [0, 4096, 8192]);
	assert.equal(samples.length, 12288);
	assert(samples.subarray(0, 2048).some(value => value !== 0));
	assert(samples.subarray(2048, 8192).every(value => value === 0));
	assert(samples.subarray(8192, 10240).some(value => value !== 0));
	assert(samples.subarray(10240).every(value => value === 0));
});
