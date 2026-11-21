// SPDX-License-Identifier: BSD-3-Clause
import { chipMixGains, soundChipMixDefaults } from '../js/soundchip_mixer.js';
import {
	NDS_CHANNEL_COUNT, NDS_CHANNEL_DEFAULTS, NDS_MAX_SAMPLE_BYTES, NdsMixerCapture,
	ndsInteger, ndsSampleRange, normalizeNdsChannel, normalizeNdsChannelMix, readNdsAdpcmHeader,
} from './nds-core.js?v=nds-shared-renderer-1';
import { openSkyEmuSound, SKYEMU_SAMPLE_RATE } from './nds-skyemu-wasm.js?v=nds-shared-renderer-1';

const SAMPLE_ADDRESS = 0x08000000;
const UPLOAD_BYTES_PER_STEP = 16 * 1024;
const REGISTER_BYTES_PER_CHANNEL = 16;
const CNT = 0, SAD = 4, TMR_PNT = 8, LEN = 12;
const KEY_ON = 0x80000000;
const ADPCM_HEADER_FRAMES = 8;
const MAX_RENDER_FRAMES = 2048;
const FORMATS = { pcm8: 0, pcm16: 1, adpcm: 2, pulse: 3, noise: 3 };
const LIVE_FIELDS = [
	['volume', 0x7f, 0], ['divider', 3, 8], ['pan', 0x7f, 16], ['duty', 7, 24],
];
const DEFAULT_MIX = Object.freeze(soundChipMixDefaults());

function registerBase(channel) {
	return channel * REGISTER_BYTES_PER_CHANNEL;
}

