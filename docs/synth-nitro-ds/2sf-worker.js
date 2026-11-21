// SPDX-License-Identifier: BSD-3-Clause
import { assembleTwoSf } from './2sf_source.js';
import { parseScspSsfTime } from '../synth-scsp/ssf_source.js';

const RATE = 48000;
const BLOCK_FRAMES = 2048;
const MAX_ROM_BYTES = 64 * 1024 * 1024;
const MAX_SECONDS = 60 * 60;
const wasmUrl = new URL('./generated/skyemu-2sf.wasm', import.meta.url);
let renderer = null;

async function open(path, files) {
	const entries = files.map(({ path, file }) => ({ path, size: file.size, arrayBuffer: () => file.arrayBuffer() }));
	const { rom, tags } = await assembleTwoSf(path, entries, { maxRomBytes: MAX_ROM_BYTES });
	const response = await fetch(wasmUrl);
	if (!response.ok) throw new Error('2SF renderer is unavailable. Build the local WASM preview first.');
	const imports = { env: { emscripten_notify_memory_growth() {} } };
	const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), imports);
	const core = instance.exports;
	core._initialize();
	const image = core.malloc(rom.byteLength);
	if (!image) throw new Error('Could not allocate the DS cartridge image.');
	try {
		new Uint8Array(core.memory.buffer, image, rom.byteLength).set(rom);
		if (!core.nds_2sf_open(image, rom.byteLength)) throw new Error('SkyEmu could not open this 2SF image.');
	} finally {
		core.free(image);
	}
	const output = core.malloc(BLOCK_FRAMES * 4);
	if (!output) throw new Error('Could not allocate the DS PCM buffer.');
	const length = parseScspSsfTime(tags.get('length')) || 180;
	const fade = parseScspSsfTime(tags.get('fade')) ?? 0;
	const fadeStart = Math.round(length * RATE);
	const totalFrames = Math.round(Math.min(length + fade, MAX_SECONDS) * RATE);
	let frame = 0;
	return {
		totalFrames,
		process() {
			const count = Math.min(totalFrames - frame, BLOCK_FRAMES);
			if (!count || core.nds_2sf_render(output, count) !== count) throw new Error('SkyEmu could not produce a PCM block.');
			const samples = new Int16Array(core.memory.buffer, output, count * 2);
			const left = new Float32Array(count), right = new Float32Array(count);
			for (let i = 0; i < count; i++) {
				const fadeGain = frame + i < fadeStart ? 1 : (totalFrames - frame - i - 1) / Math.max(1, totalFrames - fadeStart - 1);
				left[i] = samples[i * 2] * fadeGain / 32768;
				right[i] = samples[i * 2 + 1] * fadeGain / 32768;
			}
			frame += count;
			return { left, right, ended: frame === totalFrames };
		},
	};
}

self.onmessage = async ({ data }) => {
	const { id, method } = data;
	try {
		if (method === 'open') {
			renderer = await open(data.path, data.files);
			self.postMessage({ id, value: { totalFrames: renderer.totalFrames } });
		} else if (method === 'render' && renderer) {
			const block = renderer.process();
			self.postMessage({ id, value: block }, [block.left.buffer, block.right.buffer]);
		} else throw new Error('Invalid 2SF renderer request.');
	} catch (error) {
		self.postMessage({ id, error: error.message });
	}
};
