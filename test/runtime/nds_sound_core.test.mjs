// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import { NDS_AUDIO_CLOCK, NdsSoundCore } from '../../docs/synth-nitro-ds/nds-core.js';

const rate = 48000;
const stepPerFrame = 65536 - Math.floor(NDS_AUDIO_CLOCK / rate);
const allLeft = { timer: stepPerFrame, pan: 0, volume: 127 };
const pcm8Level = (value) => value / 512;
const pcm16Level = (value) => value / 131072;
const squareLevel = pcm16Level(32767);

function render(core, length) {
	const left = new Float32Array(length);
	const right = new Float32Array(length);
	core.render(left, right);
	return { left, right };
}

test('all sixteen physical channels support word-aligned PCM and signed values', () => {
	const core = new NdsSoundCore(rate);
	const bytes = Uint8Array.from([0x80, 0xff, 0, 0x7f, ...new Uint8Array(12)]);
	for (let channel = 0; channel < 16; channel++) {
		core.configure(channel, { ...allLeft, mode: 'pcm8', bytes, loop: false });
		core.keyOn(channel);
		assert.equal(core.getState(channel).active, true);
	}
	const { left, right } = render(core, 24);
	assert.deepEqual([...left.slice(0, 8)], [0, 0, 0, -4, -16 / 512, 0, 16 * 127 / 512, 0]);
	assert(right.every((value) => value === 0));
	for (let channel = 0; channel < 16; channel++) assert.equal(core.getState(channel).active, false);
});

test('PCM16 plays the lead-in once and loops only the requested words', () => {
	const core = new NdsSoundCore(rate);
	const bytes = Buffer.alloc(24);
	const samples = [1234, -1234, 10000, -10000, 1766, -1766, 30000, -30000];
	for (let index = 0; index < samples.length; index++) bytes.writeInt16LE(samples[index], index * 2);
	bytes.writeInt16LE(32000, 16);
	core.configure(0, { ...allLeft, bytes, loopStartWords: 3, lengthWords: 1, loop: true });
	core.keyOn(0);
	const { left } = render(core, 16);
	assert.deepEqual([...left], [0, 0, 0, ...samples, 30000, -30000, 30000, -30000, 30000].map(pcm16Level));
	assert.equal(core.getState(0).active, true);
});

test('NDS ADPCM decodes low nibble first and restores predictor history at a word loop', () => {
	const core = new NdsSoundCore(rate);
	const bytes = new Uint8Array(16).fill(0x21, 4);
	new DataView(bytes.buffer).setInt16(0, 1000, true);
	core.configure(0, { ...allLeft, mode: 'adpcm', bytes, loopStartWords: 2, loop: true });
	core.keyOn(0);
	const { left } = render(core, 52);
	const decoded = [1001, 1004, 1005, 1008, 1009, 1012, 1013, 1016, 1017, 1020, 1021, 1024,
		1025, 1028, 1029, 1032, 1033, 1036, 1037, 1040, 1041, 1044, 1045, 1048];
	assert.deepEqual([...left], [...Array(11).fill(0), ...decoded, ...decoded.slice(8), decoded[8]].map(pcm16Level));
	assert.equal(core.getState(0).lengthWords, 2);
	assert.throws(() => core.configure(0, { loopStartWords: 0 }), /header word/);
	const invalid = new Uint8Array(bytes);
	invalid[2] = 89;
	assert.throws(() => core.configure(0, { bytes: invalid }), /ADPCM header/);
	const saturated = new Uint8Array(16);
	new DataView(saturated.buffer).setInt16(0, -30000, true);
	saturated[2] = 88;
	saturated[4] = 0xf1;
	core.configure(0, { bytes: saturated, loop: false });
	core.keyOn(0);
	assert.deepEqual([...render(core, 13).left.slice(11)], [-17714, -32767].map(pcm16Level));
});

