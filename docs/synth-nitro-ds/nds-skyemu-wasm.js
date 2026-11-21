// SPDX-License-Identifier: BSD-3-Clause
export const SKYEMU_SAMPLE_RATE = 48000;
const MAX_RENDER_FRAMES = 2048;
const MAX_ADPCM_PREPARE_FRAMES = 16384;
const SAMPLE_SLOT_BYTES = 1024 * 1024;
const SAMPLE_SLOT_COUNT = 32;

let loading;
export function loadSkyEmuModule() {
	loading ??= (async () => {
		const wasmUrl = new URL('./generated/skyemu-2sf.wasm?v=nds-shared-renderer-1', import.meta.url);
		const response = await fetch(wasmUrl);
		if (!response.ok) throw new Error('DS renderer is unavailable. Rebuild the DS WASM or reload the distribution.');
		return WebAssembly.compile(await response.arrayBuffer());
	})().catch(error => {
		loading = null;
		throw error;
	});
	return loading;
}

export function instantiateSkyEmu(module) {
	const { exports: core } = new WebAssembly.Instance(module, {
		env: { emscripten_notify_memory_growth() {} },
	});
	core._initialize();
	return core;
}

/** Drive the same 48 kHz DS audio routine as 2SF, with host RAM and register writes. */
export function openSkyEmuSound(module) {
	const core = instantiateSkyEmu(module);
	if (typeof core.nds_synth_render_float !== 'function') throw new Error('Update the DS renderer for direct sound support.');
	if (!core.nds_synth_open()) throw new Error('Could not open the DS sound session.');
	const output = core.malloc(MAX_RENDER_FRAMES * 8);
	if (!output) {
		core.nds_synth_close();
		throw new Error('Could not allocate the DS sound buffer.');
	}
	let closed = false, renderMemory, int16Output, floatOutput;
	function requireOpen() {
		if (closed) throw new Error('The DS sound session is closed.');
	}
	function registerOffset(offset) {
		if (!Number.isInteger(offset) || offset < 0 || offset > 252 || offset % 4)
			throw new RangeError('Invalid DS sound register offset.');
	}
	function channelIndex(channel) {
		if (!Number.isInteger(channel) || channel < 0 || channel >= 16)
			throw new RangeError('Invalid DS sound channel.');
	}
	function slotIndex(slot) {
		if (!Number.isInteger(slot) || slot < 0 || slot >= SAMPLE_SLOT_COUNT)
			throw new RangeError('Invalid DS sample storage slot.');
	}
	function uploadBytes(bytes, write) {
		const buffer = core.malloc(bytes.length);
		if (!buffer) throw new Error('Could not allocate the DS sample transfer buffer.');
		try {
			new Uint8Array(core.memory.buffer, buffer, bytes.length).set(bytes);
			if (!write(buffer)) throw new Error('Could not upload the DS sample.');
		} finally {
			core.free(buffer);
		}
	}
	function renderStereo(left, right, direct) {
		requireOpen();
		if (!(left instanceof Float32Array) || !(right instanceof Float32Array) ||
			right.length !== left.length || !left.length || left.length > MAX_RENDER_FRAMES)
			throw new RangeError('Choose equal-length DS stereo buffers of 1–2048 frames.');
		const frames = left.length;
		const size = direct ? core.nds_synth_render_float(output, frames) : core.nds_synth_render(output, frames);
		if (size !== frames) throw new Error('Could not render a DS sound block.');
		if (renderMemory !== core.memory.buffer) {
			renderMemory = core.memory.buffer;
			floatOutput = new Float32Array(renderMemory, output, MAX_RENDER_FRAMES * 2);
			int16Output = new Int16Array(renderMemory, output, MAX_RENDER_FRAMES * 2);
		}
		const samples = direct ? floatOutput : int16Output;
		const scale = direct ? 1 : 1 / 32768;
		for (let frame = 0; frame < frames; frame++) {
			left[frame] = samples[frame * 2] * scale;
			right[frame] = samples[frame * 2 + 1] * scale;
		}
	}
	return {
		upload(offset, bytes) {
			requireOpen();
			if (!(bytes instanceof Uint8Array) || !bytes.length || !Number.isSafeInteger(offset) ||
				offset < 0 || offset + bytes.length > 4 * 1024 * 1024)
				throw new RangeError('DS sample data must fit in main RAM.');
			uploadBytes(bytes, buffer => core.nds_synth_upload(offset, buffer, bytes.length));
		},
		uploadVoice(slot, offset, bytes) {
			requireOpen();
			slotIndex(slot);
			if (!(bytes instanceof Uint8Array) || !bytes.length || !Number.isSafeInteger(offset) ||
				offset < 0 || offset + bytes.length > SAMPLE_SLOT_BYTES)
				throw new RangeError('DS sample data must fit in its storage slot.');
			uploadBytes(bytes, buffer => core.nds_synth_upload_voice(slot, offset, buffer, bytes.length));
		},
		prepareAdpcm(offset, byteLength, frames = MAX_ADPCM_PREPARE_FRAMES) {
			requireOpen();
			if (!Number.isInteger(offset) || offset < 0 || offset >= 4 * 1024 * 1024 ||
				!Number.isInteger(byteLength) || byteLength < 16 || byteLength > 1024 * 1024 ||
				!Number.isInteger(frames) || frames < 1 || frames > MAX_ADPCM_PREPARE_FRAMES)
				throw new RangeError('Invalid DS ADPCM preparation range.');
			const result = core.nds_synth_prepare_adpcm(offset, byteLength, frames);
			if (!result) throw new RangeError('Could not prepare the DS ADPCM range.');
			return result === 1;
		},
		prepareVoiceAdpcm(slot, byteLength, frames = MAX_ADPCM_PREPARE_FRAMES) {
			requireOpen();
			slotIndex(slot);
			if (!Number.isInteger(byteLength) || byteLength < 16 || byteLength > SAMPLE_SLOT_BYTES || byteLength % 4 ||
				!Number.isInteger(frames) || frames < 1 || frames > MAX_ADPCM_PREPARE_FRAMES)
				throw new RangeError('Invalid DS ADPCM preparation range.');
			const result = core.nds_synth_prepare_voice_adpcm(slot, byteLength, frames);
			if (!result) throw new RangeError('Could not prepare the DS ADPCM range.');
			return result < 0 ? null : result === 1;
		},
		cancelVoiceAdpcm(slot) {
			requireOpen();
			slotIndex(slot);
			core.nds_synth_cancel_voice_adpcm(slot);
		},
		write(offset, value) {
			requireOpen();
			registerOffset(offset);
			if (!Number.isInteger(value) || value < 0 || value > 0xffffffff || !core.nds_synth_write(offset, value))
				throw new RangeError('Invalid DS sound register value.');
		},
		read(offset) {
			requireOpen();
			registerOffset(offset);
			return core.nds_synth_read(offset) >>> 0;
		},
		position(channel) {
			requireOpen();
			channelIndex(channel);
			return core.nds_synth_position(channel);
		},
		setRange(channel, loopStartWords, lengthWords) {
			requireOpen();
			channelIndex(channel);
			if (!Number.isInteger(loopStartWords) || loopStartWords < 0 || loopStartWords > 65535 ||
				!Number.isInteger(lengthWords) || lengthWords < 1 || lengthWords > 0x3fffff)
				throw new RangeError('Invalid DS sample range.');
			return Boolean(core.nds_synth_range(channel, loopStartWords, lengthWords));
		},
		setMix(channel, left, right) {
			requireOpen();
			channelIndex(channel);
			if (!core.nds_synth_set_mix(channel, left, right)) throw new RangeError('Invalid DS channel gain.');
		},
		release(channel, frames) {
			requireOpen();
			channelIndex(channel);
			if (!Number.isInteger(frames) || frames < 0 || frames > SKYEMU_SAMPLE_RATE ||
				!core.nds_synth_release(channel, frames))
				throw new RangeError('Invalid DS software release.');
		},
		releasing(channel) {
			requireOpen();
			channelIndex(channel);
			return Boolean(core.nds_synth_releasing(channel));
		},
		render(left, right) { renderStereo(left, right, false); },
		renderFloat(left, right) { renderStereo(left, right, true); },
		close() {
			if (closed) return;
			closed = true;
			core.free(output);
			core.nds_synth_close();
		},
	};
}
