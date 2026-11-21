// SPDX-License-Identifier: BSD-3-Clause
import { assembleTwoSf } from './2sf_source.js';
import { parseScspSsfTime } from '../synth-scsp/ssf_source.js';
import { readTwoSfSnapshots } from './2sf-channel-monitor.js?v=nds-2sf-audition-1';
import { NDS_MAX_SAMPLE_BYTES } from './nds-core.js';

const RATE = 48000;
const BLOCK_FRAMES = 2048;
const MAX_ROM_BYTES = 64 * 1024 * 1024;
const MAX_SECONDS = 60 * 60;
const wasmUrl = new URL('./generated/skyemu-2sf.wasm?v=nds-2sf-audition-1', import.meta.url);
const captureErrors = {
	[-1]: 'Sample history is unavailable at this playback position.',
	[-2]: 'This channel was idle at Pause.',
	[-3]: 'This channel has no supported sample in DS RAM.',
	[-4]: 'This sample exceeded the 2SF history budget.',
};
let renderer = null;

async function open(path, files) {
	const entries = files.map(({ path, file }) => ({ path, size: file.size, arrayBuffer: () => file.arrayBuffer() }));
	const { rom, tags } = await assembleTwoSf(path, entries, { maxRomBytes: MAX_ROM_BYTES });
	const response = await fetch(wasmUrl);
	if (!response.ok) throw new Error('2SF renderer is unavailable. Build the local WASM preview first.');
	const imports = { env: { emscripten_notify_memory_growth() {} } };
	const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), imports);
	const core = instance.exports;
	const monitorSupported = typeof core.nds_2sf_snapshots === 'function' &&
		typeof core.nds_2sf_snapshot_count === 'function';
	const auditionSupported = monitorSupported && typeof core.nds_2sf_capture === 'function' &&
		typeof core.nds_2sf_capture_data === 'function';
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
		monitorSupported,
		auditionSupported,
		capture(frame, channel) {
			if (!auditionSupported) return { unavailable: 'Update the 2SF renderer for keyboard audition.' };
			const size = core.nds_2sf_capture(frame, channel);
			if (size <= 0) return { unavailable: captureErrors[size] ?? 'This 2SF sample is unavailable.' };
			const pointer = core.nds_2sf_capture_data();
			if (!pointer || size > NDS_MAX_SAMPLE_BYTES || pointer + size > core.memory.buffer.byteLength)
				return { unavailable: 'The 2SF renderer returned an invalid sample.' };
			return { bytes: new Uint8Array(core.memory.buffer, pointer, size).slice() };
		},
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
			const snapshots = monitorSupported ? readTwoSfSnapshots(core) : null;
			return { left, right, snapshots, ended: frame === totalFrames };
		},
	};
}

self.onmessage = async ({ data }) => {
	const { id, method } = data;
	try {
		if (method === 'open') {
			renderer = await open(data.path, data.files);
			const { totalFrames, monitorSupported, auditionSupported } = renderer;
			self.postMessage({ id, value: { totalFrames, monitorSupported, auditionSupported } });
		} else if (method === 'capture' && renderer) {
			const value = renderer.capture(data.frame, data.channel);
			self.postMessage({ id, value }, value.bytes ? [value.bytes.buffer] : []);
		} else if (method === 'render' && renderer) {
			const block = renderer.process();
			const transfer = [block.left.buffer, block.right.buffer];
			if (block.snapshots) transfer.push(block.snapshots.buffer);
			self.postMessage({ id, value: block }, transfer);
		} else throw new Error('Invalid 2SF renderer request.');
	} catch (error) {
		self.postMessage({ id, error: error.message });
	}
};
