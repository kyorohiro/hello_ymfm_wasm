// SPDX-License-Identifier: BSD-3-Clause
import { CH5 } from './ch5.js';
import { VSU_CHANNEL_COUNT } from './vsu.js';

const NOISE_CHANNEL = VSU_CHANNEL_COUNT - 1;
const voiceChannels = Object.freeze({
	wave: Object.freeze(Array.from({ length: NOISE_CHANNEL }, (_, channel) => channel)),
	effect: Object.freeze([CH5]),
	noise: Object.freeze([NOISE_CHANNEL]),
});

export const VSU_AUTO_SOURCES = Object.freeze(Object.keys(voiceChannels));

export function vsuAutoSourceForChannel(channel, ch5) {
	if (!Number.isInteger(channel) || channel < 0 || channel >= VSU_CHANNEL_COUNT)
		throw new RangeError('Choose a VSU channel from 0 to 5.');
	if (channel === NOISE_CHANNEL) return 'noise';
	if (channel === CH5 && (ch5?.mode === 'sweep' || ch5?.mode === 'modulation')) return 'effect';
	return 'wave';
}

export function vsuAutoVoiceChannels(source) {
	if (!VSU_AUTO_SOURCES.includes(source)) throw new RangeError('Choose Wave, Sweep / Modulation, or Noise.');
	return voiceChannels[source];
}

export function vsuAutoChannel(source, waveChannel = 0) {
	const channels = vsuAutoVoiceChannels(source);
	if (source !== 'wave') return channels[0];
	if (!channels.includes(waveChannel)) throw new RangeError('Choose a Wave channel from CH1 to CH5.');
	return waveChannel;
}
