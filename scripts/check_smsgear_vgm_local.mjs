// SPDX-License-Identifier: BSD-3-Clause
// Optional local corpus audit. Game files are never copied into the repository.
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { readSmsGearVgm } from "../docs/synth-smsgear/vgm_import.js";
import { createSmsGearSongEngine } from "../docs/synth-smsgear/song_engine.js";
import opllFactory from "../docs/generated/ym2413_wasm.js";
import psgFactory from "../docs/generated/segapsg_wasm.js";
const args = process.argv.slice(2),
	outArg = args.find((a) => a.startsWith("--out="));
const dirs = args.filter((a) => !a.startsWith("--"));
if (!dirs.length)
	throw Error("Pass local VGM directories; optional --out=report.json");
const binary = async (name) =>
	new Uint8Array(
		await readFile(
			new URL(`../docs/generated/${name}_wasm.wasm`, import.meta.url),
		),
	);
const [opllBinary, psgBinary] = await Promise.all([
	binary("ym2413"),
	binary("segapsg"),
]);
const files = [];
async function walk(dir) {
	for (const item of await readdir(dir, { withFileTypes: true })) {
		const file = path.join(dir, item.name);
		if (item.isDirectory()) await walk(file);
		else if (/\.(vgm|vgz)$/i.test(item.name)) files.push(file);
	}
}
for (const dir of dirs) await walk(dir);
const results = [];
for (const file of files.sort()) {
	const result = { file };
	try {
		const plan = await readSmsGearVgm(new Uint8Array(await readFile(file)));
		let latch = 0,
			noiseWrites = 0,
			tone3Writes = 0,
			stereoWrites = 0,
			rhythmWrites = 0,
			rhythmTriggerWrites = 0;
		for (let i = 0; i < plan.events.length; i += 4) {
			const type = plan.events[i + 1],
				addr = plan.events[i + 2],
				v = plan.events[i + 3];
			if (type === 0) {
				if (v & 128) latch = (v >> 4) & 7;
				if (latch === 6) {
					noiseWrites++;
					if ((v & 3) === 3) tone3Writes++;
				}
			}
			if (type === 2) stereoWrites++;
			if (type === 1 && addr === 14 && v & 32) {
				rhythmWrites++;
				if (v & 31) rhythmTriggerWrites++;
			}
		}
		Object.assign(result, {
			seconds: plan.totalSamples / 44100,
			events: plan.events.length / 4,
			noiseWrites,
			tone3Writes,
			stereoWrites,
			rhythmWrites,
			rhythmTriggerWrites,
			rates: [],
		});
		for (const sampleRate of [44100, 48000]) {
			const make = (seekCache) =>
				createSmsGearSongEngine({
					plan,
					seekCache,
					sampleRate,
					opllFactory,
					psgFactory,
					opllBinary,
					psgBinary,
				});
			const linear = await make(false),
				sought = await make(true);
			try {
				const target = Math.min(10, result.seconds / 2),
					frames = Math.round(target * sampleRate),
					l = new Float32Array(128),
					r = new Float32Array(128);
				let peak = 0;
				linear.play();
				for (let left = frames; left > 0; ) {
					const n = Math.min(left, 128);
					linear.process(l.subarray(0, n), r.subarray(0, n));
					for (let j = 0; j < n; j++) {
						assert(Number.isFinite(l[j]) && Number.isFinite(r[j]));
						peak = Math.max(peak, Math.abs(l[j]), Math.abs(r[j]));
					}
					left -= n;
				}
				sought.beginSeek(target);
				while (sought.seeking) {
					sought.process(l, r);
					assert(l.every((v) => v === 0) && r.every((v) => v === 0));
				}
				assert.equal(sought.snapshot().frame, frames);
				assert.equal(sought.snapshot().playing, false);
				sought.play();
				const a = new Float32Array(128),
					b = new Float32Array(128);
				for (let n = 0; n < 32; n++) {
					linear.process(l, r);
					sought.process(a, b);
					assert.deepEqual(a, l);
					assert.deepEqual(b, r);
				}
				assert.deepEqual(
					sought.snapshot().opll,
					linear.snapshot().opll,
				);
				const { revision: _a, ...psgA } = sought.snapshot().psg,
					{ revision: _b, ...psgB } = linear.snapshot().psg;
				assert.deepEqual(psgA, psgB);
				// Repeat after warming the cache, against an explicitly uncached
				// reconstruction. Both variants must produce identical PCM.
				linear.pause();
				sought.pause();
				linear.beginSeek(target);
				sought.beginSeek(target);
				while (linear.seeking) linear.process(l, r);
				while (sought.seeking) sought.process(a, b);
				const cache = sought.snapshot().seekCache;
				if (cache.supported && target >= 5)
					assert(cache.restoredCheckpoints > 0);
				linear.play();
				sought.play();
				for (let n = 0; n < 32; n++) {
					linear.process(l, r);
					sought.process(a, b);
					assert.deepEqual(a, l);
					assert.deepEqual(b, r);
				}

				result.rates.push({
					sampleRate,
					targetSeconds: target,
					peak,
					seekPcmExact: true,
					cachedSeekPcmExact: true,
					cacheRestores: cache.restoredCheckpoints,
					cacheStartFrame: cache.seekStartFrame,
				});
			} finally {
				linear.dispose();
				sought.dispose();
			}
		}
		result.ok = true;
	} catch (error) {
		result.ok = false;
		result.error = error.message.slice(0, 500);
	}
	results.push(result);
}
const report = {
	files: results.length,
	passed: results.filter((r) => r.ok).length,
	results,
};
if (outArg) {
	const out = outArg.slice(6);
	await mkdir(path.dirname(out), { recursive: true });
	await writeFile(out, JSON.stringify(report, null, 2) + "\n");
}
console.log(
	JSON.stringify({
		files: report.files,
		passed: report.passed,
		failed: results
			.filter((r) => !r.ok)
			.map((r) => ({ file: r.file, error: r.error })),
		noiseTracks: results.filter((r) => r.noiseWrites).length,
		tone3Tracks: results.filter((r) => r.tone3Writes).length,
		rhythmTracks: results.filter((r) => r.rhythmWrites).length,
		rhythmTriggerTracks: results.filter((r) => r.rhythmTriggerWrites)
			.length,
		stereoTracks: results.filter((r) => r.stereoWrites).length,
	}),
);
if (report.passed !== report.files) process.exitCode = 1;
