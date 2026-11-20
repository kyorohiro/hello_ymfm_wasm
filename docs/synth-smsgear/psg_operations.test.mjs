import test from "node:test";
import assert from "node:assert/strict";
import { SegaPSGSynth } from "../js/segapsgsynth.js";
import {
	buildPsgOperations as build,
	validatePsgOperations as validate,
	compilePsgOperations as compile,
	createPsgOperationResolver as resolver,
	createPsgOperationResetState as reset,
	validatePsgOperationState,
	psgOperationOffsetSeconds,
	MAX_PSG_OPERATIONS,
} from "./psg_operations.js";
import {
	createPsgTimedSnapshot,
	validatePsgTimedSnapshot,
} from "./psg_timed_state.js";

const call = (method, ...args) => ({ method, args });

test("PSG build records once without resolving arguments, uses absolute mixed time and closes leaked recorders", () => {
	let runs = 0,
		leaked;
	const program = build((b) => {
		runs++;
		leaked = b;
		b.atSample(4410)
			.setAttenuation(0, 3)
			.atSeconds(0.1)
			.setNoise({ type: "white", rate: "tone3" });
	});
	assert.equal(runs, 1);
	assert.equal(program.chip, "segapsg");
	assert.equal(program.referenceSampleRate, 44100);
	assert.deepEqual(
		program.operations.map((op) => [
			op.order,
			psgOperationOffsetSeconds(op),
		]),
		[
			[0, 0.1],
			[1, 0.1],
		],
	);
	assert.deepEqual(structuredClone(program), program);
	assert.throws(() => leaked.write(128), /no longer active/);
	assert.doesNotThrow(
		() => build((b) => b.setAttenuation(0, 99)),
		"build records data, argument validation belongs to compile/admission",
	);
	assert.throws(
		() => validate(build((b) => b.setAttenuation(0, 99))),
		/attenuation/i,
	);
	const custom = build((b) => b.atSample(4800).keyOn(0), {
		referenceSampleRate: 48000,
	});
	assert.equal(psgOperationOffsetSeconds(custom.operations[0], 48000), 0.1);
});

test("PSG program and argument copies are strict, serializable and bounded", () => {
	const settings = { type: "white", rate: "high" };
	const p = build((b) => b.setNoise(settings));
	settings.rate = "low";
	assert.equal(p.operations[0].args[0].rate, "high");
	assert.throws(() => build(async (b) => b.keyOn(0)), /synchronous/);
	assert.throws(
		() => build((b) => b.atSeconds(0.2).keyOn(0).atSample(1).keyOff(0)),
		/nondecreasing/,
	);
	assert.throws(
		() => build((b) => b.atSample(0.5).keyOn(0)),
		/safe integers/,
	);
	assert.throws(() => build((b) => b.setNoise({ fn() {} })), /serializable/);
	const cyclic = {};
	cyclic.self = cyclic;
	assert.throws(() => build((b) => b.setNoise(cyclic)), /acyclic/);
	const getter = {};
	Object.defineProperty(getter, "type", {
		get() {
			throw Error("getter invoked");
		},
	});
	assert.throws(() => build((b) => b.setNoise(getter)), /accessors/);
	assert.throws(() => validate({ ...p, extra: true }), /Unknown/);
	assert.throws(
		() =>
			validate({ ...p, operations: [{ ...p.operations[0], order: 1 }] }),
		/order/,
	);
	assert.throws(
		() =>
			build((b) => {
				for (let i = 0; i <= MAX_PSG_OPERATIONS; i++) b.write(159);
			}),
		/at most/,
	);
});

test("PSG compile uses existing immediate Synth conversions and emits only operation writes", () => {
	const state = reset(),
		expected = [],
		api = new SegaPSGSynth({
			transport: {
				clock: state.clock,
				write: (value) => expected.push(value),
				setStereo: (stereo) => expected.push({ stereo }),
			},
		});
	api._adoptState(state);
	const methods = [
		call("setAttenuation", 0, 3),
		call("noteOn", 0, "C4"),
		call("setNoise", { type: "white", rate: "tone3" }),
		call("noise", { type: "periodic", rate: "high", attenuation: 7 }),
		call("keyOff", 0),
		call("keyOn", 0),
		call("setStereo", 0x81),
	];
	const p = build((b) => {
		for (const [i, c] of methods.entries())
			b.atSample(i * 10)[c.method](...c.args);
	});
	for (const c of methods) api[c.method](...c.args);
	const before = structuredClone(state),
		rows = compile(p, state);
	assert.deepEqual(
		rows.map((r) => ("stereo" in r ? { stereo: r.stereo } : r.value)),
		expected,
	);
	assert.deepEqual(state, before);
	assert(
		rows.every((r) => r.offsetSeconds === (r.operationIndex * 10) / 44100),
	);
	assert.deepEqual(
		compile(
			build(() => {}),
			state,
		),
		[],
	);
});

test("PSG raw data bytes use the supplied live latch and preserve untouched tone nibbles", () => {
	const p = build((b) => b.write(0x21));
	const a = reset();
	a.latched = 0;
	a.periods[0] = 7;
	const b = reset();
	b.latched = 3;
	b.attenuations[1] = 2;
	const ra = resolver().resolve(p.operations[0], a),
		rb = resolver().resolve(p.operations[0], b);
	assert.equal(ra.state.periods[0], 0x217);
	assert.equal(ra.writes[0].register, 0);
	assert.equal(rb.state.attenuations[1], 1);
	assert.equal(rb.writes[0].register, 3);
	assert.equal(a.periods[0], 7);
	assert.equal(b.attenuations[1], 2);
});

