// SPDX-License-Identifier: BSD-3-Clause
import { isVsuEnvelopeEdit } from './envelope.js?v=vsu-code-envelope';
import { createVgmTransport } from './vgm-transport.js?v=vsu-live-keyboard';
import { createVsuTimedProcessor } from './timed-processor.js?v=vsu-note-gate';
import { VSU_CHANNEL_COUNT, VSU_PCM_RELEASE_MS, VSU_REGISTERS, VSU_SOUND_STOP, VSU_WAVE_BANK_COUNT, VSU_WAVE_LENGTH, vsuChannelRegister, vsuMaskedEnvelopeTarget, vsuPcmReleaseTarget } from './vsu.js?v=vsu-note-gate';

const LIVE_REPORT_FRAMES = Math.ceil(sampleRate / 30);
const ENVELOPE_REPORT_FRAMES = Math.ceil(sampleRate / 60);
const WAVE_SAMPLE_COUNT = VSU_WAVE_BANK_COUNT * VSU_WAVE_LENGTH;
const MODULATION_CHANNEL = 4;
const NOISE_CHANNEL = 5;
const RELEASE_FRAMES = Math.max(1, Math.round(sampleRate * VSU_PCM_RELEASE_MS / 1000));
const RELEASE_GAIN_STEP = 1 / Math.max(1, RELEASE_FRAMES - 1);
const FIRST_CHANNEL_INT = vsuChannelRegister(0, VSU_REGISTERS.INT);
const CHANNEL_STRIDE = vsuChannelRegister(1, VSU_REGISTERS.INT) - FIRST_CHANNEL_INT;

function createReleaseBank() {
	return { remaining: new Int32Array(NOISE_CHANNEL), restore: Array(NOISE_CHANNEL).fill(null), active: 0 };
}

class VsuProcessor extends AudioWorkletProcessor {
	constructor({ processorOptions: { wasmBinary } }) {
		super();
		this.failed = false;
		try {
			const module = new WebAssembly.Module(wasmBinary);
			const { exports } = new WebAssembly.Instance(module);
			this.core = exports;
			this.state = exports.__heap_base.value;
			this.stateBytes = exports.vsu_size();
			const stateSize = Math.ceil(this.stateBytes / 4) * 4;
			this.vgmState = this.state + stateSize;
			this.channelGains = Array(VSU_CHANNEL_COUNT).fill(1);
			this.synthKeyOwners = new Map();
			this.vgmKeyOwners = new Map();
			this.synthReleases = createReleaseBank();
			this.vgmReleases = createReleaseBank();
			this.pendingCodeWaveWrites = new Map();
			this.appliedCodeWaveWrites = [];
			this.codeWaveEditId = 0;
			this.codeWaveStateDirty = false;
			this.captureAddress = this.vgmState + stateSize;
			this.liveValuesAddress = this.captureAddress + exports.vsu_snapshot_size();
			this.liveEnvelopeWord = (this.liveValuesAddress - this.captureAddress) / Uint32Array.BYTES_PER_ELEMENT + 1;
			this.pcm = this.captureAddress + Math.ceil(exports.vsu_live_snapshot_size() / 4) * 4;
			this.liveChannel = null;
			this.liveWriteSequence = 0;
			this.nextLiveReport = 0;
			this.lastLiveId = null;
			this.liveDirty = false;
			this.envelopeStates = Array(VSU_CHANNEL_COUNT).fill(null);
			this.envelopeWatch = false;
			this.envelopePlaybackId = undefined;
			this.nextEnvelopeReport = 0;
			this.prepareBuffers(128);
			exports.vsu_reset(this.state);
			this.vgm = createVgmTransport({
				sampleRate,
				reset: () => {
					this.vgmKeyOwners.clear();
					this.clearReleases(this.vgmReleases);
					exports.vsu_reset(this.vgmState);
					this.applyChannelGains(this.vgmState);
				},
				restore: bytes => {
					if (!(bytes instanceof Uint8Array) || bytes.byteLength !== this.stateBytes)
						throw new Error('Invalid VSU seek checkpoint.');
					// Both wasm instances use the same binary and the state has no pointers.
					new Uint8Array(exports.memory.buffer, this.vgmState, this.stateBytes).set(bytes);
					this.vgmKeyOwners.clear();
					this.clearReleases(this.vgmReleases);
					this.applyChannelGains(this.vgmState);
				},
				write: (offset, value) => this.writeSource(this.vgmState, this.vgmKeyOwners, offset, value),
				setMask: mask => exports.vsu_set_mix_mask(this.vgmState, mask),
				readChannel: channel => exports.vsu_get_channel(this.vgmState, channel),
				renderFrames: (offset, frames) => this.renderFrames(this.vgmState, offset, frames),
				onState: state => this.port.postMessage({ type: 'vgm-state', ...state }),
			});
			this.renderSynthFrames = (offset, frames) => {
				// Each timed frame applies its entire set of commands before rendering.
				this.flushCodeWave();
				this.renderFrames(this.state, offset, frames);
				this.flushCodeWave();
			};
			this.timed = createVsuTimedProcessor({
				nowFrame: () => currentFrame,
				sampleRate,
				write: (offset, value, owner, mask, fadeMs) => this.writeSource(this.state, this.synthKeyOwners, offset, value, owner, mask, fadeMs),
				release: (name, owner) => this.releaseTimedNotes(name, owner),
				vgmOwnsOutput: () => this.vgm.ownsOutput,
				reportError: detail => this.port.postMessage({ type: 'timed-error', ...detail }),
			});
			this.port.onmessage = ({ data }) => this.handle(data);
			this.port.postMessage({ type: 'ready' });
		} catch (error) { this.fail(error); }
	}

