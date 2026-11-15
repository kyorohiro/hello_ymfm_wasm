// SPDX-License-Identifier: BSD-3-Clause
const FORMAT = 'tetorica-aswan-voice';
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUES = Int16Array.from({ length: 128 }, (_, index) =>
	BASE64.indexOf(String.fromCharCode(index)),
);
export const MAX_PCM_BYTES = 2 * 1024 * 1024;
const object = (value, keys, name) => {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Reflect.ownKeys(value).length !== keys.length ||
		keys.some((key) => !Object.hasOwn(value, key))
	)
		throw new TypeError(`Invalid ${name} properties`);
};
const number = (value, min, max, name, integer = false) => {
	if (
		!Number.isFinite(value) ||
		value < min ||
		value > max ||
		(integer && !Number.isInteger(value))
	)
		throw new RangeError(`${name} must be ${min}..${max}`);
	return value;
};
const bool = (value, name) => {
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean`);
	return value;
};
export function encodePcmData(bytes) {
	if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_PCM_BYTES)
		throw new RangeError('PCM needs 1..2097152 unsigned samples');
	// AudioWorkletGlobalScope deliberately has neither btoa nor atob.
	const parts = [];
	for (let start = 0; start < bytes.length; start += 12288) {
		let part = '';
		const end = Math.min(bytes.length, start + 12288);
		for (let at = start; at < end; at += 3) {
			const a = bytes[at],
				b = bytes[at + 1] ?? 0,
				c = bytes[at + 2] ?? 0;
			part +=
				BASE64[a >> 2] +
				BASE64[((a & 3) << 4) | (b >> 4)] +
				(at + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)] : '=') +
				(at + 2 < bytes.length ? BASE64[c & 63] : '=');
		}
		parts.push(part);
	}
	return parts.join('');
}
export function decodePcmData(data) {
	if (
		typeof data !== 'string' ||
		data.length > 4 * Math.ceil(MAX_PCM_BYTES / 3) ||
		!data.length ||
		data.length % 4 ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
	)
		throw new TypeError('Invalid unsigned PCM base64');
	const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
	const length = (data.length / 4) * 3 - padding;
	if (
		!length ||
		length > MAX_PCM_BYTES ||
		(padding === 2 && BASE64_VALUES[data.charCodeAt(data.length - 3)] & 15) ||
		(padding === 1 && BASE64_VALUES[data.charCodeAt(data.length - 2)] & 3)
	)
		throw new TypeError('Invalid unsigned PCM base64');
	const bytes = new Uint8Array(length);
	let output = 0;
	for (let at = 0; at < data.length; at += 4) {
		const value =
			(BASE64_VALUES[data.charCodeAt(at)] << 18) |
			(BASE64_VALUES[data.charCodeAt(at + 1)] << 12) |
			((BASE64_VALUES[data.charCodeAt(at + 2)] & 63) << 6) |
			(BASE64_VALUES[data.charCodeAt(at + 3)] & 63);
		bytes[output++] = value >> 16;
		if (output < length) bytes[output++] = value >> 8;
		if (output < length) bytes[output++] = value;
	}
	return bytes;
}
export function waveShape(name) {
	if (!['sine', 'triangle', 'saw', 'square'].includes(name))
		throw new TypeError('Unknown waveform');
	return Array.from({ length: 32 }, (_, i) =>
		Math.round(
			15 *
				(name === 'sine'
					? (1 + Math.sin((i * Math.PI) / 16)) / 2
					: name === 'triangle'
						? 1 - Math.abs(i / 16 - 1)
						: name === 'saw'
							? i / 31
							: i < 16
								? 1
								: 0),
		),
	);
}
export function createDefaultPreset() {
	return {
		format: FORMAT,
		version: 1,
		name: 'Sine',
		source: 'wave',
		wave: waveShape('sine'),
		left: 9,
		right: 9,
		sweep: { enabled: false, step: 0, time: 0 },
		noise: { type: 0 },
		envelope: { enabled: true, attack: 0.005, decay: 0.05, sustain: 1, release: 0.03 },
		pcm: {
			data: encodePcmData(
				Uint8Array.from({ length: 256 }, (_, i) =>
					Math.round(128 + 80 * Math.sin((i * Math.PI) / 32)),
				),
			),
			sampleRate: 24000,
			rootNote: 60,
			loop: true,
		},
	};
}
export function readPreset(value) {
	object(
		value,
		[
			'format',
			'version',
			'name',
			'source',
			'wave',
			'left',
			'right',
			'sweep',
			'noise',
			'envelope',
			'pcm',
		],
		'ASWAN preset',
	);
	if (value.format !== FORMAT || value.version !== 1)
		throw new TypeError('Unsupported ASWAN preset format/version');
	if (
		typeof value.name !== 'string' ||
		value.name.length > 120 ||
		/[\u0000-\u001f\u007f\u2028\u2029]/.test(value.name)
	)
		throw new TypeError('Invalid instrument name');
	if (!['wave', 'noise', 'pcm'].includes(value.source))
		throw new TypeError('Expected Wave, Noise or PCM');
	if (
		!Array.isArray(value.wave) ||
		value.wave.length !== 32 ||
		Reflect.ownKeys(value.wave).length !== 33
	)
		throw new TypeError('Wave needs exactly 32 four-bit samples');
	object(value.sweep, ['enabled', 'step', 'time'], 'Sweep');
	object(value.noise, ['type'], 'Noise');
	object(
		value.envelope,
		['enabled', 'attack', 'decay', 'sustain', 'release'],
		'Software envelope',
	);
	object(value.pcm, ['data', 'sampleRate', 'rootNote', 'loop'], 'Software PCM');
	decodePcmData(value.pcm.data);
	const result = {
		format: FORMAT,
		version: 1,
		name: value.name,
		source: value.source,
		wave: value.wave.map((v) => number(v, 0, 15, 'Wave sample', true)),
		left: number(value.left, 0, 15, 'Left', true),
		right: number(value.right, 0, 15, 'Right', true),
		sweep: {
			enabled: bool(value.sweep.enabled, 'Sweep'),
			step: number(value.sweep.step, -128, 127, 'Sweep step', true),
			time: number(value.sweep.time, 0, 31, 'Sweep time', true),
		},
		noise: { type: number(value.noise.type, 0, 7, 'Noise type', true) },
		envelope: {
			enabled: bool(value.envelope.enabled, 'Software envelope'),
			attack: number(value.envelope.attack, 0, 10, 'Attack'),
			decay: number(value.envelope.decay, 0, 10, 'Decay'),
			sustain: number(value.envelope.sustain, 0, 1, 'Sustain'),
			release: number(value.envelope.release, 0, 10, 'Release'),
		},
		pcm: {
			data: value.pcm.data,
			sampleRate: number(value.pcm.sampleRate, 1, 192000, 'PCM sample rate'),
			rootNote: number(value.pcm.rootNote, 0, 127, 'PCM root note', true),
			loop: bool(value.pcm.loop, 'PCM Loop'),
		},
	};
	if (result.source !== 'wave' && result.sweep.enabled)
		throw new TypeError('Hardware sweep requires Wave source on CH3');
	return result;
}
export function presetToCode(value) {
	const p = readPreset(value),
		ch = p.source === 'noise' ? 3 : p.source === 'pcm' ? 1 : p.sweep.enabled ? 2 : 0;
	if (p.source === 'pcm')
		return `// Audio-thread PCM requires this Synth host; JavaScript timers are not a DAC stream.\nconst preset = ${JSON.stringify(p, null, 2)};\n// Load this preset in ASWAN Synth, then use its Code tab to play CH2.\n`;
	return `const ws = await useSoundChip("wonderswan");\n// Software Envelope is provided by the Synth host.\nawait ws.setWaveform(${ch}, ${JSON.stringify(p.wave)});\nawait ws.setVolume(${ch}, ${p.left}, ${p.right});\n${p.source === 'noise' ? `await ws.setNoise({enabled:true,type:${p.noise.type},reset:true});\n` : `${ch === 2 ? `await ws.setSweep(${JSON.stringify(p.sweep)});\n` : ''}`}await ws.noteOn(${ch}, "C4");\n// await ws.noteOff(${ch}); // Software release; keyOff is raw hardware.\n`;
}