test('pulse and noise use their physical channels, correct duty and a seeded 15-bit sequence', () => {
	const core = new NdsSoundCore(rate);
	assert.throws(() => core.configure(7, { mode: 'pulse' }), /8–13/);
	assert.throws(() => core.configure(14, { mode: 'pulse' }), /8–13/);
	assert.throws(() => core.configure(13, { mode: 'noise' }), /14–15/);
	assert.throws(() => core.configure(16, { mode: 'noise' }), /DS channel/);
	for (let duty = 0; duty < 8; duty++) {
		const lowCount = duty === 7 ? 8 : 7 - duty;
		core.configure(8, { ...allLeft, mode: 'pulse', duty, loop: false });
		core.keyOn(8);
		assert.deepEqual([...render(core, 9).left], [0, ...Array(lowCount).fill(-squareLevel), ...Array(8 - lowCount).fill(squareLevel)]);
		assert.equal(core.getState(8).active, true);
		core.keyOff(8);
	}
	core.configure(14, { ...allLeft, mode: 'noise', loop: false });
	core.keyOn(14);
	const sequence = render(core, 96).left;
	assert.deepEqual([...sequence.slice(0, 17)], [0, ...Array(14).fill(-squareLevel), squareLevel, squareLevel]);
	assert(sequence.includes(squareLevel) && sequence.includes(-squareLevel));
	core.keyOn(14);
	assert.deepEqual(render(core, 96).left, sequence);
});

test('samples are owned, sample changes wait for Key On and pan, volume and divider are live', () => {
	const core = new NdsSoundCore(rate);
	const bytes = Buffer.alloc(16, 0x40);
	core.configure(8, { ...allLeft, bytes, mode: 'pcm8' });
	bytes.fill(0x60);
	assert.throws(() => core.configure(8, { lengthWords: 100, volume: 0 }), /sample range/);
	core.keyOn(8);
	assert.equal(render(core, 6).left[5], pcm8Level(0x40));
	core.configure(8, { mode: 'pulse', pan: 127, volume: 64, divider: 3 });
	assert.equal(core.getState(8).playingMode, 'pcm8');
	assert.equal(core.getState(8).mode, 'pulse');
	assert.equal(core.getState(8).byteLength, 16);
	assert(!Object.hasOwn(core.getState(8), 'bytes'));
	const live = render(core, 1);
	assert.equal(live.left[0], 0);
	assert.equal(live.right[0], pcm8Level(0x40) / 32);
	core.keyOn(8);
	assert.equal(core.getState(8).playingMode, 'pulse');
	assert.equal(render(core, 2).right[1], -squareLevel / 32);
});

test('rate tracking is block-invariant at 44.1 and 48 kHz, and release differs from hardware Key Off', () => {
	for (const sampleRate of [44100, 48000]) {
		const timer = 65536 - Math.round(NDS_AUDIO_CLOCK / (440 * 8));
		const full = new NdsSoundCore(sampleRate);
		const split = new NdsSoundCore(sampleRate);
		for (const core of [full, split]) {
			core.configure(8, { ...allLeft, mode: 'pulse', timer });
			core.keyOn(8);
		}
		const frames = sampleRate / 2;
		const rendered = render(full, frames).left;
		const partitioned = new Float32Array(frames);
		for (let start = 0; start < frames; start += 137) {
			partitioned.set(render(split, Math.min(137, frames - start)).left, start);
		}
		assert.deepEqual(partitioned, rendered);
		let rises = 0;
		for (let index = 1; index < rendered.length; index++) {
			if (rendered[index - 1] < 0 && rendered[index] > 0) rises++;
		}
		assert(Math.abs(rises * 2 - 440) <= 2);
		full.configure(0, { ...allLeft, mode: 'pcm8', bytes: new Uint8Array(16).fill(64) });
		full.keyOff(8);
		full.keyOn(0);
		render(full, 16);
		full.release(0, 8);
		const ramp = render(full, Math.round(sampleRate * 0.008) + 1).left;
		assert.equal(ramp[0], pcm8Level(64));
		assert(ramp.every((value, index) => index === 0 || value <= ramp[index - 1]));
		assert.equal(ramp.at(-2), 0);
		assert.equal(ramp.at(-1), 0);
		assert.equal(full.getState(0).active, false);
		full.keyOn(0);
		render(full, 16);
		full.keyOff(0);
		assert(render(full, 8).left.every((value) => value === 0));
		full.keyOn(0);
		full.allSoundOff();
		assert.equal(full.getState(0).active, false);
	}
});
