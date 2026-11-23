// SPDX-License-Identifier: BSD-3-Clause
import { MASTER_CLOCK_HZ } from './sm510.js';

export const SM511_ROM_STEPS = 256;
export const SM511_SHORT_SECONDS = 1 / 16;
export const SM511_DEMO = Object.freeze([0x0d, 0x09, 0x27, 0x00, 0x15, 0x12, 0x01]);
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const SHORT_TICKS = SM511_SHORT_SECONDS * MASTER_CLOCK_HZ;
const STOP = 0x01;
const melodySequences = new WeakMap();

// Keep the MIDI values in existing projects and map their pitch classes onto
// the SM511's two ROM octaves. C♯3–C5 maps two octaves up.
export function sm511Midi(note) {
	const shifted = note + 24;
	return shifted < 73 ? shifted + 12 : shifted > 96 ? shifted - 12 : shifted;
}

export function sm511Label(note) {
	const midi = sm511Midi(note);
	return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

export function sm511Command(note) {
	const midi = sm511Midi(note);
	return 2 + (12 - midi % 12) % 12 + (midi >= 85 ? 0x10 : 0);
}

export function sm511CommandLabel(command) {
	return sm511Label(49 + 0xd - (command & 0xf) + (command & 0x10 ? 12 : 0));
}

export function validateMelody(commands) {
	if ((!Array.isArray(commands) && !(commands instanceof Uint8Array)) || !commands.length || commands.length > SM511_ROM_STEPS)
		throw new RangeError('Provide 1–256 SM511 ROM commands.');
	for (const command of commands) {
		if (!Number.isInteger(command) || command < 0 || command > 0x3f || (command & 0xf) > 0xd)
			throw new RangeError('Use 6-bit SM511 note, rest or stop commands.');
	}
	return Uint8Array.from(commands);
}

function validateStartAddress(address) {
	if (!Number.isInteger(address) || address < 0 || address >= SM511_ROM_STEPS)
		throw new RangeError('Choose an SM511 ROM address from 0x00 to 0xFF.');
}

function getMelodySequence(plan) {
	const sequence = melodySequences.get(plan);
	if (!sequence) throw new TypeError('Provide an SM511 melody sequence from build().');
	return sequence;
}

function storeMelodySequence(words, startAddress) {
	const plan = Object.freeze({ commandCount: words.length });
	melodySequences.set(plan, { words, startAddress });
	return plan;
}

export function buildSm511MelodySequence(commands) {
	return storeMelodySequence(validateMelody(commands), 0);
}

export function readSm511MelodySequence(plan) {
	return getMelodySequence(plan).words.slice();
}

export function createSm511CodeChip({ play, stop }) {
	const rom = new Uint8Array(SM511_ROM_STEPS).fill(STOP);
	function snapshotFrom(address) {
		validateStartAddress(address);
		return rom.slice(address);
	}
	return {
		id: 'sm511',
		get clock() { return MASTER_CLOCK_HZ; },
		setMelody(commands) {
			const words = validateMelody(commands);
			rom.fill(STOP);
			rom.set(words);
		},
		play(startAddress = 0) { return play(snapshotFrom(startAddress)); },
		stop,
		build(source = 0) {
			if (typeof source === 'number') return storeMelodySequence(snapshotFrom(source), source);
			return buildSm511MelodySequence(source);
		},
		compile: compileSm511MelodySequence,
		playMelody(commands) { return play(validateMelody(commands)); },
		stopMelody: stop,
	};
}

function commandDurationTicks(command) {
	if ((command & 0xf) === STOP) return 0;
	return command & 0x20 ? 2 * SHORT_TICKS : SHORT_TICKS;
}

export function sm511RepeatStart(commands, startAddress) {
	for (let offset = 0; offset < commands.length; offset++) {
		const address = (startAddress + offset) % commands.length;
		if (commandDurationTicks(commands[address])) return address;
	}
	return startAddress;
}

// Commands already start at the requested address. Their playback clock
// starts at zero, while trace rows retain the original addresses in the ROM.
export function traceSm511Melody(commands, startAddress = 0) {
	const trace = [];
	let masterTick = 0;
	for (const [index, command] of commands.entries()) {
		const durationTicks = commandDurationTicks(command);
		trace.push({
			address: startAddress + index, command, masterTick, durationTicks,
			offsetSeconds: masterTick / MASTER_CLOCK_HZ,
			durationSeconds: durationTicks / MASTER_CLOCK_HZ,
		});
		if (!durationTicks) break;
		masterTick += durationTicks;
	}
	return trace;
}

export function compileSm511MelodySequence(plan) {
	const { words, startAddress } = getMelodySequence(plan);
	return traceSm511Melody(words, startAddress);
}

const hexByte = value => `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;

export function formatSm511MelodyCode(commands, startAddress = 0) {
	const melody = validateMelody(commands);
	validateStartAddress(startAddress);
	const lines = [];
	for (let start = 0; start < melody.length; start += 16) {
		const words = melody.subarray(start, start + 16);
		const hex = Array.from(words, hexByte);
		lines.push(`  ${hex.join(', ')},`);
	}
	return `const sm511 = await useSoundChip("sm511");\nsm511.setMelody([\n${lines.join('\n')}\n]);\nawait sm511.play(${hexByte(startAddress)});\n`;
}

export function sm511MelodyDuration(commands) {
	let ticks = 0;
	for (const command of commands) {
		const durationTicks = commandDurationTicks(command);
		if (!durationTicks) break;
		ticks += durationTicks;
	}
	return ticks / MASTER_CLOCK_HZ;
}

export function renderSm511Melody(core, commands, sampleRate) {
	const frames = Math.ceil(sm511MelodyDuration(commands) * sampleRate);
	return frames ? core.renderSm511Melody(commands, frames, sampleRate) : new Float32Array();
}

export function renderSm511Pattern(core, notes, { stepSeconds, gate = 1, sampleRate }) {
	const unitsPerStep = stepSeconds / SM511_SHORT_SECONDS;
	const commands = [];
	const boundaries = [];
	function append(command, units) {
		while (units >= 2) {
			commands.push(command | 0x20);
			units -= 2;
		}
		if (units) commands.push(command);
	}
	for (const [step, note] of notes.entries()) {
		const start = Math.round(step * unitsPerStep);
		const end = Math.round((step + 1) * unitsPerStep);
		const on = note === null || gate === 0 ? 0
			: Math.min(end - start, Math.max(1, Math.round((step + gate) * unitsPerStep) - start));
		boundaries.push(Math.round(start * SM511_SHORT_SECONDS * sampleRate));
		if (on) append(sm511Command(note), on);
		append(0, end - start - on);
	}
	const samples = renderSm511Melody(core, Uint8Array.from(commands), sampleRate);
	return { samples, boundaries, duration: samples.length / sampleRate };
}

export function renderSm511CommandCycle(core, command) {
	// The four stored phase lengths span two pulses.
	const frames = Math.round(2 * MASTER_CLOCK_HZ / core.sm511PitchHz(command));
	return core.renderSm511Tone(command, frames, MASTER_CLOCK_HZ);
}
