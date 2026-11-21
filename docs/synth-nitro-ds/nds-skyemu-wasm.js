// SPDX-License-Identifier: BSD-3-Clause
export const SKYEMU_SAMPLE_RATE = 48000;
const MAX_RENDER_FRAMES = 2048;
const MAX_ADPCM_PREPARE_FRAMES = 16384;

export async function loadSkyEmuModule() {
	const wasmUrl = new URL('./generated/skyemu-2sf.wasm?v=nds-adpcm-cache-1', import.meta.url);
	const response = await fetch(wasmUrl);
	if (!response.ok) throw new Error('DS renderer is unavailable. Build the local WASM preview first.');
	return WebAssembly.compile(await response.arrayBuffer());
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
	if (typeof core.nds_synth_prepare_adpcm !== 'function') throw new Error('Build a DS renderer with direct sound support.');
	if (!core.nds_synth_open()) throw new Error('Could not open the DS sound session.');
	const output = core.malloc(MAX_RENDER_FRAMES * 4);
	if (!output) {
		core.nds_synth_close();
		throw new Error('Could not allocate the DS sound buffer.');
	}
	let closed = false;
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
	return {
		upload(offset, bytes) {
			requireOpen();
			if (!(bytes instanceof Uint8Array) || !bytes.length || !Number.isSafeInteger(offset) ||
				offset < 0 || offset + bytes.length > 4 * 1024 * 1024)
				throw new RangeError('DS sample data must fit in main RAM.');
			const buffer = core.malloc(bytes.length);
			if (!buffer) throw new Error('Could not allocate the DS sample transfer buffer.');
			try {
				new Uint8Array(core.memory.buffer, buffer, bytes.length).set(bytes);
				if (!core.nds_synth_upload(offset, buffer, bytes.length)) throw new Error('Could not upload the DS sample.');
			} finally {
				core.free(buffer);
			}
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
		render(left, right) {
			requireOpen();
			const frames = left.length;
			if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || right.length !== frames ||
				!frames || frames > MAX_RENDER_FRAMES)
				throw new RangeError('Choose equal-length DS stereo buffers of 1–2048 frames.');
			if (core.nds_synth_render(output, frames) !== frames) throw new Error('Could not render a DS sound block.');
			const samples = new Int16Array(core.memory.buffer, output, frames * 2);
			for (let frame = 0; frame < frames; frame++) {
				left[frame] = samples[frame * 2] / 32768;
				right[frame] = samples[frame * 2 + 1] / 32768;
			}
		},
		close() {
			if (closed) return;
			closed = true;
			core.free(output);
			core.nds_synth_close();
		},
	};
}
