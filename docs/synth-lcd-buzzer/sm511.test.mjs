import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buzzerCodeDeclarations } from './code.js';
import { createSm510AudioCore, MASTER_CLOCK_HZ } from './sm510.js';
import {
	buildSm511MelodySequence, compileSm511MelodySequence, formatSm511MelodyCode, readSm511MelodySequence,
	renderSm511Melody, renderSm511CommandCycle, renderSm511Pattern,
	sm511Command, sm511CommandLabel, sm511Label, validateMelody,
} from './sm511.js';

const { instance } = await WebAssembly.instantiate(await readFile(new URL('./sm510.wasm', import.meta.url)));
const core = createSm510AudioCore(instance.exports);

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
	assert.match(buzzerCodeDeclarations(''), /sm511: Sm511CodeChip/);
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

test('repeating the SM511 waveform matches adjacent identical ROM commands', () => {
	for (const command of [0x02, 0x1d, 0x22, 0x3d]) {
		const cycle = renderSm511CommandCycle(core, command);
		const phrase = renderSm511Melody(core, Array(4).fill(command), MASTER_CLOCK_HZ);
		assert(phrase.every((sample, frame) => sample === cycle[frame % cycle.length]));
	}
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
	const source = formatSm511MelodyCode(rom);
	assert.match(source, /^const sm511 = await useSoundChip\("sm511"\);\nawait sm511\.playMelody\(\[/);
	const rows = source.split('\n').filter(line => /^  0x/.test(line));
	assert.equal(rows.length, 16);
	assert(rows.every(row => row.match(/0x[\dA-F]{2}/g)?.length === 16));
	assert(rows.at(-1).endsWith('0x3D,'));
	const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
	let played;
	await new AsyncFunction('useSoundChip', source)(async name => {
		assert.equal(name, 'sm511');
		return { playMelody: commands => { played = commands; } };
	});
	assert.deepEqual(played, [...rom]);
	assert.deepEqual(validateMelody(played), rom);
	assert.throws(() => formatSm511MelodyCode(Uint8Array.of(0x40)), /6-bit/);
	assert.throws(() => formatSm511MelodyCode([0x2e]), /6-bit/);
	assert.throws(() => formatSm511MelodyCode(new Uint8Array(257)), /1–256/);
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
