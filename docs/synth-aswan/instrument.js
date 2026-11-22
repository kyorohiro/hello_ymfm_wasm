// SPDX-License-Identifier: BSD-3-Clause
import { WonderSwanSynth, WONDERSWAN_CLOCK } from '../js/wonderswansynth.js';
import { noteToHz } from '../js/soundchip_pitch.js';
import { createDefaultPreset, readPreset, decodePcmData } from './preset.js';
import { validateAswanCodeCall, aswanCodeCancelled } from './code_endpoint.js';
// PCM is an immutable base64 string: share it rather than cloning megabytes
// for each of the four observed channel presets.
const copy = (value) => ({
		...value,
		wave: [...value.wave],
		sweep: { ...value.sweep },
		noise: { ...value.noise },
		envelope: { ...value.envelope },
		pcm: { ...value.pcm },
	}),
	slot = (value) => {
		if (!Number.isInteger(value) || value < 0 || value > 3)
			throw new RangeError('ASWAN channel must be 0..3');
		return value;
	};
const pool = (p) =>
	p.source === 'noise' ? [3] : p.source === 'pcm' ? [1] : p.sweep.enabled ? [2] : [0, 1, 2, 3];
const midi = (value) => 69 + 12 * Math.log2(noteToHz(value) / 440);
/** One four-channel chip. Keyboard allocation, unsigned Voice PCM streaming
 * and ADSR are software controls; the hardware has no ADSR/release unit.
 */
