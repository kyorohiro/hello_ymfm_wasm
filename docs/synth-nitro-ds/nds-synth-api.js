// SPDX-License-Identifier: BSD-3-Clause
import { noteToHz } from '../js/soundchip_pitch.js';
import { NDS_AUDIO_CLOCK, NDS_ADPCM_STEPS, NDS_ADPCM_INDEX_DELTAS, ndsAdpcmDelta } from './nds-core.js?v=nds-range-live-1';

const PCM_MODES = new Set(['pcm8', 'pcm16', 'adpcm']);
export const NDS_SOFTWARE_WAVE_FRAMES = 64;
const WAVE_SHAPE = {
	sine: (phase) => Math.sin(phase * Math.PI * 2),
	triangle: (phase) => 1 - 4 * Math.abs(phase - .5),
	saw: (phase) => phase * 2 - 1,
	square: (phase) => phase < .5 ? 1 : -1,
};

// This encoder only builds the supplied short software waveforms. The DS
// core then consumes their actual PCM words or NDS IMA ADPCM sample bytes.
function encodeWaveAdpcm(wave) {
	const bytes = new Uint8Array(4 + wave.length / 2);
	const header = new DataView(bytes.buffer);
	let predictor = wave[0], index = 55;
	header.setInt16(0, predictor, true);
	header.setUint8(2, index);
	for (let frame = 0; frame < wave.length; frame++) {
		let best = 0, bestSample = predictor, bestError = Infinity;
		for (let code = 0; code < 16; code++) {
			const value = Math.max(-32767, Math.min(32767,
				predictor + ndsAdpcmDelta(NDS_ADPCM_STEPS[index], code)));
			const error = Math.abs(value - wave[frame]);
			if (error < bestError) {
				best = code;
				bestSample = value;
				bestError = error;
			}
		}
		predictor = bestSample;
		index = Math.max(0, Math.min(88, index + NDS_ADPCM_INDEX_DELTAS[best & 7]));
		bytes[4 + (frame >> 1)] |= best << ((frame & 1) * 4);
	}
	return bytes;
}

export function makeNdsSample(mode, shape = 'sine') {
	if (!PCM_MODES.has(mode)) throw new RangeError('Choose PCM8, PCM16 or IMA ADPCM sample data.');
	if (!Object.hasOwn(WAVE_SHAPE, shape)) throw new RangeError('Unknown DS software waveform.');
	const wave = Int16Array.from({ length: NDS_SOFTWARE_WAVE_FRAMES }, (_, frame) =>
		Math.round(WAVE_SHAPE[shape](frame / NDS_SOFTWARE_WAVE_FRAMES) * 20480));
	let bytes;
	if (mode === 'pcm8') bytes = Uint8Array.from(wave, (value) => Math.round(value / 256) & 0xff);
	else if (mode === 'pcm16') {
		bytes = new Uint8Array(wave.length * 2);
		const words = new DataView(bytes.buffer);
		wave.forEach((value, frame) => words.setInt16(frame * 2, value, true));
	} else bytes = encodeWaveAdpcm(wave);
	const loopStartWords = mode === 'adpcm' ? 1 : 0;
	return { bytes, frames: wave.length, loopStartWords, lengthWords: bytes.length / 4 - loopStartWords, loop: true };
}

/** Timer code for a waveform cycle or, in Noise mode, the LFSR clock. */
export function ndsTimerForFrequency(hz, frames) {
	if (!Number.isFinite(hz) || hz <= 0) throw new RangeError('DS frequency must be positive finite Hz.');
	if (!Number.isSafeInteger(frames) || frames < 1)
		throw new RangeError('The number of DS sample frames per cycle must be positive.');
	const period = Math.max(1, Math.min(65536, Math.round(NDS_AUDIO_CLOCK / hz / frames)));
	return { timer: 65536 - period, frequencyHz: NDS_AUDIO_CLOCK / period / frames };
}

/** Immediate physical-channel operations for Keyboard and Code. Calls on an
 * owner-scoped chip release only notes that the same owner started. */
export class NdsSynth {
	#request;
	#owner;
	#owners;
	#token;
	#facades = new Map();
	constructor(request, { owner = 'direct', owners = [], token = { next: 0 } } = {}) {
		this.#request = request;
		this.#owner = owner;
		this.#owners = owners;
		this.#token = token;
	}
	forOwner(owner) {
		if (this.#owner !== 'direct') throw new Error('The DS voice owner is already assigned.');
		if (typeof owner !== 'string' || !owner.length || owner.length > 64)
			throw new TypeError('DS voice owner must be a non-empty name up to 64 characters.');
		if (!this.#facades.has(owner)) {
			this.#facades.set(owner, new NdsSynth(this.#request, {
				owner, owners: this.#owners, token: this.#token,
			}));
		}
		return this.#facades.get(owner);
	}
	owns(channel, token) {
		const voice = this.#owners[channel];
		return voice?.owner === this.#owner && (token === undefined || token === voice.token);
	}
	async noteOn(channel, note, settings = {}) {
		return this.#request('noteOn', [channel, noteToHz(note), settings, this.#owner, ++this.#token.next]);
	}
	async noteOff(channel, token) {
		return this.#request('noteOff', [channel, this.#owner, token]);
	}
	async keyOn(channel) {
		return this.#request('keyOn', [channel, this.#owner, ++this.#token.next]);
	}
	async keyOff(channel, token) {
		return this.#request('keyOff', [channel, this.#owner, token]);
	}
	async configure(channel, patch) {
		return this.#request('configure', [channel, patch]);
	}
	async configureOwned(channel, token, patch, note) {
		const args = [channel, this.#owner, token, patch];
		if (note !== undefined) args.push(noteToHz(note));
		return this.#request('configureOwned', args);
	}
	async setOwnedSampleRange(channel, token, range) {
		return this.#request('setOwnedSampleRange', [channel, this.#owner, token, range]);
	}
	async setNote(channel, note) {
		return this.setFrequency(channel, noteToHz(note));
	}
	async setFrequency(channel, frequencyHz) {
		if (!Number.isFinite(frequencyHz) || frequencyHz <= 0)
			throw new RangeError('DS frequency must be positive finite Hz.');
		return this.#request('setFrequency', [channel, frequencyHz]);
	}
	async getState(channel) {
		return this.#request('getState', [channel]);
	}
	async setChannelMix(channel, patch) {
		return this.#request('setChannelMix', [channel, patch]);
	}
	async getChannelMix(channel) {
		return this.#request('getChannelMix', [channel]);
	}
	async startCapture(unit, settings) {
		return this.#request('startCapture', [unit, settings]);
	}
	async getCaptureState(unit) {
		return this.#request('getCaptureState', [unit]);
	}
	async stopCapture(unit) {
		return this.#request('stopCapture', [unit]);
	}
	async readCapture(unit) {
		return this.#request('readCapture', [unit]);
	}
	async stopOwned() {
		return this.#request('stopOwned', [this.#owner]);
	}
	async allSoundOff() {
		return this.#request('allSoundOff');
	}
}
