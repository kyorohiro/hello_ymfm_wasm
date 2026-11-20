// SPDX-License-Identifier: BSD-3-Clause
import { YM2413Synth } from "../js/ym2413synth.js";
import { YM2413_CLOCK } from "../js/ym2413.js";

/** Register-only authoring calls supported by the OPLL operation recorder.
 * Validation and command-byte conversion remain in YM2413Synth. */
const arity = Object.freeze({
	writeRegister: [2, 2],
	setUserPatch: [1, 1],
	setUserOperator: [2, 2],
	setVoice: [2, 2],
	setPreset: [2, 2],
	setInstrument: [2, 3],
	setAttenuation: [2, 2],
	setSustain: [2, 2],
	setPitch: [2, 3],
	setFrequency: [2, 2],
	setNote: [2, 2],
	keyOn: [1, 1],
	keyOff: [1, 1],
	noteOn: [2, 2],
	noteOff: [1, 1],
	setRhythm: [1, 1],
	setRhythmLevels: [1, 1],
	setRhythmLevel: [2, 2],
});

export const OPLL_OPERATION_METHODS = Object.freeze(Object.keys(arity));
export const MAX_OPLL_OPERATIONS = 4096;

function object(value, label) {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		![Object.prototype, null].includes(Object.getPrototypeOf(value))
	) {
		throw new TypeError(`${label} must be a plain object`);
	}
}

function fields(value, names, label) {
	object(value, label);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string" || !names.includes(key))
			throw new TypeError(`Unknown ${label} field: ${String(key)}`);
		if (
			!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")
		) {
			throw new TypeError(`${label} must not contain accessors`);
		}
	}
}

