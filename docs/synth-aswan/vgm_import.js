// SPDX-License-Identifier: BSD-3-Clause
import { Ym2612VGM } from '../js/ym2612vgm.js';
import { parseVgmMetadata } from '../js/vgm_file.js';
import { readWonderSwanVgm } from '../playground/wonderswan_vgm_import.js';
import { createWonderSwanWaves } from '../vgm_analyzer/wonderswan_waves.js';
import { createWonderSwanVoiceSamples } from '../vgm_analyzer/wonderswan_voice_samples.js';
import { createDefaultPreset, readPreset, encodePcmData, MAX_PCM_BYTES } from './preset.js';
import { WONDERSWAN_TIMELINE_MAX_HOST_BYTES } from '../js/wonderswan_timeline.js';

export const MAX_VGM_BYTES = 16 * 1024 * 1024;
const MAX_VOICES = 4096;
const abort = (signal) => {
	if (signal?.aborted) throw new DOMException('ASWAN VGM import cancelled', 'AbortError');
};

/** Bounded VGZ expansion; opening a source never requests audio. */
export async function decodeAswanVgm(source, { signal } = {}) {
	abort(signal);
	const bytes =
		source instanceof Uint8Array
			? source
			: source instanceof ArrayBuffer
				? new Uint8Array(source)
				: null;
	if (!bytes) throw new TypeError('VGM source must be an ArrayBuffer or Uint8Array');
	if (bytes.length > MAX_VGM_BYTES) throw new RangeError('VGM / VGZ exceeds 16 MiB');
	if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes.slice();
	if (typeof DecompressionStream !== 'function')
		throw new Error('VGZ requires browser gzip support');
	const reader = new Blob([bytes])
		.stream()
		.pipeThrough(new DecompressionStream('gzip'))
		.getReader();
	const cancel = () => {
		void reader.cancel().catch(() => {});
	};
	signal?.addEventListener('abort', cancel, { once: true });
	const chunks = [];
	let length = 0;
	try {
		for (;;) {
			abort(signal);
			const { done, value } = await reader.read();
			abort(signal);
			if (done) break;
			length += value.length;
			if (length > MAX_VGM_BYTES) {
				await reader.cancel();
				throw new RangeError('Expanded VGZ exceeds 16 MiB');
			}
			chunks.push(value);
		}
	} finally {
		signal?.removeEventListener('abort', cancel);
		reader.releaseLock();
	}
	const output = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return output;
}

/** The existing bounded converter/parser owns DAC stream semantics. */
export async function readAswanVgm(source, { signal } = {}) {
	const bytes = await decodeAswanVgm(source, { signal });
	abort(signal);
	const trace = readWonderSwanVgm(bytes, {
		packPcm: true,
		timelineBytes: WONDERSWAN_TIMELINE_MAX_HOST_BYTES,
	});
	abort(signal);
	const parser = new Ym2612VGM(bytes);
	if (!trace.time) throw new Error('ASWAN reference requires a positive song duration');
	return {
		bytes,
		trace,
		header: { ...parser.header },
		clock: trace.clock,
		totalSamples: trace.time,
		metadata: parseVgmMetadata(bytes),
		format: 'vgm',
		warnings: [
			'One-pass WonderSwan playback. VGM loops are not repeated. Hyper Voice, DMA and other chips are unsupported.',
		],
	};
}

/** Iterate packed Voice writes without constructing an object per PCM byte. */
export function forEachAswanWrite(trace, apply) {
	for (const event of trace.events) {
		if (event.type !== 'pcm') {
			apply(event.type, event.address, event.value, event.time);
			continue;
		}
		let position = event.offset,
			time = event.time;
		for (let index = 0; index < event.count; index++) {
			let delta = 0,
				multiplier = 1,
				value;
			do {
				value = trace.pcmData[position++];
				delta += (value & 127) * multiplier;
				multiplier *= 128;
			} while (value & 128);
			time += delta;
			apply('register', 0x89, trace.pcmData[position++], time);
		}
	}
}

/** Static written waves/Noise/Sweep, plus uniform bounded CH2 Voice PCM.
 * A timed Voice capture with changing routing or irregular writes remains a
 * valid song, but is not guessed into an editable constant-rate sample. */
