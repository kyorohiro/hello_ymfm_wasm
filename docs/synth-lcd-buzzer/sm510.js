// SPDX-License-Identifier: BSD-3-Clause

export const MASTER_CLOCK_HZ = 32768;
export const TICKS_PER_MACHINE_CYCLE = 2;
export const MACHINE_CYCLE_HZ = MASTER_CLOCK_HZ / TICKS_PER_MACHINE_CYCLE;
export const R1_DIVISOR = 8;
export const R1_HZ = MASTER_CLOCK_HZ / R1_DIVISOR;
export const GATE_STEP_COUNT = 8;
export const DIRECT_R = 'direct';
export const DK52_R = 'dk52';
export const R_WRITE_CYCLES = 2; // LAX followed by ATR
export const MIN_PULSE_HALF_CYCLES = 4;
export const MAX_PULSE_HALF_CYCLES = 63;
const REG_R = 0;
const EDGE_SECONDS = .008;
const MAX_MACHINE_CYCLES = 30 * MACHINE_CYCLE_HZ;
const cycleSequences = new WeakMap();

export const GATE_PRESETS = {
	short: { stepMs: 85, on: [0] },
	double: { stepMs: 85, on: [0, 2] },
	flutter: { stepMs: 35, on: [0, 2, 4, 6] },
};

function checkWrite(register, value) {
	if (register !== REG_R) throw new RangeError('Choose the SM510 register REG_R.');
	if (!Number.isInteger(value) || value < 0 || value > 15)
		throw new RangeError('REG_R expects a 4-bit integer from 0x0 to 0xF.');
}

function getCycleSequence(plan, chip) {
	const sequence = cycleSequences.get(plan);
	if (!sequence || (chip !== undefined && sequence.chip !== chip))
		throw new TypeError('Provide an SM510 cycle sequence from build().');
	return sequence;
}

export function readSm510CycleSequence(plan, chip) {
	const { id, end, writes } = getCycleSequence(plan, chip);
	return { id, end, writes: writes.slice() };
}

export function createSm510CodeChip({ id = 'sm510', write, playCycles }) {
	const chip = {
		id,
		get REG_R() { return REG_R; },
		get clock() { return MASTER_CLOCK_HZ; },
		get machineCycleHz() { return MACHINE_CYCLE_HZ; },
		write(register, value) {
			checkWrite(register, value);
			write(value & 3);
		},
		build(record) {
			if (typeof record !== 'function') throw new TypeError('Provide a synchronous cycle recorder.');
			const writes = [];
			let cycle = 0, recording = true;
			const builder = {
				atCycle(nextCycle) {
					if (!recording) throw new Error('The cycle recorder is closed.');
					if (!Number.isInteger(nextCycle) || nextCycle < cycle || nextCycle > MAX_MACHINE_CYCLES)
						throw new RangeError('Use nondecreasing machine cycles within 30 seconds.');
					cycle = nextCycle;
					return builder;
				},
				write(register, value) {
					if (!recording) throw new Error('The cycle recorder is closed.');
					checkWrite(register, value);
					writes.push(cycle * TICKS_PER_MACHINE_CYCLE, value);
					return builder;
				},
			};
			try {
				const result = record(builder);
				if (result && typeof result.then === 'function') {
					Promise.resolve(result).catch(() => {});
					throw new TypeError('Provide a synchronous cycle recorder.');
				}
			} finally { recording = false; }
			if (!cycle) throw new RangeError('Set the end of the sequence with atCycle().');
			const end = cycle * TICKS_PER_MACHINE_CYCLE;
			const plan = Object.freeze({ machineCycles: cycle });
			writes.push(end, 0);
			cycleSequences.set(plan, { chip, id, end, writes: Uint32Array.from(writes) });
			return plan;
		},
		compile(plan) {
			const { writes } = getCycleSequence(plan, chip);
			const trace = [];
			// The final pair closes playback and was not authored by the caller.
			for (let index = 0; index < writes.length - 2; index += 2) {
				const masterTick = writes[index];
				trace.push({
					offsetSeconds: masterTick / MASTER_CLOCK_HZ,
					machineCycle: masterTick / TICKS_PER_MACHINE_CYCLE,
					masterTick, register: REG_R, value: writes[index + 1],
					operationIndex: index / 2, writeIndex: 0,
				});
			}
			return trace;
		},
		playCycles(plan) {
			const { end, writes } = readSm510CycleSequence(plan, chip);
			return playCycles({ end, writes });
		},
	};
	return chip;
}

