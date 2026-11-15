// SPDX-License-Identifier: BSD-3-Clause
import { WonderSwanAudioEngine } from '../js/wonderswanaudioengine.js';
import {
	prepareWonderSwanTimeline,
	createWonderSwanTimelineCursor,
} from '../js/wonderswan_timeline.js';
import factory from '../generated/wonderswan_wasm.js';
import { readAswanVgm } from './vgm_import.js';
import { aswanSongVoiceChanges } from './song_voice_edits.js';
import { createAswanSongManual } from './song_manual.js';

export async function prepareAswanSongSource(bytes, options = {}) {
	const source = await readAswanVgm(bytes, options),
		{ trace } = source;
	const timeline = prepareWonderSwanTimeline(
		{
			version: 1,
			clock: trace.clock,
			durationSamples: trace.time,
			pcmData: trace.pcmData,
			events: trace.events.map((event) =>
				event.type === 'pcm'
					? [event.time, 2, event.offset, event.length, event.count, event.endTime]
					: [event.time, event.type === 'register' ? 0 : 1, event.address, event.value],
			),
		},
		{ sampleRate: 44100 },
	);
	return { ...source, timeline };
}

/** Synchronous one-pass native renderer. It creates no audio context or nodes.
 * Engine output is the existing tick-aligned speaker-centered path at gain1;
 * the host's songInputNode applies Tetorica calibration exactly once. */
