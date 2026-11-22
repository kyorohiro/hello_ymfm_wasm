// SPDX-License-Identifier: BSD-3-Clause
import { noteToHz } from '../js/soundchip_pitch.js';
import { createProcessorPerformance } from '../js/playground_performance_processor.js';
import { NDS_AUDIO_CLOCK, NDS_CHANNEL_COUNT, NDS_NOISE_CLOCK_AT_C4 } from './nds-core.js?v=nds-keyboard-live-1';
import { makeNdsSample, ndsTimerForFrequency, ndsTimerForVoicePitch } from './nds-synth-api.js?v=nds-timed-1';
import { NdsSkyEmuCore } from './nds-skyemu-core.js?v=nds-timed-1';
import { resolveNdsOperation } from './nds-timed-operations.js';
import { createNdsTimedProcessor } from './nds-timed-processor.js';

const DEFAULT_SAMPLE = makeNdsSample('pcm16');
const PCM_MODES = new Set(['pcm8', 'pcm16', 'adpcm']);
const ATTACK = new Set(['noteOn', 'keyOn']);
const RELEASE = new Set(['noteOff', 'keyOff']);
const OWNERSHIP_METHODS = new Set([...ATTACK, ...RELEASE, 'getState', 'stopOwned', 'allSoundOff']);
const PREPARATION_STEPS_PER_BLOCK = 4;
const SMALL_SAMPLE_BYTES = 1024;
const NOISE_TO_KEY_RATIO = NDS_NOISE_CLOCK_AT_C4 / noteToHz('C4');

function sampleFrames(mode, loop, start, length) {
	if (mode === 'pulse') return 8;
	if (mode === 'noise') return 1;
	const words = loop ? length : start + length;
	if (mode === 'adpcm') return (words - (loop && start >= 1 ? 0 : 1)) * 8;
	return words * (mode === 'pcm8' ? 4 : 2);
}

function sameSampleBytes(previous, next) {
	if (!previous || !(next instanceof Uint8Array) || previous.length !== next.length) return false;
	for (let index = 0; index < next.length; index++) if (previous[index] !== next[index]) return false;
	return true;
}

class NdsSynthProcessor extends AudioWorkletProcessor {
	constructor({ processorOptions } = {}) {
		super();
		this.core = new NdsSkyEmuCore(processorOptions?.module, sampleRate);
		this.owners = Array(NDS_CHANNEL_COUNT).fill(null);
		this.samples = Array.from({ length: NDS_CHANNEL_COUNT }, () => ({ shape: 'sine', frames: null, tuning: null, bytes: null }));
		this.pendingAttacks = new Map();
		this.dead = false;
		this.renderFrame = 0;
		this.renderSound = (left, right) => this.core.render(left, right);
		this.performance = createProcessorPerformance({
			chip: 'nds', rate: sampleRate, nowFrame: () => this.renderFrame, trackImmediateNotes: false,
			patternCommandCost: () => 8,
			apply: ({ name, operation }, _port, _frame, { owner }) => {
				try { this.applyTimed(operation, owner, name); }
				catch (error) {
					this.releaseTimed(owner, name);
					throw error;
				}
			},
		});
		this.timed = createNdsTimedProcessor({
			performance: this.performance, sampleRate, instanceId: `nds:${Math.random().toString(36).slice(2)}`,
			getState: () => this.owners.map((_, channel) => this.timedState(channel)),
			canKeyOn: channel => this.core.timedRegisters(channel).canKeyOn,
			onError: message => this.port.postMessage(message),
			releaseHeld: (owner, name) => this.releaseTimed(owner, name),
		});
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
		const playbackRate = NDS_AUDIO_CLOCK / (65536 - state.timer);
		const frequencyHz = sample.tuning ? playbackRate * sample.tuning.rootHz / sample.tuning.sampleRate : playbackRate / frames;
		return {
			...state, frames, shape: PCM_MODES.has(state.mode) ? sample.shape : null,
			frequencyHz, sampleRate: sample.tuning?.sampleRate ?? null, rootNote: sample.tuning?.rootNote ?? null,
			owner: this.owners[channel]?.owner ?? null, token: this.owners[channel]?.token ?? null,
		};
	}

