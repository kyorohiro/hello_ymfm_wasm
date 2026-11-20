// SPDX-License-Identifier: BSD-3-Clause
import { validateOpllOperationState } from "./ym2413_operations.js?v=pokey-mode-1";

export const OPLL_TIMED_STATE_FORMAT = "tetorica-opll-state";
export const OPLL_TIMED_STATE_VERSION = 1;

/** Detached operation-resolution state, not an oscillator/audio save state. */
export function createOpllTimedSnapshot(
	state,
	{ instanceId, frame, sampleRate } = {},
) {
	const copy = validateOpllOperationState(state);
	if (
		!(
			(typeof instanceId === "string" &&
				instanceId.length > 0 &&
				instanceId.length <= 256) ||
			(Number.isSafeInteger(instanceId) && instanceId > 0)
		)
	)
		throw TypeError("OPLL snapshot requires an instance identity");
	if (!Number.isSafeInteger(frame) || frame < 0)
		throw RangeError("Invalid OPLL snapshot frame");
	if (!Number.isInteger(sampleRate) || sampleRate <= 0)
		throw RangeError("Invalid OPLL snapshot sample rate");
	Object.freeze(copy.registers);
	return Object.freeze({
		format: OPLL_TIMED_STATE_FORMAT,
		version: OPLL_TIMED_STATE_VERSION,
		instanceId,
		frame,
		sampleRate,
		state: Object.freeze(copy),
	});
}

export function validateOpllTimedSnapshot(snapshot, expected = {}) {
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
		throw TypeError("Expected OPLL snapshot");
	const fields = [
		"format",
		"version",
		"instanceId",
		"frame",
		"sampleRate",
		"state",
	];
	for (const key of Reflect.ownKeys(snapshot)) {
		if (
			!fields.includes(key) ||
			!Object.hasOwn(
				Object.getOwnPropertyDescriptor(snapshot, key),
				"value",
			)
		)
			throw TypeError("Invalid OPLL snapshot fields");
	}
	if (fields.some((key) => !Object.hasOwn(snapshot, key)))
		throw TypeError("Incomplete OPLL snapshot");
	if (
		snapshot.format !== OPLL_TIMED_STATE_FORMAT ||
		snapshot.version !== OPLL_TIMED_STATE_VERSION
	)
		throw TypeError("Unsupported OPLL snapshot format or version");
	const copy = createOpllTimedSnapshot(snapshot.state, snapshot);
	if (
		expected.instanceId !== undefined &&
		copy.instanceId !== expected.instanceId
	)
		throw Error("Incompatible OPLL snapshot instance");
	if (expected.clock !== undefined && copy.state.clock !== expected.clock)
		throw Error("Incompatible OPLL snapshot clock");
	return copy;
}