export async function createAswanSongEngine(source, { moduleFactory = factory, wasmBinary } = {}) {
	if (!source?.timeline) throw new TypeError('Prepare an ASWAN song source first');
	const engine = await WonderSwanAudioEngine.create({
		moduleFactory: wasmBinary ? () => moduleFactory({ wasmBinary }) : moduleFactory,
		clock: source.clock,
		outputSampleRate: 44100,
		masterVolume: 1,
	});
	let manual = null,
		cursor = createWonderSwanTimelineCursor(source.timeline, 44100),
		frame = 0,
		disposed = false;
	const registerKnown = new Uint8Array(32),
		memoryKnown = new Uint8Array(0x4000);
	function apply(kind, address, value, origin = 'vgm') {
		if (origin === 'vgm') manual?.observe(kind, address, value, engine.registers);
		if (kind === 0) {
			engine.writeWonderSwan(address - 0x80, value);
			registerKnown[address - 0x80] = 1;
		} else {
			engine.writeWonderSwanMemory(address, value);
			memoryKnown[address] = 1;
		}
	}
	const open = () => {
		if (disposed) throw new Error('ASWAN song engine is disposed');
	};
	cursor.advance(0, apply);
	const api = {
		clock: source.clock,
		sampleRate: () => 44100,
		get ended() {
			return frame >= cursor.durationFrames;
		},
		get frame() {
			return frame;
		},
		process(left, right, count = left?.length) {
			open();
			if (
				!(left instanceof Float32Array) ||
				!(right instanceof Float32Array) ||
				!Number.isInteger(count) ||
				count < 0 ||
				count > left.length ||
				count > right.length
			)
				throw new RangeError('Invalid ASWAN stereo output buffers');
			const length = Math.min(count, cursor.durationFrames - frame);
			let written = 0;
			while (written < length) {
				cursor.advance(frame, apply);
				const next = Math.min(frame + length - written, cursor.nextFrame());
				const size = next - frame;
				if (size <= 0) throw new Error('ASWAN timeline did not advance');
				const pcm = engine.generateStereoView(size);
				left.set(pcm.left, written);
				right.set(pcm.right, written);
				written += size;
				frame += size;
			}
			cursor.advance(frame, apply);
			return written;
		},
		processFrames(count) {
			const left = new Float32Array(count),
				right = new Float32Array(count),
				frames = api.process(left, right, count);
			return { left: left.subarray(0, frames), right: right.subarray(0, frames) };
		},
		snapshot() {
			open();
			const registers = Array.from(engine.registers),
				control = registers[16],
				waveforms = [],
				waveKnown = [];
			for (let channel = 0; channel < 4; channel++) {
				const base = ((registers[15] << 6) + channel * 16) & 0x3fff;
				waveforms.push(
					Array.from(engine.memory.subarray(base, base + 16)).flatMap((value) => [
						value & 15,
						value >> 4,
					]),
				);
				waveKnown.push(
					Boolean(registerKnown[15]) &&
						memoryKnown.subarray(base, base + 16).every(Boolean),
				);
			}
			return {
				frame,
				clock: source.clock,
				registers,
				registerKnown: Array.from(registerKnown),
				waveforms,
				waveKnown,
				channels: Array.from({ length: 4 }, (_, channel) => {
					const source =
						channel === 1 && control & 32
							? 'pcm'
							: channel === 3 && control & 128
								? 'noise'
								: 'wave';
					const code = registers[channel * 2] | ((registers[channel * 2 + 1] & 7) << 8);
					return {
						channel,
						source,
						gate: Boolean(control & (1 << channel)),
						frequency: (Math.floor(api.clock / 128) * 128) / (32 * (2048 - code)),
						left: registers[8 + channel] >> 4,
						right: registers[8 + channel] & 15,
						sweep: channel === 2 && Boolean(control & 64),
						waveKnown: waveKnown[channel],
					};
				}),
				observation:
					'sent/reset registers and written Wave RAM; oscillator/sweep phase is not observed',
			};
		},
		/** Apply only changed hardware fields at the current rendered-ahead frame.
		 * No reset, key-on, period write or PCM-buffer invalidation occurs. */
		editVoice(channel, before, next) {
			open();
			const changes = aswanSongVoiceChanges(channel, before, next),
				r = engine.registers;
			if (channel === 1 && r[16] & 32)
				throw new Error(
					'The rendered-ahead CH2 is Voice PCM; song sample editing is unavailable',
				);
			if (Object.hasOwn(changes, 'source')) {
				const released = manual.releaseChannel(channel);
				if (released?.changes?.some((change) => change.gate === false))
					changes.gate = false;
			}
			const write = (index, mask, value) =>
				apply(0, 0x80 + index, (r[index] & ~mask) | (value & mask), 'editor');
			if (Object.hasOwn(changes, 'left')) write(8 + channel, 0xf0, changes.left << 4);
			if (Object.hasOwn(changes, 'right')) write(8 + channel, 15, changes.right);
			if (Object.hasOwn(changes, 'sweepStep')) write(12, 255, changes.sweepStep & 255);
			if (Object.hasOwn(changes, 'sweepTime')) write(13, 31, changes.sweepTime);
			if (Object.hasOwn(changes, 'sweepEnabled'))
				write(16, 64, changes.sweepEnabled ? 64 : 0);
			if (Object.hasOwn(changes, 'noiseType')) write(14, 7, changes.noiseType);
			if (changes.source === 'noise') {
				write(14, 16, 16);
				write(16, 128, 128);
			} else if (changes.source === 'wave') write(16, 128, 0);
			if (changes.wave) {
				const base = ((r[15] << 6) + channel * 16) & 0x3fff;
				for (let index = 0; index < 16; index++)
					apply(
						1,
						base + index,
						changes.wave[index * 2] | (changes.wave[index * 2 + 1] << 4),
						'editor',
					);
			}
			return { nativeFrame: frame, changes, manualState: manual.read() };
		},
		manualNoteOn: (...args) => {
			open();
			return manual.noteOn(...args);
		},
		manualNoteOff: (...args) => {
			open();
			return manual.noteOff(...args);
		},
		setManualPitch: (value) => {
			open();
			return manual.setPitch(value);
		},
		releaseKeyboard: () => {
			open();
			return manual.releaseKeyboard();
		},
		getManualState: () => {
			open();
			return manual.read();
		},
		setChannelMuted(channel, muted) {
			open();
			if (
				!Number.isInteger(channel) ||
				channel < 0 ||
				channel > 3 ||
				typeof muted !== 'boolean'
			)
				throw new TypeError('ASWAN mute needs a physical channel and boolean');
			engine.setChannelMuted(channel, muted);
		},
		reset() {
			open();
			manual.reset();
			engine.reset();
			frame = 0;
			registerKnown.fill(0);
			memoryKnown.fill(0);
			cursor = createWonderSwanTimelineCursor(source.timeline, 44100);
			cursor.advance(0, apply);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			manual.dispose();
			engine.dispose();
		},
	};
	manual = createAswanSongManual({
		clock: source.clock,
		getFrame: () => frame,
		readSnapshot: () => api.snapshot(),
		write: (kind, address, value) => apply(kind, address, value, 'manual'),
	});
	return api;
}