	timedState(channel) {
		const { owner: _owner, token: _token, ...channelState } = this.read(channel);
		return { ...channelState, ...this.core.timedRegisters(channel) };
	}

	releaseTimed(owner, name) {
		let released = false;
		this.owners.forEach((voice, channel) => {
			if (voice?.timedOwner && (owner === undefined || voice.timedOwner === owner) &&
				(name === undefined || voice.scheduleName === name)) {
				this.core.release(channel);
				this.owners[channel] = null;
				released = true;
			}
		});
		return released;
	}

	applyTimed(operation, owner, name) {
		const channel = operation.args[0];
		const { patch, gate } = resolveNdsOperation(operation, this.timedState(channel));
		if (gate === 'keyOff' || gate === 'noteOff') {
			if (this.owners[channel]?.timedOwner === owner) {
				if (gate === 'keyOff') this.core.keyOff(channel);
				else this.core.release(channel);
				this.owners[channel] = null;
			}
			return;
		}
		if (Object.keys(patch).length) this.configure(channel, patch, undefined, { deferLive: gate === 'keyOn' });
		if (gate === 'keyOn') {
			this.core.keyOnPrepared(channel);
			// A scheduled attack supersedes an earlier pending attack on its voice.
			this.cancelAttack(channel);
			this.owners[channel] = { owner: 'code', timedOwner: owner, scheduleName: name, token: 0 };
		}
	}

	configure(channel, settings, frequency, options) {
		const state = this.core.getState(channel);
		if (!settings || typeof settings !== 'object' || Array.isArray(settings))
			throw new TypeError('DS channel settings must be an object.');
		const { shape, frames, sampleRate, rootNote, ...patch } = settings;
		const sample = this.samples[channel];
		const mode = patch.mode ?? state.mode;
		const sampleMode = PCM_MODES.has(mode);
		const suppliedBytes = Object.hasOwn(patch, 'bytes');
		const sourceTuningChanged = sampleRate !== undefined || rootNote !== undefined;
		let nextShape = sample.shape, frameOverride = sample.frames, tuning = sample.tuning, reusableBytes = sample.bytes;
		if (frames !== undefined && frames !== null && (!Number.isSafeInteger(frames) || frames < 1 || frames > 2097152))
			throw new RangeError('DS sample frames per cycle must be 1–2097152.');
		if (sampleMode) {
			const loadDefault = !suppliedBytes && (shape !== undefined || mode !== state.mode || !state.byteLength);
			if (loadDefault) {
				nextShape = shape ?? sample.shape ?? 'sine';
				const { frames: _frames, loop: _loop, ...wave } = makeNdsSample(mode, nextShape);
				// When callers move the loop start, the core can infer the new length.
				if (Object.hasOwn(patch, 'loopStartWords')) delete wave.lengthWords;
				Object.assign(patch, { ...wave, ...patch });
				tuning = reusableBytes = null;
				frameOverride = null;
			} else if (suppliedBytes) {
				if (shape !== undefined) throw new TypeError('Choose a DS software waveform or provide sample bytes.');
				nextShape = null;
				frameOverride = null;
				tuning = null;
			}
			if (frames !== undefined) {
				frameOverride = frames;
				if (frames !== null) tuning = null;
			}
		} else if (shape !== undefined || frames !== undefined) {
			throw new TypeError('Software waveform and cycle length apply to PCM or ADPCM only.');
		} else tuning = null;
		if (sourceTuningChanged) {
			if (!sampleMode || nextShape !== null) throw new TypeError('Source sample tuning requires imported PCM or ADPCM bytes.');
			if (!Number.isFinite(sampleRate) || sampleRate < 1 || sampleRate > NDS_AUDIO_CLOCK || rootNote === undefined)
				throw new RangeError(`Provide a DS source sampleRate from 1 through ${NDS_AUDIO_CLOCK} Hz and its rootNote together.`);
			if (frames !== undefined && frames !== null) throw new TypeError('Choose source tuning or a sample-cycle length.');
			tuning = { sampleRate, rootNote, rootHz: noteToHz(rootNote) };
			frameOverride = null;
		}
		if (frequency !== undefined && !Object.hasOwn(patch, 'timer')) {
			if (tuning) {
				patch.timer = ndsTimerForVoicePitch(frequency, 1, tuning);
			} else {
				const hasNewBytes = Object.hasOwn(patch, 'bytes');
				const loop = patch.loop ?? state.loop;
				const start = patch.loopStartWords ?? (hasNewBytes ? (mode === 'adpcm' && loop ? 1 : 0) : state.loopStartWords);
				const byteLength = hasNewBytes ? patch.bytes?.byteLength ?? 0 : state.byteLength;
				const length = Object.hasOwn(patch, 'lengthWords') || hasNewBytes
					? patch.lengthWords ?? byteLength / 4 - start
					: state.lengthWords;
				const cycle = (sampleMode ? frameOverride : null) ?? sampleFrames(mode, loop, start, length);
				const hz = mode === 'noise' && options?.keyboard ? frequency * NOISE_TO_KEY_RATIO : frequency;
				patch.timer = ndsTimerForFrequency(hz, Math.max(1, cycle)).timer;
			}
		}
		if (!tuning) reusableBytes = null;
		if (tuning && suppliedBytes) {
			// MessagePort already copied the incoming bytes. An explicit range
			// can reuse that source even when the bounds have changed.
			const received = patch.bytes?.buffer instanceof ArrayBuffer ? patch.bytes : null;
			if (mode === state.mode && Number.isInteger(patch.loopStartWords) && Number.isInteger(patch.lengthWords) &&
				sameSampleBytes(reusableBytes, received)) delete patch.bytes;
			else reusableBytes = received;
		}
		this.core.configure(channel, patch, options);
		this.samples[channel] = { shape: nextShape, frames: frameOverride, tuning, bytes: reusableBytes };
		return this.read(channel);
	}

