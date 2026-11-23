// SPDX-License-Identifier: BSD-3-Clause
import { noteToHz } from '../js/soundchip_pitch.js';
import { vsuEnvelopeRegisterValues } from './envelope.js';

export const VSU_CHANNEL_COUNT = 6;
export const VSU_WAVE_BANK_COUNT = 5;
export const VSU_WAVE_LENGTH = 32;
export const VSU_SOUND_STOP = 0x580;
export const VSU_NOISE_PATTERN_LENGTHS = Object.freeze([32767, 1953, 254, 217, 73, 63, 42, 28]);
export const VSU_INTERVAL_STEP_MS = 3.84;
export const VSU_REGISTERS = Object.freeze({
	INT: 0x00, LRV: 0x04, FQL: 0x08, FQH: 0x0c, EV0: 0x10, EV1: 0x14, RAM: 0x18, SWP: 0x1c,
});

const WAVETABLE_TONE_CLOCK = 5_000_000 / VSU_WAVE_LENGTH;
const NOISE_SHIFT_CLOCK = 500_000;
const DIVISOR_LIMIT = 2048;
const FIRST_CHANNEL_REGISTER = 0x400;
const CHANNEL_REGISTER_STRIDE = 0x40;

function checkInteger(value, min, max, name) {
	if (!Number.isInteger(value) || value < min || value > max)
		throw new RangeError(`${name} must be an integer from ${min} to ${max}.`);
}

export function vsuChannelRegister(channel, offset) {
	checkInteger(channel, 0, VSU_CHANNEL_COUNT - 1, 'Channel');
	checkInteger(offset, 0, VSU_REGISTERS.SWP, 'Channel register offset');
	if (offset % 4 !== 0) throw new RangeError('The VSU register offset must be four-byte aligned.');
	return FIRST_CHANNEL_REGISTER + channel * CHANNEL_REGISTER_STRIDE + offset;
}

export function vsuMaskedEnvelopeTarget(offset, mask, value) {
	if (!Number.isInteger(offset) || offset < FIRST_CHANNEL_REGISTER || offset >= VSU_SOUND_STOP) return null;
	const relative = offset - FIRST_CHANNEL_REGISTER;
	const channel = Math.floor(relative / CHANNEL_REGISTER_STRIDE);
	const registerOffset = relative % CHANNEL_REGISTER_STRIDE;
	if (registerOffset === VSU_REGISTERS.EV0 && mask === 0 && value === 0) return { channel, register: 'EV0' };
	if (registerOffset === VSU_REGISTERS.EV1 && mask === 3 && Number.isInteger(value) && value >= 0 && value <= mask)
		return { channel, register: 'EV1' };
	return null;
}

export function vsuWaveOffset(bank, index) {
	checkInteger(bank, 0, VSU_WAVE_BANK_COUNT - 1, 'Wave bank');
	checkInteger(index, 0, VSU_WAVE_LENGTH - 1, 'Wave sample index');
	return bank * 0x80 + index * 4;
}

export function vsuFrequencyRegister(channel, note) {
	checkInteger(channel, 0, VSU_CHANNEL_COUNT - 1, 'Channel');
	const clock = channel === VSU_CHANNEL_COUNT - 1 ? NOISE_SHIFT_CLOCK : WAVETABLE_TONE_CLOCK;
	const divisor = Math.round(clock / noteToHz(note));
	return DIVISOR_LIMIT - Math.max(1, Math.min(DIVISOR_LIMIT, divisor));
}

export function vsuNoiseShiftRate(frequency) {
	checkInteger(frequency, 0, DIVISOR_LIMIT - 1, 'VSU frequency register');
	return NOISE_SHIFT_CLOCK / (DIVISOR_LIMIT - frequency);
}

export function vsuFrequencyWrites(channel, frequency) {
	checkInteger(frequency, 0, DIVISOR_LIMIT - 1, 'VSU frequency register');
	const base = vsuChannelRegister(channel, 0);
	return [
		[base + VSU_REGISTERS.FQL, frequency & 0xff],
		[base + VSU_REGISTERS.FQH, frequency >> 8],
	];
}

