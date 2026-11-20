// SPDX-License-Identifier: BSD-3-Clause
import { SegaPSGSynth } from "./segapsgsynth.js";
import { SEGAPSG_CLOCK } from "./segapsg.js";

/** Register-only authoring calls supported by the PSG operation recorder.
 * Validation and command-byte conversion remain in SegaPSGSynth. */
const arity = Object.freeze({
	setPeriod: [2, 2],
	setFrequency: [2, 2],
	setNote: [2, 2],
	noteOn: [2, 2],
	tone: [2, 2],
	keyOn: [1, 1],
	keyOff: [1, 1],
	off: [1, 1],
	setAttenuation: [2, 2],
	setNoise: [0, 1],
	noise: [0, 1],
	noiseVolume: [1, 1],
	noiseOff: [0, 0],
	setStereo: [1, 1],
	write: [1, 1],
});

export const PSG_OPERATION_METHODS = Object.freeze(Object.keys(arity));
export const MAX_PSG_OPERATIONS = 4096;

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
			throw new TypeError("PSG operation numbers must be finite");
		return value;
	}
	if (typeof value === "string") {
		if (value.length > 1024)
			throw new RangeError("PSG operation string is too long");
		return value;
	}
	if (typeof value !== "object")
		throw new TypeError(
			"PSG operation arguments must be serializable data",
		);
	if (depth >= 8 || stack.has(value))
		throw new TypeError(
			"PSG operation arguments must be bounded, acyclic data",
		);
	if (!Array.isArray(value)) object(value, "PSG operation argument");
	const keys = Reflect.ownKeys(value);
	if (keys.length > 32)
		throw new RangeError("PSG operation argument is too large");
	stack.add(value);
	try {
		if (Array.isArray(value)) {
			if (value.length > 16)
				throw new RangeError(
					"PSG operation argument array is too large",
				);
			const result = [];
			for (let index = 0; index < value.length; index++) {
				const descriptor = Object.getOwnPropertyDescriptor(
					value,
					String(index),
				);
				if (!descriptor || !Object.hasOwn(descriptor, "value"))
					throw new TypeError(
						"PSG operation arrays must contain plain values",
					);
				result.push(copyValue(descriptor.value, stack, depth + 1));
			}
			for (const key of keys)
				if (key !== "length" && !/^(0|[1-9]\d*)$/.test(String(key))) {
					throw new TypeError(
						"PSG operation arrays must not contain extra properties",
					);
				}
			return result;
		}
		const result = {};
		for (const key of keys) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (typeof key !== "string" || !Object.hasOwn(descriptor, "value"))
				throw new TypeError(
					"PSG operation arguments must not contain symbols or accessors",
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
	fields(time, ["unit", "value"], "PSG operation time");
	const { unit, value } = time;
	if (!["sample", "seconds"].includes(unit))
		throw new TypeError(
			"PSG operation time unit must be sample or seconds",
		);
	if (
		!Number.isFinite(value) ||
		value < 0 ||
		value > Number.MAX_SAFE_INTEGER ||
		(unit === "sample" && !Number.isSafeInteger(value))
	) {
		throw new RangeError(
			"PSG operation offset must be nonnegative and samples must be safe integers",
		);
	}
	return { unit, value };
}

function copyCall(operation) {
	const method = operation?.method;
	if (typeof method !== "string" || !Object.hasOwn(arity, method))
		throw new TypeError(`Unsupported PSG operation: ${String(method)}`);
	if (!Array.isArray(operation.args))
		throw new TypeError("PSG operation args must be an array");
	const [min, max] = arity[method];
	if (operation.args.length < min || operation.args.length > max)
		throw new TypeError(`Invalid argument count for PSG ${method}`);
	return { method, args: copyValue(operation.args) };
}

export function psgOperationOffsetSeconds(
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
		"PSG operation program",
	);
	if (plan.version !== 1 || plan.chip !== "segapsg")
		throw new TypeError(
			"Unsupported PSG operation program version or chip",
		);
	const rate = referenceRate(plan.referenceSampleRate);
	if (
		!Array.isArray(plan.operations) ||
		plan.operations.length > MAX_PSG_OPERATIONS
	)
		throw new RangeError(
			`PSG programs support at most ${MAX_PSG_OPERATIONS} operations`,
		);
	let previous = 0;
	const operations = Array.from(plan.operations, (operation, index) => {
		fields(operation, ["time", "order", "method", "args"], "PSG operation");
		if (operation.order !== index)
			throw new TypeError(
				"PSG operation order must match authored order",
			);
		const time = copyTime(operation.time),
			call = copyCall(operation);
		const offset = time.unit === "sample" ? time.value / rate : time.value;
		if (offset < previous)
			throw new RangeError("PSG operation offsets must be nondecreasing");
		previous = offset;
		return { time, order: index, ...call };
	});
	return {
		version: 1,
		chip: "segapsg",
		referenceSampleRate: rate,
		operations,
	};
}

