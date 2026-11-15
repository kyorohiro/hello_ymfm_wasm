import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeScspSsfVoiceEdit, mergeScspSsfVoiceEdit } from './ssf_voice_parameters.js';

test('SSF host edit encoding groups exact hardware masks while preserving unrelated flags', () => {
	assert.deepEqual(
		[
			...encodeScspSsfVoiceEdit('setEnvelope', {
				attackRate: 21,
				decay1Rate: 12,
				decay2Rate: 7,
				releaseRate: 18,
				decayLevel: 5,
				keyRateScaling: 9,
				loopLink: true,
			}),
		],
		[8, 0xffdf, 21 | (12 << 6) | (7 << 11), 10, 0x7fff, 18 | (5 << 5) | (9 << 10) | 0x4000],
	);
	assert.deepEqual(
		[
			...encodeScspSsfVoiceEdit('setLfo', {
				frequencyCode: 31,
				pitchWave: 3,
				pitchDepth: 7,
				amplitudeWave: 3,
				amplitudeDepth: 7,
				reset: true,
			}),
		],
		[18, 0xffff, 0xffff],
	);
	assert.deepEqual(
		[...encodeScspSsfVoiceEdit('setMix', { totalLevel: 24, directLevel: 7, pan: 31 })],
		[12, 255, 24, 22, 0xff00, 0xff00],
	);
	assert.deepEqual(
		[...encodeScspSsfVoiceEdit('setEnvelope', { loopLink: false })],
		[10, 0x4000, 0],
	);
	assert.deepEqual([...encodeScspSsfVoiceEdit('setMix', {})], []);
});
test('SSF host edit validates complete patches without coercion or unknown fields', () => {
	for (const [method, patch] of [
		['setEnvelope', { attackRate: 32 }],
		['setEnvelope', { keyRateScaling: 16 }],
		['setEnvelope', { loopLink: 1 }],
		['setLfo', { reset: 0 }],
		['setLfo', { frequencyCode: 32 }],
		['setLfo', { pitchWave: 4 }],
		['setLfo', { amplitudeDepth: 8 }],
		['setMix', { pan: 32 }],
		['setMix', { directLevel: 8 }],
		['setMix', { totalLevel: -1 }],
		['setMix', { totalLevel: 1.5 }],
		['setMix', { totalLevel: '1' }],
		['setMix', { pan: NaN }],
		['setMix', { directLevel: 7, modulation: { depth: 0 } }],
		['keyOn', {}],
		['constructor', {}],
		['setEnvelope', null],
		['setMix', []],
		['setMix', { [Symbol('pan')]: 1 }],
	])
		assert.throws(() => encodeScspSsfVoiceEdit(method, patch), TypeError);
});
test('SSF journal merges only a validated parameter block and leaves the observed voice immutable', () => {
	const voice = {
		totalLevel: 12,
		pan: 6,
		directLevel: 5,
		envelope: { attackRate: 31, loopLink: false },
		lfo: { reset: false },
		modulation: { depth: 5 },
	};
	const original = structuredClone(voice);
	const merged = mergeScspSsfVoiceEdit(voice, 'setEnvelope', { attackRate: 20, loopLink: true });
	assert.equal(merged.envelope.attackRate, 20);
	assert.equal(merged.envelope.loopLink, true);
	assert.deepEqual(merged.modulation, voice.modulation);
	assert.notEqual(merged.modulation, voice.modulation);
	assert.deepEqual(voice, original);
	assert.throws(() => mergeScspSsfVoiceEdit(voice, 'setMix', { totalLevel: 256 }), TypeError);
	assert.deepEqual(voice, original);
});
