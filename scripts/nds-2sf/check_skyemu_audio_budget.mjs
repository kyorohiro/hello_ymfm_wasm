// SPDX-License-Identifier: BSD-3-Clause
// Measure WASM rendering in Node. Browser scheduling and device I/O are separate.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { instantiateSkyEmu, SKYEMU_SAMPLE_RATE } from '../../docs/synth-nitro-ds/nds-skyemu-wasm.js';
import { makeNdsSample } from '../../docs/synth-nitro-ds/nds-synth-api.js';
import { assembleTwoSf } from './assemble.mjs';

const { values } = parseArgs({
	options: {
		wasm: { type: 'string' },
		blocks: { type: 'string' },
		song: { type: 'string', multiple: true },
		'set-root': { type: 'string' },
		help: { type: 'boolean', short: 'h' },
	},
});
if (values.help) {
	console.log('Usage: node scripts/nds-2sf/check_skyemu_audio_budget.mjs [--wasm=PATH] [--blocks=COUNT] [--song=ENTRY] [--set-root=DIR]');
	process.exit(0);
}
const blockCount = values.blocks === undefined ? undefined : Number(values.blocks);
assert(blockCount === undefined || (Number.isSafeInteger(blockCount) && blockCount > 0),
	'--blocks must be a positive integer');
assert(!values['set-root'] || values.song, '--set-root requires --song');
const wasm = await WebAssembly.compile(await readFile(values.wasm ??
	new URL('../../build/nds-2sf/skyemu-2sf.wasm', import.meta.url)));

const dsClock = 16_756_991;
const normalTimer = 65536 - Math.round(dsClock / 32768);
const maxTimer = 65535;
const sampleRateFor = timer => dsClock / (65536 - timer);
const wasmExports = new Set(WebAssembly.Module.exports(wasm).map(({ name }) => name));
const supportsAdpcmCache = wasmExports.has('nds_synth_set_adpcm_cache');

function latencyStats(times) {
	times.sort();
	const percentile = fraction => times[Math.ceil(times.length * fraction) - 1];
	return {
		p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99),
		maxMs: times.at(-1), meanMs: times.reduce((sum, ms) => sum + ms, 0) / times.length,
	};
}

function measure(render, frames, blocks, warmup, observe) {
	for (let index = 0; index < warmup; index++) assert.equal(render(), frames);
	const times = new Float64Array(blocks);
	const budgetMs = frames / SKYEMU_SAMPLE_RATE * 1000;
	let overBudget = 0;
	for (let index = 0; index < blocks; index++) {
		const start = performance.now();
		const rendered = render();
		const ms = performance.now() - start;
		assert.equal(rendered, frames);
		times[index] = ms;
		if (ms > budgetMs) overBudget++;
		observe?.();
	}
	const stats = latencyStats(times);
	return {
		frames, blocks, warmup, budgetMs, overBudget, ...stats,
		realtimeFactorP95: budgetMs / stats.p95Ms,
	};
}

function measureSynth(format, channels, timer) {
	const core = instantiateSkyEmu(wasm);
	assert.equal(core.nds_synth_open(), 1);
	const frames = 128;
	const output = core.malloc(frames * 4);
	assert(output);
	try {
		const modes = ['pcm8', 'pcm16', 'adpcm'];
		const shapes = ['sine', 'triangle', 'saw', 'square'];
		const preparedAt = performance.now();
		for (let channel = 0; channel < channels; channel++) {
			const { bytes, loopStartWords, lengthWords } = makeNdsSample(format, shapes[channel % shapes.length]);
			const transfer = core.malloc(bytes.length);
			assert(transfer);
			try {
				new Uint8Array(core.memory.buffer, transfer, bytes.length).set(bytes);
				const offset = channel * 256;
				assert.equal(core.nds_synth_upload(offset, transfer, bytes.length), 1);
				const register = channel * 16;
				const pan = channel % 2 ? 96 : 32;
				const control = (1 << 31) | (modes.indexOf(format) << 29) | (1 << 27) | (pan << 16) | 24;
				assert.equal(core.nds_synth_write(register + 4, 0x02000000 + offset), 1);
				assert.equal(core.nds_synth_write(register + 8, (loopStartWords << 16) | timer), 1);
				assert.equal(core.nds_synth_write(register + 12, lengthWords), 1);
				assert.equal(core.nds_synth_write(register, control), 1);
			} finally {
				core.free(transfer);
			}
		}
		const prepareMs = performance.now() - preparedAt;
		const timing = measure(() => core.nds_synth_render(output, frames), frames, blockCount ?? 1000, 150);
		assert(new Int16Array(core.memory.buffer, output, frames * 2).some(value => value !== 0), 'Expected an audible loop');
		return { kind: 'synth', format, channels, timer, clockedSampleRate: sampleRateFor(timer), prepareMs, ...timing };
	} finally {
		core.free(output);
		core.nds_synth_close();
	}
}

