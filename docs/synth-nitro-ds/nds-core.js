// SPDX-License-Identifier: BSD-3-Clause
// DS sound-channel formats and timing from GBATEK, DS Sound Channels / Notes.
// https://mgba-emu.github.io/gbatek/#ds-sound

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
const DIVISORS = [1, 2, 4, 16];
const STARTUP_PERIODS = { pcm8: 3, pcm16: 3, adpcm: 11, pulse: 1, noise: 1 };
const OUTPUT_GAIN = 0.25; // Software headroom before Master; no 10-bit DAC clipping.
const PSG_LEVEL = 32767 / 32768;
const PULSE_PATTERNS = Array.from({ length: 8 }, (_, duty) =>
	Int8Array.from({ length: 8 }, (_, frame) => duty !== 7 && frame >= 7 - duty ? 1 : -1));
const DEFAULTS = Object.freeze({
	mode: 'pcm16', bytes: null, loopStartWords: 0, lengthWords: null, loop: true,
	timer: 65536 - Math.round(NDS_AUDIO_CLOCK / (440 * 8)), volume: 96, pan: 64, divider: 0, duty: 3,
});

// Cache one whole 15-bit LFSR period so high timer rates can skip ahead in O(1).
const NOISE_PATTERN = new Int8Array(0x7fff);
let lfsr = 0x7fff;
for (let index = 0; index < NOISE_PATTERN.length; index++) {
	const low = lfsr & 1;
	NOISE_PATTERN[index] = low ? -1 : 1;
	lfsr = (lfsr >>> 1) ^ (low ? 0x6000 : 0);
}

