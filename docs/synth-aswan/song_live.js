// SPDX-License-Identifier: BSD-3-Clause
import { createDefaultPreset, readPreset } from './preset.js';

/** Passive projection onto the same Synth fields. Unknown RAM is explicitly
 * flagged; default placeholders must not be presented as recovered samples. */
export function aswanSongLiveView(snapshot, channel) {
	if (!Number.isInteger(channel) || channel < 0 || channel > 3)
		throw new RangeError('ASWAN channel must be 0..3');
	if (
		!Array.isArray(snapshot?.registers) ||
		snapshot.registers.length !== 32 ||
		!Array.isArray(snapshot.waveforms) ||
		snapshot.waveforms.length !== 4
	)
		throw new TypeError('ASWAN Live needs a song snapshot');
	const r = snapshot.registers,
		known = snapshot.registerKnown ?? Array(32).fill(1),
		unknownFields = [],
		control = r[16];
	const preset = createDefaultPreset();
	preset.name = `VGM CH${channel + 1}`;
	preset.envelope.enabled = false;
	const source =
		channel === 1 && control & 32 ? 'pcm' : channel === 3 && control & 128 ? 'noise' : 'wave';
	preset.source = source;
	preset.wave = [...snapshot.waveforms[channel]];
	preset.left = r[8 + channel] >> 4;
	preset.right = r[8 + channel] & 15;
	preset.sweep = {
		enabled: channel === 2 && Boolean(control & 64),
		step: r[12] >= 128 ? r[12] - 256 : r[12],
		time: r[13] & 31,
	};
	preset.noise.type = r[14] & 7;
	const waveKnown = Boolean(snapshot.waveKnown?.[channel]);
	if (!waveKnown) unknownFields.push('wave');
	if (!known[8 + channel]) unknownFields.push('left', 'right');
	if (!known[16]) unknownFields.push('source', 'gate');
	if (source === 'pcm') {
		const route = r[20];
		preset.left = route & 8 ? 15 : route & 4 ? 7 : 0;
		preset.right = route & 2 ? 15 : route & 1 ? 7 : 0;
		unknownFields.push('pcm.data', 'pcm.sampleRate', 'pcm.rootNote', 'pcm.loop');
	}
	const code = r[channel * 2] | ((r[channel * 2 + 1] & 7) << 8);
	const frequency = (Math.floor(snapshot.clock / 128) * 128) / (32 * (2048 - code));
	const gate = Boolean(control & (1 << channel)),
		headphones = Boolean(r[17] & 8);
	const type =
		source === 'pcm'
			? 'Voice PCM'
			: source === 'noise'
				? 'Noise'
				: preset.sweep.enabled
					? 'Sweep'
					: 'Wave';
	const readout = `VGM CH${channel + 1} · ${type} · Gate ${gate ? 'On' : 'Off'} · ${source === 'pcm' ? `last unsigned byte ${r[9]}` : `base ${frequency.toFixed(1)} Hz`} · L ${preset.left} / R ${preset.right} · Headphones ${headphones ? 'On' : 'Off'} · sent settings, not oscillator phase`;
	return {
		preset: readPreset(preset),
		channel,
		source,
		gate,
		frequency,
		waveKnown,
		unknownFields,
		readout,
		observation: snapshot.observation,
		canCapture: source === 'noise' || (source === 'wave' && waveKnown),
	};
}