export function readRAtTick({ writes }, tick) {
	let first = 0, end = writes.length / 2;
	while (first < end) {
		const middle = Math.floor((first + end) / 2);
		if (writes[middle * 2] <= tick) first = middle + 1;
		else end = middle;
	}
	return first ? writes[first * 2 - 1] & 3 : 0;
}

export function buildSm510Pulse(mode, halfCycles, driveMask, highCycles = halfCycles) {
	const direct = mode === DIRECT_R;
	if (!direct && mode !== DK52_R) throw new RangeError('Choose Direct R or the DK-52 divider.');
	if (!Number.isInteger(driveMask) || driveMask < 0 || driveMask > 3)
		throw new RangeError('Use a two-bit R pin mask.');
	const loopStart = R_WRITE_CYCLES * TICKS_PER_MACHINE_CYCLE;
	const continuous = !direct && halfCycles === 0 && highCycles === 0;
	if (!continuous && (!Number.isInteger(halfCycles) || halfCycles < MIN_PULSE_HALF_CYCLES || halfCycles > MAX_PULSE_HALF_CYCLES))
		throw new RangeError(`Use ${MIN_PULSE_HALF_CYCLES}–${MAX_PULSE_HALF_CYCLES} machine cycles per half-period.`);
	const halfTicks = halfCycles * TICKS_PER_MACHINE_CYCLE;
	if (highCycles === 0 || highCycles === 2 * halfCycles) {
		let latch;
		if (direct) latch = driveMask & (highCycles > 0 ? 1 : 2);
		else latch = continuous || highCycles > 0 ? driveMask : 0;
		const loopLength = direct ? 2 * halfTicks : R1_DIVISOR;
		return { end: loopStart + loopLength, writes: Uint32Array.of(loopStart, latch), loopStart, halfTicks };
	}
	if (!Number.isInteger(highCycles) || highCycles < R_WRITE_CYCLES ||
		2 * halfCycles - highCycles < R_WRITE_CYCLES)
		throw new RangeError('Allow at least two machine cycles for each R phase.');

	const highTicks = highCycles * TICKS_PER_MACHINE_CYCLE;
	const period = 2 * halfTicks;
	// An odd number of machine cycles per half-period flips the divider phase
	// after one pulse period, so the loop must include both phases.
	const loopLength = !direct && period % R1_DIVISOR ? 2 * period : period;
	const end = loopStart + loopLength;
	const high = direct ? driveMask & 1 : driveMask;
	const low = direct ? driveMask & 2 : 0;
	const writes = [];
	for (let tick = loopStart; tick < end; tick += period) writes.push(tick, high, tick + highTicks, low);
	return { end, writes: Uint32Array.from(writes), loopStart, halfTicks };
}

export function connectRChannels(source, context, outputs) {
	const splitter = context.createChannelSplitter(2);
	source.connect(splitter);
	for (const [channel, output] of outputs.entries()) splitter.connect(output, channel);
	return splitter;
}

export function createRVoice(context, outputs, renderR1, renderR2) {
	const source = context.createBufferSource(), rate = context.sampleRate;
	const buffer = context.createBuffer(2, rate, rate);
	buffer.copyToChannel(renderR1(Uint32Array.of(0, 1), rate, rate), 0);
	buffer.copyToChannel(renderR2(Uint32Array.of(0, 2), rate, rate), 1);
	source.buffer = buffer;
	source.loop = true;
	const gates = outputs.map(output => {
		const gate = context.createGain();
		gate.gain.value = 0;
		gate.connect(output);
		return gate;
	});
	const splitter = connectRChannels(source, context, gates);
	source.onended = () => {
		source.disconnect();
		splitter.disconnect();
		for (const gate of gates) gate.disconnect();
	};
	source.start();

	let value = 0, silenceAt = context.currentTime;
	function setValue(next, time = context.currentTime) {
		const nextValue = next & 3;
		const changed = value ^ nextValue;
		value = nextValue;
		const now = context.currentTime;
		for (const [channel, { gain }] of gates.entries()) {
			const bit = 1 << channel;
			if (!(changed & bit)) continue;
			const level = value & bit ? 1 : 0;
			gain.cancelScheduledValues(now);
			gain.setTargetAtTime(level, time, .001);
			gain.setValueAtTime(level, time + EDGE_SECONDS);
			if (!level) silenceAt = Math.max(silenceAt, time + EDGE_SECONDS);
		}
	}
	return {
		setValue,
		dispose() {
			setValue(0);
			const now = context.currentTime;
			source.stop(Math.max(now, silenceAt));
			if (silenceAt > now) return silenceAt;
		},
	};
}