export async function extractVgmInstruments(source, { signal, allowEmpty = false } = {}) {
	if (typeof allowEmpty !== 'boolean') throw new TypeError('allowEmpty must be boolean');
	const parsed = await readAswanVgm(source, { signal }),
		{ trace } = parsed;
	const waves = createWonderSwanWaves(trace.clock, { maxDefinitions: 4096, maxEvents: 100000 });
	const pcm = createWonderSwanVoiceSamples(trace.clock, {
		limits: { maxSamples: 4096, maxEvents: 100000, maxPayloadBytes: 16 * 1024 * 1024 },
	});
	const registers = new Uint8Array(32),
		known = new Uint8Array(32),
		voices = [],
		definitions = new Map();
	const warnings = new Set([
		'Static sounds omit oscillator phase and later register automation. Imported Software Envelope is off.',
	]);
	if (trace.clock !== 3072000)
		warnings.add(
			'Imported static sounds use the normal 3072000 Hz Synth clock; reference playback retains the original clock.',
		);
	let time = 0,
		waveEvent = 0,
		writes = 0;
	const record = (preset, kind, channel, firstTime, notes = []) => {
		preset.envelope.enabled = false;
		for (const note of notes) warnings.add(note);
		const key = JSON.stringify({ ...preset, name: '' });
		const previous = definitions.get(key);
		if (previous) {
			previous.occurrences++;
			return;
		}
		if (voices.length >= MAX_VOICES)
			throw new RangeError('VGM exceeds 4096 distinct ASWAN sounds');
		const id = voices.length + 1;
		preset.name = `${kind === 'pcm' ? 'Voice PCM' : kind === 'noise' ? 'Noise' : kind === 'sweep' ? 'Sweep' : 'Wave'} CH${channel + 1} · ${id}`;
		const voice = {
			id,
			kind,
			channel: channel + 1,
			firstTime,
			occurrences: 1,
			preset: readPreset(preset),
			warnings: notes,
		};
		definitions.set(key, voice);
		voices.push(voice);
	};
	const collectWaves = () => {
		while (waveEvent < waves.events.length) {
			const event = waves.events[waveEvent++];
			if (!event.audible) continue;
			const channel = event.channel - 1;
			if (![8 + channel, 15, 16, 17].every((index) => known[index])) {
				warnings.add('Waves with unrecorded mode / output / volume settings are omitted.');
				continue;
			}
			const preset = createDefaultPreset();
			preset.wave = [...waves.samples[event.sampleId - 1].waveform];
			preset.left = event.pan.left;
			preset.right = event.pan.right;
			if (event.mode === 'sweep') {
				if (!known[12] || !known[13]) {
					warnings.add('Sweep intervals with unrecorded step/time are omitted.');
					continue;
				}
				preset.sweep = {
					enabled: true,
					step: registers[12] >= 128 ? registers[12] - 256 : registers[12],
					time: registers[13] & 31,
				};
			}
			record(preset, event.mode, channel, event.startTime);
		}
	};
	const collectNoise = () => {
		if ((registers[16] & 0x88) !== 0x88 || !(registers[17] & 8) || !registers[11]) return;
		if (![11, 14, 16, 17].every((index) => known[index]) || !(registers[14] & 16)) {
			warnings.add(
				'Noise intervals without a recorded generator-enable / output / volume setting are omitted.',
			);
			return;
		}
		const preset = createDefaultPreset();
		preset.source = 'noise';
		preset.noise.type = registers[14] & 7;
		preset.left = registers[11] >> 4;
		preset.right = registers[11] & 15;
		record(preset, 'noise', 3, time);
	};
	forEachAswanWrite(trace, (type, address, value, nextTime) => {
		if (!(++writes & 1023)) abort(signal);
		if (nextTime > time) {
			waves.advance(nextTime);
			collectWaves();
			collectNoise();
			time = nextTime;
		}
		if (type === 'memory')
			waves.apply({ type: 'wonderswan-memory-write', offset: address, value }, nextTime);
		else {
			const register = address - 0x80;
			waves.apply({ type: 'wonderswan-write', register, value }, nextTime);
			pcm.write(register, value, nextTime);
			registers[register] = value;
			known[register] = 1;
		}
	});
	waves.flush(trace.time);
	collectWaves();
	if (trace.time > time) collectNoise();
	pcm.finish(trace.time);
	for (const message of waves.warnings) warnings.add(message);
	for (const capture of pcm.samples) {
		let count = 0,
			firstTime = null,
			lastTime = null,
			delta = 0,
			safe = true;
		const initial = capture.initial.registers.slice();
		for (let index = 0; index < capture.times.length; index++) {
			const register = capture.registers[index],
				value = capture.values[index],
				at = capture.times[index];
			if (register === 9) {
				if (!count) firstTime = at;
				else if (count === 1) delta = at - firstTime;
				else if (at !== firstTime + count * delta) safe = false;
				lastTime = at;
				count++;
			} else if (at === 0) initial[register] = value;
			else if (at < capture.durationSamples && value !== initial[register]) safe = false;
		}
		const output = initial[17],
			route = initial[20];
		if (
			!safe ||
			(initial[16] & 0x22) !== 0x22 ||
			!(output & 8) ||
			!route ||
			count < 2 ||
			firstTime !== 0 ||
			delta <= 0 ||
			capture.durationSamples <= lastTime ||
			capture.durationSamples > count * delta ||
			count > MAX_PCM_BYTES
		) {
			warnings.add(
				'Irregular or automated Voice PCM intervals remain playable in the VGM but are omitted from constant-rate PCM presets.',
			);
			continue;
		}
		const preset = createDefaultPreset();
		preset.source = 'pcm';
		preset.left = route & 8 ? 15 : route & 4 ? 7 : 0;
		preset.right = route & 2 ? 15 : route & 1 ? 7 : 0;
		preset.pcm = {
			data: encodePcmData(capture.data),
			sampleRate: 44100 / delta,
			rootNote: 60,
			loop: false,
		};
		const notes = [
			'Software-fed CH2 unsigned 8-bit PCM. C4 uses the recorded byte rate; no original loop is inferred.',
		];
		if (capture.durationSamples !== count * delta)
			notes.push(
				'The last partial byte hold is extended to one complete sample in this constant-rate preset.',
			);
		record(preset, 'pcm', 1, capture.sourceStartSample, notes);
	}
	abort(signal);
	if (!voices.length && !allowEmpty)
		throw new Error('This VGM contains no complete editable WonderSwan sounds');
	return {
		voices,
		warnings: [...warnings],
		metadata: parsed.metadata,
		clock: trace.clock,
		totalSamples: trace.time,
	};
}