/** Record once. This function never constructs a chip or resolves register bytes. */
export function buildPsgOperations(callback, options = {}) {
	if (typeof callback !== "function")
		throw new TypeError("PSG build requires a synchronous callback");
	fields(options, ["referenceSampleRate"], "PSG build options");
	const rate = referenceRate(options.referenceSampleRate ?? 44100),
		operations = [];
	let time = { unit: "sample", value: 0 },
		active = true,
		previous = 0;
	const check = () => {
		if (!active)
			throw new Error("PSG operation recorder is no longer active");
	};
	const builder = Object.create(null);
	builder.atSeconds = (value) => {
		check();
		time = copyTime({ unit: "seconds", value });
		if (value < previous)
			throw new RangeError("PSG operation offsets must be nondecreasing");
		previous = value;
		return builder;
	};
	builder.atSample = (value) => {
		check();
		time = copyTime({ unit: "sample", value });
		const seconds = value / rate;
		if (seconds < previous)
			throw new RangeError("PSG operation offsets must be nondecreasing");
		previous = seconds;
		return builder;
	};
	for (const method of PSG_OPERATION_METHODS)
		builder[method] = (...args) => {
			check();
			if (operations.length >= MAX_PSG_OPERATIONS)
				throw new RangeError(
					`PSG programs support at most ${MAX_PSG_OPERATIONS} operations`,
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
			throw new TypeError("PSG build callbacks must be synchronous");
		}
		return copyProgram({
			version: 1,
			chip: "segapsg",
			referenceSampleRate: rate,
			operations,
		});
	} finally {
		active = false;
	}
}

/** Detached command/authoring state. No oscillator/LFSR phase or PCM is captured.
 * `attenuations` are remembered next-key levels, not effective mute values. */
export function validatePsgOperationState(state) {
	fields(
		state,
		[
			"clock",
			"stereoEnabled",
			"attenuations",
			"periods",
			"latched",
			"noiseMode",
			"stereo",
		],
		"PSG operation state",
	);
	const integer = (value, maximum, label) => {
		if (!Number.isInteger(value) || value < 0 || value > maximum)
			throw RangeError(`Invalid PSG ${label}`);
		return value;
	};
	if (
		!Number.isInteger(state.clock) ||
		state.clock < 100000 ||
		state.clock > 100000000
	)
		throw RangeError("Invalid PSG state clock");
	if (typeof state.stereoEnabled !== "boolean")
		throw TypeError("Complete PSG stereo configuration required");
	const array = (values, length, maximum, label) => {
		if (!Array.isArray(values) || values.length !== length)
			throw TypeError(`Incomplete PSG ${label}`);
		return copyValue(values).map((value) => integer(value, maximum, label));
	};
	const stereo = integer(state.stereo, 255, "stereo mask");
	if (!state.stereoEnabled && stereo !== 255)
		throw TypeError("Mono PSG state must use stereo mask 255");
	return {
		clock: state.clock,
		stereoEnabled: state.stereoEnabled,
		attenuations: array(
			state.attenuations,
			4,
			15,
			"configured attenuation",
		),
		periods: array(state.periods, 3, 1023, "tone period"),
		latched: integer(state.latched, 7, "latch"),
		noiseMode: integer(state.noiseMode, 7, "Noise mode"),
		stereo,
	};
}

