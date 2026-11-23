// SPDX-License-Identifier: BSD-3-Clause
import { MASTER_CLOCK_HZ } from './sm510.js';

export const SM511_ROM_STEPS = 256;
export const SM511_SHORT_SECONDS = 1 / 16;
const TICKS_PER_CYCLE = 4;
const INSTRUCTION_CYCLES = 2;
export const SM511_MACHINE_CYCLE_HZ = MASTER_CLOCK_HZ / TICKS_PER_CYCLE;
export const SM511_PRE_SECONDS = INSTRUCTION_CYCLES / SM511_MACHINE_CYCLE_HZ;
export const SM511_PRE = 0, SM511_SME = 1, SM511_RME = 2, SM511_TMEL = 3;
export const SM511_DEMO = Object.freeze([0x0d, 0x09, 0x27, 0x00, 0x15, 0x12, 0x01]);
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const SHORT_TICKS = SM511_SHORT_SECONDS * MASTER_CLOCK_HZ;
const STOP = 0x01;
const melodySequences = new WeakMap();
const instructionSequences = new WeakMap();
const instructionNames = ['PRE', 'SME', 'RME', 'TMEL'];
const MAX_MACHINE_CYCLES = 30 * SM511_MACHINE_CYCLE_HZ;

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

function buildSm511InstructionSequence(record, rom) {
	const words = rom.slice();
	let cycle = 0, recording = true;
	const events = [];
	function requireCycle(next) {
		if (!recording) throw new Error('The SM511 instruction recorder is closed.');
		if (!Number.isInteger(next) || next < cycle || next > MAX_MACHINE_CYCLES)
			throw new RangeError('Use nondecreasing SM511 machine cycles within 30 seconds, allowing two cycles per instruction.');
	}
	function issue(op, operand = 0) {
		const completed = cycle + INSTRUCTION_CYCLES;
		requireCycle(completed);
		cycle = completed;
		events.push(cycle * TICKS_PER_CYCLE, op, operand);
		return builder;
	}
	const builder = {
		atCycle(next) { requireCycle(next); cycle = next; return builder; },
		pre(address) { validateStartAddress(address); return issue(SM511_PRE, address); },
		sme() { return issue(SM511_SME); },
		rme() { return issue(SM511_RME); },
	};
	try {
		const result = record(builder);
		if (result && typeof result.then === 'function') {
			Promise.resolve(result).catch(() => {});
			throw new TypeError('Provide a synchronous SM511 instruction recorder.');
		}
	} finally { recording = false; }
	if (!events.length) throw new RangeError('Record at least one SM511 melody instruction.');
	const plan = Object.freeze({ machineCycles: cycle });
	instructionSequences.set(plan, { words, events: Uint32Array.from(events) });
	return plan;
}

export function readSm511InstructionSequence(plan) {
	const sequence = instructionSequences.get(plan);
	return sequence && { end: plan.machineCycles * TICKS_PER_CYCLE, words: sequence.words.slice(), events: sequence.events.slice() };
}

function compileSm511CodeSequence(plan) {
	const sequence = instructionSequences.get(plan);
	if (!sequence) return compileSm511MelodySequence(plan);
	const trace = [];
	const { events } = sequence;
	for (let i = 0; i < events.length; i += 3) {
		const masterTick = events[i], op = events[i + 1], operand = events[i + 2];
		trace.push({ operation: instructionNames[op], ...(op === SM511_PRE ? { address: operand } : {}),
			machineCycle: masterTick / TICKS_PER_CYCLE, masterTick, offsetSeconds: masterTick / MASTER_CLOCK_HZ });
	}
	return trace;
}

export function createSm511CodeChip({ play, stop, control }) {
	const rom = new Uint8Array(SM511_ROM_STEPS).fill(STOP);
	function snapshotFrom(address) {
		validateStartAddress(address);
		return rom.slice(address);
	}
	return {
		id: 'sm511',
		get clock() { return MASTER_CLOCK_HZ; },
		get machineCycleHz() { return SM511_MACHINE_CYCLE_HZ; },
		setMelody(commands) {
			const words = validateMelody(commands);
			rom.fill(STOP);
			rom.set(words);
			control?.reset();
		},
		play(startAddress = 0) { return play(snapshotFrom(startAddress)); },
		stop,
		async pre(address) { validateStartAddress(address); await control.command(rom, SM511_PRE, address); },
		async sme() { await control.command(rom, SM511_SME); },
		async rme() { await control.command(rom, SM511_RME); },
		async tmel() { return Boolean(await control.command(rom, SM511_TMEL)); },
		captureState() { return control.captureState(rom); },
		build(source = 0) {
			if (typeof source === 'number') return storeMelodySequence(snapshotFrom(source), source);
			if (typeof source === 'function') return buildSm511InstructionSequence(source, rom);
			return buildSm511MelodySequence(source);
		},
		compile: compileSm511CodeSequence,
		playMelody(commands) { return play(validateMelody(commands)); },
		stopMelody: stop,
	};
}

// Use a dedicated WASM instance for each live controller or offline render.
export function createSm511Controller(exports) {
	const {
		memory, __heap_base, sm511_controller_size, sm511_controller_reset, sm511_controller_load,
		sm511_controller_apply, sm511_controller_state, sm511_controller_render,
	} = exports;
	if (!(memory instanceof WebAssembly.Memory) || !Number.isInteger(__heap_base?.value) || [
		sm511_controller_size, sm511_controller_reset, sm511_controller_load, sm511_controller_apply,
		sm511_controller_state, sm511_controller_render,
	].some(fn => typeof fn !== 'function')) throw new Error('The audio core does not support SM511 instructions.');
	const state = __heap_base.value;
	const scratch = state + Math.ceil(sm511_controller_size() / 4) * 4;
	function reserve(end) {
		if (end > memory.buffer.byteLength) memory.grow(Math.ceil((end - memory.buffer.byteLength) / 65536));
	}
	reserve(scratch + SM511_ROM_STEPS);
	let rendered;
	const controller = {
		reset() { sm511_controller_reset(state); },
		load(words) {
			const rom = validateMelody(words);
			new Uint8Array(memory.buffer, scratch, rom.length).set(rom);
			sm511_controller_load(state, scratch, rom.length);
		},
		apply(op, arg = 0) { return sm511_controller_apply(state, op, arg); },
		getState() {
			sm511_controller_state(state, scratch);
			const [address, enabled, stopFlag, pin, masterTick] = new Uint32Array(memory.buffer, scratch, 5);
			return { address, enabled: Boolean(enabled), stopFlag: Boolean(stopFlag), pin, masterTick };
		},
		renderInto(samples, sampleRate, events) {
			const eventStart = scratch + samples.byteLength;
			reserve(eventStart + (events?.byteLength ?? 0));
			if (events?.length) new Uint32Array(memory.buffer, eventStart, events.length).set(events);
			if (rendered?.buffer !== memory.buffer || rendered.length !== samples.length)
				rendered = new Float32Array(memory.buffer, scratch, samples.length);
			sm511_controller_render(state, scratch, samples.length, sampleRate, events?.length ? eventStart : 0, (events?.length ?? 0) / 3);
			samples.set(rendered);
		},
	};
	controller.reset();
	return controller;
}

function commandDurationTicks(command) {
	if ((command & 0xf) === STOP) return 0;
	return command & 0x20 ? 2 * SHORT_TICKS : SHORT_TICKS;
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