test("PSG configured levels distinguish explicit silent edits from temporary keyOff mute", () => {
	const r = resolver(),
		state = reset();
	state.attenuations[0] = 3;
	const off = r.resolve(call("keyOff", 0), state);
	assert.equal(off.writes[0].value, 0x9f);
	assert.equal(off.state.attenuations[0], 3);
	const on = r.resolve(call("keyOn", 0), off.state);
	assert.equal(on.writes[0].value, 0x93);
	const silent = r.resolve(call("setAttenuation", 0, 15), on.state);
	assert.equal(silent.state.attenuations[0], 15);
	assert.equal(
		r.resolve(call("keyOn", 0), silent.state).writes[0].value,
		0x9f,
	);
	assert.deepEqual(state.attenuations, [3, 0, 0, 0]);
});

test("PSG same-time order and repeated Noise writes survive compilation and state resolution", () => {
	const state = reset(),
		p = build((b) => b.write(0xe4).write(0xe4).write(0xf3).noiseOff());
	const rows = compile(p, state);
	assert.deepEqual(
		rows.map((r) => r.value),
		[0xe4, 0xe4, 0xf3, 0xff],
	);
	assert.deepEqual(
		rows.map((r) => r.operationIndex),
		[0, 1, 2, 3],
	);
	let applied = state;
	const r = resolver();
	const actual = [];
	for (const op of p.operations) {
		const result = r.resolve(op, applied);
		actual.push(...result.writes);
		applied = result.state;
	}
	assert.deepEqual(
		actual,
		rows.map(
			({ offsetSeconds, operationIndex, writeIndex, ...row }) => row,
		),
	);
	assert.equal(applied.noiseMode, 4);
	assert.equal(applied.attenuations[3], 15);
});

test("PSG operation state/config validation rejects partial or incompatible inputs atomically", () => {
	const state = reset();
	const before = structuredClone(state);
	assert.throws(
		() =>
			compile(
				build((b) => b.keyOn(0).setAttenuation(0, 16)),
				state,
			),
		/attenuation/i,
	);
	assert.deepEqual(state, before);
	assert.throws(
		() => validatePsgOperationState({ ...state, periods: [1] }),
		/Incomplete/,
	);
	assert.throws(
		() => resolver({ clock: 4000000 }).resolve(call("keyOn", 0), state),
		/Incompatible/,
	);
	assert.throws(
		() =>
			compile(
				build((b) => b.setStereo(128)),
				reset({ stereoEnabled: false }),
			),
		/Stereo routing/,
	);
	assert.throws(
		() =>
			validatePsgOperationState({
				...state,
				stereoEnabled: false,
				stereo: 128,
			}),
		/Mono/,
	);
	assert.throws(
		() => validatePsgOperationState({ ...state, noiseMode: 8 }),
		/Noise/,
	);
	const levels = [0, 1, 2, 3];
	Object.defineProperty(levels, "0", {
		get() {
			throw Error("getter invoked");
		},
	});
	assert.throws(
		() => validatePsgOperationState({ ...state, attenuations: levels }),
		/plain values/,
	);
});

test("PSG snapshots own frozen state reusable across operation comparisons and validate identity/config", () => {
	const state = reset();
	state.attenuations[0] = 4;
	state.periods[0] = 100;
	const snapshot = createPsgTimedSnapshot(state, {
		instanceId: "a",
		frame: 128,
		sampleRate: 48000,
	});
	state.attenuations[0] = 9;
	state.periods[0] = 500;
	const a = compile(
			build((b) => b.keyOn(0)),
			snapshot.state,
		),
		b = compile(
			build((b) => b.keyOff(0)),
			snapshot.state,
		);
	assert.equal(a[0].value, 0x94);
	assert.equal(b[0].value, 0x9f);
	assert.equal(snapshot.state.periods[0], 100);
	assert(Object.isFrozen(snapshot.state.attenuations));
	const copy = validatePsgTimedSnapshot(structuredClone(snapshot), {
		instanceId: "a",
		clock: snapshot.state.clock,
		stereoEnabled: true,
	});
	assert.deepEqual(copy, snapshot);
	assert.notEqual(copy, snapshot);
	assert.notEqual(copy.state.periods, snapshot.state.periods);
	assert.throws(
		() => validatePsgTimedSnapshot(snapshot, { instanceId: "b" }),
		/instance/,
	);
	assert.throws(
		() => validatePsgTimedSnapshot(snapshot, { clock: 4000000 }),
		/clock/,
	);
	assert.throws(
		() => validatePsgTimedSnapshot(snapshot, { stereoEnabled: false }),
		/stereo/,
	);
	assert.throws(
		() => validatePsgTimedSnapshot({ ...snapshot, format: "another-chip" }),
		/format/,
	);
});

test("PSG tone convenience calls and default Noise preserve immediate API conversion", () => {
	const plan = build((b) =>
		b.tone(1, { period: 123, attenuation: 6 }).setNoise(),
	);
	const rows = compile(plan, reset());
	assert.deepEqual(
		rows.map((w) => w.value),
		[0xab, 7, 0xb6, 0xe5],
	);
});
