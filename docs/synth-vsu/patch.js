// SPDX-License-Identifier: BSD-3-Clause
import { validateCh5Settings } from './ch5.js';
import { VSU_CHANNEL_COUNT, VSU_WAVE_BANK_COUNT, VSU_WAVE_LENGTH } from './vsu.js';

export const VSU_PATCH_FORMAT = 'tetorica-vsu-patch';

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
		};
	});

	return {
		format: VSU_PATCH_FORMAT, version: 1, banks, channels,
		noiseTap: boundedInteger(patch.noiseTap, 0, 7, 'Noise tap'),
		ch5: validateCh5Settings(patch.ch5),
	};
}
