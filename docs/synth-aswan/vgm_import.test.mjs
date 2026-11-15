// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import {
	extractVgmInstruments,
	readAswanVgm,
	decodeAswanVgm,
	MAX_VGM_BYTES,
} from './vgm_import.js';
import { decodePcmData, readPreset } from './preset.js';
import { createWonderSwanVgm } from '../../test/helpers/wonderswan_vgm_fixture.mjs';
import {
	createWonderSwanSampleVgm,
	WONDER_SWAN_SAMPLE_WAVES,
} from '../../test/helpers/wonderswan_sample_vgm_fixture.mjs';

const fixture = (mode) => createWonderSwanVgm({ mode, seconds: 0.2, loop: false });
test('ASWAN extraction reuses written RAM analysis and retains per-channel stereo settings', async () => {
	const result = await extractVgmInstruments(createWonderSwanSampleVgm());
	assert.equal(result.voices.length, 2, 'same Wave/pan is shared across physical channels');
	assert.deepEqual(new Set(result.voices.map((voice) => voice.kind)), new Set(['wave']));
	for (const voice of result.voices) {
		assert.deepEqual(readPreset(voice.preset), voice.preset);
		assert.equal(voice.preset.envelope.enabled, false);
		assert.equal(voice.preset.left, 9);
		assert.equal(voice.preset.right, 9);
	}
	assert.deepEqual(
		result.voices[0].preset.wave,
		WONDER_SWAN_SAMPLE_WAVES[0].flatMap((value) => [value & 15, value >> 4]),
	);
	assert.equal(result.totalSamples, 3 * 44100);
});
test('ASWAN Wave, hardware Sweep CH3 and Noise CH4 become compatible strict presets', async () => {
	for (const [mode, kind, channel] of [
		['wave', 'wave', 1],
		['sweep', 'sweep', 3],
		['noise', 'noise', 4],
	]) {
		const result = await extractVgmInstruments(fixture(mode)),
			voice = result.voices[0];
		assert.equal(result.voices.length, 1);
		assert.equal(voice.kind, kind);
		assert.equal(voice.channel, channel);
		assert.equal(voice.preset.source, mode === 'noise' ? 'noise' : 'wave');
		assert.equal(voice.preset.sweep.enabled, mode === 'sweep');
		if (mode === 'sweep')
			assert.deepEqual(voice.preset.sweep, { enabled: true, step: 1, time: 4 });
		if (mode === 'noise') assert.equal(voice.preset.noise.type, 0);
	}
});
test('uniform unsigned CH2 Voice bytes preserve rate, order and route as software-fed PCM', async () => {
	const result = await extractVgmInstruments(fixture('voice')),
		voice = result.voices[0];
	assert.equal(result.voices.length, 1);
	assert.equal(voice.kind, 'pcm');
	assert.equal(voice.channel, 2);
	const pcm = decodePcmData(voice.preset.pcm.data);
	assert.equal(pcm.length, Math.ceil(8820 / 44));
	assert.deepEqual(
		[...pcm],
		Array.from({ length: pcm.length }, (_, index) => (index & 1 ? 0xe0 : 0x20)),
	);
	assert.equal(voice.preset.pcm.sampleRate, 44100 / 44);
	assert.equal(voice.preset.pcm.rootNote, 60);
	assert.equal(voice.preset.pcm.loop, false);
	assert.equal(voice.preset.left, 15);
	assert.equal(voice.preset.right, 15);
	assert.match(voice.warnings.join(' '), /last partial byte hold/);
});
test('irregular Voice writes are not guessed into a static sample, while the exact song remains valid', async () => {
	const bytes = fixture('voice');
	for (let position = 0x100; position < bytes.length - 3; position++)
		if (bytes[position] === 0x61 && bytes[position + 1] === 44) {
			bytes[position + 1] = 43;
			break;
		}
	const result = await extractVgmInstruments(bytes, { allowEmpty: true });
	assert.equal(result.voices.length, 0);
	assert.match(result.warnings.join(' '), /Irregular/);
	assert((await readAswanVgm(bytes)).totalSamples > 0);
	await assert.rejects(extractVgmInstruments(bytes), /no complete editable/);
});
test('VGM/VGZ subarrays are copied and retain the same extracted content', async () => {
	const source = fixture('wave'),
		padded = new Uint8Array(source.length + 12);
	padded.set(source, 7);
	const subarray = padded.subarray(7, 7 + source.length),
		raw = await extractVgmInstruments(subarray);
	const packed = await extractVgmInstruments(gzipSync(subarray));
	assert.deepEqual(packed, raw);
	const decoded = await decodeAswanVgm(subarray);
	decoded[0] = 0;
	assert.equal(source[0], 86);
	assert.equal(subarray[0], 86);
});
test('unknown Wave RAM is omitted rather than silently filling it from the Synth', async () => {
	const bytes = fixture('wave');
	bytes[0x100] = 0xc6;
	bytes[0x101] = 0x13;
	bytes[0x102] = 0xff;
	const result = await extractVgmInstruments(bytes, { allowEmpty: true });
	assert.equal(result.voices.length, 0);
	assert.match(result.warnings.join(' '), /incomplete wave RAM/);
});
test('mixed chips, flags, unsupported writes and truncation fail before audio or sound application', async () => {
	for (const mutate of [
		(bytes) => new DataView(bytes.buffer).setUint32(0x0c, 3579545, true),
		(bytes) => new DataView(bytes.buffer).setUint32(0xc0, 3072000 | 0x40000000, true),
		(bytes) => {
			bytes[0x100] = 0xbc;
			bytes[0x101] = 0x20;
		},
		(bytes) => new DataView(bytes.buffer).setUint32(4, bytes.length + 100, true),
	]) {
		const bytes = fixture('wave');
		mutate(bytes);
		await assert.rejects(extractVgmInstruments(bytes), /WonderSwan|VGM|truncated|offset/i);
	}
	await assert.rejects(extractVgmInstruments(new Uint8Array(MAX_VGM_BYTES + 1)), /16 MiB/);
	await assert.rejects(
		decodeAswanVgm(gzipSync(new Uint8Array(MAX_VGM_BYTES + 1))),
		/Expanded VGZ/,
	);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(extractVgmInstruments(fixture('wave'), { signal: controller.signal }), {
		name: 'AbortError',
	});
	await assert.rejects(extractVgmInstruments(fixture('wave'), { allowEmpty: 1 }), /boolean/);
});

