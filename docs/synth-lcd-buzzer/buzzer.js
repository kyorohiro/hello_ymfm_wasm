// SPDX-License-Identifier: BSD-3-Clause
import { noteToHz } from '../js/soundchip_pitch.js';

const LOWEST_NOTE = 48;
const HIGHEST_NOTE = 84;
const STEP_COUNT = 8;
const PITCH_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export const NOTE_OPTIONS = Array.from({ length: HIGHEST_NOTE - LOWEST_NOTE + 1 }, (_, offset) => {
	const value = LOWEST_NOTE + offset;
	return { value, label: `${PITCH_NAMES[value % 12]}${Math.floor(value / 12) - 1}` };
});

export const PATTERNS = [
	{ name: 'Pocket Signal', notes: [61, null, 66, 68, null, 61, 71, null], bpm: 120 },
	{ name: 'Staircase', notes: [57, 60, 64, null, 67, 65, 62, null], bpm: 146 },
	{ name: 'Late Check-In', notes: [52, 64, null, 59, 62, null, 52, 55], bpm: 94 },
];

function checkNote(note) {
	if (note !== null && (!Number.isInteger(note) || note < LOWEST_NOTE || note > HIGHEST_NOTE))
		throw new RangeError('Choose a MIDI note from 48 to 84, or a rest.');
}

export function buzzerMidi(note) {
	const midi = typeof note === 'string'
		? Math.round(69 + 12 * Math.log2(noteToHz(note.replace('♯', '#').replace('♭', 'b')) / 440))
		: note;
	if (midi === null) throw new RangeError('Choose a note from C3 to C6.');
	checkNote(midi);
	return midi;
}

export function validateBuzzerPattern(pattern) {
	const { notes, bpm, gate, volume, loop } = pattern ?? {};
	if (!Array.isArray(notes) || notes.length !== STEP_COUNT)
		throw new TypeError('A pattern must contain eight steps.');
	for (const note of notes) checkNote(note);
	if (!Number.isInteger(bpm) || bpm < 40 || bpm > 240) throw new RangeError('Tempo must be 40–240 BPM.');
	if (!Number.isFinite(gate) || gate < .1 || gate > 1) throw new RangeError('Note length must be 10–100%.');
	if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new RangeError('Volume must be 0–100%.');
	if (typeof loop !== 'boolean') throw new TypeError('Loop must be on or off.');
	return { notes: notes.slice(), bpm, gate, volume, loop };
}
