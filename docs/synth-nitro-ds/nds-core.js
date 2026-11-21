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
const CAPTURE_TIMER_CHANNELS = [1, 3];
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

function quantizeCapture(output, pcm8) {
	// Recover the mixer level before Tetorica's output headroom, then clip
	// at the capture unit's 16.8-bit input. GBATEK describes a correction
	// toward zero for negative values with the top fractional bit set.
	const fixed = Math.max(-0x800000, Math.min(0x7fffff, Math.floor(output * (0x800000 / OUTPUT_GAIN))));
	const shift = pcm8 ? 16 : 8;
	const fractionHighBit = 1 << (shift - 1);
	const correction = fixed < 0 && (fixed & fractionHighBit) !== 0 ? 1 : 0;
	return (fixed >> shift) + correction;
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
	#captures = [null, null];
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
		if (old.timer !== next.timer) {
			const oldPeriod = this.#period(old.timer);
			const period = this.#period(next.timer);
			if (voice) {
				// Retune without jumping to a different sample at the update boundary.
				voice.clock = Math.floor((voice.clock / oldPeriod) * period);
			}
			const capture = this.#captures[CAPTURE_TIMER_CHANNELS.indexOf(index)];
			if (capture?.active) {
				capture.clock = Math.floor((capture.clock / oldPeriod) * period);
				capture.timerChanged = true;
			}
		}
		channel.config = next;
		channel.sample = sample;
	}

	/** Start a mixer-tap one-shot while sharing the capture unit's voice timer. */
	startCapture(unit, settings) {
		integer(unit, 0, 1, 'DS capture unit');
		if (this.#captures[unit]?.active) throw new Error('Stop the active Sound Capture before starting again.');
		if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
			Object.keys(settings).some(key => key !== 'format' && key !== 'lengthWords' && key !== 'timer'))
			throw new TypeError('Expected DS capture format, word length and optional timer');
		const { format, lengthWords, timer } = settings;
		if (format !== 'pcm8' && format !== 'pcm16') throw new RangeError('DS capture format must be pcm8 or pcm16');
		integer(lengthWords, 1, 0xffff, 'DS capture length in words');
		const timerChannel = CAPTURE_TIMER_CHANNELS[unit];
		const sharedTimer = timer === undefined ? this.#channels[timerChannel].config.timer : timer;
		integer(sharedTimer, 0, 65535, 'DS timer');
		const bytes = new Uint8Array(lengthWords * 4);
		if (timer !== undefined) this.configure(timerChannel, { timer });
		this.#captures[unit] = {
			active: true, bytes, format, lengthWords, timer: sharedTimer,
			timerChanged: false, clock: 0, writtenBytes: 0,
		};
		return this.getCaptureState(unit);
	}

	getCaptureState(unit) {
		integer(unit, 0, 1, 'DS capture unit');
		const capture = this.#captures[unit];
		const timerChannel = CAPTURE_TIMER_CHANNELS[unit];
		const currentTimer = this.#channels[timerChannel].config.timer;
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
		integer(unit, 0, 1, 'DS capture unit');
		const capture = this.#captures[unit];
		if (capture) capture.active = false;
		return this.getCaptureState(unit);
	}

	readCapture(unit) {
		const state = this.getCaptureState(unit);
		const bytes = this.#captures[unit]?.bytes.slice(0, state.byteLength) ?? new Uint8Array(0);
		return { ...state, bytes };
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
		if (this.#captures[0]?.active) this.#renderCapture(0, left);
		if (this.#captures[1]?.active) this.#renderCapture(1, right);
	}

	#renderCapture(unit, output) {
		const capture = this.#captures[unit];
		const timer = this.#channels[CAPTURE_TIMER_CHANNELS[unit]].config.timer;
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
