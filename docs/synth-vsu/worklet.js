// SPDX-License-Identifier: BSD-3-Clause
import { isVsuEnvelopeEdit } from './envelope.js?v=vsu-code-envelope';
import { createVgmTransport } from './vgm-transport.js?v=vsu-live-keyboard';
import { createVsuTimedProcessor } from './timed-processor.js';
import { VSU_CHANNEL_COUNT, VSU_REGISTERS, VSU_SOUND_STOP, VSU_WAVE_BANK_COUNT, VSU_WAVE_LENGTH, vsuChannelRegister } from './vsu.js';

const LIVE_REPORT_FRAMES = Math.ceil(sampleRate / 30);
const WAVE_SAMPLE_COUNT = VSU_WAVE_BANK_COUNT * VSU_WAVE_LENGTH;
const MODULATION_CHANNEL = 4;
const NOISE_CHANNEL = 5;
const FIRST_CHANNEL_INT = vsuChannelRegister(0, VSU_REGISTERS.INT);
const CHANNEL_STRIDE = vsuChannelRegister(1, VSU_REGISTERS.INT) - FIRST_CHANNEL_INT;

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
			this.pendingCodeWaveWrites = new Map();
			this.appliedCodeWaveWrites = [];
			this.codeWaveEditId = 0;
			this.codeWaveStateDirty = false;
			this.captureAddress = this.vgmState + stateSize;
			this.pcm = this.captureAddress + Math.ceil(exports.vsu_live_snapshot_size() / 4) * 4;
			this.liveChannel = null;
			this.liveWriteSequence = 0;
			this.nextLiveReport = 0;
			this.lastLiveId = null;
			this.liveDirty = false;
			this.prepareBuffers(128);
			exports.vsu_reset(this.state);
			this.vgm = createVgmTransport({
				sampleRate,
				reset: () => {
					this.vgmKeyOwners.clear();
					exports.vsu_reset(this.vgmState);
					this.applyChannelGains(this.vgmState);
				},
				restore: bytes => {
					if (!(bytes instanceof Uint8Array) || bytes.byteLength !== this.stateBytes)
						throw new Error('Invalid VSU seek checkpoint.');
					// Both wasm instances use the same binary and the state has no pointers.
					new Uint8Array(exports.memory.buffer, this.vgmState, this.stateBytes).set(bytes);
					this.vgmKeyOwners.clear();
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
				write: (offset, value, owner) => this.writeSource(this.state, this.synthKeyOwners, offset, value, owner),
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

	writeSource(state, owners, offset, value, timed) {
		// Only a source write to the gate takes ownership from a held key.
		if (offset === VSU_SOUND_STOP && (value & 1)) owners.clear();
		else if (offset >= FIRST_CHANNEL_INT && offset < VSU_SOUND_STOP && (offset - FIRST_CHANNEL_INT) % CHANNEL_STRIDE === 0) {
			const channel = (offset - FIRST_CHANNEL_INT) / CHANNEL_STRIDE;
			if (timed && (value & 0x80)) owners.set(channel, timed);
			else {
				const previous = owners.get(channel);
				if (timed && (this.core.vsu_get_channel(state, channel) & 0x100) &&
					(previous?.owner !== timed.owner || previous.patternName !== timed.patternName)) return;
				owners.delete(channel);
			}
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

	liveNoteOff({ source, channel, playbackId, owner }) {
		const isSynth = source === 'synth' && playbackId === null;
		if (!isSynth && (source !== 'vgm' || playbackId === null || playbackId !== this.vgm.outputId)) return;
		const owners = isSynth ? this.synthKeyOwners : this.vgmKeyOwners;
		if (!owners.has(channel) || owners.get(channel) !== owner) return;
		const state = isSynth ? this.state : this.vgmState;
		this.writeLiveGate(state, channel, false);
		owners.delete(channel);
		this.liveDirty = true;
	}

	writeSynthKey({ channel, owner, writes }, edit) {
		// A Code or scheduled attack may have taken the channel since the UI last saw this key.
		if (this.vgm.ownsOutput || (edit && this.synthKeyOwners.get(channel) !== owner)) return;
		for (let index = 0; index < writes.length; index += 2)
			this.core.vsu_write(this.state, writes[index], writes[index + 1]);
		if (!edit) this.synthKeyOwners.set(channel, owner);
		this.liveDirty = true;
	}

	releaseLiveNotes(state, owners) {
		for (const channel of owners.keys()) this.writeLiveGate(state, channel, false);
		owners.clear();
	}

	releaseTimedNotes(name, { session, owner } = {}) {
		let released = false;
		for (const [channel, gate] of this.synthKeyOwners) {
			if (gate.patternName === undefined || (name !== undefined && gate.patternName !== name) ||
				(session !== undefined && gate.session !== session) || (owner !== undefined && gate.owner !== owner)) continue;
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
	}

	renderFrames(state, offset, frames) {
		const byteOffset = offset * Float32Array.BYTES_PER_ELEMENT;
		this.core.vsu_render(state, this.pcm + byteOffset, this.rightOffset + byteOffset, frames, sampleRate);
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
			const values = new Uint32Array(buffer, this.captureAddress + this.core.vsu_snapshot_size(), 2);
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
				this.clearCodeWave();
				this.core.vsu_reset(this.state);
				this.applyChannelGains(this.state);
				this.liveDirty = true;
				break;
			case 'channel-gain': {
				const { channel, gain } = message;
				this.channelGains[channel] = gain;
				this.core.vsu_set_channel_gain(this.state, channel, gain);
				if (this.vgm.ownsOutput) this.core.vsu_set_channel_gain(this.vgmState, channel, gain);
				break;
			}
			case 'write':
				this.writeSource(this.state, this.synthKeyOwners, message.offset, message.value);
				break;
			case 'batch':
				for (let index = 0; index < message.writes.length; index += 2)
					this.writeSource(this.state, this.synthKeyOwners, message.writes[index], message.writes[index + 1]);
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
			case 'live-write':
				this.editLive(message);
				break;
			case 'live-note-on':
				this.liveNoteOn(message);
				break;
			case 'live-note-off':
				this.liveNoteOff(message);
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
		} catch (error) {
			this.fail(error);
			return false;
		}
		return true;
	}
}

registerProcessor('tetorica-vsu', VsuProcessor);
