// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import { NOTE_OPTIONS, PATTERNS, renderNote, renderPattern } from './buzzer.js';

test('a preview uses two pulse levels and stays in tune at common output rates', () => {
	const level = Math.fround(0.2);
	for (const sampleRate of [44100, 48000]) {
		const samples = renderNote(69, { sampleRate });
		assert.equal(samples.length, Math.round(0.18 * sampleRate));
		assert.equal(samples[0], 0);
		assert.equal(samples.at(-1), 0);
		assert(samples[1] > 0 && samples[1] < level);
		assert(samples.every(value => Math.abs(value) <= level));
		const core = samples.subarray(Math.round(0.003 * sampleRate), -Math.round(0.003 * sampleRate));
		assert.deepEqual(new Set(core), new Set([level, -level]));
		const risingEdges = [];
		for (let frame = 1; frame < core.length; frame++) {
			if (core[frame - 1] < 0 && core[frame] > 0) risingEdges.push(frame);
		}
		const frequency = (risingEdges.length - 1) * sampleRate / (risingEdges.at(-1) - risingEdges[0]);
		assert(Math.abs(frequency - 440) < 1);
	}
});

test('eight steps keep their cumulative sample boundaries and leave rests and gate tails silent', () => {
	const sampleRate = 44100;
	const bpm = 137;
	const gate = 0.57;
	const notes = [60, null, 62, 63, null, 65, null, 67];
	const { samples, stepFrames, duration } = renderPattern(notes, { sampleRate, bpm, gate });
	assert.equal(stepFrames, sampleRate * 60 / bpm / 2);
	assert.equal(samples.length, Math.round(stepFrames * 8));
	assert.equal(duration, samples.length / sampleRate);
	for (let step = 0; step < notes.length; step++) {
		const start = Math.round(step * stepFrames);
		const end = Math.round((step + 1) * stepFrames);
		const gatedEnd = Math.round((step + gate) * stepFrames);
		assert.equal(samples[start], 0);
		if (notes[step] === null) {
			assert(samples.subarray(start, end).every(value => value === 0));
		} else {
			assert(samples[start + 1] > 0);
			assert.notEqual(samples[gatedEnd - 2], 0);
			assert(samples.subarray(gatedEnd - 1, end).every(value => value === 0));
		}
	}
	assert(renderPattern(notes, { gate: 0 }).samples.every(value => value === 0));
	assert(renderNote(null).every(value => value === 0));
});

test('the original presets use supported notes and invalid inputs are rejected', () => {
	assert.deepEqual(NOTE_OPTIONS[0], { value: 48, label: 'C3' });
	assert.deepEqual(NOTE_OPTIONS.at(-1), { value: 84, label: 'C6' });
	for (const { notes, bpm } of PATTERNS) {
		assert(renderPattern(notes, { bpm }).samples.some(value => value !== 0));
	}
	assert.throws(() => renderPattern([60, 62]), /eight steps/);
	assert.throws(() => renderPattern(PATTERNS[0].notes, { bpm: 0 }), /Tempo/);
	assert.throws(() => renderPattern(PATTERNS[0].notes, { gate: 1.1 }), /Gate/);
	assert.throws(() => renderNote(85), /MIDI note/);
	assert.throws(() => renderNote(60, { sampleRate: 0 }), /Sample rate/);
});
