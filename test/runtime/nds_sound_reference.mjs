// SPDX-License-Identifier: BSD-3-Clause
// Reference renderer for comparing DS timing and sample-format behavior in tests.
import { chipMixGains, soundChipMixDefaults } from '../../docs/js/soundchip_mixer.js';
import {
	NDS_AUDIO_CLOCK, NDS_CHANNEL_COUNT, NDS_CHANNEL_DEFAULTS, NDS_SYNTH_OUTPUT_GAIN, NdsMixerCapture,
	decodeNdsAdpcm, ndsInteger, ndsSampleRange, normalizeNdsChannel, normalizeNdsChannelMix,
} from '../../docs/synth-nitro-ds/nds-core.js';

const DIVISORS = [1, 2, 4, 16];
const STARTUP_PERIODS = { pcm8: 3, pcm16: 3, adpcm: 11, pulse: 1, noise: 1 };
const MIX_DEFAULTS = Object.freeze(soundChipMixDefaults());
const MIX_GAINS_DEFAULTS = Object.freeze(chipMixGains(MIX_DEFAULTS));
const PSG_LEVEL = 32767 / 32768;
const PULSE_PATTERNS = Array.from({ length: 8 }, (_, duty) =>
	Int8Array.from({ length: 8 }, (_, frame) => duty !== 7 && frame >= 7 - duty ? 1 : -1));

// Cache one whole 15-bit LFSR period so high timer rates can skip ahead in O(1).
const NOISE_PATTERN = new Int8Array(0x7fff);
let lfsr = 0x7fff;
for (let index = 0; index < NOISE_PATTERN.length; index++) {
	const low = lfsr & 1;
	NOISE_PATTERN[index] = low ? -1 : 1;
	lfsr = (lfsr >>> 1) ^ (low ? 0x6000 : 0);
}

function unit7(code) {
	return code === 127 ? 1 : code / 128;
}

function sampleReader(mode, bytes) {
	if (mode === 'pcm8') return frame => ((bytes[frame] << 24) >> 24) / 128;
	if (mode === 'pcm16') {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		return frame => view.getInt16(frame * 2, true) / 32768;
	}
	// The complete decode preserves predictor history at each loop point.
	// Keep it for later changes to either boundary of this sample.
	const decoded = decodeNdsAdpcm(bytes);
	return frame => decoded[frame] / 32768;
}

function prepareSample(config, read) {
	const range = ndsSampleRange(config);
	return range && { ...range, read: read ?? sampleReader(config.mode, config.bytes) };
}

