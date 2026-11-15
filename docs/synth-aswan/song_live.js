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
		snapshot.waveforms.length !== 4 ||
		!snapshot.registers.every(
			(value) => Number.isInteger(value) && value >= 0 && value <= 255,
		) ||
		!Number.isFinite(snapshot.clock) ||
		snapshot.clock < 128 ||
		snapshot.clock > 100000000
	)
		throw new TypeError('ASWAN Live needs a song snapshot');
	const r = snapshot.registers,
		known = snapshot.registerKnown ?? Array(32).fill(0),
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
	const periodKnown = Boolean(known[channel * 2] && known[channel * 2 + 1]);
	if (!periodKnown) unknownFields.push('frequency');
	if (!known[17]) unknownFields.push('output');
	if (preset.sweep.enabled && (!known[12] || !known[13])) unknownFields.push('sweep');
	if (source === 'noise' && !known[14]) unknownFields.push('noise');
	const frequency = periodKnown
		? (Math.floor(snapshot.clock / 128) * 128) / (32 * (2048 - code))
		: null;
	const gate = known[16] ? Boolean(control & (1 << channel)) : null,
		headphones = Boolean(r[17] & 8);
	const type =
		source === 'pcm'
			? 'Voice PCM'
			: source === 'noise'
				? 'Noise'
				: preset.sweep.enabled
					? 'Sweep'
					: 'Wave';
	const readout = `VGM CH${channel + 1} · ${type} · Gate ${gate === null ? 'Unknown' : gate ? 'On' : 'Off'} · ${source === 'pcm' ? `last unsigned byte ${r[9]}` : `base ${frequency === null ? 'Unknown' : frequency.toFixed(1)} Hz`} · L ${preset.left} / R ${preset.right} · Headphones ${headphones ? 'On' : 'Off'} · sent settings, not oscillator phase`;
	const required = [16, 17, 8 + channel, channel * 2, channel * 2 + 1];
	if (preset.sweep.enabled) required.push(12, 13);
	if (source === 'noise') required.push(14);
	let captureReason =
		source === 'pcm'
			? 'Transient Voice PCM has no recovered sample; use an extracted PCM preset.'
			: required.some((index) => !known[index])
				? 'The selected voice has incomplete recorded mode, pitch, volume or effect settings.'
				: source === 'wave' && !waveKnown
					? 'The selected voice has incomplete written Wave RAM.'
					: source === 'noise' && !(r[14] & 16)
						? 'The recorded Noise generator is disabled.'
						: '';
	const canCapture = !captureReason;
	const auditionReason =
		captureReason ||
		(snapshot.clock !== 3072000
			? 'Paused keyboard audition currently requires the normal 3072000 Hz WonderSwan clock.'
			: '');
	const canAudition = !auditionReason;
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
		canCapture,
		canAudition,
		playable: canAudition,
		reason: auditionReason,
		auditionReason,
		captureReason,
		manualEdited: Boolean(snapshot.channels?.[channel]?.manualEdited),
	};
}
