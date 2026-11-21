// SPDX-License-Identifier: BSD-3-Clause
import { NDS_AUDIO_CLOCK, NDS_CHANNEL_COUNT, NdsSoundCore } from './nds-core.js';
import { makeNdsSample, ndsTimerForFrequency } from './nds-synth-api.js';

const DEFAULT_SAMPLE = makeNdsSample('pcm16');
const PCM_MODES = new Set(['pcm8', 'pcm16', 'adpcm']);
const ATTACK = new Set(['noteOn', 'keyOn']);
const RELEASE = new Set(['noteOff', 'keyOff']);
const OWNERSHIP_METHODS = new Set([...ATTACK, ...RELEASE, 'stopOwned', 'allSoundOff']);

function sampleFrames(mode, loop, start, length) {
	if (mode === 'pulse') return 8;
	if (mode === 'noise') return 1;
	const words = loop ? length : start + length;
	if (mode === 'adpcm') return (words - (loop && start >= 1 ? 0 : 1)) * 8;
	return words * (mode === 'pcm8' ? 4 : 2);
}

class NdsSynthProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.core = new NdsSoundCore(sampleRate);
		this.owners = Array(NDS_CHANNEL_COUNT).fill(null);
		this.samples = Array.from({ length: NDS_CHANNEL_COUNT }, () => ({ shape: 'sine', frames: null }));
		this.dead = false;
		for (let channel = 0; channel < NDS_CHANNEL_COUNT; channel++) {
			const { frames, ...sample } = DEFAULT_SAMPLE;
			this.core.configure(channel, { ...sample, mode: 'pcm16', timer: ndsTimerForFrequency(440, frames).timer });
		}
		this.port.onmessage = ({ data }) => this.receive(data);
	}

	read(channel) {
		const state = this.core.getState(channel);
		const sample = this.samples[channel];
		const frames = (PCM_MODES.has(state.mode) ? sample.frames : null)
			?? sampleFrames(state.mode, state.loop, state.loopStartWords, state.lengthWords);
		return {
			...state, frames, shape: PCM_MODES.has(state.mode) ? sample.shape : null,
			frequencyHz: NDS_AUDIO_CLOCK / (65536 - state.timer) / frames,
			owner: this.owners[channel]?.owner ?? null, token: this.owners[channel]?.token ?? null,
		};
	}

	configure(channel, settings, frequency) {
		const state = this.core.getState(channel);
		if (!settings || typeof settings !== 'object' || Array.isArray(settings))
			throw new TypeError('DS channel settings must be an object.');
		const { shape, frames, ...patch } = settings;
		const sample = this.samples[channel];
		const mode = patch.mode ?? state.mode;
		let nextShape = sample.shape, frameOverride = sample.frames;
		if (frames !== undefined && frames !== null && (!Number.isSafeInteger(frames) || frames < 1 || frames > 2097152))
			throw new RangeError('DS sample frames per cycle must be 1–2097152.');
		if (PCM_MODES.has(mode)) {
			const loadDefault = !Object.hasOwn(patch, 'bytes') && (
				shape !== undefined || mode !== state.mode || !state.byteLength);
			if (loadDefault) {
				nextShape = shape ?? sample.shape ?? 'sine';
				const { frames: _frames, loop: _loop, ...wave } = makeNdsSample(mode, nextShape);
				// When callers move the loop start, the core can infer the new length.
				if (Object.hasOwn(patch, 'loopStartWords')) delete wave.lengthWords;
				Object.assign(patch, { ...wave, ...patch });
				frameOverride = null;
			} else if (Object.hasOwn(patch, 'bytes')) {
				if (shape !== undefined) throw new TypeError('Choose a DS software waveform or provide sample bytes.');
				nextShape = null;
				frameOverride = null;
			}
			if (frames !== undefined) frameOverride = frames;
		} else if (shape !== undefined || frames !== undefined) {
			throw new TypeError('Software waveform and cycle length apply to PCM or ADPCM only.');
		}
		if (frequency !== undefined && !Object.hasOwn(patch, 'timer')) {
			const hasNewBytes = Object.hasOwn(patch, 'bytes');
			const loop = patch.loop ?? state.loop;
			const start = patch.loopStartWords ?? (hasNewBytes ? (mode === 'adpcm' && loop ? 1 : 0) : state.loopStartWords);
			const byteLength = hasNewBytes ? patch.bytes?.byteLength ?? 0 : state.byteLength;
			const length = Object.hasOwn(patch, 'lengthWords') || hasNewBytes
				? patch.lengthWords ?? byteLength / 4 - start
				: state.lengthWords;
			const cycle = (PCM_MODES.has(mode) ? frameOverride : null) ?? sampleFrames(mode, loop, start, length);
			patch.timer = ndsTimerForFrequency(frequency, Math.max(1, cycle)).timer;
		}
		this.core.configure(channel, patch);
		this.samples[channel] = { shape: nextShape, frames: frameOverride };
		return this.read(channel);
	}

	owns(channel, owner, token) {
		this.core.getState(channel); // Use core validation even for a no-op.
		return this.owners[channel]?.owner === owner
			&& (token === undefined || this.owners[channel]?.token === token);
	}

	dispatch(method, args) {
		const [channel, first, second, third, fourth] = args;
		if (ATTACK.has(method)) {
			const [owner, token] = method === 'noteOn' ? [third, fourth] : [first, second];
			if (method === 'noteOn') this.configure(channel, second, first);
			this.core.keyOn(channel);
			this.owners[channel] = { owner, token };
			const { timer, frequencyHz } = this.read(channel);
			return { channel, token, timer, frequencyHz };
		}
		if (RELEASE.has(method)) {
			if (!this.owns(channel, first, second)) return false;
			if (method === 'keyOff') this.core.keyOff(channel);
			else this.core.release(channel);
			this.owners[channel] = null;
			return true;
		}
		switch (method) {
			case 'ready': return true;
			case 'configure': return this.configure(channel, first);
			case 'configureOwned':
				return this.owns(channel, first, second) ? this.configure(channel, third) : false;
			case 'setFrequency': {
				const { timer, frequencyHz } = this.configure(channel, {}, first);
				return { timer, frequencyHz };
			}
			case 'getState':
				return channel === undefined ? this.owners.map((_, index) => this.read(index)) : this.read(channel);
			case 'stopOwned': {
				let released = 0;
				this.owners.forEach((voice, index) => {
					if (voice?.owner !== channel) return;
					this.core.release(index);
					this.owners[index] = null;
					released++;
				});
				return released;
			}
			case 'allSoundOff':
				this.core.allSoundOff();
				this.owners.fill(null);
				return true;
			default: throw new TypeError('Unknown DS audio command.');
		}
	}

	receive(data) {
		if (data?.method === 'dispose') {
			this.dead = true;
			this.core.allSoundOff();
			this.owners.fill(null);
			return;
		}
		if (this.dead || !Number.isSafeInteger(data?.id)) return;
		const { id, method, args } = data;
		try {
			if (!Array.isArray(args)) throw new TypeError('DS audio arguments must be an array.');
			const value = this.dispatch(method, args);
			this.port.postMessage({ id, value, owners: OWNERSHIP_METHODS.has(method) ? this.owners : undefined });
		} catch (error) {
			this.port.postMessage({ id, error: error.message, name: error.name });
		}
	}

	process(_inputs, outputs) {
		const [left, right] = outputs[0] ?? [];
		if (this.dead) return false;
		if (left && right) this.core.render(left, right);
		return true;
	}
}

registerProcessor('tetorica-nds-synth', NdsSynthProcessor);