export class NdsSoundCore {
	#channels = Array.from({ length: NDS_CHANNEL_COUNT }, () => ({
		config: NDS_CHANNEL_DEFAULTS, sample: null, voice: null, mix: MIX_DEFAULTS, mixGains: MIX_GAINS_DEFAULTS,
	}));
	#capture;
	#sampleRate;

	constructor(sampleRate) {
		ndsInteger(sampleRate, 8000, 192000, 'Output sample rate');
		this.#sampleRate = sampleRate;
		this.#capture = new NdsMixerCapture(sampleRate, channel => this.#channels[channel].config.timer,
			(channel, timer) => this.configure(channel, { timer }));
	}

	#channel(index) {
		ndsInteger(index, 0, NDS_CHANNEL_COUNT - 1, 'DS channel');
		return this.#channels[index];
	}

	#period(timer) {
		return (65536 - timer) * this.#sampleRate;
	}

	configure(index, patch) {
		const channel = this.#channel(index);
		const next = normalizeNdsChannel(index, channel.config, patch);
		const replacing = Object.hasOwn(patch, 'bytes');

		const old = channel.config;
		const sampleChanged = next.mode !== old.mode || replacing || next.loopStartWords !== old.loopStartWords
			|| next.lengthWords !== old.lengthWords || next.loop !== old.loop;
		const read = !replacing && next.mode === old.mode ? channel.sample?.read : undefined;
		const sample = sampleChanged ? prepareSample(next, read) : channel.sample;
		const voice = channel.voice;
		if (old.timer !== next.timer) {
			const oldPeriod = this.#period(old.timer);
			const period = this.#period(next.timer);
			if (voice) {
				// Retune without jumping to a different sample at the update boundary.
				voice.clock = Math.floor((voice.clock / oldPeriod) * period);
			}
			this.#capture.retune(index, old.timer, next.timer);
		}
		channel.config = next;
		channel.sample = sample;
	}

	startCapture(unit, settings) { return this.#capture.startCapture(unit, settings); }
	getCaptureState(unit) { return this.#capture.getCaptureState(unit); }
	stopCapture(unit) { return this.#capture.stopCapture(unit); }
	readCapture(unit) { return this.#capture.readCapture(unit); }

	keyOn(index) {
		const channel = this.#channel(index);
		const { mode, loop, bytes } = channel.config;
		const sample = channel.sample;
		if (!sample && mode !== 'pulse' && mode !== 'noise') throw new Error('Load a DS sample before Key On');
		channel.voice = {
			mode, sample, loop, bytes, position: -STARTUP_PERIODS[mode], clock: 0,
			releaseFrames: 0, releaseRemaining: 0,
		};
	}

	/** Apply software-edited bounds to the sounding sample without restarting it. */
	setPlayingSampleRange(index, { loopStartWords, lengthWords }) {
		const voice = this.#channel(index).voice;
		if (!voice?.sample || voice.releaseFrames) return false;
		ndsInteger(loopStartWords, 0, 65535, 'DS loop start in words');
		ndsInteger(lengthWords, 1, 0x3fffff, 'DS sample length in words');
		const sample = prepareSample({ mode: voice.mode, bytes: voice.bytes, loop: voice.loop, loopStartWords, lengthWords }, voice.sample.read);
		if (voice.position >= sample.end) {
			if (!voice.loop) {
				this.release(index);
				return true;
			}
			voice.position = sample.start + (voice.position - sample.end) % (sample.end - sample.start);
		}
		voice.sample = sample;
		return true;
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

	/** Software output trim independent of the physical channel registers. */
	setChannelMix(index, patch) {
		const channel = this.#channel(index);
		const mix = normalizeNdsChannelMix(channel.mix, patch);
		channel.mix = mix;
		channel.mixGains = chipMixGains(mix);
		return { ...mix };
	}

	getChannelMix(index) {
		if (index === undefined) return this.#channels.map(channel => ({ ...channel.mix }));
		return { ...this.#channel(index).mix };
	}

	render(left, right) {
		if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length)
			throw new TypeError('DS rendering requires equal-length Float32Array output channels');
		left.fill(0);
		right.fill(0);
		for (const channel of this.#channels) {
			if (channel.voice) this.#renderChannel(channel, left, right);
		}
		this.#capture.render(left, right);
	}

	#renderChannel(channel, left, right) {
		const voice = channel.voice;
		const { sample, mode, loop, releaseFrames } = voice;
		const { timer, volume, pan, divider, duty } = channel.config;
		const gain = unit7(volume) * NDS_SYNTH_OUTPUT_GAIN / DIVISORS[divider];
		const panMix = unit7(pan);
		const [mixLeft, mixRight] = channel.mixGains;
		const leftGain = gain * (1 - panMix) * mixLeft;
		const rightGain = gain * panMix * mixRight;
		const audible = leftGain !== 0 || rightGain !== 0;
		const period = this.#period(timer);
		const oscillator = mode === 'pulse' ? PULSE_PATTERNS[duty] : NOISE_PATTERN;
		const length = sample?.end ?? oscillator.length;
		const repeats = !sample || loop;
		const loopStart = sample?.start ?? 0;
		const loopLength = length - loopStart;
		let { position, clock, releaseRemaining } = voice;

		for (let frame = 0; frame < left.length; frame++) {
			if (audible && position >= 0) {
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