	applyChannelGains(state) {
		for (const [channel, gain] of this.channelGains.entries()) this.core.vsu_set_channel_gain(state, channel, gain);
	}

	releaseBank(state) {
		return state === this.state ? this.synthReleases : this.vgmReleases;
	}

	clearReleases(bank) {
		bank.remaining.fill(0);
		bank.restore.fill(null);
		bank.active = 0;
	}

	applyReleaseGain(state, channel, remaining) {
		const scale = remaining === 0 ? 1 : Math.max(0, remaining - 1) * RELEASE_GAIN_STEP;
		this.core.vsu_set_channel_gain(state, channel, this.channelGains[channel] * scale);
	}

	cancelRelease(state, channel, closingGate = false) {
		const bank = this.releaseBank(state);
		const remaining = bank.remaining[channel];
		if (!remaining || (remaining < 0 && closingGate)) return;
		if (remaining > 0) bank.active--;
		// Keep the gain down after closing the gate. The native DAC can still hold
		// its old sample until the next clock. A new attack restores mixer gain.
		bank.remaining[channel] = closingGate ? -1 : 0;
		bank.restore[channel] = null;
		this.applyReleaseGain(state, channel, bank.remaining[channel]);
		this.liveDirty = true;
	}

	restoreKeyboardRegisters(state, writes) {
		if (!writes) return;
		for (let index = 0; index < writes.length; index += 2)
			this.core.vsu_write(state, writes[index], writes[index + 1]);
	}

	finishRelease(state, bank, channel) {
		const writes = bank.restore[channel];
		this.cancelRelease(state, channel, true);
		this.writeLiveGate(state, channel, false);
		this.restoreKeyboardRegisters(state, writes);
		(state === this.state ? this.synthKeyOwners : this.vgmKeyOwners).delete(channel);
		this.liveDirty = true;
	}

	releaseNote(state, owners, channel, timed, writes) {
		const active = Boolean(this.core.vsu_get_channel(state, channel) & 0x100);
		const previous = owners.get(channel);
		if (timed && active && (previous?.owner !== timed.owner || previous.patternName !== timed.patternName)) return;
		const bank = this.releaseBank(state);
		if (bank.remaining[channel] > 0) return;
		if (channel === NOISE_CHANNEL || !active) {
			owners.delete(channel);
			this.writeLiveGate(state, channel, false);
			this.restoreKeyboardRegisters(state, writes);
			this.liveDirty = true;
			return;
		}
		bank.remaining[channel] = RELEASE_FRAMES;
		bank.restore[channel] = writes ?? null;
		bank.active++;
	}

	synthWaveCanWrite() {
		// Wave RAM is locked while any hardware gate is open, even on a muted channel.
		for (let channel = 0; channel < VSU_CHANNEL_COUNT; channel++) {
			if (this.core.vsu_get_channel(this.state, channel) & 0x100) return false;
		}
		return true;
	}

