import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buzzerCodeDeclarations } from './code.js';
import { BUZZER_EXAMPLES } from './code_examples.js';
import { createSm510AudioCore, MASTER_CLOCK_HZ } from './sm510.js';
import {
	buildSm511MelodySequence, compileSm511MelodySequence, createSm511CodeChip, formatSm511MelodyCode, readSm511MelodySequence,
	renderSm511Melody, renderSm511CommandCycle, renderSm511Pattern,
	sm511Command, sm511CommandLabel, sm511Label, sm511RepeatStart, traceSm511Melody, validateMelody,
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

test('SM511 editor Repeat can start on Stop and wrap to the next timed slot', () => {
	const rom = new Uint8Array(256).fill(0x01);
	assert.equal(sm511RepeatStart(rom, 0xff), 0xff);
	rom[0] = 0x09;
	rom[0x14] = 0x20; // A long rest is a timed slot.
	rom[0x18] = 0x2d;
	assert.equal(sm511RepeatStart(rom, 0x12), 0x14);
	assert.equal(sm511RepeatStart(rom, 0x18), 0x18);
	assert.equal(sm511RepeatStart(rom, 0xff), 0x00);
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
