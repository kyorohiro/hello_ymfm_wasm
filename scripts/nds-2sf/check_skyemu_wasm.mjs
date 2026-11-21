// SPDX-License-Identifier: BSD-3-Clause
// Verify the DS-only WASM against native libretro with no audio device.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTwoSfPath } from '../../docs/synth-nitro-ds/2sf_source.js';
import { assembleTwoSf } from './assemble.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const realFolder = /^--real-folder=(.+)$/.exec(args[0] ?? '')?.[1];
assert(args.length === 0 || (args.length === 1 && realFolder),
	'Usage: node scripts/nds-2sf/check_skyemu_wasm.mjs [--real-folder=PATH]');
const rate = 48000;
const snapshotWords = 1 + 16 * 5;
const wasmPath = join(root, 'build/nds-2sf/skyemu-2sf.wasm');
const wasm = new WebAssembly.Module(readFileSync(wasmPath));
assert.deepEqual(WebAssembly.Module.imports(wasm), [
	{ module: 'env', name: 'emscripten_notify_memory_growth', kind: 'function' },
]);

function openRenderer(rom) {
	const { exports: core } = new WebAssembly.Instance(wasm, {
		env: { emscripten_notify_memory_growth() {} },
	});
	core._initialize();
	const image = core.malloc(rom.length);
	const output = core.malloc(2048 * 4);
	assert(image && output, 'Allocate ROM and stereo PCM buffers');
	new Uint8Array(core.memory.buffer, image, rom.length).set(rom);
	assert.equal(core.nds_2sf_open(image, 1000), 0, 'Reject too-short ROM');
	assert.equal(core.nds_2sf_open(image, rom.length), 1, 'Boot ROM');
	assert.equal(core.nds_2sf_open(image, rom.length), 0, 'Keep existing console while open');
	core.free(image);
	assert.equal(core.nds_2sf_render(output, 0), 0, 'Reject empty render');
	assert.equal(core.nds_2sf_render(output, 2049), 0, 'Reject overlarge render');
	return { core, output };
}

function render(rom, frameCount, blockSize, snapshots) {
	const { core, output } = openRenderer(rom);
	const pcm = Buffer.alloc(frameCount * 4);
	for (let start = 0; start < frameCount; start += blockSize) {
		const count = Math.min(blockSize, frameCount - start);
		assert.equal(core.nds_2sf_render(output, count), count);
		pcm.set(new Uint8Array(core.memory.buffer, output, count * 4), start * 4);
		if (snapshots) {
			const snapshotCount = core.nds_2sf_snapshot_count();
			assert(snapshotCount <= 9, 'A render should produce a bounded number of snapshots');
			if (snapshotCount) {
				const words = new Uint32Array(core.memory.buffer, core.nds_2sf_snapshots(), snapshotCount * snapshotWords);
				for (let offset = 0; offset < words.length; offset += snapshotWords)
					snapshots.push(words.slice(offset, offset + snapshotWords));
			}
		}
	}
	core.nds_2sf_close();
	assert.equal(core.nds_2sf_render(output, 1), 0, 'Reject render after closing');
	core.free(output);
	return pcm;
}

function checkSnapshots(track, pcm, snapshots) {
	assert(snapshots.length >= 2, 'Expected a baseline and emulator-tick snapshots');
	assert.equal(snapshots[0][0], 0, 'Baseline snapshot should start at output frame zero');
	assert(snapshots.every(([frame], index) => index === 0 || frame > snapshots[index - 1][0]),
		'Snapshot positions should be strictly increasing in the 48 kHz output timeline');
	const sound = snapshots.find(row => row[1] >>> 31);
	assert(sound, 'The fixture should key on hardware CH0');
	const firstSignal = Math.floor(pcm.findIndex((byte) => byte !== 0) / 4);
	assert(firstSignal >= 0 && Math.abs(sound[0] - firstSignal) <= 1024,
		`CH0 activity should line up with the first PCM within one tick: snapshot ${sound[0]}, audio ${firstSignal}`);

	const last = snapshots.at(-1);
	const [, control, address, timerLoop, length] = last;
	const panRight = track === 'right-e5';
	assert.equal(control >>> 31, 1, 'CH0 should remain active');
	assert.equal((control >>> 29) & 3, 1, 'CH0 reads back as PCM16');
	assert.equal(control & 127, 100, 'CH0 volume should equal the authored setting');
	assert.equal((control >>> 8) & 3, 0, 'CH0 uses the unattenuated divider setting');
	assert.equal((control >>> 16) & 127, panRight ? 127 : 0, 'CH0 pan should match the selected track');
	assert.equal(address, 0x03800100, 'CH0 source should match the fixture wave address');
	assert.equal(timerLoop, panRight ? 64742 : 64346, 'CH0 timer and loop start should match the fixture');
	assert.equal(length, 16, 'CH0 loop length should match the 32 PCM16 samples');
	for (let channel = 1; channel < 16; channel++)
		assert.equal(last[1 + channel * 5] >>> 31, 0, `Hardware CH${channel} should stay idle`);
}