export function vsuStartWrites(channel, frequency, interval = null) {
	if (interval !== null) checkInteger(interval, 0, 31, 'VSU interval index');
	return [...vsuFrequencyWrites(channel, frequency),
		[vsuChannelRegister(channel, VSU_REGISTERS.INT), interval === null ? 0x80 : 0xa0 | interval]];
}

export function vsuNoteOnWrites(channel, note) {
	return vsuStartWrites(channel, vsuFrequencyRegister(channel, note));
}

const WAVE_SHAPES = {
	sine: phase => Math.sin(2 * Math.PI * phase),
	triangle: phase => 1 - Math.abs(4 * phase - 2),
	square: phase => phase < 0.5 ? 1 : -1,
	saw: phase => 2 * phase - 1,
};

export function createVsuWave(shape) {
	if (!Object.hasOwn(WAVE_SHAPES, shape)) throw new RangeError(`Unknown VSU wave shape: ${shape}.`);
	return Uint8Array.from({ length: VSU_WAVE_LENGTH }, (_, index) =>
		Math.round((WAVE_SHAPES[shape](index / VSU_WAVE_LENGTH) + 1) * 31.5));
}

export function createVsuClient(audio) {
	function write(offset, value) {
		checkInteger(offset, 0, VSU_SOUND_STOP, 'VSU offset');
		if (offset % 4 !== 0) throw new RangeError('The VSU offset must be four-byte aligned.');
		checkInteger(value, 0, 255, 'Register byte');
		return audio.write(offset, value);
	}

	return {
		id: 'vsu',
		write,
		// The core applies the hardware write lock for shared wave RAM. Stop
		// every channel before uploading a wave that needs to take effect.
		setWave(bank, values) {
			const base = vsuWaveOffset(bank, 0);
			if ((!Array.isArray(values) && !ArrayBuffer.isView(values)) || values.length !== VSU_WAVE_LENGTH)
				throw new RangeError('A VSU wave must contain 32 six-bit samples.');
			const writes = Array.from(values, (value, index) => {
				checkInteger(value, 0, 63, 'Wave sample');
				return [base + 4 * index, value];
			});
			return audio.writeBatch(writes);
		},
		setWaveSample(bank, index, value) {
			checkInteger(value, 0, 63, 'Wave sample');
			return write(vsuWaveOffset(bank, index), value);
		},
		setVolume(channel, left, right) {
			checkInteger(left, 0, 15, 'Left level');
			checkInteger(right, 0, 15, 'Right level');
			return write(vsuChannelRegister(channel, VSU_REGISTERS.LRV), (left << 4) | right);
		},
		setWaveBank(channel, bank) {
			checkInteger(channel, 0, VSU_CHANNEL_COUNT - 2, 'Wave channel');
			checkInteger(bank, 0, VSU_WAVE_BANK_COUNT - 1, 'Wave bank');
			return write(vsuChannelRegister(channel, VSU_REGISTERS.RAM), bank);
		},
		setEnvelope(channel, options) {
			const ev0Offset = vsuChannelRegister(channel, VSU_REGISTERS.EV0);
			const ev1Offset = vsuChannelRegister(channel, VSU_REGISTERS.EV1);
			const { level, rate, direction, enabled, repeat } = options ?? {};
			const { ev0, ev1 } = vsuEnvelopeRegisterValues({ initial: level, rate, direction, enabled, repeat });
			return audio.writeEnvelope([[ev0Offset, ev0], [ev1Offset, ev1, 3]]);
		},
		resetEnvelope(channel) {
			return audio.writeEnvelope([[vsuChannelRegister(channel, VSU_REGISTERS.EV0), 0, 0]]);
		},
		noteOn(channel, note) {
			return audio.writeBatch(vsuNoteOnWrites(channel, note));
		},
		noteOff(channel) {
			return write(vsuChannelRegister(channel, VSU_REGISTERS.INT), 0);
		},
		allNotesOff() {
			return write(VSU_SOUND_STOP, 1);
		},
	};
}
