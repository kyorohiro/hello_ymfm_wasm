// SPDX-License-Identifier: BSD-3-Clause

const LOWEST_NOTE = 48;
const HIGHEST_NOTE = 84;
const STEP_COUNT = 8;
const PULSE_LEVEL = 0.2;
const EDGE_SECONDS = 0.002;
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

function checkSampleRate(sampleRate) {
	if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000)
		throw new RangeError('Sample rate must be an integer from 8000 to 384000 Hz.');
}

function writePulse(samples, start, length, note, sampleRate) {
	if (note === null || length < 3) return;
	const frequency = 440 * 2 ** ((note - 69) / 12);
	const phaseStep = frequency / sampleRate;
	const edge = Math.max(1, Math.min(Math.round(EDGE_SECONDS * sampleRate), Math.floor(length / 2)));
	let phase = phaseStep;
	for (let frame = 1; frame < length - 1; frame++) {
		// The oscillator switches between two levels. Taper the gate edges to
		// prevent clicks when a note starts or ends partway through a cycle.
		const gain = Math.min(1, frame / edge, (length - frame - 1) / edge);
		samples[start + frame] = (phase < 0.5 ? PULSE_LEVEL : -PULSE_LEVEL) * gain;
		phase += phaseStep;
		if (phase >= 1) phase -= 1;
	}
}

export function renderPattern(notes, { bpm = 120, gate = 0.65, sampleRate = 48000 } = {}) {
	if (!Array.isArray(notes) || notes.length !== STEP_COUNT)
		throw new TypeError('A pattern must contain eight steps.');
	for (const note of notes) checkNote(note);
	checkSampleRate(sampleRate);
	if (!Number.isFinite(bpm) || bpm < 20 || bpm > 480)
		throw new RangeError('Tempo must be between 20 and 480 BPM.');
	if (!Number.isFinite(gate) || gate < 0 || gate > 1)
		throw new RangeError('Gate must be between 0 and 1.');

	const stepFrames = sampleRate * 60 / bpm / 2;
	const samples = new Float32Array(Math.round(STEP_COUNT * stepFrames));
	for (let step = 0; step < STEP_COUNT; step++) {
		// Round absolute boundaries so fractional steps never accumulate drift.
		const start = Math.round(step * stepFrames);
		const end = Math.round((step + gate) * stepFrames);
		writePulse(samples, start, end - start, notes[step], sampleRate);
	}
	return { samples, stepFrames, duration: samples.length / sampleRate };
}

export function renderNote(note, { sampleRate = 48000, duration = 0.18 } = {}) {
	checkNote(note);
	checkSampleRate(sampleRate);
	if (!Number.isFinite(duration) || duration < 0 || duration > 4)
		throw new RangeError('Preview duration must be between 0 and 4 seconds.');
	const samples = new Float32Array(Math.round(duration * sampleRate));
	writePulse(samples, 0, samples.length, note, sampleRate);
	return samples;
}
