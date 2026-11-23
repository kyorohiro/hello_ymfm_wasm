// SPDX-License-Identifier: BSD-3-Clause
import { CH5, decodeCh5Settings } from './ch5.js';
import { decodeVsuEnvelope } from './envelope.js';
import { validateVsuPatch } from './patch.js?v=vsu-noise';
import { VSU_CHANNEL_COUNT, VSU_WAVE_BANK_COUNT, VSU_WAVE_LENGTH } from './vsu.js';

const NOISE_CHANNEL = VSU_CHANNEL_COUNT - 1;

function captureBank(patch, channel, wave) {
	const current = patch.channels[channel].wave;
	const matches = bank => bank.every((sample, index) => sample === wave[index]);
	if (matches(patch.banks[current])) return current;
	const matching = patch.banks.findIndex(matches);
	if (matching >= 0) return matching;

	const used = new Set(patch.channels.filter((voice, index) => index !== channel && voice.wave !== null)
		.map(voice => voice.wave));
	if (!used.has(current)) return current;
	// Five wave voices and five banks guarantee a free bank when the
	// current voice shares its bank with any other voice.
	return patch.banks.findIndex((_, index) => !used.has(index));
}

export function captureVsuVoice(source, snapshot) {
	const { channel, active, waveBank, wave, left, right, ev0, ev1, swp, modulation, frequency, interval } = snapshot ?? {};
	if (!Number.isInteger(channel) || channel < 0 || channel >= VSU_CHANNEL_COUNT)
		throw new RangeError('Choose a VSU channel to copy.');
	if (active !== true) throw new Error('Choose a channel that is active in the paused VGM.');

	const patch = validateVsuPatch(source);
	const envelope = decodeVsuEnvelope(ev0, ev1);
	let bank = null;
	if (channel === NOISE_CHANNEL) {
		patch.noiseTap = (ev1 >> 4) & 7;
		patch.noise = { keyTracking: false, frequency, interval: interval ?? null };
	} else {
		if (!Number.isInteger(waveBank) || waveBank < 0 || waveBank >= VSU_WAVE_BANK_COUNT ||
			(!Array.isArray(wave) && !ArrayBuffer.isView(wave)) || wave.length !== VSU_WAVE_LENGTH)
			throw new Error('The captured voice needs a valid VSU wave bank.');
		bank = captureBank(patch, channel, wave);
		patch.banks[bank] = Array.from(wave);
	}
	patch.channels[channel] = { wave: bank, left, right, envelope };
	if (channel === CH5) patch.ch5 = decodeCh5Settings(ev1, swp, modulation);

	return { patch: validateVsuPatch(patch), channel, bank };
}
