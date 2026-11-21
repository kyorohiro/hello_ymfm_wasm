// SPDX-License-Identifier: BSD-3-Clause
// DS sound-channel formats and timing from GBATEK, DS Sound Channels / Notes.
// https://mgba-emu.github.io/gbatek/#ds-sound
import { soundChipMixDefaults, validateChipMix } from '../js/soundchip_mixer.js';

export const NDS_AUDIO_CLOCK = 16756991;
export const NDS_CHANNEL_COUNT = 16;
export const NDS_MAX_SAMPLE_BYTES = 1024 * 1024;

export const NDS_ADPCM_INDEX_DELTAS = Object.freeze([-1, -1, -1, -1, 2, 4, 6, 8]);
export const NDS_ADPCM_STEPS = Object.freeze([
	7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
	34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
	157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658,
	724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024,
	3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
	15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
]);

export function ndsAdpcmDelta(step, code) {
	let delta = step >> 3;
	if (code & 1) delta += step >> 2;
	if (code & 2) delta += step >> 1;
	if (code & 4) delta += step;
	return code & 8 ? -delta : delta;
}

export function readNdsAdpcmHeader(bytes) {
	if (!(bytes instanceof Uint8Array) || bytes.length < 4)
		throw new RangeError('Invalid Nintendo DS ADPCM header');
	const sample = new DataView(bytes.buffer, bytes.byteOffset, 4).getInt16(0, true);
	const stepIndex = bytes[2];
	if (stepIndex > 88 || bytes[3] !== 0 || sample === -32768)
		throw new RangeError('Invalid Nintendo DS ADPCM header');
	return { sample, stepIndex };
}

export function decodeNdsAdpcm(bytes) {
	let { sample, stepIndex } = readNdsAdpcmHeader(bytes);
	const decoded = new Int16Array((bytes.length - 4) * 2);
	for (let index = 0; index < decoded.length; index++) {
		const code = (bytes[4 + (index >>> 1)] >>> ((index & 1) * 4)) & 15;
		sample = Math.min(32767, Math.max(-32767, sample + ndsAdpcmDelta(NDS_ADPCM_STEPS[stepIndex], code)));
		stepIndex = Math.min(88, Math.max(0, stepIndex + NDS_ADPCM_INDEX_DELTAS[code & 7]));
		decoded[index] = sample;
	}
	return decoded;
}

const MODES = ['pcm8', 'pcm16', 'adpcm', 'pulse', 'noise'];
export const NDS_SYNTH_OUTPUT_GAIN = 0.25; // Software headroom before Master; no 10-bit DAC clipping.
const MIX_DEFAULTS = Object.freeze(soundChipMixDefaults());
const CAPTURE_TIMER_CHANNELS = [1, 3];
export const NDS_CHANNEL_DEFAULTS = Object.freeze({
	mode: 'pcm16', bytes: null, loopStartWords: 0, lengthWords: null, loop: true,
	timer: 65536 - Math.round(NDS_AUDIO_CLOCK / (440 * 8)), volume: 96, pan: 64, divider: 0, duty: 3,
});