	queueCodeWave({ editId, writes }) {
		if (!Number.isSafeInteger(editId) || editId <= this.codeWaveEditId) return;
		this.codeWaveEditId = editId;
		this.codeWaveStateDirty = true;
		if (this.vgm.ownsOutput || !(writes instanceof Uint16Array) || !writes.length ||
			writes.length % 2 !== 0 || writes.length > WAVE_SAMPLE_COUNT * 2) return;
		for (let index = 0; index < writes.length; index += 2) {
			const offset = writes[index];
			if (offset % 4 !== 0 || offset >= WAVE_SAMPLE_COUNT * 4 || writes[index + 1] > 63) return;
		}
		for (let index = 0; index < writes.length; index += 2)
			this.pendingCodeWaveWrites.set(writes[index], writes[index + 1]);
	}

	clearCodeWave() {
		if (!this.pendingCodeWaveWrites.size) return;
		this.pendingCodeWaveWrites.clear();
		this.codeWaveStateDirty = true;
	}

	flushCodeWave() {
		if (!this.pendingCodeWaveWrites.size || this.vgm.ownsOutput || !this.synthWaveCanWrite()) return;
		for (const [offset, value] of this.pendingCodeWaveWrites) {
			this.core.vsu_write(this.state, offset, value);
			this.appliedCodeWaveWrites.push([offset, value]);
		}
		this.clearCodeWave();
		this.liveDirty = true;
	}

	reportCodeWave() {
		if (!this.codeWaveStateDirty) return;
		this.codeWaveStateDirty = false;
		const appliedWrites = this.appliedCodeWaveWrites;
		this.appliedCodeWaveWrites = [];
		this.port.postMessage({ type: 'code-wave-state', editId: this.codeWaveEditId,
			pendingWrites: [...this.pendingCodeWaveWrites], appliedWrites });
	}

	writeSource(state, owners, offset, value, timed, mask, fadeMs) {
		if (fadeMs !== undefined) {
			const channel = vsuPcmReleaseTarget(offset, value, fadeMs);
			if (mask === undefined && channel !== null) this.releaseNote(state, owners, channel, timed);
			return;
		}
		if (mask !== undefined) {
			const target = vsuMaskedEnvelopeTarget(offset, mask, value);
			if (!target) return;
			const { channel, register } = target;
			const previous = this.envelopeByte(state, channel, register);
			if (previous !== undefined) this.writeMaskedRegister(state, channel, register, mask, value, previous);
			return;
		}
		// Only a source write to the gate takes ownership from a held key.
		if (offset === VSU_SOUND_STOP && (value & 1)) {
			owners.clear();
			for (let channel = 0; channel < NOISE_CHANNEL; channel++) this.cancelRelease(state, channel, true);
		}
		else if (offset >= FIRST_CHANNEL_INT && offset < VSU_SOUND_STOP && (offset - FIRST_CHANNEL_INT) % CHANNEL_STRIDE === 0) {
			const channel = (offset - FIRST_CHANNEL_INT) / CHANNEL_STRIDE;
			if (timed && (value & 0x80)) owners.set(channel, timed);
			else {
				const previous = owners.get(channel);
				if (timed && (this.core.vsu_get_channel(state, channel) & 0x100) &&
					(previous?.owner !== timed.owner || previous.patternName !== timed.patternName)) return;
				owners.delete(channel);
			}
			this.cancelRelease(state, channel, !(value & 0x80));
		}
		this.core.vsu_write(state, offset, value);
		if (state === this.state && this.pendingCodeWaveWrites.has(offset) && this.synthWaveCanWrite()) {
			// A successful source write supersedes the waiting edit at that address.
			this.pendingCodeWaveWrites.delete(offset);
			this.codeWaveStateDirty = true;
			this.liveDirty = true;
		}
	}

	envelopeByte(state, channel, register) {
		// The live ABI retains envelope bytes for voices with unavailable waveform banks.
		if (!this.core.vsu_snapshot_live_voice(state, channel, this.captureAddress)) return undefined;
		const word = register === 'EV0' ? 5 : 6;
		return new Uint32Array(this.core.memory.buffer, this.captureAddress + 4 * word, 1)[0];
	}

