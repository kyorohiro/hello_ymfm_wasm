import assert from 'node:assert/strict';
import test from 'node:test';
import { MASTER_CLOCK_HZ, R1_DIVISOR, R1_HZ, renderR1Pattern } from './sm510.js';

test('DK-52 R1 uses the same 4,096 Hz carrier at different step times and browser sample rates', () => {
	assert.equal(MASTER_CLOCK_HZ / R1_DIVISOR, 4096);
	assert.equal(R1_HZ, 4096);
	for (const sampleRate of [44100, 48000]) {
		for (const stepMs of [85, 150]) {
			const { samples } = renderR1Pattern(Array(8).fill(true), { stepMs, sampleRate });
			assert.equal(samples.length, Math.round(sampleRate * stepMs * 8 / 1000));
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
	const { samples, stepFrames } = renderR1Pattern([true, true, false, true, false, false, false, false], options);
	const continuous = renderR1Pattern(Array(8).fill(true), options).samples;
	const first = Math.round(stepFrames);
	const second = Math.round(stepFrames * 2);
	const third = Math.round(stepFrames * 3);
	assert.deepEqual(samples.slice(first - 8, first + 8), continuous.slice(first - 8, first + 8));
	assert(samples.slice(first - 8, first + 8).some(sample => Math.abs(sample) > .1));
	assert(samples.slice(second, third).every(sample => sample === 0));
	assert.deepEqual(samples.slice(third + 48, third + 80), continuous.slice(third + 48, third + 80));
	assert(samples.slice(Math.round(stepFrames * 4)).every(sample => sample === 0));
});