test('uniform VGM DAC streams include same-sample output/routing setup after Voice enable', async () => {
	const commands = [
		0xbc, 0x10, 0x22, 0xbc, 0x11, 8, 0xbc, 0x14, 15, 0x67, 0x66, 0x0a, 4, 0, 0, 0, 0x20, 0x80,
		0xe0, 0x60, 0x90, 0, 0x21, 0, 9, 0x91, 0, 0x0a, 1, 0, 0x92, 0, 0x22, 0x56, 0, 0, 0x95, 0, 0,
		0, 0, 0x61, 8, 0, 0x66,
	];
	const bytes = new Uint8Array(256 + commands.length),
		view = new DataView(bytes.buffer);
	bytes.set([86, 103, 109, 32]);
	view.setUint32(4, bytes.length - 4, true);
	view.setUint32(8, 0x171, true);
	view.setUint32(0x34, 0xcc, true);
	view.setUint32(0xc0, 3072000, true);
	bytes.set(commands, 256);
	const result = await extractVgmInstruments(bytes),
		voice = result.voices[0];
	assert.equal(result.voices.length, 1);
	assert.equal(voice.kind, 'pcm');
	assert.equal(voice.preset.pcm.sampleRate, 22050);
	assert.deepEqual([...decodePcmData(voice.preset.pcm.data)], [0x20, 0x80, 0xe0, 0x60]);
	assert.equal(voice.preset.left, 15);
	assert.equal(voice.preset.right, 15);
});
