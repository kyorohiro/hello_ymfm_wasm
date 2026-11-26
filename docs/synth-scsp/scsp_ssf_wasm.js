// SPDX-License-Identifier: BSD-3-Clause
export const SSF_RENDER_FRAMES = 2048;
const RAM_BYTES = 512 * 1024;

/** Own one raw-WASM Saturn sound board. Returned PCM can be transferred away. */
export async function createScspSsfWasmRenderer(wasmBinary, source) {
	const { ram, totalSamples, lengthSeconds, fadeSeconds, volume } = source;
	if (!(ram instanceof Uint8Array) || ram.length !== RAM_BYTES)
		throw new TypeError('SSF playback requires a prepared 512 KiB sound RAM image');
	if (!Number.isSafeInteger(totalSamples) || totalSamples < 0)
		throw new RangeError('Invalid SSF playback length');
	const importObject = { env: { emscripten_notify_memory_growth() {} } };
	const { instance } = await WebAssembly.instantiate(wasmBinary, importObject);
	const native = instance.exports;
	native._initialize();
	let handle = 0,
		left = 0,
		right = 0,
		position = 0,
		disposed = false;

	function dispose() {
		if (disposed) return;
		disposed = true;
		if (handle) native.scsp_ssf_destroy(handle);
		if (left) native.free(left);
		if (right) native.free(right);
	}
	try {
		const input = native.malloc(RAM_BYTES);
		if (!input) throw new Error('Could not allocate SSF sound RAM');
		try {
			new Uint8Array(native.memory.buffer, input, RAM_BYTES).set(ram);
			handle = native.scsp_ssf_create(input, RAM_BYTES);
		} finally {
			native.free(input);
		}
		if (!handle) throw new Error('The SCSP board rejected the SSF sound RAM image');
		left = native.malloc(SSF_RENDER_FRAMES * Float32Array.BYTES_PER_ELEMENT);
		right = native.malloc(SSF_RENDER_FRAMES * Float32Array.BYTES_PER_ELEMENT);
		if (!left || !right) throw new Error('Could not allocate SSF PCM buffers');
	} catch (error) {
		dispose();
		throw error;
	}
	let lastMask = 0;
	const gain = Number.isFinite(volume) ? Math.max(0, volume) : 1;
	const fadeStart = fadeSeconds > 0 && Number.isFinite(lengthSeconds)
		? Math.round(lengthSeconds * 44100)
		: totalSamples;
	return {
		process(frames, muteMask = 0) {
			if (disposed) throw new Error('SSF renderer has been disposed');
			if (!Number.isInteger(frames) || frames < 1 || frames > SSF_RENDER_FRAMES)
				throw new RangeError(`SSF render request must have 1–${SSF_RENDER_FRAMES} frames`);
			if (muteMask !== lastMask) native.scsp_ssf_set_mute(handle, muteMask);
			lastMask = muteMask;
			const count = Math.min(frames, totalSamples - position);
			if (count && !native.scsp_ssf_render(handle, left, right, count)) {
				const fault = native.scsp_ssf_fault_address(handle) >>> 0;
				const message = fault === 0xffffffff
					? 'SSF render failed'
					: `Unsupported SCSP sound-board access at 0x${fault.toString(16).toUpperCase()}`;
				throw new Error(`${message} (frame ${position})`);
			}
			const pcmLeft = new Float32Array(native.memory.buffer, left, count).slice();
			const pcmRight = new Float32Array(native.memory.buffer, right, count).slice();
			if (gain !== 1 || position + count > fadeStart) {
				for (let index = 0; index < count; index++) {
					const frame = position + index;
					const fade = frame < fadeStart
						? 1
						: (totalSamples - frame - 1) / Math.max(1, totalSamples - fadeStart - 1);
					const scale = gain * fade;
					pcmLeft[index] = Math.max(-1, Math.min(1, pcmLeft[index] * scale));
					pcmRight[index] = Math.max(-1, Math.min(1, pcmRight[index] * scale));
				}
			}
			position += count;
			return { left: pcmLeft, right: pcmRight, frames: count, ended: position === totalSamples };
		},
		dispose,
	};
}