	owns(channel, owner, token) {
		this.core.getState(channel); // Use core validation even for a no-op.
		const sounding = this.owners[channel];
		return sounding?.owner === owner && (token === undefined || sounding.token === token);
	}

	queueAttack(id, method, args) {
		const [channel, first, second, third, fourth] = args;
		const [owner, token] = method === 'noteOn' ? [third, fourth] : [first, second];
		if (method === 'prepareVoice' && this.pendingAttacks.has(channel))
			throw new Error('The DS channel is already preparing a note.');
		if (method === 'noteOn') this.configure(channel, second, first, { deferLive: true, keyboard: owner === 'keyboard' });
		else this.core.getState(channel);
		this.cancelAttack(channel);
		this.pendingAttacks.set(channel, { id, method, owner, token });
	}

	cancelAttack(channel, owner, token) {
		const attack = this.pendingAttacks.get(channel);
		if (!attack || (owner !== undefined && attack.owner !== owner) ||
			(token !== undefined && attack.token !== token)) return false;
		this.pendingAttacks.delete(channel);
		this.core.cancelPreparation(channel);
		this.port.postMessage({ id: attack.id, name: 'AbortError', error: 'DS note preparation cancelled.' });
		return true;
	}

	advanceAttacks() {
		let budget = PREPARATION_STEPS_PER_BLOCK;
		while (this.pendingAttacks.size && budget > 0) {
			const [channel, attack] = this.pendingAttacks.entries().next().value;
			try {
				const ready = this.core.prepareKeyOn(channel);
				if (!ready || this.core.getState(channel).byteLength > SMALL_SAMPLE_BYTES) budget--;
				// Finish a sample before starting another. The ADPCM cache
				// reserves room for one replacement while all 16 voices play.
				if (!ready) continue;
				this.pendingAttacks.delete(channel);
				if (attack.method === 'prepareVoice') {
					this.reply(attack.id, attack.method, this.read(channel));
					continue;
				}
				this.core.keyOn(channel);
				const { owner, token } = attack;
				this.owners[channel] = { owner, token };
				const { timer, frequencyHz } = this.read(channel);
				this.reply(attack.id, attack.method, { channel, token, timer, frequencyHz });
			} catch (error) {
				this.pendingAttacks.delete(channel);
				this.core.cancelPreparation(channel);
				this.port.postMessage({ id: attack.id, error: error.message, name: error.name });
			}
		}
	}

