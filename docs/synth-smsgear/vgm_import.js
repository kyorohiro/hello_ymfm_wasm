// SPDX-License-Identifier: BSD-3-Clause
import { Ym2612VGM } from "../js/ym2612vgm.js";
import { parseVgmMetadata } from "../js/vgm_file.js";
import { createPsgRegisterState } from "../synth/synth_song_psg_state.js";
import { capturePreset } from "./preset.js";
export const MAX_VGM_BYTES = 16 * 1024 * 1024,
	MAX_EVENTS = 2000000;
const check = (signal) => signal?.throwIfAborted();
export async function decodeVgm(input, { signal } = {}) {
	check(signal);
	let bytes =
		input instanceof Uint8Array
			? input.slice()
			: input instanceof ArrayBuffer
				? new Uint8Array(input.slice(0))
				: null;
	if (!bytes || bytes.length > MAX_VGM_BYTES)
		throw Error("Choose VGM/VGZ up to 16 MiB");
	if (bytes[0] !== 31 || bytes[1] !== 139) return bytes;
	const reader = new Blob([bytes])
		.stream()
		.pipeThrough(new DecompressionStream("gzip"))
		.getReader();
	const cancel = () => void reader.cancel().catch(() => {});
	signal?.addEventListener("abort", cancel, { once: true });
	const parts = [];
	let length = 0;
	try {
		for (;;) {
			check(signal);
			const { value, done } = await reader.read();
			check(signal);
			if (done) break;
			length += value.length;
			if (length > MAX_VGM_BYTES)
				throw Error("Expanded VGM exceeds 16 MiB");
			parts.push(value);
		}
	} finally {
		signal?.removeEventListener("abort", cancel);
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
	bytes = new Uint8Array(length);
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}
	return bytes;
}
export async function readSmsGearVgm(input, { signal } = {}) {
	const bytes = await decodeVgm(input, { signal }),
		parser = new Ym2612VGM(bytes),
		header = parser.header;
	const psgRaw = header.psgClock >>> 0,
		fmRaw = header.ym2413Clock >>> 0;
	if (!(psgRaw & 0x3fffffff) && !(fmRaw & 0x3fffffff))
		throw Error("This VGM contains neither Sega PSG nor YM2413");
	if ((psgRaw | fmRaw) & 0xc0000000)
		throw Error(
			"Dual chips and YM2413/VRC7 variants are not supported by this SMS/GG view",
		);
	const psgClock = psgRaw || 3579545,
		opllClock = fmRaw || 3579545,
		shadow = createPsgRegisterState(psgClock),
		opll = new Uint8Array(64);
	const events = [],
		voices = [],
		seen = new Set(),
		warnings = [];
	let time = 0,
		stereo = 255;
	const capture = (kind, channel) => {
		if (voices.length >= 512) return;
		const preset = capturePreset(kind, channel, {
			psg: shadow.snapshot(),
			opll,
			stereo,
		});
		const key = JSON.stringify({ ...preset, name: "" });
		if (seen.has(key)) return;
		seen.add(key);
		preset.name = `${kind === "psg" ? "PSG" : "FM"} ${voices.length + 1} · CH${channel + 1}`;
		voices.push({ preset, channel, timeSamples: time });
	};
	for (let count = 0; ; count++) {
		check(signal);
		if (events.length > MAX_EVENTS * 4)
			throw Error("VGM exceeds two million register events");
		if (count % 4096 === 0)
			await new Promise((resolve) => setTimeout(resolve, 0));
		if (parser.position >= bytes.length)
			throw Error("Truncated VGM: missing End command");
		const command = bytes[parser.position];
		if (command === 0x4f) {
			if (parser.position + 1 >= bytes.length)
				throw Error("Truncated Game Gear stereo write");
			stereo = bytes[parser.position + 1];
			parser.position += 2;
			events.push(time, 2, 0, stereo);
			continue;
		}
		const event = parser.step();
		if (event.chipIndex)
			throw Error("Second sound chips are not supported");
		if (event.type === "end") break;
		if (event.type === "wait") {
			time += event.samples;
			if (!Number.isSafeInteger(time) || time > 44100 * 3600)
				throw Error("VGM exceeds the one-hour preview limit");
		} else if (event.type === "psg-write") {
			if (!psgRaw) throw Error("PSG writes have no declared clock");
			shadow.write(event.value);
			events.push(time, 0, 0, event.value);
			const state = shadow.snapshot(),
				ch = state.latched >> 1;
			if (state.latched & 1 && state.attenuations[ch] < 15)
				capture("psg", ch);
		} else if (event.type === "ym2413-write") {
			if (!fmRaw) {
				// Some old SMS PSG logs contain an initial unused User-patch
				// clear despite declaring no FM clock. Never infer audible FM.
				if (time === 0 && event.register <= 7 && event.value === 0) {
					if (
						!warnings.includes(
							"Ignored zero User-patch initialization for undeclared YM2413 at time 0.",
						)
					)
						warnings.push(
							"Ignored zero User-patch initialization for undeclared YM2413 at time 0.",
						);
					continue;
				}
				throw Error("Invalid YM2413 register/clock");
			}
			if (event.register >= 64)
				throw Error("Invalid YM2413 register/clock");
			opll[event.register] = event.value;
			events.push(time, 1, event.register, event.value);
			if (
				event.register >= 0x20 &&
				event.register <= 0x28 &&
				event.value & 16 &&
				!(opll[14] & 32 && event.register >= 0x26)
			)
				capture("opll", event.register - 0x20);
		} else
			throw Error(
				`SMS/GG preview does not support ${event.type} (command 0x${command.toString(16)})`,
			);
		if (events.length > MAX_EVENTS * 4)
			throw Error("VGM exceeds two million register events");
	}
	if (voices.length >= 512)
		warnings.push(
			"Sound list limited to 512 distinct static presets; full song retained.",
		);
	if (!events.length) throw Error("VGM contains no PSG / YM2413 writes");
	return {
		events: new Uint32Array(events),
		totalSamples: Math.max(time, 1),
		psgClock,
		opllClock,
		metadata: parseVgmMetadata(bytes),
		voices,
		warnings,
	};
}
export const extractVgmInstruments = readSmsGearVgm;
