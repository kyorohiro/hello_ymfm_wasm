// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import { captureVsuVoice } from './capture.js';
import { CH5, ch5ControlWrites, createCh5Settings } from './ch5.js';
import { createVsuEnvelope, decodeVsuEnvelope, envelopeLevels, envelopeStepMs, vsuEnvelopeRegisterValues } from './envelope.js';
import { createDefaultVsuPatch, createLegacyVsuNoiseSettings, validateVsuPatch, VSU_PATCH_FORMAT } from './patch.js';

function originalPatch() {
	return {
		format: VSU_PATCH_FORMAT, version: 1,
		banks: Array.from({ length: 5 }, (_, index) => Array(32).fill(index + 1)),
		channels: Array.from({ length: 6 }, (_, index) => ({ wave: index === 5 ? null : index, left: 12, right: 8 })),
		noiseTap: 2, ch5: createCh5Settings(),
	};
}

function snapshot(overrides = {}) {
	return {
		channel: 0, active: true, waveBank: 4,
		wave: Array.from({ length: 32 }, (_, index) => index * 2),
		left: 3, right: 7, ev0: 0xec, ev1: 3, swp: 0, modulation: null, frequency: 1550, ...overrides,
	};
}

test('EV0/EV1 decode and curve preserve the envelope timing independently of shared bits', () => {
	assert.deepEqual(vsuEnvelopeRegisterValues(createVsuEnvelope()), { ev0: 0xf0, ev1: 0 });
	const grow = decodeVsuEnvelope(0xef, 0x73);
	assert.deepEqual(grow, { initial: 14, rate: 7, direction: 'up', enabled: true, repeat: true });
	assert.deepEqual(vsuEnvelopeRegisterValues(grow), { ev0: 0xef, ev1: 3 });
	assert.equal(envelopeStepMs(grow), 122.88);
	assert.deepEqual(envelopeLevels(grow), [14, 15, 14]);
	assert.deepEqual(envelopeLevels(decodeVsuEnvelope(0x20, 1)), [2, 1, 0, 0]);
	assert.deepEqual(envelopeLevels(decodeVsuEnvelope(0x20, 2)), [2, 2]);
});

test('old patches load the original fixed envelope for each channel', () => {
	const source = originalPatch();
	const patch = validateVsuPatch(source);
	assert.equal(patch.version, 1);
	assert.deepEqual(patch.channels.map(voice => voice.envelope),
		Array.from({ length: 6 }, () => createVsuEnvelope()));
	patch.channels[0].envelope.initial = 3;
	assert.equal(patch.channels[1].envelope.initial, 15);
	assert.equal(validateVsuPatch(JSON.parse(JSON.stringify(patch))).channels[0].envelope.initial, 3);
	assert.throws(() => validateVsuPatch({ ...source, channels: [{ ...source.channels[0], envelope: null }, ...source.channels.slice(1)] }),
		/Envelope initial level/);
});

test('noise settings round trip and remain optional for earlier patches', () => {
	const patch = createDefaultVsuPatch();
	assert.deepEqual(patch.noise, { keyTracking: false, frequency: 0x7f0, interval: null });
	assert.deepEqual(createLegacyVsuNoiseSettings(), { keyTracking: true, frequency: 0x7f0, interval: null });
	assert.equal(Object.hasOwn(validateVsuPatch(originalPatch()), 'noise'), false);
	for (const noise of [patch.noise, { keyTracking: true, frequency: 0, interval: 0 },
		{ keyTracking: false, frequency: 0x7ff, interval: 31 }]) {
		assert.deepEqual(validateVsuPatch(JSON.parse(JSON.stringify({ ...patch, noise }))).noise, noise);
	}
	assert.throws(() => validateVsuPatch({ ...patch, noise: { ...patch.noise, keyTracking: 1 } }), /key tracking/);
	assert.throws(() => validateVsuPatch({ ...patch, noise: { ...patch.noise, frequency: 0x800 } }), /Noise frequency/);
	assert.throws(() => validateVsuPatch({ ...patch, noise: { ...patch.noise, interval: 32 } }), /Noise interval/);
});

test('capture uses a spare or identical bank without altering other authored voices', () => {
	const source = originalPatch();
	source.channels[0].wave = 1;
	const captured = snapshot();
	const { patch, channel, bank } = captureVsuVoice(source, captured);
	assert.equal(channel, 0);
	assert.equal(bank, 0);
	assert.equal(source.channels[0].wave, 1);
	assert.equal(source.banks[0][1], 1);
	assert.deepEqual(patch.channels[0],
		{ wave: 0, left: 3, right: 7, envelope: decodeVsuEnvelope(0xec, 3) });
	assert.deepEqual(patch.banks[0], captured.wave);
	assert.deepEqual(patch.banks.slice(1), source.banks.slice(1));
	assert.deepEqual(patch.channels.slice(1), validateVsuPatch(source).channels.slice(1));

	const matching = captureVsuVoice(source, snapshot({ wave: source.banks[2] }));
	assert.equal(matching.bank, 2);
	assert.deepEqual(matching.patch.banks, source.banks);

	const privateBank = captureVsuVoice(originalPatch(), snapshot({ channel: 3 }));
	assert.equal(privateBank.bank, 3);
	assert.throws(() => captureVsuVoice(source, snapshot({ active: false })), /active/);
	assert.throws(() => captureVsuVoice(source, snapshot({ waveBank: 7 })), /valid VSU wave bank/);
	assert.throws(() => captureVsuVoice(source, snapshot({ wave: Array(32).fill(64) })), /Wave sample/);
});

test('capture keeps CH5 signed offsets and CH6 noise settings with their original envelope bits', () => {
	const source = originalPatch();
	const modulation = [0, -128, -127, 127, ...Array(28).fill(0)];
	const captured = captureVsuVoice(source, snapshot({ channel: CH5, ev1: 0x73, swp: 0xa9, modulation })).patch;
	assert.deepEqual(captured.ch5, {
		mode: 'modulation', clock: 'slow', rate: 2, direction: 'up', shift: 1, repeat: true, modulation,
	});
	assert.deepEqual(ch5ControlWrites(captured.ch5, vsuEnvelopeRegisterValues(captured.channels[CH5].envelope).ev1),
		[[0x51c, 0xa0], [0x514, 0x73]]);
	assert.equal(captured.noiseTap, source.noiseTap);

	const noiseSnapshot = snapshot({ channel: 5, ev1: 0x51, wave: null, waveBank: null, interval: 0 });
	const noise = captureVsuVoice(captured, noiseSnapshot);
	assert.equal(noise.bank, null);
	assert.equal(noise.patch.noiseTap, 5);
	assert.deepEqual(noise.patch.noise, { keyTracking: false, frequency: 1550, interval: 0 });
	assert.equal(captureVsuVoice(captured, { ...noiseSnapshot, interval: undefined }).patch.noise.interval, null);
	assert.deepEqual(noise.patch.banks, captured.banks);
	assert.deepEqual(noise.patch.ch5, captured.ch5);
	assert.deepEqual(vsuEnvelopeRegisterValues(noise.patch.channels[5].envelope), { ev0: 0xec, ev1: 1 });
});
