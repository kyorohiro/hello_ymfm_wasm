import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buzzerCodeDeclarations } from './code.js';
import { createSm510AudioCore, MASTER_CLOCK_HZ } from './sm510.js';
import { renderSm511Melody, renderSm511CommandCycle, renderSm511Pattern, sm511Command, sm511CommandLabel, sm511Label, validateMelody } from './sm511.js';

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