	writeMaskedRegister(state, channel, register, mask, value, previous) {
		const next = (previous & ~mask) | (value & mask);
		// An EV0 write reloads the running envelope even when its programmed byte is the same.
		if (next !== previous || register === 'EV0')
			this.core.vsu_write(state, vsuChannelRegister(channel, VSU_REGISTERS[register]), next);
		return next;
	}

	editCodeEnvelope({ channels, register, mask, value }) {
		if (this.vgm.ownsOutput || !isVsuEnvelopeEdit(register, mask, value) ||
			!Array.isArray(channels) || channels.length > VSU_CHANNEL_COUNT) return;
		for (const channel of channels) {
			if (!Number.isInteger(channel) || channel < 0 || channel >= VSU_CHANNEL_COUNT) continue;
			const previous = this.envelopeByte(this.state, channel, register);
			if (previous !== undefined) this.writeMaskedRegister(this.state, channel, register, mask, value, previous);
		}
		this.liveDirty = true;
	}

	readInterval(state, channel) {
		const interval = this.core.vsu_get_interval(state, channel) >>> 0;
		return interval === 0xffffffff ? null : interval;
	}

	writeLiveGate(state, channel, enabled) {
		const interval = channel === NOISE_CHANNEL ? this.readInterval(state, channel) : null;
		const duration = interval === null ? 0 : 0x20 | interval;
		this.core.vsu_write(state, vsuChannelRegister(channel, VSU_REGISTERS.INT), (enabled ? 0x80 : 0) | duration);
	}

	liveNoteOn({ source, channel, playbackId, revision, owner, writes }) {
		const id = this.vgm.outputId;
		if (this.liveChannel === null || channel !== this.liveChannel || revision !== this.liveRevision || playbackId !== id ||
			source !== (id === null ? 'synth' : 'vgm') || (id !== null && !this.vgm.isPlaying(id))) return;
		const state = id === null ? this.state : this.vgmState;
		const owners = id === null ? this.synthKeyOwners : this.vgmKeyOwners;
		const ev0 = this.envelopeByte(state, channel, 'EV0');
		if (ev0 === undefined) return;
		this.cancelRelease(state, channel);
		// Reload the programmed initial envelope level so every press can retrigger it.
		this.core.vsu_write(state, vsuChannelRegister(channel, VSU_REGISTERS.EV0), ev0);
		if (channel === NOISE_CHANNEL) {
			// A live Noise key auditions the source's programmed shift rate and interval.
			this.writeLiveGate(state, channel, true);
		} else {
			for (const [offset, value] of writes) this.core.vsu_write(state, offset, value);
		}
		owners.set(channel, owner);
		this.liveDirty = true;
	}

	liveNoteOff({ source, channel, playbackId, owner, immediate }) {
		const isSynth = source === 'synth' && playbackId === null;
		if (!isSynth && (source !== 'vgm' || playbackId === null || playbackId !== this.vgm.outputId)) return;
		const owners = isSynth ? this.synthKeyOwners : this.vgmKeyOwners;
		if (!owners.has(channel) || owners.get(channel) !== owner) return;
		const state = isSynth ? this.state : this.vgmState;
		if (immediate) {
			this.cancelRelease(state, channel, true);
			this.writeLiveGate(state, channel, false);
			owners.delete(channel);
			this.liveDirty = true;
		} else this.releaseNote(state, owners, channel);
	}

	writeSynthKey({ channel, owner, writes }, edit) {
		// A Code or scheduled attack may have taken the channel since the UI last saw this key.
		if (this.vgm.ownsOutput || (edit && this.synthKeyOwners.get(channel) !== owner)) return;
		const gate = vsuChannelRegister(channel, VSU_REGISTERS.INT);
		for (let index = 0; index < writes.length; index += 2) {
			if (writes[index] === gate) this.cancelRelease(this.state, channel, !(writes[index + 1] & 0x80));
			this.core.vsu_write(this.state, writes[index], writes[index + 1]);
		}
		if (!edit) this.synthKeyOwners.set(channel, owner);
		this.liveDirty = true;
	}

