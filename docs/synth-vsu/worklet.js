// SPDX-License-Identifier: BSD-3-Clause
import { createVgmTransport } from './vgm-transport.js?v=vsu-live';

const LIVE_REPORT_FRAMES = Math.ceil(sampleRate / 30);
const WAVE_BANK_COUNT = 5;
const WAVE_LENGTH = 32;
const MODULATION_CHANNEL = 4;

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
			this.captureAddress = this.vgmState + stateSize;
			this.pcm = this.captureAddress + Math.ceil(exports.vsu_live_snapshot_size() / 4) * 4;
			this.liveChannel = null;
			this.nextLiveReport = 0;
			this.lastLiveId = null;
			this.liveDirty = false;
			this.prepareBuffers(128);
			exports.vsu_reset(this.state);
			this.vgm = createVgmTransport({
				sampleRate,
				reset: () => exports.vsu_reset(this.vgmState),
				restore: bytes => {
					if (!(bytes instanceof Uint8Array) || bytes.byteLength !== this.stateBytes)
						throw new Error('Invalid VSU seek checkpoint.');
					// Both wasm instances use the same binary and the state has no pointers.
					new Uint8Array(exports.memory.buffer, this.vgmState, this.stateBytes).set(bytes);
				},
				write: (offset, value) => exports.vsu_write(this.vgmState, offset, value),
				setMask: mask => exports.vsu_set_mix_mask(this.vgmState, mask),
				readChannel: channel => exports.vsu_get_channel(this.vgmState, channel),
				renderFrames: (offset, frames) => {
					const byteOffset = offset * Float32Array.BYTES_PER_ELEMENT;
					exports.vsu_render(this.vgmState, this.pcm + byteOffset, this.rightOffset + byteOffset, frames, sampleRate);
				},
				onState: state => this.port.postMessage({ type: 'vgm-state', ...state }),
			});
			this.port.onmessage = ({ data }) => this.handle(data);
			this.port.postMessage({ type: 'ready' });
		} catch (error) { this.fail(error); }
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
			waveBank: waveBank === 0xffffffff ? null : waveBank,
			wave: waveBank < WAVE_BANK_COUNT ? Array.from(new Uint8Array(buffer, ramAddress, WAVE_LENGTH)) : null,
			modulation: channel === MODULATION_CHANNEL
				? Array.from(new Int8Array(buffer, ramAddress + WAVE_LENGTH, WAVE_LENGTH)) : null,
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

	reportLive() {
		if (this.liveChannel === null) return;
		const playbackId = this.vgm.outputId;
		if (!this.liveDirty && playbackId === this.lastLiveId &&
			(currentFrame < this.nextLiveReport || this.vgm.isPaused(playbackId))) return;
		this.liveDirty = false;
		this.lastLiveId = playbackId;
		this.nextLiveReport = currentFrame + LIVE_REPORT_FRAMES;
		const source = playbackId === null ? 'synth' : 'vgm';
		const channel = this.liveChannel;
		const voice = this.readVoice(source === 'synth' ? this.state : this.vgmState, channel, true);
		this.port.postMessage({ type: 'live-state', source, channel, voice, playbackId, revision: this.liveRevision });
	}

	handle(message) {
		try {
			switch (message.type) {
			case 'reset':
				this.core.vsu_reset(this.state);
				break;
			case 'write':
				this.core.vsu_write(this.state, message.offset, message.value);
				break;
			case 'batch':
				for (let index = 0; index < message.writes.length; index += 2)
					this.core.vsu_write(this.state, message.writes[index], message.writes[index + 1]);
				break;
			case 'vgm-play':
				if (message.plan) this.vgmPlan = message.plan;
				this.vgm.play({ ...message, plan: this.vgmPlan });
				this.liveDirty = true;
				break;
			case 'vgm-pause':
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
			}
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
				this.core.vsu_render(this.state, this.pcm, this.rightOffset, left.length, sampleRate);
			}
			left.set(this.left);
			right.set(this.right);
			this.reportLive();
		} catch (error) {
			this.fail(error);
			return false;
		}
		return true;
	}
}

registerProcessor('tetorica-vsu', VsuProcessor);
