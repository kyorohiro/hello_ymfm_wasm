import test from "node:test";
import assert from "node:assert/strict";
import { YM2413Synth } from "../js/ym2413synth.js";
import {
	buildOpllOperations as build,
	validateOpllOperations as validate,
	compileOpllOperations as compile,
	createOpllOperationResetState as reset,
	validateOpllOperationState,
	createOpllOperationResolver as resolver,
	opllOperationOffsetSeconds,
	MAX_OPLL_OPERATIONS,
} from "./opll_operations.js";
import {
	createOpllTimedSnapshot,
	validateOpllTimedSnapshot,
} from "./opll_timed_state.js";
const call = (method, ...args) => ({ method, args });

test("OPLL build records once with owned plain data and absolute mixed offsets, without argument resolution", () => {
	let count = 0,
		leaked;
	const voice = { instrument: 2, attenuation: 3 };
	const p = build((b) => {
		count++;
		leaked = b;
		b.atSeconds(0.1).setVoice(0, voice).atSample(4410).keyOn(0);
	});
	voice.attenuation = 15;
	assert.equal(count, 1);
	assert.equal(p.chip, "ym2413");
	assert.equal(p.operations[0].args[1].attenuation, 3);
	assert.deepEqual(
		p.operations.map((op) => opllOperationOffsetSeconds(op)),
		[0.1, 0.1],
	);
	assert.deepEqual(p, structuredClone(p));
	assert.throws(() => leaked.keyOn(0), /no longer active/);
	const custom = build((b) => b.atSample(4800).keyOff(0), {
		referenceSampleRate: 48000,
	});
	assert.equal(opllOperationOffsetSeconds(custom.operations[0], 48000), 0.1);
	assert.doesNotThrow(() =>
		build((b) => b.setVoice(999, { instrument: 99 })),
	);
	assert.throws(
		() => validate(build((b) => b.setVoice(999, { instrument: 99 }))),
		/channel/,
	);
});

test("OPLL records reject callbacks, accessors, cycles, unknown methods and unbounded data", () => {
	assert.throws(() => build(async (b) => b.keyOn(0)), /synchronous/);
	assert.throws(
		() => build((b) => b.atSeconds(0.1).keyOn(0).atSample(0).keyOff(0)),
		/nondecreasing/,
	);
	assert.throws(
		() => build((b) => b.setUserPatch({ fn() {} })),
		/serializable/,
	);
	const cycle = {};
	cycle.self = cycle;
	assert.throws(() => build((b) => b.setUserPatch(cycle)), /acyclic/);
	const access = {};
	Object.defineProperty(access, "ar", {
		get() {
			throw Error("getter invoked");
		},
	});
	assert.throws(
		() => build((b) => b.setUserOperator(0, access)),
		/accessors/,
	);
	const p = build((b) => b.keyOn(0));
	assert.throws(() => validate({ ...p, extra: 1 }), /Unknown/);
	assert.throws(
		() =>
			validate({
				...p,
				operations: [{ ...p.operations[0], method: "initialize" }],
			}),
		/Unsupported/,
	);
	assert.throws(
		() =>
			build((b) => {
				for (let i = 0; i <= MAX_OPLL_OPERATIONS; i++) b.keyOn(0);
			}),
		/at most/,
	);
});