/** DS Synth controls backed by the same SkyEmu audio unit as 2SF playback. */
export class NdsSkyEmuCore {
	#renderer;
	#capture;
	#channels = Array.from({ length: NDS_CHANNEL_COUNT }, (_, channel) => ({
		config: NDS_CHANNEL_DEFAULTS, range: null, timer: NDS_CHANNEL_DEFAULTS.timer,
		playing: null, prepared: null, preparingSlot: null, mix: DEFAULT_MIX,
		slots: [0, 1].map(index => ({ index: channel * 2 + index, bytes: null, uploaded: 0 })),
	}));
	constructor(module, sampleRate) {
		if (sampleRate !== SKYEMU_SAMPLE_RATE) throw new RangeError(`DS audio requires a ${SKYEMU_SAMPLE_RATE} Hz rendering context.`);
		this.#renderer = openSkyEmuSound(module);
		this.#capture = new NdsMixerCapture(sampleRate, channel => this.#channels[channel].timer,
			(channel, timer) => this.configure(channel, { timer }));
		for (let channel = 0; channel < NDS_CHANNEL_COUNT; channel++) {
			this.#renderer.write(registerBase(channel) + TMR_PNT, this.#channels[channel].timer);
		}
	}

	#channel(index) {
		ndsInteger(index, 0, NDS_CHANNEL_COUNT - 1, 'DS channel');
		return this.#channels[index];
	}

	#playing(index, channel) {
		if (channel.playing && !(this.#renderer.read(registerBase(index) + CNT) & KEY_ON)) channel.playing = null;
		return channel.playing;
	}

	#writeTimer(index, channel, timer, loopStartWords) {
		const register = registerBase(index) + TMR_PNT;
		const start = loopStartWords ?? (this.#renderer.read(register) >>> 16);
		this.#renderer.write(register, ((start << 16) | timer) >>> 0);
		this.#capture.retune(index, channel.timer, timer);
		channel.timer = timer;
	}

	configure(index, patch, { deferLive = false } = {}) {
		const channel = this.#channel(index);
		const next = normalizeNdsChannel(index, channel.config, patch);
		const range = ndsSampleRange(next);
		if (next.mode === 'adpcm' && next.bytes) readNdsAdpcmHeader(next.bytes);
		if (!deferLive) {
			if (Object.hasOwn(patch, 'timer') && channel.timer !== next.timer) this.#writeTimer(index, channel, next.timer);
			const register = registerBase(index) + CNT;
			const current = this.#renderer.read(register);
			let control = current;
			for (const [field, mask, shift] of LIVE_FIELDS) {
				if (Object.hasOwn(patch, field)) control = (control & ~(mask << shift)) | (next[field] << shift);
			}
			if ((control >>> 0) !== current) this.#renderer.write(register, control >>> 0);
		}
		if (channel.config.mode !== next.mode || channel.config.bytes !== next.bytes) this.cancelPreparation(index);
		channel.config = next;
		channel.range = range;
	}

	/** Run one bounded upload block or ADPCM preparation block for this attack. */
	prepareKeyOn(index) {
		const channel = this.#channel(index);
		const { mode, bytes } = channel.config;
		if (FORMATS[mode] === 3) return true;
		if (!channel.range) throw new Error('Load a DS sample before Key On');

		const soundingSlot = this.#playing(index, channel)?.slot;
		// Keep the sounding sample intact while loading a replacement.
		const slot = channel.slots.find(slot => slot.bytes === bytes)
			?? channel.slots.find(slot => slot !== soundingSlot);
		channel.prepared = null;
		if (slot.bytes !== bytes) {
			slot.bytes = bytes;
			slot.uploaded = 0;
		}
		if (slot.uploaded < bytes.length) {
			const end = Math.min(bytes.length, slot.uploaded + UPLOAD_BYTES_PER_STEP);
			this.#renderer.uploadVoice(slot.index, slot.uploaded, bytes.subarray(slot.uploaded, end));
			slot.uploaded = end;
			if (end < bytes.length) return false;
		}
		// An inactive cache entry can be evicted, so check it on each new attack.
		// A valid sample that cannot be cached uses the incremental hardware decoder.
		if (mode === 'adpcm') {
			channel.preparingSlot = slot;
			if (this.#renderer.prepareVoiceAdpcm(slot.index, bytes.length) === false) return false;
			channel.preparingSlot = null;
		}
		channel.prepared = { mode, bytes, slot };
		return true;
	}

	cancelPreparation(index) {
		const channel = this.#channel(index);
		if (channel.preparingSlot) this.#renderer.cancelVoiceAdpcm(channel.preparingSlot.index);
		channel.preparingSlot = null;
		channel.prepared = null;
	}

	keyOn(index) {
		const channel = this.#channel(index);
		const { mode, bytes, loop, loopStartWords, timer, volume, pan, divider, duty } = channel.config;
		const format = FORMATS[mode];
		const usesSample = format !== 3;
		const prepared = channel.prepared;
		if (usesSample && (!prepared || prepared.mode !== mode || prepared.bytes !== bytes))
			throw new Error('Prepare the DS sample before Key On');
		const base = registerBase(index);
		this.#renderer.write(base + CNT, 0);
		const slot = usesSample ? prepared.slot : null;
		if (usesSample) {
			this.#renderer.write(base + SAD, SAMPLE_ADDRESS + slot.index * NDS_MAX_SAMPLE_BYTES);
			this.#renderer.write(base + LEN, channel.range.lengthWords);
		}
		this.#writeTimer(index, channel, timer, usesSample ? loopStartWords : 0);
		const repeat = loop || !usesSample ? 1 : 2;
		const control = volume | (divider << 8) | (pan << 16) | (duty << 24) | (repeat << 27) | (format << 29);
		this.#renderer.write(base + CNT, (KEY_ON | control) >>> 0);
		channel.playing = { mode, loop, bytes, slot };
		channel.prepared = null;
	}

	setPlayingSampleRange(index, { loopStartWords, lengthWords }) {
		const voice = this.#playing(index, this.#channel(index));
		if (!voice?.slot || this.#renderer.releasing(index)) return false;
		ndsInteger(loopStartWords, 0, 65535, 'DS loop start in words');
		ndsInteger(lengthWords, 1, 0x3fffff, 'DS sample length in words');
		const range = ndsSampleRange({ ...voice, loopStartWords, lengthWords });
		const headerFrames = voice.mode === 'adpcm' ? ADPCM_HEADER_FRAMES : 0;
		if (!voice.loop && this.#renderer.position(index) >= range.end + headerFrames) {
			this.release(index);
			return true;
		}
		return this.#renderer.setRange(index, loopStartWords, lengthWords);
	}

	keyOff(index) {
		const channel = this.#channel(index);
		const register = registerBase(index) + CNT;
		const current = this.#renderer.read(register);
		if (current & KEY_ON) this.#renderer.write(register, current & ~KEY_ON);
		channel.playing = null;
	}

	release(index, milliseconds = 8) {
		const channel = this.#channel(index);
		if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 1000)
			throw new RangeError('Software release must be from 0 through 1000 ms');
		if (this.#playing(index, channel)) this.#renderer.release(index, Math.round(milliseconds * SKYEMU_SAMPLE_RATE / 1000));
	}

	allSoundOff() {
		for (let index = 0; index < NDS_CHANNEL_COUNT; index++) {
			this.cancelPreparation(index);
			this.keyOff(index);
		}
	}

	getState(index) {
		const channel = this.#channel(index);
		const voice = this.#playing(index, channel);
		const { bytes, ...fields } = channel.config;
		const headerFrames = voice?.mode === 'adpcm' ? ADPCM_HEADER_FRAMES : 0;
		return {
			...fields, channel: index, active: voice !== null, playingMode: voice?.mode ?? null,
			position: voice ? Math.max(0, this.#renderer.position(index) - headerFrames) : 0,
			releasing: Boolean(voice && this.#renderer.releasing(index)),
			lengthWords: channel.range?.lengthWords ?? fields.lengthWords, byteLength: bytes?.byteLength ?? 0,
		};
	}

	setChannelMix(index, patch) {
		const channel = this.#channel(index);
		const mix = normalizeNdsChannelMix(channel.mix, patch);
		const [left, right] = chipMixGains(mix);
		this.#renderer.setMix(index, left, right);
		channel.mix = mix;
		return { ...mix };
	}

	getChannelMix(index) {
		if (index === undefined) return this.#channels.map(channel => ({ ...channel.mix }));
		return { ...this.#channel(index).mix };
	}

	startCapture(unit, settings) { return this.#capture.startCapture(unit, settings); }
	getCaptureState(unit) { return this.#capture.getCaptureState(unit); }
	stopCapture(unit) { return this.#capture.stopCapture(unit); }
	readCapture(unit) { return this.#capture.readCapture(unit); }

	render(left, right) {
		if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length)
			throw new TypeError('DS rendering requires equal-length Float32Array output channels');
		if (left.length > 0 && left.length <= MAX_RENDER_FRAMES) this.#renderer.renderFloat(left, right);
		else {
			for (let start = 0; start < left.length; start += MAX_RENDER_FRAMES) {
				const end = start + MAX_RENDER_FRAMES;
				this.#renderer.renderFloat(left.subarray(start, end), right.subarray(start, end));
			}
		}
		this.#capture.render(left, right);
	}

	close() { this.#renderer.close(); }
}
