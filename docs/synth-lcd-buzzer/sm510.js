// SPDX-License-Identifier: BSD-3-Clause

export const MASTER_CLOCK_HZ = 32768;
export const TICKS_PER_MACHINE_CYCLE = 2;
export const MACHINE_CYCLE_HZ = MASTER_CLOCK_HZ / TICKS_PER_MACHINE_CYCLE;
export const R1_DIVISOR = 8;
export const R1_HZ = MASTER_CLOCK_HZ / R1_DIVISOR;
export const GATE_STEP_COUNT = 8;
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

export function createSm510CodeChip({ write, playCycles }) {
	const plans = new WeakMap();
	return {
		id: 'sm510',
		get REG_R() { return REG_R; },
		get clock() { return MASTER_CLOCK_HZ; },
		get machineCycleHz() { return MACHINE_CYCLE_HZ; },
		write(register, value) {
			checkWrite(register, value);
			write(Boolean(value & 1));
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

export function createR1Renderer({ memory, __heap_base, sm510_render_r1 }) {
	const start = __heap_base.value;
	return (writes, frameCount, sampleRate) => {
		const output = start + writes.byteLength;
		const bytes = output + frameCount * Float32Array.BYTES_PER_ELEMENT;
		if (bytes > memory.buffer.byteLength) memory.grow(Math.ceil((bytes - memory.buffer.byteLength) / 65536));
		new Uint32Array(memory.buffer, start, writes.length).set(writes);
		sm510_render_r1(output, frameCount, sampleRate, start, writes.length / 2);
		return new Float32Array(memory.buffer, output, frameCount).slice();
	};
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
