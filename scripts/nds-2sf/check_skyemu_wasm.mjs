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

function render(rom, frameCount, blockSize) {
	const { core, output } = openRenderer(rom);
	const pcm = Buffer.alloc(frameCount * 4);
	for (let start = 0; start < frameCount; start += blockSize) {
		const count = Math.min(blockSize, frameCount - start);
		assert.equal(core.nds_2sf_render(output, count), count);
		pcm.set(new Uint8Array(core.memory.buffer, output, count * 4), start * 4);
	}
	core.nds_2sf_close();
	assert.equal(core.nds_2sf_render(output, 1), 0, 'Reject render after closing');
	core.free(output);
	return pcm;
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
		for (const blockSize of [2048, 257])
			assert(render(rom, frames, blockSize).equals(native), `${track}: ${blockSize}-frame blocks differed from Native PCM`);
		console.log(`${track}: ${frames} stereo frames match native PCM with 2048- and 257-frame blocks`);
	}
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
