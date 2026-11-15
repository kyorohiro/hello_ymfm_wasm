// SPDX-License-Identifier: BSD-3-Clause
import { readPreset } from './preset.js';

export function aswanSongVoiceChanges(channel, before, next) {
	if (!Number.isInteger(channel) || channel < 0 || channel > 3)
		throw new RangeError('ASWAN channel must be 0..3');
	const a = readPreset(before),
		b = readPreset(next);
	if (a.source === 'pcm' || b.source === 'pcm')
		throw new Error('Transient Voice PCM cannot be edited as a recovered song sample');
	if ((b.source === 'noise' || a.source === 'noise') && channel !== 3)
		throw new Error('Hardware Noise uses CH4');
	if ((a.sweep.enabled || b.sweep.enabled) && channel !== 2)
		throw new Error('Hardware Sweep uses CH3');
	const changes = {};
	for (const name of ['left', 'right']) if (a[name] !== b[name]) changes[name] = b[name];
	if (a.source !== b.source) changes.source = b.source;
	if (
		b.source === 'wave' &&
		(a.source !== b.source || a.wave.some((value, index) => value !== b.wave[index]))
	)
		changes.wave = [...b.wave];
	if (channel === 2) {
		if (a.sweep.enabled !== b.sweep.enabled) changes.sweepEnabled = b.sweep.enabled;
		if (a.sweep.step !== b.sweep.step) changes.sweepStep = b.sweep.step;
		if (a.sweep.time !== b.sweep.time) changes.sweepTime = b.sweep.time;
	}
	if (
		channel === 3 &&
		(a.noise.type !== b.noise.type || (a.source !== b.source && b.source === 'noise'))
	)
		changes.noiseType = b.noise.type;
	return changes;
}

/** A UI projection only: never modifies a historical source observation. */
export function projectAswanSongVoiceChanges(snapshot, channel, changes) {
	const result = structuredClone(snapshot),
		r = result.registers,
		known = result.registerKnown;
	const write = (index, mask, value) => {
		r[index] = (r[index] & ~mask) | (value & mask);
		if (known) known[index] = 1;
	};
	if (Object.hasOwn(changes, 'periodCode')) {
		write(channel * 2, 255, changes.periodCode & 255);
		write(channel * 2 + 1, 7, changes.periodCode >>> 8);
	}
	if (Object.hasOwn(changes, 'gate')) write(16, 1 << channel, changes.gate ? 1 << channel : 0);
	if (Object.hasOwn(changes, 'left')) write(8 + channel, 0xf0, changes.left << 4);
	if (Object.hasOwn(changes, 'right')) write(8 + channel, 0x0f, changes.right);
	if (Object.hasOwn(changes, 'source')) write(16, 128, changes.source === 'noise' ? 128 : 0);
	if (Object.hasOwn(changes, 'sweepEnabled')) write(16, 64, changes.sweepEnabled ? 64 : 0);
	if (Object.hasOwn(changes, 'sweepStep')) write(12, 255, changes.sweepStep & 255);
	if (Object.hasOwn(changes, 'sweepTime')) write(13, 31, changes.sweepTime);
	if (Object.hasOwn(changes, 'noiseType')) write(14, 7, changes.noiseType);
	if (changes.source === 'noise') write(14, 16, 16);
	if (changes.wave) {
		result.waveforms[channel] = [...changes.wave];
		result.waveKnown[channel] = true;
	}
	if (result.channels?.[channel])
		Object.assign(result.channels[channel], {
			source:
				channel === 3 && r[16] & 128
					? 'noise'
					: channel === 1 && r[16] & 32
						? 'pcm'
						: 'wave',
			gate: Boolean(r[16] & (1 << channel)),
			frequency:
				(Math.floor(result.clock / 128) * 128) /
				(32 * (2048 - (r[channel * 2] | ((r[channel * 2 + 1] & 7) << 8)))),
			left: r[8 + channel] >> 4,
			right: r[8 + channel] & 15,
			sweep: channel === 2 && Boolean(r[16] & 64),
			waveKnown: result.waveKnown[channel],
			manualEdited: true,
		});
	return result;
}

/** At most one retained value per hardware field and physical channel. A
 * rendered-ahead edit stays visible until a later audible native observation
 * can show recorded writes taking over again. */
export class AswanSongEditJournal {
	constructor() {
		this.channels = new Map();
		this.revision = 0;
	}
	record(channel, changes, frame) {
		if (!Number.isSafeInteger(frame) || frame < 0)
			throw new RangeError('Invalid ASWAN native edit frame');
		if (!Object.keys(changes).length) return false;
		let fields = this.channels.get(channel);
		if (!fields) this.channels.set(channel, (fields = new Map()));
		for (const [name, value] of Object.entries(changes))
			fields.set(name, { value: structuredClone(value), frame });
		this.revision++;
		return true;
	}
	prune(frame) {
		for (const [channel, fields] of this.channels) {
			for (const [name, item] of fields) if (frame > item.frame) fields.delete(name);
			if (!fields.size) this.channels.delete(channel);
		}
	}
	project(snapshot) {
		let result = structuredClone(snapshot);
		for (const [channel, fields] of this.channels)
			result = projectAswanSongVoiceChanges(
				result,
				channel,
				Object.fromEntries([...fields].map(([name, item]) => [name, item.value])),
			);
		result.manualRevision = this.revision;
		return result;
	}
}
