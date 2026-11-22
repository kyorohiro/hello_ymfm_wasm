// SPDX-License-Identifier: BSD-3-Clause
import { assembleTwoSf } from './2sf_source.js';
import { parseScspSsfTime } from '../synth-scsp/ssf_source.js';
import { readTwoSfSnapshots } from './2sf-channel-monitor.js?v=nds-2sf-audition-1';
import { buildTwoSfWaveform } from './2sf-waveform.js';
import { NDS_MAX_SAMPLE_BYTES } from './nds-core.js';
import { instantiateSkyEmu, loadSkyEmuModule, SKYEMU_SAMPLE_RATE as RATE } from './nds-skyemu-wasm.js?v=nds-2sf-live-edit-1';

const BLOCK_FRAMES = 2048;
const MAX_ROM_BYTES = 64 * 1024 * 1024;
const MAX_SECONDS = 60 * 60;
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
	const core = instantiateSkyEmu(await loadSkyEmuModule());
	const monitorSupported = typeof core.nds_2sf_snapshots === 'function' &&
		typeof core.nds_2sf_snapshot_count === 'function';
	const auditionSupported = monitorSupported && typeof core.nds_2sf_capture === 'function' &&
		typeof core.nds_2sf_capture_data === 'function';
	const waveformSupported = auditionSupported && typeof core.nds_2sf_capture_revision === 'function';
	const editSupported = typeof core.nds_2sf_edit_channel === 'function';
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
	function capture(frame, channel) {
		if (!auditionSupported) return { unavailable: 'Update the 2SF renderer for keyboard audition.' };
		const size = core.nds_2sf_capture(frame, channel);
		if (size <= 0) return { unavailable: captureErrors[size] ?? 'This 2SF sample is unavailable.' };
		const pointer = core.nds_2sf_capture_data();
		if (!pointer || size > NDS_MAX_SAMPLE_BYTES || pointer + size > core.memory.buffer.byteLength)
			return { unavailable: 'The 2SF renderer returned an invalid sample.' };
		return { bytes: new Uint8Array(core.memory.buffer, pointer, size) };
	}
	return {
		totalFrames, monitorSupported, auditionSupported, waveformSupported, editSupported,
		capture(frame, channel) {
			const sample = capture(frame, channel);
			return sample.bytes ? { bytes: sample.bytes.slice() } : sample;
		},
		waveform(frame, channel, mode, knownRevision) {
			if (!waveformSupported) return { unavailable: true };
			const { bytes } = capture(frame, channel);
			if (!bytes) return { unavailable: true };
			const revision = core.nds_2sf_capture_revision() >>> 0;
			if (revision === knownRevision) return { revision };
			try {
				return { revision, waveform: buildTwoSfWaveform(bytes, mode) };
			} catch {
				return { unavailable: true };
			}
		},
		edit(writes) {
			if (!editSupported) throw new Error('Update the 2SF renderer for channel editing.');
			let firstFrame = frame;
			for (const { channel, mask, control, timer } of writes) {
				firstFrame = core.nds_2sf_edit_channel(channel, mask, control, timer);
				if (firstFrame < 0) throw new Error('The 2SF renderer rejected a channel edit.');
			}
			return firstFrame;
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
			const { totalFrames, monitorSupported, auditionSupported, waveformSupported, editSupported } = renderer;
			self.postMessage({ id, value: { totalFrames, monitorSupported, auditionSupported, waveformSupported, editSupported } });
		} else if (method === 'capture' && renderer) {
			const value = renderer.capture(data.frame, data.channel);
			self.postMessage({ id, value }, value.bytes ? [value.bytes.buffer] : []);
		} else if (method === 'waveform' && renderer) {
			const value = renderer.waveform(data.frame, data.channel, data.mode, data.knownRevision);
			self.postMessage({ id, value }, value.waveform ? [value.waveform.peaks.buffer] : []);
		} else if (method === 'edit' && renderer) {
			self.postMessage({ id, value: renderer.edit(data.writes) });
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
