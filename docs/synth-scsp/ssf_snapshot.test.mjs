import test from 'node:test';
import assert from 'node:assert/strict';
import {
	decodeScspSsfSnapshot,
	readScspSsfPcmPreview,
	SCSP_SSF_SNAPSHOT_WORDS,
} from './ssf_snapshot.js';

function source(bits = 16) {
	const words = new Uint32Array(SCSP_SSF_SNAPSHOT_WORDS),
		ram = new Uint8Array(512 * 1024);
	words[0] = 0x53534632;
	words[1] = 588;
	words[16] = (bits === 8 ? 16 : 0) | 0x820;
	words[17] = 0x1000;
	words[19] = 4;
	words[32] = 1;
	words[37] = 1;
	return { words, ram };
}

test('passive words decode hardware fields including raw zero-rate pitch and source flags', () => {
	const { words, ram } = source();
	words[20] = 31 | (4 << 6) | (8 << 11);
	words[21] = 15 | (7 << 5) | (9 << 10) | 0xc000;
	words[22] = 22 | 0x300;
	words[23] = (9 << 12) | (17 << 6) | 33;
	words[24] = 0x400;
	words[25] = (20 << 10) | (2 << 8) | (5 << 5) | (3 << 3) | 4 | 0x8000;
	words[27] = (7 << 13) | (21 << 8) | (4 << 5) | 10;
	const snapshot = decodeScspSsfSnapshot(words, ram),
		slot = snapshot.slots[0];
	assert.equal(snapshot.frame, 588);
	assert.equal(slot.voice.frequencyHz, 0);
	assert.deepEqual(slot.voice.envelope, {
		attackRate: 31,
		decay1Rate: 4,
		decay2Rate: 8,
		decayLevel: 7,
		releaseRate: 15,
		keyRateScaling: 9,
		loopLink: true,
	});
	assert.deepEqual(slot.voice.lfo, {
		frequencyCode: 20,
		pitchWave: 2,
		pitchDepth: 5,
		amplitudeWave: 3,
		amplitudeDepth: 4,
		reset: true,
	});
	assert.deepEqual(slot.voice.modulation, {
		depth: 9,
		xOffset: 17,
		yOffset: 33,
		writeInhibit: true,
	});
	assert.equal(slot.voice.pan, 21);
	assert.equal(slot.dsp.returnLevel, 4);
	assert.equal(slot.dsp.pan, 10);
	assert(slot.flags.envelopeBypass && slot.flags.loopLink && slot.flags.soundDirect);
});

test('raw PCM preview is signed, big endian and bounded at the programmed prefix', () => {
	const { words, ram } = source();
	ram.set([0x12, 0x34, 0xff, 0xfe, 0x80, 0, 0x7f, 0xff], 0x1000);
	let snapshot = decodeScspSsfSnapshot(words, ram);
	assert.deepEqual([...readScspSsfPcmPreview(snapshot, 0).pcm], [4660, -2, -32768, 32767]);
	assert.deepEqual([...readScspSsfPcmPreview(snapshot, 0, { maxSamples: 2 }).pcm], [4660, -2]);
	words[16] |= 16;
	ram.set([0, 127, 128, 255], 0x1000);
	snapshot = decodeScspSsfSnapshot(words, ram);
	assert.deepEqual([...readScspSsfPcmPreview(snapshot, 0).pcm], [0, 127, -128, -1]);
	words[16] |= 0x80;
	assert.equal(
		readScspSsfPcmPreview(decodeScspSsfSnapshot(words, ram), 0).reason,
		'Noise generator',
	);
	assert.throws(() => readScspSsfPcmPreview(snapshot, 32), /slot/);
	assert.throws(() => readScspSsfPcmPreview(snapshot, 0, { maxSamples: 8192 }), /length/);
});

test('raw preview follows native 20-bit address wrap, dummy RAM and PCM16 alignment', () => {
	const { words, ram } = source(8);
	ram.set([0x12, 0x34, 0xff, 0xfe], 0);
	ram.set([0x7f, 0x80], ram.length - 2);
	words[16] = 0x0820 | 16 | 7;
	words[17] = 0xfffe;
	let snapshot = decodeScspSsfSnapshot(words, ram);
	assert.deepEqual([...readScspSsfPcmPreview(snapshot, 0).pcm], [127, -128, 0, 0]);
	words[16] = 0x0820 | 16 | 15;
	snapshot = decodeScspSsfSnapshot(words, ram);
	assert.deepEqual([...readScspSsfPcmPreview(snapshot, 0).pcm], [0, 0, 18, 52]);
	words[16] &= ~16;
	words[17] = 0xffff;
	snapshot = decodeScspSsfSnapshot(words, ram);
	assert.deepEqual([...readScspSsfPcmPreview(snapshot, 0).pcm], [0, 4660, -2, 0]);
});

test('the native memory-mode flag retains direct 512 KiB addressing in the preview', () => {
	const { words, ram } = source(8);
	ram.set([1, 2, 3, 4], 0x3fffe);
	words[16] = 0x0820 | 16 | 3;
	words[17] = 0xfffe;
	const small = readScspSsfPcmPreview(decodeScspSsfSnapshot(words, ram), 0).pcm;
	words[4] = 1;
	const large = readScspSsfPcmPreview(decodeScspSsfSnapshot(words, ram), 0).pcm;
	assert.deepEqual([...small], [1, 2, 3, 4]);
	assert.deepEqual(large, small);
});
