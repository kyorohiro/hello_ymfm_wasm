// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import { NOTE_OPTIONS, PATTERNS, buzzerMidi, validateBuzzerPattern } from './buzzer.js';

test('note names and MIDI numbers cover the same C3–C6 range', () => {
	assert.deepEqual(NOTE_OPTIONS[0], { value: 48, label: 'C3' });
	assert.deepEqual(NOTE_OPTIONS.at(-1), { value: 84, label: 'C6' });
	for (const { value, label } of NOTE_OPTIONS) {
		assert.equal(buzzerMidi(label), value);
		assert.equal(buzzerMidi(value), value);
	}
	assert.equal(buzzerMidi('B♭4'), 70);
	assert.throws(() => buzzerMidi('C♯6'), /MIDI note/);
	assert.throws(() => buzzerMidi(null), /C3 to C6/);
});

test('pattern validation preserves all original preset steps and settings', () => {
	for (const { notes, bpm } of PATTERNS) {
		const pattern = { notes, bpm, gate: .65, volume: .6, loop: true };
		const validated = validateBuzzerPattern(pattern);
		assert.deepEqual(validated, pattern);
		assert.notEqual(validated.notes, notes);
	}
	const notes = [48, null, 84, null, 48, 84, null, 60];
	const shortest = { notes, bpm: 240, gate: .1, volume: 0, loop: false };
	const longest = { notes, bpm: 40, gate: 1, volume: 1, loop: true };
	assert.deepEqual(validateBuzzerPattern(shortest), shortest);
	assert.deepEqual(validateBuzzerPattern(longest), longest);
});

test('pattern validation rejects unsupported input', () => {
	const pattern = { notes: PATTERNS[0].notes, bpm: 120, gate: .65, volume: .6, loop: true };
	assert.throws(() => validateBuzzerPattern({ ...pattern, notes: [60, 62] }), /eight steps/);
	assert.throws(() => validateBuzzerPattern({ ...pattern, bpm: 39 }), /Tempo/);
	assert.throws(() => validateBuzzerPattern({ ...pattern, gate: 1.1 }), /Note length/);
	assert.throws(() => validateBuzzerPattern({ ...pattern, volume: -1 }), /Volume/);
	assert.throws(() => validateBuzzerPattern({ ...pattern, loop: 1 }), /Loop/);
});
