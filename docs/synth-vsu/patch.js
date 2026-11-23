// SPDX-License-Identifier: BSD-3-Clause
import { vsuAutoVoiceChannels } from './auto-source.js';
import { createCh5Settings, validateCh5Settings } from './ch5.js';
import { createVsuEnvelope, validateVsuEnvelope } from './envelope.js';
import { createVsuWave, VSU_CHANNEL_COUNT, VSU_WAVE_BANK_COUNT, VSU_WAVE_LENGTH } from './vsu.js';

export const VSU_PATCH_FORMAT = 'tetorica-vsu-patch';

export function createLegacyVsuNoiseSettings() {
	return { keyTracking: true, frequency: 0x7f0, interval: null };
}

export function createDefaultVsuPatch() {
	return {
		format: VSU_PATCH_FORMAT, version: 1,
		banks: ['triangle', 'sine', 'square', 'saw', 'triangle'].map(shape => Array.from(createVsuWave(shape))),
		channels: Array.from({ length: VSU_CHANNEL_COUNT }, (_, index) => ({
			wave: index < VSU_WAVE_BANK_COUNT ? index : null, left: 10, right: 10, envelope: createVsuEnvelope(),
		})),
		noiseTap: 0, noise: { ...createLegacyVsuNoiseSettings(), keyTracking: false }, ch5: createCh5Settings(),
	};
}

function boundedInteger(value, min, max, name) {
	if (!Number.isInteger(value) || value < min || value > max)
		throw new Error(`${name} must be an integer from ${min} to ${max}.`);
	return value;
}

function items(value, length, name, transform) {
	if (!Array.isArray(value) || value.length !== length)
		throw new Error(`${name} must contain ${length} entries.`);
	return Array.from(value, transform);
}

function validateNoiseSettings(noise) {
	if (typeof noise?.keyTracking !== 'boolean')
		throw new Error('Noise key tracking must be on or off.');
	return {
		keyTracking: noise.keyTracking,
		frequency: boundedInteger(noise.frequency, 0, 0x7ff, 'Noise frequency register'),
		interval: noise.interval === null ? null : boundedInteger(noise.interval, 0, 31, 'Noise interval'),
	};
}

export function validateVsuPatch(patch) {
	if (patch?.format !== VSU_PATCH_FORMAT || patch.version !== 1)
		throw new Error('Choose a Tetorica VSU patch (version 1).');

	const banks = items(patch.banks, VSU_WAVE_BANK_COUNT, 'Wave RAM', (bank, index) =>
		items(bank, VSU_WAVE_LENGTH, `Wave bank ${index}`, value => boundedInteger(value, 0, 63, 'Wave sample')));
	const channels = items(patch.channels, VSU_CHANNEL_COUNT, 'Channel settings', (channel, index) => {
		if (index === VSU_CHANNEL_COUNT - 1 && channel?.wave !== null)
			throw new Error('The noise channel has no wave bank.');
		return {
			wave: index === VSU_CHANNEL_COUNT - 1 ? null : boundedInteger(channel?.wave, 0, VSU_WAVE_BANK_COUNT - 1, 'Wave bank'),
			left: boundedInteger(channel?.left, 0, 15, 'Left level'),
			right: boundedInteger(channel?.right, 0, 15, 'Right level'),
			envelope: channel.envelope === undefined ? createVsuEnvelope() : validateVsuEnvelope(channel.envelope),
		};
	});

	const { preferredSource } = patch;
	const preferredChannel = patch.preferredChannel === undefined ? undefined :
		boundedInteger(patch.preferredChannel, 0, VSU_CHANNEL_COUNT - 1, 'Preferred channel');
	if (preferredSource !== undefined && !vsuAutoVoiceChannels(preferredSource).includes(preferredChannel))
		throw new Error('The preferred source must support the preferred channel.');

	return {
		format: VSU_PATCH_FORMAT, version: 1, banks, channels,
		noiseTap: boundedInteger(patch.noiseTap, 0, 7, 'Noise tap'),
		...(patch.noise === undefined ? {} : { noise: validateNoiseSettings(patch.noise) }),
		ch5: validateCh5Settings(patch.ch5),
		...(preferredChannel === undefined ? {} : { preferredChannel }),
		...(preferredSource === undefined ? {} : { preferredSource }),
	};
}