function integer(value, minimum, maximum, label) {
	if (!Number.isInteger(value) || value < minimum || value > maximum)
		throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}`);
}

function unit7(code) {
	return code === 127 ? 1 : code / 128;
}

function prepareSample({ mode, bytes, loopStartWords, lengthWords, loop }) {
	if (!bytes || mode === 'pulse' || mode === 'noise') return null;
	const availableWords = bytes.length / 4;
	const length = lengthWords ?? (availableWords - loopStartWords);
	const end = loopStartWords + length;
	if (length < 1 || end < 4 || end > availableWords)
		throw new RangeError('The sample range must use at least four words inside its data');
	if (mode === 'pcm8') {
		return {
			read: (frame) => ((bytes[frame] << 24) >> 24) / 128,
			start: loopStartWords * 4, end: end * 4, lengthWords: length,
		};
	}
	if (mode === 'pcm16') {
		const view = new DataView(bytes.buffer, bytes.byteOffset, end * 4);
		return {
			read: (frame) => view.getInt16(frame * 2, true) / 32768,
			start: loopStartWords * 2, end: end * 2, lengthWords: length,
		};
	}
	if (loop && loopStartWords === 0) throw new RangeError('An ADPCM loop must start after its header word');
	// Decode from the header even when the loop has a lead-in. Reading from the
	// decoded loop start restores the same predictor and index on every repeat.
	const decoded = decodeNdsAdpcm(bytes.subarray(0, end * 4));
	return {
		read: (frame) => decoded[frame] / 32768,
		start: Math.max(0, (loopStartWords - 1) * 8), end: decoded.length, lengthWords: length,
	};
}

export class NdsSoundCore {
	#channels = Array.from({ length: NDS_CHANNEL_COUNT }, () => ({ config: DEFAULTS, sample: null, voice: null }));
	#sampleRate;

	constructor(sampleRate) {
		integer(sampleRate, 8000, 192000, 'Output sample rate');
		this.#sampleRate = sampleRate;
	}

	#channel(index) {
		integer(index, 0, NDS_CHANNEL_COUNT - 1, 'DS channel');
		return this.#channels[index];
	}

	#period(timer) {
		return (65536 - timer) * this.#sampleRate;
	}

	configure(index, patch) {
		const channel = this.#channel(index);
		if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Expected a DS channel patch');
		for (const field of Object.keys(patch)) {
			if (!Object.hasOwn(DEFAULTS, field)) throw new TypeError(`Unknown DS channel field: ${field}`);
		}
		const next = { ...channel.config, ...patch };
		if (!MODES.includes(next.mode)) throw new RangeError(`Unknown DS sound mode: ${next.mode}`);
		if (next.mode === 'pulse' && (index < 8 || index > 13)) throw new RangeError('Pulse is available on DS channels 8–13');
		if (next.mode === 'noise' && index < 14) throw new RangeError('Noise is available on DS channels 14–15');
		integer(next.timer, 0, 65535, 'DS timer');
		integer(next.volume, 0, 127, 'DS volume');
		integer(next.pan, 0, 127, 'DS pan');
		integer(next.divider, 0, 3, 'DS volume divider');
		integer(next.duty, 0, 7, 'DS pulse duty');
		if (typeof next.loop !== 'boolean') throw new TypeError('DS loop must be a boolean');

		const replacing = Object.hasOwn(patch, 'bytes');
		if (replacing) {
			if (!(next.bytes instanceof Uint8Array)) throw new TypeError('DS sample bytes must be a Uint8Array');
			if (next.bytes.length < 16 || next.bytes.length > NDS_MAX_SAMPLE_BYTES || next.bytes.length % 4 !== 0)
				throw new RangeError('DS samples must have 16 bytes to 1 MiB of word-aligned data');
			next.bytes = new Uint8Array(next.bytes);
			if (!Object.hasOwn(patch, 'lengthWords')) next.lengthWords = null;
			if (!Object.hasOwn(patch, 'loopStartWords')) next.loopStartWords = next.mode === 'adpcm' && next.loop ? 1 : 0;
		}
		if (!Object.hasOwn(patch, 'loopStartWords') && next.mode === 'adpcm' && next.loop && next.loopStartWords === 0
			&& (next.mode !== channel.config.mode || !channel.config.loop)) next.loopStartWords = 1;
		integer(next.loopStartWords, 0, 65535, 'DS loop start in words');
		if (next.lengthWords !== null) integer(next.lengthWords, 1, 0x3fffff, 'DS sample length in words');

		const old = channel.config;
		const sampleChanged = next.mode !== old.mode || replacing || next.loopStartWords !== old.loopStartWords
			|| next.lengthWords !== old.lengthWords || next.loop !== old.loop;
		const sample = sampleChanged ? prepareSample(next) : channel.sample;
		const voice = channel.voice;
		if (voice && old.timer !== next.timer) {
			// Retune without jumping to a different sample at the update boundary.
			voice.clock = Math.floor((voice.clock / this.#period(old.timer)) * this.#period(next.timer));
		}
		channel.config = next;
		channel.sample = sample;
	}

	keyOn(index) {
		const channel = this.#channel(index);
		const { mode, loop } = channel.config;
		const sample = channel.sample;
		if (!sample && mode !== 'pulse' && mode !== 'noise') throw new Error('Load a DS sample before Key On');
		channel.voice = {
			mode, sample, loop, position: -STARTUP_PERIODS[mode], clock: 0,
			releaseFrames: 0, releaseRemaining: 0,
		};
	}

	keyOff(index) {
		this.#channel(index).voice = null;
	}

	release(index, milliseconds = 8) {
		const channel = this.#channel(index);
		if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 1000)
			throw new RangeError('Software release must be from 0 through 1000 ms');
		const frames = Math.round(milliseconds * this.#sampleRate / 1000);
		if (!frames) {
			channel.voice = null;
			return;
		}
		if (!channel.voice || channel.voice.releaseFrames) return;
		channel.voice.releaseFrames = frames;
		channel.voice.releaseRemaining = frames;
	}

	allSoundOff() {
		for (const channel of this.#channels) channel.voice = null;
	}

	getState(index) {
		const { config, sample, voice } = this.#channel(index);
		const { bytes, ...fields } = config;
		return {
			...fields, channel: index, active: voice !== null, playingMode: voice?.mode ?? null,
			position: voice ? Math.max(0, voice.position) : 0, releasing: Boolean(voice?.releaseFrames),
			lengthWords: sample?.lengthWords ?? fields.lengthWords, byteLength: bytes?.byteLength ?? 0,
		};
	}

	render(left, right) {
		if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length)
			throw new TypeError('DS rendering requires equal-length Float32Array output channels');
		left.fill(0);
		right.fill(0);
		for (const channel of this.#channels) {
			if (channel.voice) this.#renderChannel(channel, left, right);
		}
	}

	#renderChannel(channel, left, right) {
		const voice = channel.voice;
		const { sample, mode, loop, releaseFrames } = voice;
		const { timer, volume, pan, divider, duty } = channel.config;
		const gain = unit7(volume) * OUTPUT_GAIN / DIVISORS[divider];
		const panMix = unit7(pan);
		const leftGain = gain * (1 - panMix);
		const rightGain = gain * panMix;
		const period = this.#period(timer);
		const oscillator = mode === 'pulse' ? PULSE_PATTERNS[duty] : NOISE_PATTERN;
		const length = sample?.end ?? oscillator.length;
		const repeats = !sample || loop;
		const loopStart = sample?.start ?? 0;
		const loopLength = length - loopStart;
		let { position, clock, releaseRemaining } = voice;

		for (let frame = 0; frame < left.length; frame++) {
			if (position >= 0) {
				const fade = releaseFrames ? (releaseRemaining - 1) / Math.max(1, releaseFrames - 1) : 1;
				const value = (sample ? sample.read(position) : oscillator[position] * PSG_LEVEL) * fade;
				left[frame] += value * leftGain;
				right[frame] += value * rightGain;
			}
			if (releaseFrames && --releaseRemaining === 0) {
				channel.voice = null;
				return;
			}
			clock += NDS_AUDIO_CLOCK;
			if (clock < period) continue;
			const advanced = Math.floor(clock / period);
			clock -= advanced * period;
			position += advanced;
			if (position < length) continue;
			if (!repeats) {
				channel.voice = null;
				return;
			}
			position = loopStart + (position - length) % loopLength;
		}
		voice.position = position;
		voice.clock = clock;
		voice.releaseRemaining = releaseRemaining;
	}
}
