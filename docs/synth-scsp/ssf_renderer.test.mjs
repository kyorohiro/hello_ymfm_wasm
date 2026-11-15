import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createScspSsfPlaybackFixture } from '../../test/helpers/scsp_ssf_fixture.mjs';
import { prepareScspSsfSource } from './ssf_source.js';
import { createScspSsfRenderer } from './ssf_renderer.js';
import { checkSsfPlayerSources } from '../../scripts/build_ssf_player.mjs';

const wasmBinary = await readFile(
	new URL('../generated/ssf-player/ssf_player.wasm', import.meta.url),
);
const fixture = createScspSsfPlaybackFixture();
const prepared = await prepareScspSsfSource(fixture.standaloneFiles, '/ssf/standalone.ssf');
const create = (source) => createScspSsfRenderer(source, { wasmBinary });

function output(renderer, count) {
	const left = new Float32Array(count),
		right = new Float32Array(count);
	const produced = renderer.process(left, right, count);
	assert(produced >= 0 && produced <= count);
	assert(left.every(Number.isFinite) && right.every(Number.isFinite));
	return { left, right, produced };
}

test('SSF playback vendor files retain pinned source hashes and GPL provenance', async () => {
	const source = await checkSsfPlayerSources();
	assert.equal(source.commit, 'a28e0d7e14a3dc04a486ea26f30bc52edad3dc4d');
	assert.equal(source.license, 'GPL-2.0-or-later');
	assert(source.files.length > 100);
	assert(!source.files.some((file) => /font18x18ko|font12x13ja/.test(file.path)));
});

test('actual 68000 program configures SCSP PCM, renders finite audio and ends at the exact tagged frame', async () => {
	const renderer = await create(prepared);
	try {
		let frames = 0,
			peak = 0;
		while (!renderer.ended) {
			const { left, right, produced } = output(renderer, 2048);
			frames += produced;
			for (let index = 0; index < produced; index++)
				peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
			assert(produced > 0);
		}
		assert.equal(frames, prepared.totalSamples);
		assert.equal(renderer.framesRendered, prepared.totalSamples);
		assert(peak > 0.1 && peak <= 1);
		const tail = output(renderer, 16);
		assert.equal(tail.produced, 0);
		assert(tail.left.every((value) => value === 0));
	} finally {
		renderer.dispose();
		renderer.dispose();
	}
	assert.throws(() => renderer.process(new Float32Array(1), new Float32Array(1), 1), /disposed/);
});

test('independent WASM machines can coexist and disposal leaves the other decoder running', async () => {
	const first = await create(prepared);
	const mini = await prepareScspSsfSource(fixture.files, '/ssf/Demo/track.minissf');
	const second = await create(mini);
	try {
		const a = output(first, 8192),
			b = output(second, 8192);
		assert(a.left.some((value) => value !== 0));
		assert(b.left.some((value) => value !== 0));
		assert.notDeepEqual(a.left, b.left);
		first.dispose();
		const later = output(second, 1024);
		assert(later.left.some((value) => value !== 0));
		assert.equal(second.framesRendered, 9216);
	} finally {
		first.dispose();
		second.dispose();
	}
});

test('relative volume including negative polarity and sample-exact software fade preserve the native waveform', async () => {
	const dry = await create({
		...prepared,
		lengthSeconds: prepared.durationSeconds,
		fadeSeconds: 0,
	});
	const faded = await create({ ...prepared, volume: -0.5 });
	try {
		let position = 0;
		while (!dry.ended) {
			const a = output(dry, 2048),
				b = output(faded, 2048);
			assert.equal(a.produced, b.produced);
			for (let index = 0; index < a.produced; index += 31) {
				const frame = position + index;
				const fade = frame >= 88200 ? (prepared.totalSamples - frame) / 11025 : 1;
				assert(Math.abs(b.left[index] - a.left[index] * -0.5 * fade) < 1e-7);
			}
			position += a.produced;
		}
		assert(faded.ended);
	} finally {
		dry.dispose();
		faded.dispose();
	}
});

test('unknown durations remain streaming and aborted or malformed sources fail before module creation', async () => {
	const renderer = await create({
		...prepared,
		lengthSeconds: null,
		durationSeconds: null,
		totalSamples: null,
	});
	try {
		assert.equal(output(renderer, 512).produced, 512);
		assert.equal(renderer.ended, false);
		assert.throws(
			() => renderer.process(new Float32Array(1), new Float32Array(1), 2),
			/buffers/,
		);
	} finally {
		renderer.dispose();
	}
	let calls = 0;
	const moduleFactory = () => {
		calls++;
		throw new Error('Module should not be created');
	};
	await assert.rejects(
		createScspSsfRenderer({ ...prepared, ram: new Uint8Array(5) }, { moduleFactory }),
		/512 KiB/,
	);
	await assert.rejects(
		createScspSsfRenderer({ ...prepared, volume: Infinity }, { moduleFactory }),
		/finite/,
	);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		createScspSsfRenderer(prepared, { signal: controller.signal, moduleFactory }),
		{ name: 'AbortError' },
	);
	assert.equal(calls, 0);
});
