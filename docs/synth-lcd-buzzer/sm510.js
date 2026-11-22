// SPDX-License-Identifier: BSD-3-Clause

export const MASTER_CLOCK_HZ = 32768;
export const TICKS_PER_MACHINE_CYCLE = 2;
export const MACHINE_CYCLE_HZ = MASTER_CLOCK_HZ / TICKS_PER_MACHINE_CYCLE;
export const R1_DIVISOR = 8;
export const R1_HZ = MASTER_CLOCK_HZ / R1_DIVISOR;
export const GATE_STEP_COUNT = 8;
export const DIRECT_R = 'direct';
export const DK52_R = 'dk52';
export const EQUAL_TEMPERAMENT = 'equal';
export const R_WRITE_CYCLES = 2; // LAX followed by ATR
const REG_R = 0;
const EDGE_SECONDS = .008;
const MAX_MACHINE_CYCLES = 30 * MACHINE_CYCLE_HZ;

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

export function createSm510CodeChip({ id = 'sm510', write, playCycles }) {
	const plans = new WeakMap();
	return {
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
			plans.set(plan, { end, writes: Uint32Array.from(writes) });
			return plan;
		},
		playCycles(plan) {
			const timeline = plans.get(plan);
			if (!timeline) throw new TypeError('Provide an SM510 cycle sequence from build().');
			return playCycles(timeline);
		},
	};
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

export function createR1Voice(context, output, render) {
	const source = context.createBufferSource(), gain = context.createGain();
	const samples = render(Uint32Array.of(0, 1), context.sampleRate, context.sampleRate);
	const buffer = context.createBuffer(1, samples.length, context.sampleRate);
	buffer.copyToChannel(samples, 0);
	source.buffer = buffer;
	source.loop = true;
	gain.gain.value = 0;
	source.connect(gain);
	gain.connect(output);
	source.onended = () => { source.disconnect(); gain.disconnect(); };
	source.start();

	let enabled = false, silenceAt = context.currentTime;
	function setGate(next, time = context.currentTime) {
		if (next === enabled) return;
		enabled = next;
		const level = next ? 1 : 0;
		gain.gain.cancelScheduledValues(context.currentTime);
		gain.gain.setTargetAtTime(level, time, .001);
		gain.gain.setValueAtTime(level, time + EDGE_SECONDS);
		if (!next) silenceAt = time + EDGE_SECONDS;
	}
	return {
		get enabled() { return enabled; },
		setGate,
		dispose() {
			setGate(false);
			const now = context.currentTime;
			source.stop(Math.max(now, silenceAt));
			if (silenceAt > now) return silenceAt;
		},
	};
}

export function createSm510AudioCore({
	memory, __heap_base, sm510_render_r1, sm510_direct_half_cycles,
	sm510_render_direct_note, sm510_render_direct_r1,
	sm511_pitch_hz, sm511_render_tone, sm511_render_melody,
}) {
	if (!(memory instanceof WebAssembly.Memory) || !Number.isInteger(__heap_base?.value) ||
		[sm510_render_r1, sm510_direct_half_cycles, sm510_render_direct_note, sm510_render_direct_r1,
			sm511_pitch_hz, sm511_render_tone, sm511_render_melody]
			.some(render => typeof render !== 'function')) {
		throw new Error('The installed audio core does not support SM510 and SM511.');
	}
	const start = __heap_base.value;
	function reserve(bytes) {
		if (bytes > memory.buffer.byteLength) memory.grow(Math.ceil((bytes - memory.buffer.byteLength) / 65536));
	}
	function r1Renderer(render) {
		return (writes, frameCount, sampleRate) => {
			const output = start + writes.byteLength;
			reserve(output + frameCount * Float32Array.BYTES_PER_ELEMENT);
			new Uint32Array(memory.buffer, start, writes.length).set(writes);
			render(output, frameCount, sampleRate, start, writes.length / 2);
			return new Float32Array(memory.buffer, output, frameCount).slice();
		};
	}
	function renderTone(render, command, frames, sampleRate) {
		reserve(start + frames * Float32Array.BYTES_PER_ELEMENT);
		render(start, frames, sampleRate, command);
		return new Float32Array(memory.buffer, start, frames).slice();
	}
	return {
		directHalfCycles: sm510_direct_half_cycles,
		renderR1: r1Renderer(sm510_render_r1),
		renderDirectR1: r1Renderer(sm510_render_direct_r1),
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

export function renderSm510Notes(core, mode, frequencies, { stepSeconds, gate = 1, sampleRate }) {
	const stepCycles = MACHINE_CYCLE_HZ * stepSeconds;
	const end = Math.round(frequencies.length * stepCycles) * TICKS_PER_MACHINE_CYCLE;
	const writes = [];
	const write = (cycle, value) => writes.push(cycle * TICKS_PER_MACHINE_CYCLE, value);
	for (const [step, frequency] of frequencies.entries()) {
		if (frequency === null) continue;
		// The first pin change occurs after LAX and ATR finish. At release, the
		// direct two-page routine leaves R1 low after its last complete period.
		const on = Math.round(step * stepCycles) + R_WRITE_CYCLES;
		const off = Math.round((step + gate) * stepCycles);
		if (off - on < R_WRITE_CYCLES) continue;
		if (mode === DK52_R) {
			write(on, 1);
			write(off, 0);
		} else {
			const half = core.directHalfCycles(frequency);
			if (!half) throw new RangeError('The direct R note needs a positive frequency.');
			const period = half * 2;
			for (let high = on; high + period <= off; high += period) {
				write(high, 1);
				write(high + half, 0);
			}
		}
	}
	const render = mode === DK52_R ? core.renderR1 : core.renderDirectR1;
	const samples = renderR1Timeline({ end, writes: Uint32Array.from(writes) }, sampleRate, render);
	return { samples, stepFrames: sampleRate * stepSeconds, duration: samples.length / sampleRate };
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