	releaseLiveNotes(state, owners) {
		for (const channel of owners.keys()) this.writeLiveGate(state, channel, false);
		owners.clear();
		const bank = this.releaseBank(state);
		for (let channel = 0; channel < NOISE_CHANNEL; channel++) {
			if (bank.remaining[channel] > 0) this.finishRelease(state, bank, channel);
		}
	}

	releaseTimedNotes(name, { session, owner } = {}) {
		let released = false;
		for (const [channel, gate] of this.synthKeyOwners) {
			if (gate.patternName === undefined || (name !== undefined && gate.patternName !== name) ||
				(session !== undefined && gate.session !== session) || (owner !== undefined && gate.owner !== owner)) continue;
			this.cancelRelease(this.state, channel, true);
			this.writeLiveGate(this.state, channel, false);
			this.synthKeyOwners.delete(channel);
			released = this.liveDirty = true;
		}
		return released;
	}

	fail(error) {
		this.failed = true;
		this.port.onmessage = null;
		this.port.postMessage({ type: 'error', error: String(error?.message ?? error) });
	}

	prepareBuffers(frames) {
		// Keep WASM state and both channels in the same linear memory. Recreate
		// the views only when the browser changes its rendering block size.
		const { memory } = this.core;
		this.rightOffset = this.pcm + frames * Float32Array.BYTES_PER_ELEMENT;
		const end = this.rightOffset + frames * Float32Array.BYTES_PER_ELEMENT;
		if (end > memory.buffer.byteLength) memory.grow(Math.ceil((end - memory.buffer.byteLength) / 65536));
		this.left = new Float32Array(memory.buffer, this.pcm, frames);
		this.right = new Float32Array(memory.buffer, this.rightOffset, frames);
		this.envelopeSnapshot = new Uint32Array(memory.buffer, this.captureAddress, this.liveEnvelopeWord + 1);
	}

	renderChip(state, offset, frames) {
		const byteOffset = offset * Float32Array.BYTES_PER_ELEMENT;
		this.core.vsu_render(state, this.pcm + byteOffset, this.rightOffset + byteOffset, frames, sampleRate);
	}

	renderFrames(state, offset, frames) {
		const bank = this.releaseBank(state);
		const { remaining } = bank;
		while (frames && bank.active) {
			for (let channel = 0; channel < NOISE_CHANNEL; channel++) {
				if (remaining[channel] > 0) this.applyReleaseGain(state, channel, remaining[channel]);
			}
			this.renderChip(state, offset++, 1);
			frames--;
			for (let channel = 0; channel < NOISE_CHANNEL; channel++) {
				if (remaining[channel] === 1) this.finishRelease(state, bank, channel);
				else if (remaining[channel] > 1) remaining[channel]--;
			}
		}
		if (frames) this.renderChip(state, offset, frames);
	}

	readVoice(state, channel, live = false) {
		const snapshot = live ? this.core.vsu_snapshot_live_voice : this.core.vsu_snapshot_voice;
		if (!snapshot(state, channel, this.captureAddress)) return null;
		// Both formats start with vsu_voice_snapshot. Copy RAM out before reusing the buffer.
		const buffer = this.core.memory.buffer;
		const words = new Uint32Array(buffer, this.captureAddress, 8);
		const [frequency, active, waveBank, left, right, ev0, ev1, swp] = words;
		const ramAddress = this.captureAddress + words.byteLength;
		const voice = {
			channel, frequency, active: Boolean(active), left, right, ev0, ev1, swp,
			interval: this.readInterval(state, channel),
			waveBank: waveBank === 0xffffffff ? null : waveBank,
			wave: waveBank < VSU_WAVE_BANK_COUNT ? Array.from(new Uint8Array(buffer, ramAddress, VSU_WAVE_LENGTH)) : null,
			modulation: channel === MODULATION_CHANNEL
				? Array.from(new Int8Array(buffer, ramAddress + VSU_WAVE_LENGTH, VSU_WAVE_LENGTH)) : null,
		};
		if (live) {
			const values = new Uint32Array(buffer, this.liveValuesAddress, 2);
			[voice.workingFrequency, voice.currentEnvelope] = values;
		}
		return voice;
	}