export class AswanInstrument {
	constructor(core) {
		if (
			!core ||
			typeof core.generateStereoView !== 'function' ||
			typeof core.writeWonderSwan !== 'function'
		)
			throw new TypeError('Expected WonderSwanAudioEngine');
		this.core = core;
		this.rate = core.sampleRate();
		this.frame = 0;
		this.sequence = 0;
		this.pitch = 0;
		this.cursor = 0;
		this.voices = new Map();
		this.owners = Array(4).fill(null);
		this.codeSession = 0;
		this.codeActive = false;
		this.disposed = false;
		this.synth = new WonderSwanSynth({
			transport: {
				writeRegister: (address, value) => core.writeWonderSwan(address - 0x80, value),
				writeMemory: (address, value) => core.writeWonderSwanMemory(address, value),
				reset: () => core.reset(),
			},
		});
		this.synth.initialize();
		this.preset = createDefaultPreset();
		this.channelPresets = Array.from({ length: 4 }, () => copy(this.preset));
		this.pcmCache = new Map();
		this.setPreset(this.preset);
		this.stop();
	}
	_open() {
		if (this.disposed) throw new Error('ASWAN instrument is disposed');
	}
	_settings(channel) {
		const p = this.channelPresets[channel];
		return { preset: p, samples: this._pcm(p) };
	}
	_pcm(p) {
		let bytes = this.pcmCache.get(p.pcm.data);
		if (!bytes) {
			bytes = decodePcmData(p.pcm.data);
			if (this.pcmCache.size >= 8) this.pcmCache.clear();
			this.pcmCache.set(p.pcm.data, bytes);
		}
		return bytes;
	}
	_frequency(value) {
		return Math.max(
			WONDERSWAN_CLOCK / (32 * 2048),
			Math.min(WONDERSWAN_CLOCK / 32, 440 * 2 ** ((value - 69 + this.pitch) / 12)),
		);
	}
	_wave(channel, wave) {
		const bank = this.synth._getState().registers[15] << 6;
		for (let i = 0; i < 16; i++)
			this.synth.writeMemory(
				(bank + channel * 16 + i) & 0x3fff,
				wave[i * 2] | (wave[i * 2 + 1] << 4),
			);
	}
	_apply(channel, p) {
		this._wave(channel, p.wave);
		if (channel === 1) this.synth.setVoiceMode(p.source === 'pcm');
		if (channel === 2) this.synth.setSweep(p.sweep);
		if (channel === 3)
			this.synth.setNoise({
				enabled: p.source === 'noise',
				type: p.noise.type,
				reset: false,
			});
		if (p.source === 'pcm')
			this.synth.writeRegister(
				0x94,
				(p.left >= 8 ? 8 : p.left ? 4 : 0) | (p.right >= 8 ? 2 : p.right ? 1 : 0),
			);
		else this.synth.setVolume(channel, p.left, p.right);
		const voice = this.owners[channel];
		if (voice) {
			const changed =
				voice.preset.pcm.data !== p.pcm.data || voice.preset.source !== p.source;
			voice.preset = copy(p);
			voice.samples = this._pcm(p);
			if (changed) voice.position = 0;
			if (!voice.raw) {
				this._tune(voice);
				this._volume(voice);
			}
		}
	}
	setPreset(value, channel = null) {
		this._open();
		const p = readPreset(value),
			targets = channel === null ? pool(p) : [slot(channel)];
		if (targets.some((ch) => !pool(p).includes(ch)))
			throw new RangeError('Noise uses CH4, PCM CH2 and Sweep CH3');
		// Validate before any register/RAM write. Wave edits use packed RAM
		// directly because setWaveform() intentionally clears the native gate.
		this._pcm(p);
		if (channel === null) this.preset = p;
		for (const ch of targets) {
			this.channelPresets[ch] = copy(p);
			this._apply(ch, p);
		}
		return this.read();
	}
	applyPreset(...args) {
		return this.setPreset(...args);
	}
	loadPreset(...args) {
		return this.setPreset(...args);
	}
	editPreset(before, value, channel) {
		this._open();
		const previous = readPreset(before),
			next = readPreset(value);
		if (channel !== null) slot(channel);
		const current =
			channel === null ? copy(this.preset) : this.read().channels[channel].authoredPreset;
		const merge = (old, changed, latest) => {
			for (const key of Object.keys(changed)) {
				if (JSON.stringify(old[key]) === JSON.stringify(changed[key])) continue;
				if (
					changed[key] &&
					typeof changed[key] === 'object' &&
					!Array.isArray(changed[key])
				)
					merge(old[key], changed[key], latest[key]);
				else latest[key] = Array.isArray(changed[key]) ? [...changed[key]] : changed[key];
			}
			return latest;
		};
		return this.setPreset(merge(previous, next, current), channel);
	}
	_tune(voice) {
		if (voice.preset.source === 'pcm')
			voice.step =
				(voice.preset.pcm.sampleRate / this.rate) *
				2 ** ((voice.midi - voice.preset.pcm.rootNote + this.pitch) / 12);
		else this.synth.setFrequency(voice.channel, this._frequency(voice.midi));
	}
	_held(voice) {
		const e = voice.preset.envelope;
		if (!e.enabled) return 1;
		const time = (this.frame - voice.start) / this.rate;
		if (e.attack && time < e.attack) return time / e.attack;
		if (e.decay && time < e.attack + e.decay)
			return 1 - ((1 - e.sustain) * (time - e.attack)) / e.decay;
		return e.sustain;
	}
	_level(voice) {
		if (voice.release === null) return this._held(voice);
		const e = voice.preset.envelope;
		return !e.enabled || e.release === 0
			? 0
			: voice.releaseLevel *
					Math.max(0, 1 - (this.frame - voice.release) / this.rate / e.release);
	}
	_volume(voice) {
		const p = voice.preset,
			level = this._level(voice);
		if (p.source !== 'pcm')
			this.synth.setVolume(
				voice.channel,
				Math.round(p.left * level),
				Math.round(p.right * level),
			);
	}
	_forget(voice, gate = true) {
		if (this.owners[voice.channel] !== voice) return;
		if (gate) this.synth.keyOff(voice.channel);
		this.owners[voice.channel] = null;
		if (this.voices.get(voice.id) === voice) this.voices.delete(voice.id);
	}
	_start(id, value, channel, kind = 'keyboard') {
		const p = copy(this.channelPresets[channel]),
			previous = this.owners[channel];
		if (previous) this._forget(previous, false);
		const voice = {
			id,
			midi: value,
			channel,
			kind,
			session: this.codeSession,
			preset: p,
			samples: this._pcm(p),
			position: 0,
			step: 0,
			start: this.frame,
			release: null,
			releaseLevel: 0,
			order: ++this.sequence,
		};
		this.owners[channel] = voice;
		this.voices.set(id, voice);
		this._tune(voice);
		this._volume(voice);
		if (p.source === 'pcm') this.synth.writeVoice(128);
		this.synth.keyOn(channel);
		return voice;
	}
	noteOn(id, note, channel = null) {
		this._open();
		if (typeof id !== 'string' || !id.length)
			throw new TypeError('Note identity must be a nonempty string');
		const value = midi(note),
			choices = channel === null ? pool(this.preset) : [slot(channel)];
		if (channel === null) {
			channel = choices.find((ch) => !this.owners[ch]);
			if (channel === undefined) channel = choices[this.cursor++ % choices.length];
			this.channelPresets[channel] = copy(this.preset);
			this._apply(channel, this.preset);
		}
		const previous = this.voices.get(id);
		if (previous) this._forget(previous);
		const stolen = this.owners[channel]?.id ?? null;
		const voice = this._start(id, value, channel);
		return {
			channel,
			stolenId: stolen,
			...(voice.preset.source === 'pcm' ? { softwarePcm: true } : {}),
		};
	}
	noteOff(id) {
		this._open();
		const voice = this.voices.get(id);
		if (!voice || this.owners[voice.channel] !== voice || voice.release !== null) return false;
		voice.releaseLevel = this._level(voice);
		voice.release = this.frame;
		if (voice.raw || !voice.preset.envelope.enabled || voice.preset.envelope.release === 0)
			this._forget(voice);
		return true;
	}
	setPitch(value) {
		this._open();
		if (!Number.isFinite(value) || value < -48 || value > 48)
			throw new RangeError('Pitch must be -48..48 semitones');
		this.pitch = value;
		for (const voice of this.owners) if (voice) this._tune(voice);
		return value;
	}
	stop() {
		this._open();
		this.codeActive = false;
		this.codeSession++;
		this.voices.clear();
		this.owners.fill(null);
		this.synth.allNotesOff();
		return true;
	}
	setChannelEnabled(channel, enabled) {
		this._open();
		slot(channel);
		if (typeof enabled !== 'boolean') throw new TypeError('Channel enabled must be boolean');
		this.core.setChannelMuted(channel, !enabled);
		return enabled;
	}
	beginCode() {
		this._open();
		if (this.codeActive) this.endCode(this.codeSession);
		this.codeActive = true;
		return { session: ++this.codeSession, clock: WONDERSWAN_CLOCK, channels: 4 };
	}
	_rawOwner(channel) {
		const previous = this.owners[channel];
		if (previous) this._forget(previous, false);
		const state = this.read().channels[channel];
		if (!state.active) return;
		const voice = {
			id: `code:${this.codeSession}:${channel}:raw`,
			midi: 69,
			channel,
			kind: 'code',
			session: this.codeSession,
			preset: state.preset,
			samples: this._pcm(state.preset),
			position: 0,
			step: 0,
			start: this.frame,
			release: null,
			releaseLevel: 0,
			order: ++this.sequence,
			raw: true,
		};
		this.owners[channel] = voice;
		this.voices.set(voice.id, voice);
	}
	endCode(session) {
		this._open();
		if (!this.codeActive || session !== this.codeSession) throw aswanCodeCancelled();
		for (const voice of this.owners)
			if (voice?.kind === 'code' && voice.session === session) this.noteOff(voice.id);
		this.codeActive = false;
		return true;
	}
	code(session, method, args = []) {
		this._open();
		if (!this.codeActive || session !== this.codeSession) throw aswanCodeCancelled();
		validateAswanCodeCall(method, args);
		if (method === 'getState') return this.read();
		if (method === 'initialize') {
			for (const voice of [...this.voices.values()])
				if (voice.kind === 'code') this._forget(voice);
			return true;
		}
		if (method === 'allNotesOff') {
			for (const voice of this.owners)
				if (voice?.kind === 'code' && voice.session === session) this.noteOff(voice.id);
			return true;
		}
		if (method === 'noteOff' || method === 'keyOff') {
			const voice = this.owners[args[0]];
			if (voice?.kind !== 'code' || voice.session !== session) return false;
			if (method === 'keyOff') {
				this._forget(voice);
				return true;
			}
			return this.noteOff(voice.id);
		}
		if (method === 'noteOn' || method === 'keyOn') {
			const channel = args[0], state = this.read().channels[channel];
			const softwarePcm = state.preset.source === 'pcm' && this.channelPresets[channel].source === 'pcm';
			if (method === 'keyOn' && !softwarePcm) {
				this.synth.keyOn(channel);
				this._rawOwner(channel);
				return channel;
			}
			const value =
					method === 'noteOn'
						? midi(args[1])
						: 69 + 12 * Math.log2(state.frequency / 440) - this.pitch;
			if (state.preset.source === 'pcm' && this.channelPresets[channel].source !== 'pcm') {
				if (method === 'noteOn') this.synth.setNote(channel, args[1]);
				this.synth.keyOn(channel);
				this._rawOwner(channel);
				return channel;
			}
			// Code sees the current raw authoring registers, while software
			// release follows this channel's explicit Synth envelope settings.
			this.channelPresets[channel] = {
				...state.preset,
				left: this.channelPresets[channel].left,
				right: this.channelPresets[channel].right,
			};
			return this._start(`code:${session}:${channel}`, value, channel, 'code').channel;
		}
		const result = this.synth[method](...args);
		if (
			(method === 'setVolume' || method === 'setPan') &&
			!(args[0] === 1 && this.synth._getState().registers[16] & 32)
		) {
			const p = this.channelPresets[args[0]];
			p.left = args[1];
			p.right = args[2] ?? args[1];
			const voice = this.owners[args[0]];
			if (voice) {
				voice.preset.left = args[1];
				voice.preset.right = args[2] ?? args[1];
			}
		}
		if (method === 'setFrequency' || method === 'setNote') {
			const voice = this.owners[args[0]];
			if (voice)
				voice.midi =
					method === 'setNote'
						? midi(args[1]) - this.pitch
						: 69 + 12 * Math.log2(args[1] / 440) - this.pitch;
		}
		if (method === 'writeRegister' && args[0] === 0x90)
			for (let ch = 0; ch < 4; ch++) this._rawOwner(ch);
		if (method === 'setVoiceMode') this._rawOwner(1);
		if (method === 'writeRegister' && args[0] === 0x94) {
			this.channelPresets[1].left = args[1] & 8 ? 15 : args[1] & 4 ? 7 : 0;
			this.channelPresets[1].right = args[1] & 2 ? 15 : args[1] & 1 ? 7 : 0;
		}
		if (method === 'writeRegister' && args[0] >= 0x88 && args[0] <= 0x8b) {
			const ch = args[0] - 0x88;
			if (!(ch === 1 && this.synth._getState().registers[16] & 32)) {
				this.channelPresets[ch].left = args[1] >> 4;
				this.channelPresets[ch].right = args[1] & 15;
			}
			this._rawOwner(ch);
		}
		return result ?? true;
	}
	// Timed Gate ownership belongs to the actual voice, so a later keyboard or
	// immediate Code note replaces the token along with the old physical owner.
	timedCode(session, operation, metadata) {
		const {method, args} = operation;
		if (!this.codeActive || session !== this.codeSession) throw aswanCodeCancelled();
		if (!['noteOn','noteOff','keyOn','keyOff'].includes(method))
			return this.code(session, method, args);
		const channel = slot(args[0]);
		if (method === 'noteOff' || method === 'keyOff') {
			const voice = this.owners[channel], token = voice?.timedOwner;
			if (voice?.session !== session || token?.owner !== metadata.owner ||
				token?.reservation !== metadata.reservation) return false;
			if (method === 'keyOff') { this._forget(voice); return true; }
			return this.noteOff(voice.id);
		}
		if (method === 'keyOn') {
			this.synth.keyOn(channel);
			this._rawOwner(channel);
		} else this.code(session, method, args);
		this.owners[channel].timedOwner = {
			owner: metadata.owner, reservation: metadata.reservation, pattern: metadata.pattern,
		};
		return true;
	}
	releaseTimed({owner, reservation, pattern} = {}) {
		let released = false;
		for (const voice of this.owners) {
			const token = voice?.timedOwner;
			if (!token || (owner !== undefined && token.owner !== owner) ||
				(reservation !== undefined && token.reservation !== reservation) ||
				(pattern !== undefined && token.pattern !== pattern)) continue;
			released = this.noteOff(voice.id) || released;
		}
		return released;
	}
	read() {
		this._open();
		const state = this.synth._getState(),
			r = state.registers;
		const channels = this.channelPresets.map((stored, ch) => {
			const p = copy(stored);
			p.source = ch === 1 && r[16] & 32 ? 'pcm' : ch === 3 && r[16] & 128 ? 'noise' : 'wave';
			p.wave = Array.from({ length: 32 }, (_, i) => {
				const byte = state.memory[((r[15] << 6) + ch * 16 + (i >> 1)) & 0x3fff];
				return (byte >> ((i % 2) * 4)) & 15;
			});
			if (p.source !== 'pcm') {
				p.left = r[8 + ch] >> 4;
				p.right = r[8 + ch] & 15;
			} else {
				p.left = r[20] & 8 ? 15 : r[20] & 4 ? 7 : 0;
				p.right = r[20] & 2 ? 15 : r[20] & 1 ? 7 : 0;
			}
			p.sweep = {
				enabled: ch === 2 && Boolean(r[16] & 64),
				step: r[12] >= 128 ? r[12] - 256 : r[12],
				time: r[13] & 31,
			};
			p.noise.type = r[14] & 7;
			const period = 2048 - (r[ch * 2] | ((r[ch * 2 + 1] & 7) << 8)),
				frequency = WONDERSWAN_CLOCK / (32 * period);
			return {
				channel: ch,
				index: ch,
				preset: p,
				authoredPreset: { ...copy(p), left: stored.left, right: stored.right },
				baseLeft: stored.left,
				baseRight: stored.right,
				left: p.left,
				right: p.right,
				frequency,
				frequencyHz: frequency,
				active: Boolean(r[16] & (1 << ch)),
				enabled: !this.core.mutedChannels[ch],
				gate: Boolean(r[16] & (1 << ch)),
				owner: this.owners[ch]?.kind ?? null,
			};
		});
		return {
			preset: copy(this.preset),
			editorSource: this.preset.source,
			pitch: this.pitch,
			clock: WONDERSWAN_CLOCK,
			initialized: true,
			capacity: pool(this.preset).length,
			registers: r,
			memory: state.memory,
			channels,
			voices: [...this.voices.values()].map((v) => ({
				id: v.id,
				midi: v.midi,
				channel: v.channel,
				released: v.release !== null,
				kind: v.kind,
			})),
			frame: this.frame,
			codeActive: this.codeActive,
		};
	}
	generateStereo(frames) {
		const left = new Float32Array(frames),
			right = new Float32Array(frames);
		this.process(left, right, frames);
		return { left, right };
	}
	process(left, right, frames) {
		this._open();
		if (
			!(left instanceof Float32Array) ||
			!(right instanceof Float32Array) ||
			!Number.isInteger(frames) ||
			frames < 0 ||
			frames > 1048576 ||
			Math.min(left.length, right.length) < frames
		)
			throw new RangeError('Invalid ASWAN audio buffers');
		let at = 0;
		while (at < frames) {
			if (this.frame % 16 === 0)
				for (const voice of this.owners)
					if (voice && !voice.raw) {
						if (voice.release !== null && this._level(voice) <= 0) this._forget(voice);
						else this._volume(voice);
					}
			const pcm =
				!this.owners[1]?.raw && this.owners[1]?.preset.source === 'pcm'
					? this.owners[1]
					: null;
			if (pcm) {
				const index = Math.floor(pcm.position),
					p = pcm.preset;
				if (index >= pcm.samples.length && !p.pcm.loop) this._forget(pcm);
				else {
					const sample = pcm.samples[index % pcm.samples.length];
					let level = this._level(pcm);
					if (!p.pcm.loop && p.envelope.enabled && p.envelope.release > 0)
						level *= Math.min(
							1,
							(pcm.samples.length - pcm.position) /
								pcm.step /
								this.rate /
								p.envelope.release,
						);
					this.synth.writeVoice(Math.round(128 + (sample - 128) * level));
					pcm.position += pcm.step;
				}
			}
			const count = Math.min(frames - at, pcm ? 1 : 16 - (this.frame % 16)),
				output = this.core.generateStereoView(count);
			left.set(output.left, at);
			right.set(output.right, at);
			this.frame += count;
			at += count;
		}
	}
	dispose() {
		if (this.disposed) return;
		this.stop();
		this.synth.dispose();
		this.core.dispose();
		this.disposed = true;
	}
}
