// SPDX-License-Identifier: BSD-3-Clause

export const MASTER_CLOCK_HZ = 32768;
export const R1_DIVISOR = 8;
export const R1_HZ = MASTER_CLOCK_HZ / R1_DIVISOR;
export const GATE_STEP_COUNT = 8;

export const GATE_PRESETS = {
	short: { stepMs: 85, on: [0] },
	double: { stepMs: 85, on: [0, 2] },
	flutter: { stepMs: 35, on: [0, 2, 4, 6] },
};

export function renderR1Pattern(gates, { stepMs, sampleRate = 48000 }) {
	if (!Array.isArray(gates) || gates.length !== GATE_STEP_COUNT) throw new TypeError('Use eight on/off gates.');
	for (const gate of gates) {
		if (typeof gate !== 'boolean') throw new TypeError('Use eight on/off gates.');
	}
	if (!Number.isFinite(stepMs) || stepMs < 20 || stepMs > 250)
		throw new RangeError('Step time must be 20–250 ms.');
	if (!Number.isInteger(sampleRate) || sampleRate <= R1_HZ * 2 || sampleRate > 384000)
		throw new RangeError('The audio sample rate must support a 4,096 Hz carrier.');

	const stepFrames = sampleRate * stepMs / 1000;
	const samples = new Float32Array(Math.round(GATE_STEP_COUNT * stepFrames));
	const fadeFrames = Math.max(1, Math.round(.001 * sampleRate));
	let step = 0;
	while (step < gates.length) {
		const enabled = gates[step];
		const start = Math.round(step * stepFrames);
		step++;
		if (!enabled) continue;
		while (gates[step]) step++;
		const end = Math.round(step * stepFrames);
		for (let frame = start; frame < end; frame++) {
			const phase = 2 * Math.PI * (frame * R1_HZ % sampleRate) / sampleRate;
			// Audition the square carrier with only harmonics below Nyquist.
			// The divider keeps running through silent steps.
			let wave = 0;
			for (let harmonic = 1; 2 * harmonic * R1_HZ < sampleRate; harmonic += 2)
				wave += Math.sin(harmonic * phase) / harmonic;
			const gain = Math.min(1, (frame - start) / fadeFrames, (end - frame - 1) / fadeFrames);
			samples[frame] = wave * gain * .16;
		}
	}
	return { samples, stepFrames };
}