	captureVgm({ id, request, channel }) {
		if (!this.vgm.isPaused(id)) {
			this.port.postMessage({ type: 'vgm-capture', id, request, error: 'Pause a VGM before copying a channel.' });
			return;
		}
		const voice = this.readVoice(this.vgmState, channel);
		const result = voice ? { voice } : { error: 'That channel uses an unavailable waveform bank.' };
		this.port.postMessage({ type: 'vgm-capture', id, request, ...result });
	}

	editLive({ source, channel, playbackId, revision, sequence, register, mask, value }) {
		if (!Number.isSafeInteger(sequence) || sequence <= this.liveWriteSequence) return;
		this.liveWriteSequence = sequence;
		const id = this.vgm.outputId;
		if (this.liveChannel === null || channel !== this.liveChannel || revision !== this.liveRevision ||
			playbackId !== id || source !== (id === null ? 'synth' : 'vgm')) return;
		const allowedMask = register === 'EV1' ? 3 : 255;
		if (!Number.isInteger(mask) || mask < 1 || mask > allowedMask ||
			!Number.isInteger(value) || value < 0 || value > 255) return;
		const state = id === null ? this.state : this.vgmState;
		let previous;
		switch (register) {
		case 'LRV':
			previous = this.core.vsu_get_channel(state, channel) & 255;
			break;
		case 'EV0':
		case 'EV1':
			previous = this.envelopeByte(state, channel, register);
			if (previous === undefined) return;
			break;
		case 'RAM':
			if (source !== 'synth' || channel >= NOISE_CHANNEL || mask !== 7 || value >= VSU_WAVE_BANK_COUNT) return;
			previous = this.readVoice(state, channel, true)?.waveBank;
			if (previous === null || previous === undefined) return;
			break;
		default:
			return;
		}
		const next = this.writeMaskedRegister(state, channel, register, mask, value, previous);
		this.reportLive({ register, mask, value: next });
	}

	reportLive(edit) {
		if (this.liveChannel === null) return;
		const playbackId = this.vgm.outputId;
		if (!edit && !this.liveDirty && playbackId === this.lastLiveId &&
			(currentFrame < this.nextLiveReport || this.vgm.isPaused(playbackId))) return;
		this.liveDirty = false;
		this.lastLiveId = playbackId;
		this.nextLiveReport = currentFrame + LIVE_REPORT_FRAMES;
		const source = playbackId === null ? 'synth' : 'vgm';
		const channel = this.liveChannel;
		const voice = this.readVoice(source === 'synth' ? this.state : this.vgmState, channel, true);
		this.port.postMessage({
			type: 'live-state', source, channel, voice, playbackId, revision: this.liveRevision,
			sequence: this.liveWriteSequence, ...(edit ? { edit } : {}),
		});
	}

	reportEnvelopeState() {
		if (!this.envelopeWatch || currentFrame < this.nextEnvelopeReport) return;
		this.nextEnvelopeReport = currentFrame + ENVELOPE_REPORT_FRAMES;
		const playbackId = this.vgm.outputId;
		const state = playbackId === null ? this.state : this.vgmState;
		const words = this.envelopeSnapshot;
		let changed = playbackId !== this.envelopePlaybackId;
		this.envelopePlaybackId = playbackId;
		for (let channel = 0; channel < VSU_CHANNEL_COUNT; channel++) {
			this.core.vsu_snapshot_live_voice(state, channel, this.captureAddress);
			const active = Boolean(words[1]), ev0 = words[5], ev1 = words[6] & 3, level = words[this.liveEnvelopeWord];
			const previous = this.envelopeStates[channel];
			if (previous && active === previous.active && ev0 === previous.ev0 && ev1 === previous.ev1 && level === previous.level) continue;
			this.envelopeStates[channel] = { ev0, ev1, level, active };
			changed = true;
		}
		if (changed) this.port.postMessage({ type: 'envelope-state', playbackId,
			revision: this.envelopeRevision, states: this.envelopeStates.slice() });
	}

