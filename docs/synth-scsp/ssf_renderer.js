// SPDX-License-Identifier: BSD-3-Clause
import createSsfPlayerModule from '../generated/ssf-player/ssf_player.js?v=scsp-ssf-dsp-1';
import { zlibSync } from '../playground/vendor/fflate.js';
import { scspSsfCrc32 } from './ssf_source.js';
import { decodeScspSsfSnapshot, decodeScspSsfDspSnapshot, SCSP_SSF_SNAPSHOT_WORDS, SCSP_SSF_DSP_SNAPSHOT_WORDS } from './ssf_snapshot.js?v=scsp-ssf-dsp-1';
import { encodeScspSsfVoiceEdit } from './ssf_voice_parameters.js';

const RATE = 44100;
const MAX_FRAMES = 16384;
const RAM_BYTES = 512 * 1024;
let binaryPromise = null;

const cancelled = () => new DOMException('SSF renderer creation cancelled', 'AbortError');
function check(signal) {
	if (signal?.aborted) throw cancelled();
}

async function getBinary() {
	binaryPromise ??= fetch(new URL('../generated/ssf-player/ssf_player.wasm?v=scsp-ssf-dsp-1', import.meta.url))
		.then((response) => {
			if (!response.ok) throw new Error(`SSF player WASM HTTP ${response.status}`);
			return response.arrayBuffer();
		})
		.catch((error) => {
			binaryPromise = null;
			throw error;
		});
	return binaryPromise;
}

function flattenedContainer(ram) {
	// The loader already verified every source CRC and dependency. A single
	// local PSFv11 carries the merged image into Mednafen without filesystem libs.
	const program = new Uint8Array(4 + RAM_BYTES);
	program.set(ram, 4);
	const compressed = zlibSync(program);
	const bytes = new Uint8Array(16 + compressed.length);
	bytes.set([0x50, 0x53, 0x46, 0x11]);
	const view = new DataView(bytes.buffer);
	view.setUint32(8, compressed.length, true);
	view.setUint32(12, scspSsfCrc32(compressed), true);
	bytes.set(compressed, 16);
	return bytes;
}

/** Each renderer owns one WASM module because Mednafen's sound machine is
 * global within a module. Concurrent candidates and seeks remain independent.
 * The Synth's authored SCSP and its RAM are owned by the separate editor.
 */