/** Operation arguments deliberately use a small structured-cloneable subset. */
function copyValue(value, stack = new Set(), depth = 0) {
	if (value === null || value === undefined || typeof value === "boolean")
		return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value))
			throw new TypeError("OPLL operation numbers must be finite");
		return value;
	}
	if (typeof value === "string") {
		if (value.length > 1024)
			throw new RangeError("OPLL operation string is too long");
		return value;
	}
	if (typeof value !== "object")
		throw new TypeError(
			"OPLL operation arguments must be serializable data",
		);
	if (depth >= 8 || stack.has(value))
		throw new TypeError(
			"OPLL operation arguments must be bounded, acyclic data",
		);
	if (!Array.isArray(value)) object(value, "OPLL operation argument");
	const keys = Reflect.ownKeys(value);
	if (keys.length > 32)
		throw new RangeError("OPLL operation argument is too large");
	stack.add(value);
	try {
		if (Array.isArray(value)) {
			if (value.length > 16)
				throw new RangeError(
					"OPLL operation argument array is too large",
				);
			const result = [];
			for (let index = 0; index < value.length; index++) {
				const descriptor = Object.getOwnPropertyDescriptor(
					value,
					String(index),
				);
				if (!descriptor || !Object.hasOwn(descriptor, "value"))
					throw new TypeError(
						"OPLL operation arrays must contain plain values",
					);
				result.push(copyValue(descriptor.value, stack, depth + 1));
			}
			for (const key of keys)
				if (key !== "length" && !/^(0|[1-9]\d*)$/.test(String(key))) {
					throw new TypeError(
						"OPLL operation arrays must not contain extra properties",
					);
				}
			return result;
		}
		const result = {};
		for (const key of keys) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (typeof key !== "string" || !Object.hasOwn(descriptor, "value"))
				throw new TypeError(
					"OPLL operation arguments must not contain symbols or accessors",
				);
			Object.defineProperty(result, key, {
				value: copyValue(descriptor.value, stack, depth + 1),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
		return result;
	} finally {
		stack.delete(value);
	}
}

function referenceRate(value) {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new RangeError(
			"referenceSampleRate must be a positive safe integer",
		);
	return value;
}

function copyTime(time) {
	fields(time, ["unit", "value"], "OPLL operation time");
	const { unit, value } = time;
	if (!["sample", "seconds"].includes(unit))
		throw new TypeError(
			"OPLL operation time unit must be sample or seconds",
		);
	if (
		!Number.isFinite(value) ||
		value < 0 ||
		value > Number.MAX_SAFE_INTEGER ||
		(unit === "sample" && !Number.isSafeInteger(value))
	) {
		throw new RangeError(
			"OPLL operation offset must be nonnegative and samples must be safe integers",
		);
	}
	return { unit, value };
}

function copyCall(operation) {
	const method = operation?.method;
	if (typeof method !== "string" || !Object.hasOwn(arity, method))
		throw new TypeError(`Unsupported OPLL operation: ${String(method)}`);
	if (!Array.isArray(operation.args))
		throw new TypeError("OPLL operation args must be an array");
	const [min, max] = arity[method];
	if (operation.args.length < min || operation.args.length > max)
		throw new TypeError(`Invalid argument count for OPLL ${method}`);
	return { method, args: copyValue(operation.args) };
}

export function opllOperationOffsetSeconds(
	operation,
	referenceSampleRate = 44100,
) {
	referenceRate(referenceSampleRate);
	const time = copyTime(operation.time);
	return time.unit === "sample"
		? time.value / referenceSampleRate
		: time.value;
}

/** Copies/validates data without evaluating chip operations or reading state. */
function copyProgram(plan) {
	fields(
		plan,
		["version", "chip", "referenceSampleRate", "operations"],
		"OPLL operation program",
	);
	if (plan.version !== 1 || plan.chip !== "ym2413")
		throw new TypeError(
			"Unsupported OPLL operation program version or chip",
		);
	const rate = referenceRate(plan.referenceSampleRate);
	if (
		!Array.isArray(plan.operations) ||
		plan.operations.length > MAX_OPLL_OPERATIONS
	)
		throw new RangeError(
			`OPLL programs support at most ${MAX_OPLL_OPERATIONS} operations`,
		);
	let previous = 0;
	const operations = Array.from(plan.operations, (operation, index) => {
		fields(
			operation,
			["time", "order", "method", "args"],
			"OPLL operation",
		);
		if (operation.order !== index)
			throw new TypeError(
				"OPLL operation order must match authored order",
			);
		const time = copyTime(operation.time),
			call = copyCall(operation);
		const offset = time.unit === "sample" ? time.value / rate : time.value;
		if (offset < previous)
			throw new RangeError(
				"OPLL operation offsets must be nondecreasing",
			);
		previous = offset;
		return { time, order: index, ...call };
	});
	return {
		version: 1,
		chip: "ym2413",
		referenceSampleRate: rate,
		operations,
	};
}

/** Record once. This function never constructs a chip or resolves register bytes. */
export function buildOpllOperations(callback, options = {}) {
	if (typeof callback !== "function")
		throw new TypeError("OPLL build requires a synchronous callback");
	fields(options, ["referenceSampleRate"], "OPLL build options");
	const rate = referenceRate(options.referenceSampleRate ?? 44100),
		operations = [];
	let time = { unit: "sample", value: 0 },
		active = true,
		previous = 0;
	const check = () => {
		if (!active)
			throw new Error("OPLL operation recorder is no longer active");
	};
	const builder = Object.create(null);
	builder.atSeconds = (value) => {
		check();
		time = copyTime({ unit: "seconds", value });
		if (value < previous)
			throw new RangeError(
				"OPLL operation offsets must be nondecreasing",
			);
		previous = value;
		return builder;
	};
	builder.atSample = (value) => {
		check();
		time = copyTime({ unit: "sample", value });
		const seconds = value / rate;
		if (seconds < previous)
			throw new RangeError(
				"OPLL operation offsets must be nondecreasing",
			);
		previous = seconds;
		return builder;
	};
	for (const method of OPLL_OPERATION_METHODS)
		builder[method] = (...args) => {
			check();
			if (operations.length >= MAX_OPLL_OPERATIONS)
				throw new RangeError(
					`OPLL programs support at most ${MAX_OPLL_OPERATIONS} operations`,
				);
			const call = copyCall({ method, args });
			operations.push({
				time: { ...time },
				order: operations.length,
				...call,
			});
			return builder;
		};
	try {
		const result = callback(builder);
		if (result && typeof result.then === "function") {
			Promise.resolve(result).catch(() => {});
			throw new TypeError("OPLL build callbacks must be synchronous");
		}
		return copyProgram({
			version: 1,
			chip: "ym2413",
			referenceSampleRate: rate,
			operations,
		});
	} finally {
		active = false;
	}
}

/** Complete register-authoring state, not an oscillator/Envelope save state. */
export function validateOpllOperationState(state) {
	fields(state, ["clock", "registers"], "OPLL operation state");
	if (
		!Number.isInteger(state.clock) ||
		state.clock < 100000 ||
		state.clock > 100000000
	)
		throw RangeError("Invalid OPLL state clock");
	if (!Array.isArray(state.registers) || state.registers.length !== 64)
		throw TypeError("Complete OPLL register state requires 64 bytes");
	const input = state.registers;
	for (const key of Reflect.ownKeys(input)) {
		if (
			key !== "length" &&
			(typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key))
		)
			throw TypeError(
				"OPLL register state must not contain extra properties",
			);
	}
	const registers = Array.from({ length: 64 }, (_, index) => {
		const descriptor = Object.getOwnPropertyDescriptor(
			input,
			String(index),
		);
		if (!descriptor || !Object.hasOwn(descriptor, "value"))
			throw TypeError("OPLL register state must contain plain values");
		const value = descriptor.value;
		if (!Number.isInteger(value) || value < 0 || value > 255)
			throw RangeError("Invalid OPLL register byte");
		return value;
	});
	return { clock: state.clock, registers };
}