export function createPsgOperationResetState({
	clock = SEGAPSG_CLOCK,
	stereoEnabled = true,
} = {}) {
	return validatePsgOperationState({
		clock,
		stereoEnabled,
		attenuations: [0, 0, 0, 0],
		periods: [0, 0, 0],
		latched: 0,
		noiseMode: 0,
		stereo: 255,
	});
}

/** Reuse SegaPSGSynth parameter math and validation on a private transport.
 * Rows are `{value,register,channel}` command bytes. `register` is the logical
 * PSG latch target 0..7, not an address port. Game Gear pan writes are `{stereo}`.
 * Raw data bytes resolve against the currently applied latch; repeated bytes
 * are retained (Noise writes reset the LFSR even when their value is unchanged). */
export function createPsgOperationResolver({
	clock = SEGAPSG_CLOCK,
	stereoEnabled = true,
} = {}) {
	let writes = [],
		working;
	// Validate configuration before constructing even an inert authoring Synth.
	createPsgOperationResetState({ clock, stereoEnabled });
	const synth = new SegaPSGSynth({
		transport: {
			clock,
			write(value) {
				if (value & 128) working.latched = (value >> 4) & 7;
				const register = working.latched,
					channel = register >> 1;
				if (!(register & 1)) {
					if (channel === 3) working.noiseMode = value & 7;
					else if (value & 128)
						working.periods[channel] =
							(working.periods[channel] & 1008) | (value & 15);
					else
						working.periods[channel] =
							(working.periods[channel] & 15) |
							((value & 63) << 4);
				}
				writes.push({ value, register, channel });
			},
			...(stereoEnabled
				? {
						setStereo(stereo) {
							working.stereo = stereo;
							writes.push({ stereo });
						},
					}
				: {}),
		},
	});
	function start(state) {
		working = validatePsgOperationState(state);
		if (working.clock !== clock || working.stereoEnabled !== stereoEnabled)
			throw Error("Incompatible PSG operation configuration");
		synth._adoptState(working);
	}
	function apply(operation) {
		if (!working) throw Error("PSG operation resolver needs initial state");
		const call = copyCall(operation);
		writes = [];
		synth[call.method](...call.args);
		const authored = synth._getState();
		working.attenuations = authored.attenuations;
		working.latched = authored.latched;
		working.stereo = authored.stereo;
		return writes;
	}
	return {
		start,
		apply,
		resolve(operation, state) {
			start(state);
			const result = apply(operation);
			return {
				writes: result,
				state: validatePsgOperationState(working),
			};
		},
	};
}

/** Admission validation never reads or mutates a live chip. */
export function validatePsgOperations(
	plan,
	{
		clock = SEGAPSG_CLOCK,
		stereoEnabled = true,
		validateArguments = true,
	} = {},
) {
	const copy = copyProgram(plan);
	if (!validateArguments) return copy;
	const resolver = createPsgOperationResolver({ clock, stereoEnabled });
	resolver.start(createPsgOperationResetState({ clock, stereoEnabled }));
	for (const operation of copy.operations) resolver.apply(operation);
	return copy;
}

/** Compile one pass from a detached state. Initial-state adoption emits no rows. */
export function compilePsgOperations(
	plan,
	state,
	{
		clock = state?.clock ?? SEGAPSG_CLOCK,
		stereoEnabled = state?.stereoEnabled ?? true,
	} = {},
) {
	const copy = copyProgram(plan),
		resolver = createPsgOperationResolver({ clock, stereoEnabled }),
		rows = [];
	resolver.start(state);
	for (
		let operationIndex = 0;
		operationIndex < copy.operations.length;
		operationIndex++
	) {
		const operation = copy.operations[operationIndex],
			offsetSeconds = psgOperationOffsetSeconds(
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