export async function createScspSsfRenderer(
	source,
	{ signal, moduleFactory = createSsfPlayerModule, wasmBinary } = {},
) {
	check(signal);
	if (
		source?.kind !== 'ssf' ||
		!(source.ram instanceof Uint8Array) ||
		source.ram.length !== RAM_BYTES
	)
		throw new TypeError('SSF rendering requires a prepared 512 KiB sound-RAM image');
	const total = source.totalSamples;
	if (total !== null && (!Number.isSafeInteger(total) || total < 0))
		throw new TypeError('SSF duration must be a safe sample count or null');
	const length = source.lengthSeconds;
	if (length !== null && (!Number.isFinite(length) || length < 0))
		throw new TypeError('SSF length must be finite seconds or null');
	const volume = source.volume ?? 1;
	if (!Number.isFinite(volume)) throw new TypeError('SSF volume must be finite');
	const fadeStart = length === null ? Infinity : Math.round(length * RATE);
	const bytes = flattenedContainer(source.ram);
	const binary = wasmBinary ?? (await getBinary());
	check(signal);
	const module = await moduleFactory({ wasmBinary: binary });
	check(signal);
	const abi=module._ssf_abi_version();
	if (![3,4].includes(abi)||abi===4&&typeof module._ssf_read_dsp_snapshot!=='function') throw new Error('Unsupported SSF renderer ABI');
	let input = 0,
		leftPointer = 0,
		rightPointer = 0,
		renderer = 0,
		snapshotWords = 0,
		snapshotRam = 0,
		dspWords = 0,
		editWords = 0,
		cachedSnapshot = null;
	let framesRendered = 0,
		ended = total === 0,
		disposed = false;
	const error = () =>
		new Error(module.UTF8ToString(module._ssf_last_error()) || 'SSF rendering failed');
	function dispose() {
		if (disposed) return;
		disposed = true;
		if (renderer) module._ssf_destroy(renderer);
		if (leftPointer) module._free(leftPointer);
		if (rightPointer) module._free(rightPointer);
		if (snapshotWords) module._free(snapshotWords);
		if (snapshotRam) module._free(snapshotRam);
		if (dspWords) module._free(dspWords);
		if (editWords) module._free(editWords);
		cachedSnapshot = null;
		snapshotWords = snapshotRam = dspWords = editWords = 0;
		renderer = leftPointer = rightPointer = 0;
	}
	try {
		input = module._malloc(bytes.length);
		if (!input) throw new Error('SSF container allocation failed');
		module.HEAPU8.set(bytes, input);
		renderer = module._ssf_create(input, bytes.length);
		if (!renderer) throw error();
		leftPointer = module._malloc(MAX_FRAMES * 4);
		rightPointer = module._malloc(MAX_FRAMES * 4);
		if (!leftPointer || !rightPointer) throw new Error('SSF output allocation failed');
		check(signal);
	} catch (failure) {
		dispose();
		throw failure;
	} finally {
		if (input) module._free(input);
	}
	function process(left, right, frames) {
		if (disposed) throw new Error('SSF renderer is disposed');
		if (
			!(left instanceof Float32Array) ||
			!(right instanceof Float32Array) ||
			!Number.isInteger(frames) ||
			frames < 0 ||
			frames > MAX_FRAMES ||
			frames > Math.min(left.length, right.length)
		)
			throw new RangeError('Invalid SSF output buffers');
		left.fill(0, 0, frames);
		right.fill(0, 0, frames);
		if (ended || frames === 0) return 0;
		const count = total === null ? frames : Math.min(frames, total - framesRendered);
		const produced = module._ssf_render(renderer, leftPointer, rightPointer, count);
		if (produced < 0 || produced > count) throw error();
		// Native render can grow memory. Acquire the current heap after each call.
		const heap = module.HEAPF32;
		for (let frame = 0; frame < produced; frame++) {
			const position = framesRendered + frame;
			const fade =
				total !== null && total > fadeStart && position >= fadeStart
					? (total - position) / (total - fadeStart)
					: 1;
			const gain = volume * fade;
			const l = heap[(leftPointer >> 2) + frame] * gain;
			const r = heap[(rightPointer >> 2) + frame] * gain;
			if (!Number.isFinite(l) || !Number.isFinite(r))
				throw new Error('SSF renderer produced non-finite PCM');
			left[frame] = l;
			right[frame] = r;
			if (!Number.isFinite(left[frame]) || !Number.isFinite(right[frame]))
				throw new Error('SSF relative volume exceeds finite PCM range');
		}
		framesRendered += produced;
		ended =
			produced < count ||
			Boolean(module._ssf_ended(renderer)) ||
			(total !== null && framesRendered >= total);
		return produced;
	}
	function readSnapshot() {
		if (disposed) throw new Error('SSF renderer is disposed');
		const frame = module._ssf_native_frame(renderer);
		if (cachedSnapshot?.frame === frame) return cachedSnapshot;
		if (!snapshotWords) snapshotWords = module._malloc(SCSP_SSF_SNAPSHOT_WORDS * 4);
		if (!snapshotRam) snapshotRam = module._malloc(RAM_BYTES);
		if (!snapshotWords || !snapshotRam) throw new Error('SSF observation allocation failed');
		if (
			!module._ssf_read_snapshot(
				renderer,
				snapshotWords,
				SCSP_SSF_SNAPSHOT_WORDS,
				snapshotRam,
				RAM_BYTES,
			)
		)
			throw new Error('SSF observation is unavailable');
		const words = new Uint32Array(
			module.HEAPU8.buffer,
			snapshotWords,
			SCSP_SSF_SNAPSHOT_WORDS,
		).slice();
		const ram = module.HEAPU8.slice(snapshotRam, snapshotRam + RAM_BYTES);
		const snapshot=decodeScspSsfSnapshot(words,ram);
		if(abi===4){
			if(!dspWords)dspWords=module._malloc(SCSP_SSF_DSP_SNAPSHOT_WORDS*4);
			if(!dspWords)throw new Error('SSF DSP observation allocation failed');
			if(!module._ssf_read_dsp_snapshot(renderer,dspWords,SCSP_SSF_DSP_SNAPSHOT_WORDS))throw new Error('SSF DSP observation is unavailable');
			snapshot.dsp=decodeScspSsfDspSnapshot(new Uint32Array(module.HEAPU8.buffer,dspWords,SCSP_SSF_DSP_SNAPSHOT_WORDS),snapshot.frame);
		}
		cachedSnapshot = snapshot;
		return cachedSnapshot;
	}
	function editVoice(slot, method, patch) {
		if (disposed) throw new Error('SSF renderer is disposed');
		if (!Number.isInteger(slot) || slot < 0 || slot > 31)
			throw new RangeError('SSF slot must be an integer from 0 to 31');
		const edits = encodeScspSsfVoiceEdit(method, patch);
		if (edits.length) {
			if (!editWords) editWords = module._malloc(9 * 4);
			if (!editWords) throw new Error('SSF edit allocation failed');
			new Uint32Array(module.HEAPU8.buffer, editWords, edits.length).set(edits);
			if (!module._ssf_edit_voice(renderer, slot, editWords, edits.length / 3)) throw error();
			// Host writes change registers without advancing the native clock.
			cachedSnapshot = null;
		}
		return { frame: framesRendered, nativeFrame: module._ssf_native_frame(renderer) };
	}
	return {
		process,
		readSnapshot,
		editVoice,
		dispose,
		get framesRendered() {
			return framesRendered;
		},
		get ended() {
			return ended;
		},
	};
}
