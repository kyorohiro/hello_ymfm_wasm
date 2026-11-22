// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTwoSfWaveformMonitor } from './2sf-live-view.js';
import { buildTwoSfWaveform } from './2sf-waveform.js';
import { decodeNdsAdpcm } from './nds-core.js';

test('2SF live ADPCM waveform shows the recorded nibbles and bounds long previews', () => {
	const bytes = new Uint8Array(16);
	bytes.set([0x22, 0xfa, 13, 0, 0x19, 0x74, 0x78, 0xaf, 0x33, 0x51, 0xab], 0);
	const decoded = decodeNdsAdpcm(bytes);
	const waveform = buildTwoSfWaveform(bytes, 'adpcm');
	assert.equal(waveform.frameCount, decoded.length);
	assert.equal(waveform.previewFrames, decoded.length);
	assert.deepEqual(waveform.peaks, Float32Array.from(Array.from(decoded).flatMap(value => [value / 32768, value / 32768])));

	const long = new Uint8Array(1024 * 1024);
	long.set(bytes);
	const preview = buildTwoSfWaveform(long, 'adpcm');
	assert.equal(preview.frameCount, (long.length - 4) * 2);
	assert.equal(preview.previewFrames, 32768);
	assert.equal(preview.peaks.length, 512);
});

test('2SF waveform requests are bounded and stale replies cannot repaint a new channel', async t => {
	let now = 0, changes = 0;
	t.mock.method(performance, 'now', () => now);
	const pending = [];
	const monitor = createTwoSfWaveformMonitor({
		readWaveform: (...args) => new Promise(resolve => pending.push({ args, resolve })),
		onChange: () => changes++,
	});
	const voice = { active: true, mode: 'adpcm', byteLength: 16, sampleAddress: 0x02000000 };
	const select = (channel, frame) => monitor.sample({ path: 'song.mini2sf', channel, voice, frame });
	const settle = () => new Promise(resolve => setImmediate(resolve));
	assert.equal(select(0, 16), null);
	assert.deepEqual(pending[0].args, [0, 16, 'adpcm', undefined]);
	assert.equal(select(1, 20), null);
	assert.equal(pending.length, 1);
	const waveform = buildTwoSfWaveform(new Uint8Array(16), 'adpcm');
	pending[0].resolve({ revision: 1, waveform });
	await settle();
	assert.equal(changes, 0);
	now = 250;
	assert.equal(select(1, 20), null);
	pending[1].resolve({ revision: 2, waveform });
	await settle();
	assert.equal(changes, 1);
	assert.equal(select(1, 25), waveform);
	now = 500;
	assert.equal(select(1, 30), waveform);
	assert.deepEqual(pending[2].args, [1, 30, 'adpcm', 2]);
	pending[2].resolve({ revision: 2 });
	await settle();
	assert.equal(changes, 1);
});