test("OPLL compiler delegates register math to existing immediate Synth and emits no baseline writes", () => {
	const state = reset(),
		expected = [],
		synth = new YM2413Synth({
			clock: state.clock,
			transport: {
				writeRegister: (register, value) =>
					expected.push({ register, value }),
			},
		});
	synth.adoptRegisterSnapshot(state.registers);
	const methods = [
		call("setUserPatch", {
			feedback: 3,
			operators: [
				{ multi: 2, ar: 10, tl: 20 },
				{ multi: 1, ar: 14 },
			],
		}),
		call("setVoice", 0, { instrument: 0, attenuation: 4, sustain: true }),
		call("noteOn", 0, "C4"),
		call("setFrequency", 1, 440),
		call("setPitch", 2, 123, 5),
		call("keyOn", 2),
		call("noteOff", 0),
		call("setSustain", 1, true),
	];
	const p = build((b) => {
		for (const [i, c] of methods.entries())
			b.atSample(i * 10)[c.method](...c.args);
	});
	for (const c of methods) synth[c.method](...c.args);
	const before = structuredClone(state),
		rows = compile(p, state);
	assert.deepEqual(
		rows.map(
			({ offsetSeconds, operationIndex, writeIndex, ...row }) => row,
		),
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

test("OPLL partial User operator R0 and shared feedback/waveform R3 preserve current neighboring fields", () => {
	const state = reset();
	state.registers[0] = 0xf1;
	state.registers[3] = 0xd6;
	const r = resolver();
	const a = r.resolve(call("setUserOperator", 0, { multi: 7 }), state);
	assert.equal(a.writes[0].value, 0xf7);
	assert.equal(a.state.registers[0], 0xf7);
	const b = r.resolve(call("setUserOperator", 0, { waveform: 1 }), a.state);
	assert.equal(b.writes[0].register, 3);
	assert.equal(b.writes[0].value, 0xde);
	const c = r.resolve(call("setUserPatch", { feedback: 1 }), b.state);
	assert.equal(c.state.registers[3], 0xd9);
	assert.equal(state.registers[0], 0xf1);
	assert.equal(state.registers[3], 0xd6);
});

test("OPLL Rhythm R14 partial updates preserve other drum bits and expose only authored trigger intent", () => {
	const state = reset();
	state.registers[14] = 0x38;
	const r = resolver(),
		a = r.resolve(call("setRhythm", { hiHat: true }), state);
	assert.deepEqual(a.writes, [{ register: 14, value: 0x39, intentMask: 1 }]);
	const b = r.resolve(call("setRhythm", { snare: false }), a.state);
	assert.deepEqual(b.writes, [{ register: 14, value: 0x31, intentMask: 8 }]);
	const raw = r.resolve(call("writeRegister", 14, 0x21), b.state);
	assert.deepEqual(raw.writes, [{ register: 14, value: 0x21 }]);
	const mode = r.resolve(call("setRhythm", { enabled: true }), reset());
	assert.deepEqual(
		mode.writes.map((w) => w.register),
		[0x26, 0x27, 0x28, 14],
	);
	assert.equal(mode.writes.at(-1).intentMask, 0);
	assert.equal(state.registers[14], 0x38);
});

test("OPLL CH7/8 Rhythm level nibbles preserve their paired drums and melody aliases", () => {
	const state = reset();
	state.registers[0x37] = 0xa3;
	state.registers[0x38] = 0xb4;
	const r = resolver(),
		a = r.resolve(call("setRhythmLevel", "hiHat", 5), state);
	assert.equal(a.state.registers[0x37], 0x53);
	const b = r.resolve(
		call("setRhythmLevels", { snare: 7, tom: 2, cymbal: 9 }),
		a.state,
	);
	assert.equal(b.state.registers[0x37], 0x57);
	assert.equal(b.state.registers[0x38], 0x29);
	assert.equal(state.registers[0x38], 0xb4);
});

test("OPLL voice and pitch edits preserve adjacent key/sustain bits; repeated write ordering is retained", () => {
	const state = reset();
	state.registers[0x20] = 0x3b;
	state.registers[0x30] = 0xa7;
	const p = build((b) =>
		b
			.setVoice(0, { attenuation: 2 })
			.keyOff(0)
			.setPitch(0, 0x1aa, 4)
			.keyOn(0)
			.keyOn(0),
	);
	const r = resolver();
	let next = state;
	const result = [];
	for (const op of p.operations) {
		const value = r.resolve(op, next);
		result.push(...value.writes);
		next = value.state;
	}
	assert.equal(result[0].value, 0xa2);
	assert.equal(result[1].value, 0x2b);
	assert.equal(next.registers[0x20], 0x39);
	assert.equal(next.registers[0x10], 0xaa);
	const compiled = compile(p, state);
	assert.deepEqual(
		compiled.map(
			({ offsetSeconds, operationIndex, writeIndex, ...row }) => row,
		),
		result,
	);
	assert.deepEqual(result.at(-1), result.at(-2));
	assert.equal(state.registers[0x20], 0x3b);
});

test("OPLL malformed state/config or illegal Rhythm melody plan rejects without altering initial state", () => {
	const state = reset(),
		before = structuredClone(state);
	assert.throws(
		() =>
			compile(
				build((b) =>
					b
						.setVoice(0, { attenuation: 2 })
						.setUserOperator(1, { tl: 1 }),
				),
				state,
			),
		/Carrier/,
	);
	assert.deepEqual(state, before);
	assert.throws(
		() => validate(build((b) => b.setRhythm({ enabled: true }).keyOn(6))),
		/Rhythm mode reserves/,
	);
});

test("OPLL state arrays are dense owned bytes with a matching clock", () => {
	const state = reset();
	const copied = validateOpllOperationState(state);
	assert.notEqual(copied.registers, state.registers);
	assert.throws(
		() =>
			validateOpllOperationState({
				...state,
				registers: Array(63).fill(0),
			}),
		/64 bytes/,
	);
	const access = Array(64).fill(0);
	Object.defineProperty(access, "0", {
		get() {
			throw Error("getter invoked");
		},
	});
	assert.throws(
		() => validateOpllOperationState({ ...state, registers: access }),
		/plain values/,
	);
	const symbol = Array(64).fill(0);
	symbol[Symbol("extra")] = 1;
	assert.throws(
		() => validateOpllOperationState({ ...state, registers: symbol }),
		/extra properties/,
	);
	assert.throws(
		() => resolver({ clock: 4000000 }).resolve(call("keyOn", 0), state),
		/Incompatible/,
	);
});

test("OPLL snapshots own immutable reusable states and reject another chip/instance/config", () => {
	const state = reset();
	state.registers[0x30] = 0x45;
	const snapshot = createOpllTimedSnapshot(state, {
		instanceId: "opll-a",
		frame: 128,
		sampleRate: 48000,
	});
	state.registers[0x30] = 0x99;
	assert.equal(
		compile(
			build((b) => b.setAttenuation(0, 3)),
			snapshot.state,
		)[0].value,
		0x43,
	);
	assert.equal(
		compile(
			build((b) => b.setInstrument(0, 6)),
			snapshot.state,
		)[0].value,
		0x65,
	);
	assert.equal(snapshot.state.registers[0x30], 0x45);
	assert(Object.isFrozen(snapshot.state.registers));
	const copy = validateOpllTimedSnapshot(structuredClone(snapshot), {
		instanceId: "opll-a",
		clock: state.clock,
	});
	assert.deepEqual(copy, snapshot);
	assert.notEqual(copy.state.registers, snapshot.state.registers);
	assert.throws(
		() => validateOpllTimedSnapshot(snapshot, { instanceId: "opll-b" }),
		/instance/,
	);
	assert.throws(
		() => validateOpllTimedSnapshot(snapshot, { clock: 4000000 }),
		/clock/,
	);
	assert.throws(
		() =>
			validateOpllTimedSnapshot({
				...snapshot,
				format: "tetorica-psg-state",
			}),
		/format/,
	);
});