export function createSm510AudioCore({
	memory, __heap_base, sm510_render_r1, sm510_direct_half_cycles,
	sm510_direct_high_cycles, sm510_render_direct_note, sm510_render_direct_r1,
	sm511_pitch_hz, sm511_render_tone, sm511_render_melody,
}) {
	if (!(memory instanceof WebAssembly.Memory) || !Number.isInteger(__heap_base?.value) ||
		[sm510_render_r1, sm510_direct_half_cycles, sm510_direct_high_cycles, sm510_render_direct_note, sm510_render_direct_r1,
			sm511_pitch_hz, sm511_render_tone, sm511_render_melody]
			.some(render => typeof render !== 'function')) {
		throw new Error('The installed audio core does not support SM510 and SM511.');
	}
	const start = __heap_base.value;
	function reserve(bytes) {
		if (bytes > memory.buffer.byteLength) memory.grow(Math.ceil((bytes - memory.buffer.byteLength) / 65536));
	}
	function pinRenderer(render, { r2 = false, invert = false } = {}) {
		return (writes, frameCount, sampleRate) => {
			const output = start + writes.byteLength;
			reserve(output + frameCount * Float32Array.BYTES_PER_ELEMENT);
			const events = new Uint32Array(memory.buffer, start, writes.length);
			events.set(writes);
			// Let the R1 integrator see bit 1 without shifting any write's time.
			if (r2) {
				for (let index = 1; index < events.length; index += 2) events[index] = (events[index] >>> 1) & 1;
			}
			render(output, frameCount, sampleRate, start, writes.length / 2);
			const samples = new Float32Array(memory.buffer, output, frameCount).slice();
			if (invert) {
				for (let index = 0; index < samples.length; index++) {
					if (samples[index] !== 0) samples[index] = -samples[index];
				}
			}
			return samples;
		};
	}
	function renderTone(render, command, frames, sampleRate) {
		reserve(start + frames * Float32Array.BYTES_PER_ELEMENT);
		render(start, frames, sampleRate, command);
		return new Float32Array(memory.buffer, start, frames).slice();
	}
	function pulseTiming(halfCycles, duty = .5) {
		if (!Number.isInteger(halfCycles) || halfCycles < MIN_PULSE_HALF_CYCLES || halfCycles > MAX_PULSE_HALF_CYCLES)
			throw new RangeError(`Use ${MIN_PULSE_HALF_CYCLES}–${MAX_PULSE_HALF_CYCLES} machine cycles per half-period.`);
		if (!Number.isFinite(duty) || duty < 0 || duty > 1)
			throw new RangeError('R duty must be between 0 and 1.');
		const periodCycles = 2 * halfCycles;
		const steadyLatch = duty === 0 || duty === 1;
		// LAX and ATR have the same timing under both R output masks.
		const highCycles = steadyLatch ? periodCycles * duty : sm510_direct_high_cycles(periodCycles, duty);
		return {
			highCycles, lowCycles: periodCycles - highCycles, periodCycles,
			frequency: steadyLatch ? 0 : directPitchHz(halfCycles), duty: highCycles / periodCycles,
		};
	}
	return {
		directHalfCycles: sm510_direct_half_cycles,
		pulseTiming,
		directPulseTiming: pulseTiming,
		dividerPulseTiming: pulseTiming,
		renderR1: pinRenderer(sm510_render_r1),
		renderR2: pinRenderer(sm510_render_r1, { r2: true, invert: true }),
		renderDirectR1: pinRenderer(sm510_render_direct_r1),
		renderDirectR2: pinRenderer(sm510_render_direct_r1, { r2: true }),
		renderDirectNote(halfCycles, frames, sampleRate) {
			return renderTone(sm510_render_direct_note, halfCycles, frames, sampleRate);
		},
		sm511PitchHz: sm511_pitch_hz,
		renderSm511Tone(command, frames, sampleRate) {
			return renderTone(sm511_render_tone, command, frames, sampleRate);
		},
		renderSm511Melody(commands, frames, sampleRate) {
			const output = start + Math.ceil(commands.length / 4) * 4;
			reserve(output + frames * Float32Array.BYTES_PER_ELEMENT);
			new Uint8Array(memory.buffer, start, commands.length).set(commands);
			sm511_render_melody(output, frames, sampleRate, start, commands.length);
			return new Float32Array(memory.buffer, output, frames).slice();
		},
	};
}