	handle(message) {
		try {
			switch (message.type) {
			case 'timed-request': {
				const response = { type: 'timed-response', id: message.id };
				try { response.value = this.timed.request(message.request); }
				catch (error) { response.error = error.message; response.name = error.name; }
				this.port.postMessage(response);
				break;
			}
			case 'reset':
				this.timed.clear();
				this.synthKeyOwners.clear();
				this.clearReleases(this.synthReleases);
				this.clearCodeWave();
				this.core.vsu_reset(this.state);
				this.applyChannelGains(this.state);
				this.liveDirty = true;
				break;
			case 'channel-gain': {
				const { channel, gain } = message;
				this.channelGains[channel] = gain;
				this.applyReleaseGain(this.state, channel, this.synthReleases.remaining[channel] ?? 0);
				if (this.vgm.ownsOutput) this.applyReleaseGain(this.vgmState, channel, this.vgmReleases.remaining[channel] ?? 0);
				break;
			}
			case 'write':
				this.writeSource(this.state, this.synthKeyOwners, message.offset, message.value);
				break;
			case 'batch':
				for (let index = 0; index < message.writes.length; index += 2)
					this.writeSource(this.state, this.synthKeyOwners, message.writes[index], message.writes[index + 1]);
				break;
			case 'envelope-writes':
			case 'note-writes':
				if (this.vgm.ownsOutput) break;
				for (const [offset, value, mask, fadeMs] of message.writes)
					this.writeSource(this.state, this.synthKeyOwners, offset, value, undefined, mask, fadeMs);
				this.liveDirty = true;
				break;
			case 'code-wave-write':
				this.queueCodeWave(message);
				break;
			case 'code-envelope-write':
				this.editCodeEnvelope(message);
				break;
			case 'vgm-play':
				this.timed.clear();
				this.releaseLiveNotes(this.state, this.synthKeyOwners);
				this.clearCodeWave();
				if (message.plan) this.vgmPlan = message.plan;
				this.vgm.play({ ...message, plan: this.vgmPlan });
				this.liveDirty = true;
				break;
			case 'vgm-pause':
				if (message.paused && this.vgm.isPlaying(message.id)) this.releaseLiveNotes(this.vgmState, this.vgmKeyOwners);
				this.vgm.pause(message.id, message.paused);
				this.liveDirty = true;
				break;
			case 'vgm-stop':
				this.vgm.stop(message.id);
				this.liveDirty = true;
				break;
			case 'vgm-loop':
				this.vgm.setLoop(message.id, message.loop);
				break;
			case 'vgm-mask':
				this.vgm.setMask(message.id, message.mask);
				break;
			case 'vgm-capture':
				this.captureVgm(message);
				break;
			case 'live-watch':
				this.liveChannel = message.channel;
				this.liveRevision = message.revision;
				this.liveDirty = true;
				break;
			case 'envelope-watch':
				this.envelopeWatch = message.enabled;
				this.envelopeRevision = message.revision;
				this.envelopePlaybackId = undefined;
				this.nextEnvelopeReport = 0;
				break;
			case 'live-write':
				this.editLive(message);
				break;
			case 'live-note-on':
				this.liveNoteOn(message);
				break;
			case 'live-note-off':
				this.liveNoteOff(message);
				break;
			case 'keyboard-note-off':
				if (!this.vgm.ownsOutput && Number.isInteger(message.channel) && message.channel >= 0 &&
					message.channel < VSU_CHANNEL_COUNT && !this.synthKeyOwners.has(message.channel))
					this.releaseNote(this.state, this.synthKeyOwners, message.channel, undefined, message.writes);
				break;
			case 'synth-key-on':
			case 'synth-key-edit':
				this.writeSynthKey(message, message.type === 'synth-key-edit');
				break;
			}
			// Flush only after a complete host batch has applied its writes and gates.
			this.flushCodeWave();
			this.reportCodeWave();
		} catch (error) { this.fail(error); }
	}

	process(_inputs, outputs) {
		if (this.failed) return false;
		const left = outputs[0]?.[0], right = outputs[0]?.[1];
		if (!left?.length || !right) return true;
		try {
			if (this.left.length !== left.length) this.prepareBuffers(left.length);
			if (this.vgm.ownsOutput) {
				const rendered = this.vgm.render(left.length);
				this.left.fill(0, rendered);
				this.right.fill(0, rendered);
			} else {
				this.timed.render(left.length, this.renderSynthFrames);
			}
			left.set(this.left);
			right.set(this.right);
			this.reportCodeWave();
			this.reportLive();
			this.reportEnvelopeState();
		} catch (error) {
			this.fail(error);
			return false;
		}
		return true;
	}
}

registerProcessor('tetorica-vsu', VsuProcessor);