export function ndsInteger(value, minimum, maximum, label) {
	if (!Number.isInteger(value) || value < minimum || value > maximum)
		throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}`);
}

function quantizeCapture(output, pcm8) {
	// Recover the mixer level before Tetorica's output headroom, then clip
	// at the capture unit's 16.8-bit input. GBATEK describes a correction
	// toward zero for negative values with the top fractional bit set.
	const fixed = Math.max(-0x800000, Math.min(0x7fffff, Math.floor(output * (0x800000 / NDS_SYNTH_OUTPUT_GAIN))));
	const shift = pcm8 ? 16 : 8;
	const fractionHighBit = 1 << (shift - 1);
	const correction = fixed < 0 && (fixed & fractionHighBit) !== 0 ? 1 : 0;
	return (fixed >> shift) + correction;
}

export function ndsSampleRange({ mode, bytes, loopStartWords, lengthWords, loop }) {
	if (!bytes || mode === 'pulse' || mode === 'noise') return null;
	const availableWords = bytes.length / 4;
	const length = lengthWords ?? (availableWords - loopStartWords);
	const end = loopStartWords + length;
	if (length < 1 || end < 4 || end > availableWords)
		throw new RangeError('The sample range must use at least four words inside its data');
	const headerWords = mode === 'adpcm' ? 1 : 0;
	if (loop && loopStartWords < headerWords) throw new RangeError('An ADPCM loop must start after its header word');
	const framesPerWord = mode === 'adpcm' ? 8 : mode === 'pcm8' ? 4 : 2;
	return {
		start: Math.max(0, loopStartWords - headerWords) * framesPerWord,
		end: (end - headerWords) * framesPerWord,
		lengthWords: length,
	};
}

export function normalizeNdsChannel(index, current, patch) {
	if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Expected a DS channel patch');
	for (const field of Object.keys(patch)) {
		if (!Object.hasOwn(NDS_CHANNEL_DEFAULTS, field)) throw new TypeError(`Unknown DS channel field: ${field}`);
	}
	const next = { ...current, ...patch };
	if (!MODES.includes(next.mode)) throw new RangeError(`Unknown DS sound mode: ${next.mode}`);
	if (next.mode === 'pulse' && (index < 8 || index > 13)) throw new RangeError('Pulse is available on DS channels 8–13');
	if (next.mode === 'noise' && index < 14) throw new RangeError('Noise is available on DS channels 14–15');
	ndsInteger(next.timer, 0, 65535, 'DS timer');
	ndsInteger(next.volume, 0, 127, 'DS volume');
	ndsInteger(next.pan, 0, 127, 'DS pan');
	ndsInteger(next.divider, 0, 3, 'DS volume divider');
	ndsInteger(next.duty, 0, 7, 'DS pulse duty');
	if (typeof next.loop !== 'boolean') throw new TypeError('DS loop must be a boolean');
	if (Object.hasOwn(patch, 'bytes')) {
		if (!(next.bytes instanceof Uint8Array)) throw new TypeError('DS sample bytes must be a Uint8Array');
		if (next.bytes.length < 16 || next.bytes.length > NDS_MAX_SAMPLE_BYTES || next.bytes.length % 4 !== 0)
			throw new RangeError('DS samples must have 16 bytes to 1 MiB of word-aligned data');
		next.bytes = new Uint8Array(next.bytes);
		if (!Object.hasOwn(patch, 'lengthWords')) next.lengthWords = null;
		if (!Object.hasOwn(patch, 'loopStartWords')) next.loopStartWords = next.mode === 'adpcm' && next.loop ? 1 : 0;
	}
	if (!Object.hasOwn(patch, 'loopStartWords') && next.mode === 'adpcm' && next.loop && next.loopStartWords === 0
		&& (next.mode !== current.mode || !current.loop)) next.loopStartWords = 1;
	ndsInteger(next.loopStartWords, 0, 65535, 'DS loop start in words');
	if (next.lengthWords !== null) ndsInteger(next.lengthWords, 1, 0x3fffff, 'DS sample length in words');
	return next;
}

export function normalizeNdsChannelMix(current, patch) {
	if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
		Object.keys(patch).some(key => !Object.hasOwn(MIX_DEFAULTS, key)))
		throw new TypeError('Expected DS channel mixer volume, pan or mute settings');
	const mix = { ...current, ...patch };
	validateChipMix(mix);
	return mix;
}

/** Browser Synth mixer tap. The capture clock follows the shared voice timer. */
export class NdsMixerCapture {
	#captures = [null, null];
	#sampleRate;
	#getTimer;
	#setTimer;

	constructor(sampleRate, getTimer, setTimer) {
		this.#sampleRate = sampleRate;
		this.#getTimer = getTimer;
		this.#setTimer = setTimer;
	}

	#period(timer) {
		return (65536 - timer) * this.#sampleRate;
	}

	retune(channel, previous, next) {
		if (previous === next) return;
		const capture = this.#captures[CAPTURE_TIMER_CHANNELS.indexOf(channel)];
		if (!capture?.active) return;
		capture.clock = Math.floor((capture.clock / this.#period(previous)) * this.#period(next));
		capture.timerChanged = true;
	}

	render(left, right) {
		if (this.#captures[0]?.active) this.#renderCapture(0, left);
		if (this.#captures[1]?.active) this.#renderCapture(1, right);
	}

	/** Start a mixer-tap one-shot while sharing the capture unit's voice timer. */
	startCapture(unit, settings) {
		ndsInteger(unit, 0, 1, 'DS capture unit');
		if (this.#captures[unit]?.active) throw new Error('Stop the active Sound Capture before starting again.');
		if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
			Object.keys(settings).some(key => key !== 'format' && key !== 'lengthWords' && key !== 'timer'))
			throw new TypeError('Expected DS capture format, word length and optional timer');
		const { format, lengthWords, timer } = settings;
		if (format !== 'pcm8' && format !== 'pcm16') throw new RangeError('DS capture format must be pcm8 or pcm16');
		ndsInteger(lengthWords, 1, 0xffff, 'DS capture length in words');
		const timerChannel = CAPTURE_TIMER_CHANNELS[unit];
		const sharedTimer = timer === undefined ? this.#getTimer(timerChannel) : timer;
		ndsInteger(sharedTimer, 0, 65535, 'DS timer');
		const bytes = new Uint8Array(lengthWords * 4);
		if (timer !== undefined) this.#setTimer(timerChannel, timer);
		this.#captures[unit] = {
			active: true, bytes, format, lengthWords, timer: sharedTimer,
			timerChanged: false, clock: 0, writtenBytes: 0,
		};
		return this.getCaptureState(unit);
	}

	getCaptureState(unit) {
		ndsInteger(unit, 0, 1, 'DS capture unit');
		const capture = this.#captures[unit];
		const timerChannel = CAPTURE_TIMER_CHANNELS[unit];
		const currentTimer = this.#getTimer(timerChannel);
		const timer = capture?.timer ?? currentTimer;
		const writtenBytes = capture?.writtenBytes ?? 0;
		return {
			unit, timerChannel, timer, currentTimer, sampleRate: NDS_AUDIO_CLOCK / (65536 - timer),
			active: capture?.active ?? false, format: capture?.format ?? null,
			lengthWords: capture?.lengthWords ?? 0,
			recordedFrames: writtenBytes / (capture?.format === 'pcm16' ? 2 : 1),
			byteLength: writtenBytes - writtenBytes % 4,
			timerChanged: capture?.timerChanged ?? false,
		};
	}

	stopCapture(unit) {
		ndsInteger(unit, 0, 1, 'DS capture unit');
		const capture = this.#captures[unit];
		if (capture) capture.active = false;
		return this.getCaptureState(unit);
	}

	readCapture(unit) {
		const state = this.getCaptureState(unit);
		const bytes = this.#captures[unit]?.bytes.slice(0, state.byteLength) ?? new Uint8Array(0);
		return { ...state, bytes };
	}

	#renderCapture(unit, output) {
		const capture = this.#captures[unit];
		const timer = this.#getTimer(CAPTURE_TIMER_CHANNELS[unit]);
		const period = this.#period(timer);
		const { bytes } = capture;
		const pcm8 = capture.format === 'pcm8';
		const sampleBytes = pcm8 ? 1 : 2;
		let { clock, writtenBytes } = capture;

		// Integrate the shared timer at the output cadence. Several capture
		// edges within a host frame use the same held mixer sample.
		for (let frame = 0; frame < output.length; frame++) {
			clock += NDS_AUDIO_CLOCK;
			if (clock < period) continue;
			const steps = Math.floor(clock / period);
			clock -= steps * period;
			const end = Math.min(bytes.length, writtenBytes + steps * sampleBytes);
			const value = quantizeCapture(output[frame], pcm8);
			if (pcm8) bytes.fill(value, writtenBytes, end);
			else {
				for (let offset = writtenBytes; offset < end; offset += 2) {
					bytes[offset] = value;
					bytes[offset + 1] = value >> 8;
				}
			}
			writtenBytes = end;
			if (writtenBytes === bytes.length) {
				capture.active = false;
				break;
			}
		}
		capture.clock = clock;
		capture.writtenBytes = writtenBytes;
	}
}