export const directPitchHz = halfCycles => MACHINE_CYCLE_HZ / (2 * halfCycles);

export function renderSm510Notes(core, mode, frequencies, { stepSeconds, gate = 1, sampleRate, duty = .5 }) {
	const stepCycles = MACHINE_CYCLE_HZ * stepSeconds;
	const end = Math.round(frequencies.length * stepCycles) * TICKS_PER_MACHINE_CYCLE;
	const writes = [];
	const directPulses = mode === DK52_R ? null : Array(frequencies.length).fill(null);
	const write = (cycle, value) => writes.push(cycle * TICKS_PER_MACHINE_CYCLE, value);
	for (const [step, frequency] of frequencies.entries()) {
		if (frequency === null) continue;
		let pulse;
		if (directPulses) {
			const half = core.directHalfCycles(frequency);
			if (!half) throw new RangeError('The direct R note needs a positive frequency.');
			pulse = directPulses[step] = core.directPulseTiming(half, duty);
			if (!pulse.frequency) continue; // A held pin level produces no sustained tone.
		}
		// The first pin change occurs after LAX and ATR finish. At release, the
		// direct routine leaves R1 low after its last complete period.
		const on = Math.round(step * stepCycles) + R_WRITE_CYCLES;
		const off = Math.round((step + gate) * stepCycles);
		if (off - on < R_WRITE_CYCLES) continue;
		if (!pulse) {
			write(on, 1);
			write(off, 0);
		} else {
			const { highCycles, periodCycles } = pulse;
			for (let high = on; high + periodCycles <= off; high += periodCycles) {
				write(high, 1);
				write(high + highCycles, 0);
			}
		}
	}
	const render = mode === DK52_R ? core.renderR1 : core.renderDirectR1;
	const samples = renderR1Timeline({ end, writes: Uint32Array.from(writes) }, sampleRate, render);
	const rendered = { samples, stepFrames: sampleRate * stepSeconds, duration: samples.length / sampleRate };
	if (directPulses) rendered.directPulses = directPulses;
	return rendered;
}

export function renderR1Timeline({ end, writes }, sampleRate, render) {
	return render(writes, Math.ceil(end * sampleRate / MASTER_CLOCK_HZ), sampleRate);
}

export function renderR1Pattern(gates, { stepMs, sampleRate = 48000 }, render) {
	if (!Array.isArray(gates) || gates.length !== GATE_STEP_COUNT) throw new TypeError('Use eight on/off gates.');
	for (const gate of gates) {
		if (typeof gate !== 'boolean') throw new TypeError('Use eight on/off gates.');
	}
	if (!Number.isFinite(stepMs) || stepMs < 20 || stepMs > 250)
		throw new RangeError('Step time must be 20–250 ms.');
	if (!Number.isInteger(sampleRate) || sampleRate <= R1_HZ * 2 || sampleRate > 384000)
		throw new RangeError('The audio sample rate must support a 4,096 Hz carrier.');

	const stepTicks = MASTER_CLOCK_HZ * stepMs / 1000;
	const end = Math.round(gates.length * stepTicks);
	const writes = new Uint32Array((gates.length + 1) * 2);
	for (const [index, enabled] of gates.entries()) {
		writes[index * 2] = Math.round(index * stepTicks);
		writes[index * 2 + 1] = Number(enabled);
	}
	writes[gates.length * 2] = end;
	return { samples: renderR1Timeline({ end, writes }, sampleRate, render), stepFrames: sampleRate * stepMs / 1000 };
}