function checkCaptureHistory(work) {
	const fixture = fileURLToPath(new URL('./make_fixture.py', import.meta.url));
	execFileSync('python3', [fixture, work, '--history-fixture'], { timeout: 60000 });
	const rom = readFileSync(join(work, 'history-overwrite.nds'));
	const { core, output } = openRenderer(rom);
	function capture(frame) {
		const bytes = core.nds_2sf_capture(frame, 0);
		assert.equal(bytes, 64, 'Expected the entire 32-frame PCM16 sample');
		return Buffer.from(new Uint8Array(core.memory.buffer, core.nds_2sf_capture_data(), bytes));
	}
	let initial;
	try {
		for (let start = 0; start < rate; start += 2048) {
			assert.equal(core.nds_2sf_render(output, 2048), 2048);
			const words = new Uint32Array(core.memory.buffer, core.nds_2sf_snapshots(),
				core.nds_2sf_snapshot_count() * snapshotWords).slice();
			for (let offset = 0; offset < words.length; offset += snapshotWords) {
				const [frame, control, address] = words.subarray(offset, offset + snapshotWords);
				if (!(control >>> 31)) continue;
				const sample = capture(frame);
				if (!initial) {
					assert.equal(sample.readInt16LE(0), 0, 'Original source starts at the sine zero crossing');
					assert.equal(sample.readInt16LE(2), 2341, 'Original source starts with the authored PCM16 samples');
					assert.equal(core.nds_2sf_capture(frame + 1, 0), -1, 'Reject a frame with no exact snapshot');
					assert.equal(core.nds_2sf_capture(frame, 1), -2, 'Reject an idle channel');
					initial = { frame, address, sample, rewritten: false };
				} else if (!initial.rewritten && sample.readUInt32LE(0) === 0x1234abcd) {
					assert.equal(address, initial.address, 'The same source address now contains different PCM');
					assert.deepEqual(sample.subarray(4), initial.sample.subarray(4), 'Only the first PCM word changed');
					assert.deepEqual(capture(initial.frame), initial.sample, 'Older observation must keep its own PCM bytes');
					initial.rewritten = true;
				}
			}
		}
		assert(initial?.rewritten, 'Expected the playing program to rewrite its sample');
		assert.equal(core.nds_2sf_capture(initial.frame, 0), -1, 'Expired sample observations should be rejected');
	} finally {
		core.nds_2sf_close();
		core.free(output);
	}
	console.log('Capture history retains original PCM across an in-place rewrite and drops expired observations');
}

function readNativePcm(path, frames) {
	const wave = readFileSync(path);
	// Header produced by render_skyemu.c. The comparison uses only PCM.
	assert.equal(wave.readUInt32LE(24), rate);
	assert.equal(wave.readUInt16LE(22), 2);
	assert.equal(wave.readUInt16LE(34), 16);
	const pcm = wave.subarray(44);
	assert.equal(pcm.length, frames * 4);
	return pcm;
}

function checkDemo(work) {
	const checker = fileURLToPath(new URL('./check_demo.py', import.meta.url));
	execFileSync('python3', [checker, '--work-dir', work], { stdio: 'inherit', timeout: 60000 });
	const frames = rate * 2;
	for (const track of ['left-a4', 'right-e5']) {
		const rom = readFileSync(join(work, track + '.nds'));
		const native = readNativePcm(join(work, track + '.wav'), frames);
		const regular = [], small = [];
		assert(render(rom, frames, 2048, regular).equals(native), `${track}: 2048-frame blocks differed from Native PCM`);
		assert(render(rom, frames, 257, small).equals(native), `${track}: 257-frame blocks differed from Native PCM`);
		assert.deepEqual(small, regular, `${track}: snapshots changed with browser render-block size`);
		checkSnapshots(track, native, regular);
		console.log(`${track}: ${frames} stereo frames match native PCM and ${regular.length} snapshots agree across block sizes`);
	}
	checkCaptureHistory(work);
}

async function checkRealFolder(work, folder) {
	const setRoot = resolve(folder);
	const tracks = readdirSync(setRoot, { recursive: true, withFileTypes: true })
		.filter(entry => entry.isFile() && isTwoSfPath(entry.name))
		.map(entry => join(entry.parentPath, entry.name)).sort();
	assert(tracks.length, 'The selected folder contains no .2sf or .mini2sf tracks');
	const renderer = join(root, 'build/nds-2sf/render-skyemu');
	const input = join(work, 'track.nds');
	const output = join(work, 'track.wav');
	const seconds = 8;
	const frames = rate * seconds;
	let nonSilentTracks = 0;
	for (const path of tracks) {
		try {
			const { rom } = await assembleTwoSf(path, { setRoot });
			writeFileSync(input, rom);
			execFileSync(renderer, [input, output, String(seconds)], { timeout: 30000 });
			const native = readNativePcm(output, frames);
			const result = render(rom, frames, 2048);
			if (!result.equals(native)) {
				const first = native.findIndex((byte, i) => byte !== result[i]);
				const sample = first - first % 2;
				throw Error(`first PCM difference at frame ${Math.floor(sample / 4)}, channel ${sample % 4 === 0 ? 'L' : 'R'} (Native ${native.readInt16LE(sample)}, WASM ${result.readInt16LE(sample)})`);
			}
			if (native.some(byte => byte !== 0)) nonSilentTracks++;
		} catch (error) {
			throw Error(`${relative(setRoot, path)}: ${error.message}`, { cause: error });
		}
	}
	console.log(JSON.stringify({
		tracks: tracks.length, nonSilentTracks, sampleRate: rate, secondsPerTrack: seconds,
		stereoFramesCompared: frames * tracks.length, pcmBitExact: true,
	}));
}

const work = mkdtempSync(join(tmpdir(), 'tetorica-2sf-parity-'));
try {
	if (realFolder) await checkRealFolder(work, realFolder);
	else checkDemo(work);
} finally {
	rmSync(work, { recursive: true, force: true });
}