function measureColdAdpcmKeyOn(cache) {
	const core = instantiateSkyEmu(wasm);
	assert.equal(core.nds_synth_open(), 1);
	if (cache === 'disabled') assert.equal(core.nds_synth_set_adpcm_cache(0), 1);
	const bytes = new Uint8Array(1024 * 1024);
	bytes[2] = 32;
	let random = 1;
	for (let index = 4; index < bytes.length; index++) {
		random = (Math.imul(1664525, random) + 1013904223) >>> 0;
		bytes[index] = random >>> 24;
	}
	const transfer = core.malloc(bytes.length);
	assert(transfer);
	try {
		new Uint8Array(core.memory.buffer, transfer, bytes.length).set(bytes);
		assert.equal(core.nds_synth_upload(0, transfer, bytes.length), 1);
		assert.equal(core.nds_synth_write(4, 0x02000000), 1);
		assert.equal(core.nds_synth_write(8, (1 << 16) | normalTimer), 1);
		assert.equal(core.nds_synth_write(12, bytes.length / 4 - 1), 1);
		const control = (2 << 29) | (1 << 27) | (64 << 16) | 24;
		const warmup = 4, trials = 32;
		const times = new Float64Array(trials);
		const prepareFrames = 16384;
		const stepsPerTrial = Math.ceil(bytes.length * 2 / prepareFrames);
		const preparation = cache === 'preprepared' ? {
			steps: new Float64Array(trials * stepsPerTrial),
			firstSteps: new Float64Array(trials),
			totals: new Float64Array(trials),
		} : null;
		for (let index = 0; index < warmup + trials; index++) {
			assert.equal(core.nds_synth_write(0, control), 1);
			// Force a cold cache after each key-off. Neither this upload nor
			// buffer creation is part of the measured register write.
			new Uint8Array(core.memory.buffer, transfer, 1)[0] = index & 1;
			assert.equal(core.nds_synth_upload(bytes.length - 1, transfer, 1), 1);
			const trial = index - warmup;
			if (preparation) {
				let totalMs = 0;
				for (let step = 0; step < stepsPerTrial; step++) {
					const start = performance.now();
					const state = core.nds_synth_prepare_adpcm(0, bytes.length, prepareFrames);
					const ms = performance.now() - start;
					assert.equal(state, step + 1 === stepsPerTrial ? 1 : 2);
					totalMs += ms;
					if (index === 0 && step === 0) preparation.firstEverStepMs = ms;
					if (trial >= 0) {
						preparation.steps[trial * stepsPerTrial + step] = ms;
						if (step === 0) preparation.firstSteps[trial] = ms;
					}
				}
				if (trial >= 0) preparation.totals[trial] = totalMs;
			}
			const start = performance.now();
			const written = core.nds_synth_write(0, control | (1 << 31));
			const ms = performance.now() - start;
			assert.equal(written, 1);
			if (trial >= 0) times[trial] = ms;
		}
		const result = { kind: 'adpcm-key-on', cache, bytes: bytes.length, trials, warmup, ...latencyStats(times) };
		if (preparation) result.preparation = {
			framesPerStep: prepareFrames, stepsPerTrial, firstEverStepMs: preparation.firstEverStepMs,
			perStep: latencyStats(preparation.steps),
			firstStep: latencyStats(preparation.firstSteps),
			totalPerTrial: latencyStats(preparation.totals),
		};
		return result;
	} finally {
		core.free(transfer);
		core.nds_synth_close();
	}
}

async function measureSong(entry) {
	const { rom } = await assembleTwoSf(entry, { setRoot: values['set-root'] });
	const core = instantiateSkyEmu(wasm);
	const frames = 2048;
	const image = core.malloc(rom.length);
	const output = core.malloc(frames * 4);
	assert(image && output);
	try {
		new Uint8Array(core.memory.buffer, image, rom.length).set(rom);
		assert.equal(core.nds_2sf_open(image, rom.length), 1);
		let nonSilentBlocks = 0;
		const timing = measure(() => core.nds_2sf_render(output, frames), frames, blockCount ?? 160, 4, () => {
			if (new Int16Array(core.memory.buffer, output, frames * 2).some(value => value !== 0)) nonSilentBlocks++;
		});
		return { kind: '2sf', track: basename(entry), nonSilentBlocks, ...timing };
	} finally {
		core.nds_2sf_close();
		core.free(output);
		core.free(image);
	}
}

console.log(JSON.stringify({
	node: process.version, arch: process.arch, platform: process.platform, cpu: cpus()[0]?.model,
	outputRate: SKYEMU_SAMPLE_RATE,
}));
for (const format of ['pcm8', 'pcm16', 'adpcm']) {
	console.log(JSON.stringify(measureSynth(format, 4, normalTimer)));
	console.log(JSON.stringify(measureSynth(format, 16, maxTimer)));
}
console.log(JSON.stringify(measureColdAdpcmKeyOn(supportsAdpcmCache ? 'default' : 'legacy')));
if (supportsAdpcmCache) console.log(JSON.stringify(measureColdAdpcmKeyOn('disabled')));
if (wasmExports.has('nds_synth_prepare_adpcm')) console.log(JSON.stringify(measureColdAdpcmKeyOn('preprepared')));
for (const song of values.song ?? []) console.log(JSON.stringify(await measureSong(song)));