/** Hardware reset image; useful starter patches are deliberately not installed. */
export function createOpllOperationResetState({ clock = YM2413_CLOCK } = {}) {
	return validateOpllOperationState({ clock, registers: Array(64).fill(0) });
}

/** Resolve with the existing YM2413Synth against an isolated 64-byte shadow.
 * Shared User/Rhythm fields are read immediately before each operation.
 * R14 rows authored by setRhythm carry `intentMask` for the requested percussion
 * trigger bits, matching the immediate client. Unrelated drum Gate bits must
 * not become owned by this operation merely because the shared byte includes them.
 * Raw writeRegister(R14, value) is a complete write and has no intentMask. */
export function createOpllOperationResolver({ clock = YM2413_CLOCK } = {}) {
	createOpllOperationResetState({ clock });
	let writes = [],
		active = false,
		rhythmIntent;
	const drums = ["bassDrum", "snare", "tom", "cymbal", "hiHat"];
	const synth = new YM2413Synth({
		clock,
		transport: {
			writeRegister(register, value) {
				writes.push({
					register,
					value,
					...(register === 14 && rhythmIntent !== undefined
						? { intentMask: rhythmIntent }
						: {}),
				});
			},
		},
	});
	function start(state) {
		const input = validateOpllOperationState(state);
		if (input.clock !== clock)
			throw Error("Incompatible OPLL operation clock");
		synth.adoptRegisterSnapshot(input.registers);
		active = true;
	}
	function apply(operation) {
		if (!active) throw Error("OPLL operation resolver needs initial state");
		const call = copyCall(operation);
		writes = [];
		rhythmIntent =
			call.method === "setRhythm"
				? drums.reduce(
						(mask, key, index) =>
							mask |
							(Object.hasOwn(call.args[0] ?? {}, key)
								? 16 >> index
								: 0),
						0,
					)
				: undefined;
		try {
			synth[call.method](...call.args);
			return writes;
		} finally {
			rhythmIntent = undefined;
		}
	}
	return {
		start,
		apply,
		resolve(operation, state) {
			start(state);
			const result = apply(operation);
			return {
				writes: result,
				state: {
					clock,
					registers: Array.from(synth.getRegisterSnapshot()),
				},
			};
		},
	};
}

/** Structural copies can be validated independently of the actual renderer state. */
export function validateOpllOperations(
	plan,
	{ clock = YM2413_CLOCK, validateArguments = true } = {},
) {
	const copy = copyProgram(plan);
	if (!validateArguments) return copy;
	const resolver = createOpllOperationResolver({ clock });
	resolver.start(createOpllOperationResetState({ clock }));
	for (const operation of copy.operations) resolver.apply(operation);
	return copy;
}

/** Simulate only the authored operations. Baseline adoption emits no writes. */
export function compileOpllOperations(
	plan,
	state,
	{ clock = state?.clock ?? YM2413_CLOCK } = {},
) {
	const copy = copyProgram(plan),
		resolver = createOpllOperationResolver({ clock }),
		rows = [];
	resolver.start(state);
	for (
		let operationIndex = 0;
		operationIndex < copy.operations.length;
		operationIndex++
	) {
		const operation = copy.operations[operationIndex],
			offsetSeconds = opllOperationOffsetSeconds(
				operation,
				copy.referenceSampleRate,
			);
		const writes = resolver.apply(operation);
		for (let writeIndex = 0; writeIndex < writes.length; writeIndex++)
			rows.push({
				offsetSeconds,
				...writes[writeIndex],
				operationIndex,
				writeIndex,
			});
	}
	return rows;
}
