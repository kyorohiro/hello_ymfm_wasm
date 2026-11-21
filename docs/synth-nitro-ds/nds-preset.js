// SPDX-License-Identifier: BSD-3-Clause
import { NDS_MAX_SAMPLE_BYTES } from './nds-core.js';
import { getNdsSampleLayout, readNdsSampleRange, validateNdsSampleRate } from './nds-sample.js';

export const NDS_PRESET_FORMAT = 'tetorica-nds-sound';
export const NDS_PRESET_EXTENSION = '.nds.json';
const SAMPLE_MODES = ['pcm8', 'pcm16', 'adpcm'];
const MODES = [...SAMPLE_MODES, 'pulse', 'noise'];
const SHAPES = ['sine', 'triangle', 'saw', 'square'];
const BASE64_LIMIT = Math.ceil(NDS_MAX_SAMPLE_BYTES / 3) * 4;

export const isNdsPresetPath = path => typeof path === 'string' && path.toLowerCase().endsWith(NDS_PRESET_EXTENSION);

function nameOf(value) {
	if (typeof value !== 'string' || value.isWellFormed?.() === false || /[\u0000-\u001f\u007f]/.test(value))
		throw new TypeError('A DS sound name must be valid text.');
	const name = value.trim().normalize('NFC');
	if (!name || name.length > 120) throw new RangeError('A DS sound name must have 1–120 characters.');
	return name;
}

function integer(value, min, max, label) {
	if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${label} must be ${min}–${max}.`);
	return value;
}

function decodeBase64(value) {
	if (typeof value !== 'string' || value.length > BASE64_LIMIT || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
		throw new TypeError('DS sample data must be canonical base64.');
	const raw = atob(value);
	if (btoa(raw) !== value) throw new TypeError('DS sample data must be canonical base64.');
	return Uint8Array.from(raw, character => character.charCodeAt(0));
}

function encodeBase64(bytes) {
	let raw = '';
	for (let index = 0; index < bytes.length; index += 32768)
		raw += String.fromCharCode(...bytes.subarray(index, index + 32768));
	return btoa(raw);
}

function validateSound(sound, name, readBytes) {
	if (!sound || !MODES.includes(sound.mode)) throw new TypeError('Unknown DS sound mode.');
	if (!SHAPES.includes(sound.shape ?? 'sine')) throw new TypeError('Unknown DS built-in waveform.');
	if (typeof sound.loop !== 'boolean') throw new TypeError('DS Repeat must be a boolean.');
	const result = {
		name: nameOf(name), mode: sound.mode, shape: sound.shape ?? 'sine',
		volume: integer(sound.volume, 0, 127, 'DS volume'),
		pan: integer(sound.pan, 0, 127, 'DS pan'),
		divider: integer(sound.divider, 0, 3, 'DS volume divider'),
		duty: integer(sound.duty, 0, 7, 'DS pulse duty'), loop: sound.loop,
	};
	if (sound.sample == null) return result;
	if (!SAMPLE_MODES.includes(result.mode) || typeof sound.sample !== 'object' || Array.isArray(sound.sample))
		throw new TypeError('DS sample data requires PCM8, PCM16 or IMA-ADPCM.');
	const { sampleRate, rootNote, loopStartWords, lengthWords } = sound.sample;
	const bytes = readBytes(sound.sample.bytes);
	const layout = getNdsSampleLayout(bytes, result.mode);
	readNdsSampleRange(layout, { loopStartWords, lengthWords, loop: result.loop });
	result.sample = {
		sampleRate: validateNdsSampleRate(sampleRate),
		rootNote: integer(rootNote, 0, 127, 'DS root MIDI note'), loopStartWords, lengthWords, bytes,
	};
	return result;
}

export function readNdsPreset(source) {
	if (typeof source === 'string' && source.length > BASE64_LIMIT + 16384) throw new RangeError('DS sound JSON is too large.');
	const value = typeof source === 'string' ? JSON.parse(source.replace(/^\uFEFF/, '')) : source;
	if (value?.format !== NDS_PRESET_FORMAT || value.version !== 1) throw new TypeError('Unsupported DS sound preset.');
	return validateSound(value, value.name, decodeBase64);
}

/** Convert a decoded sound into settings for one physical DS channel. */
export function ndsPresetChannelSettings({ mode, shape, volume, pan, divider, duty, loop, sample }) {
	const settings = { mode, volume, pan, divider, duty, loop };
	if (!SAMPLE_MODES.includes(mode)) return settings;
	if (!sample) return { ...settings, shape };
	const { bytes, sampleRate, rootNote, loopStartWords, lengthWords } = sample;
	return { ...settings, bytes, sampleRate, rootNote, loopStartWords, lengthWords };
}

export function writeNdsPreset(name, sound) {
	const value = validateSound(sound, name, bytes => bytes);
	if (value.sample) value.sample.bytes = encodeBase64(value.sample.bytes);
	return JSON.stringify({ format: NDS_PRESET_FORMAT, version: 1, ...value }, null, 2) + '\n';
}