	dispatch(method, args) {
		const [channel, first, second, third, fourth] = args;
		if (RELEASE.has(method)) {
			const cancelled = this.cancelAttack(channel, first, second);
			if (!this.owns(channel, first, second)) return cancelled;
			if (method === 'keyOff') this.core.keyOff(channel);
			else this.core.release(channel);
			this.owners[channel] = null;
			return true;
		}
		switch (method) {
			case 'ready': return 'skyemu';
			case 'ndsTimed': return this.timed.invoke(channel);
			case 'configure': return this.configure(channel, first);
			case 'configureOwned':
				return !this.pendingAttacks.has(channel) && this.owns(channel, first, second)
					? this.configure(channel, third, fourth) : false;
			case 'setOwnedSampleRange':
				return !this.pendingAttacks.has(channel) && this.owns(channel, first, second)
					&& this.core.setPlayingSampleRange(channel, third);
			case 'setFrequency': {
				const { timer, frequencyHz } = this.configure(channel, {}, first);
				return { timer, frequencyHz };
			}
			case 'getState':
				return channel === undefined ? this.owners.map((_, index) => this.read(index)) : this.read(channel);
			case 'setChannelMix': return this.core.setChannelMix(channel, first);
			case 'getChannelMix': return this.core.getChannelMix(channel);
			case 'startCapture': return this.core.startCapture(channel, first);
			case 'getCaptureState': return this.core.getCaptureState(channel);
			case 'stopCapture': return this.core.stopCapture(channel);
			case 'readCapture': return this.core.readCapture(channel);
			case 'stopOwned': {
				let released = 0;
				this.owners.forEach((voice, index) => {
					const cancelled = this.cancelAttack(index, channel);
					if (voice?.owner === channel) {
						this.core.release(index);
						this.owners[index] = null;
					}
					if (cancelled || voice?.owner === channel) released++;
				});
				return released;
			}
			case 'allSoundOff':
				this.timed.reset();
				for (const index of this.pendingAttacks.keys()) this.cancelAttack(index);
				this.core.allSoundOff();
				this.owners.fill(null);
				return true;
			default: throw new TypeError('Unknown DS audio command.');
		}
	}

	reply(id, method, value) {
		this.port.postMessage({ id, value, owners: OWNERSHIP_METHODS.has(method) ? this.owners : undefined },
			method === 'readCapture' ? [value.bytes.buffer] : []);
	}

	receive(data) {
		if (data?.method === 'dispose') {
			this.dead = true;
			this.timed.reset();
			this.pendingAttacks.clear();
			this.core.close();
			this.owners.fill(null);
			return;
		}
		if (this.dead || !Number.isSafeInteger(data?.id)) return;
		const { id, method, args } = data;
		try {
			if (!Array.isArray(args)) throw new TypeError('DS audio arguments must be an array.');
			if (ATTACK.has(method) || method === 'prepareVoice') this.queueAttack(id, method, args);
			else this.reply(id, method, this.dispatch(method, args));
		} catch (error) {
			this.port.postMessage({ id, error: error.message, name: error.name });
		}
	}

	process(_inputs, outputs) {
		const [left, right] = outputs[0] ?? [];
		if (this.dead) return false;
		if (left && right) {
			this.performance.render(left, right, this.renderSound);
			this.renderFrame += left.length;
		}
		this.advanceAttacks();
		return true;
	}
}

registerProcessor('tetorica-nds-synth', NdsSynthProcessor);
