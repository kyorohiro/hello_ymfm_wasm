// SPDX-License-Identifier: BSD-3-Clause
import { validatePsgOperationState } from "./segapsg_operations.js?v=audio-numeric-bindings-1";

export const PSG_TIMED_STATE_FORMAT = "tetorica-psg-state";
export const PSG_TIMED_STATE_VERSION = 1;

/** Detached operation-resolution state, not an oscillator/audio save state. */
export function createPsgTimedSnapshot(
	state,
	{ instanceId, frame, sampleRate } = {},
) {
	const copy = validatePsgOperationState(state);
	if (
		!(
			(typeof instanceId === "string" &&
				instanceId.length > 0 &&
				instanceId.length <= 256) ||
			(Number.isSafeInteger(instanceId) && instanceId > 0)
		)
	)
		throw TypeError("PSG snapshot requires an instance identity");
	if (!Number.isSafeInteger(frame) || frame < 0)
		throw RangeError("Invalid PSG snapshot frame");
	if (!Number.isInteger(sampleRate) || sampleRate <= 0)
		throw RangeError("Invalid PSG snapshot sample rate");
	Object.freeze(copy.attenuations);
	Object.freeze(copy.periods);
	return Object.freeze({
		format: PSG_TIMED_STATE_FORMAT,
		version: PSG_TIMED_STATE_VERSION,
		instanceId,
		frame,
		sampleRate,
		state: Object.freeze(copy),
	});
}

export function validatePsgTimedSnapshot(snapshot, expected = {}) {
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
		throw TypeError("Expected PSG snapshot");
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
			throw TypeError("Invalid PSG snapshot fields");
	}
	if (fields.some((key) => !Object.hasOwn(snapshot, key)))
		throw TypeError("Incomplete PSG snapshot");
	if (
		snapshot.format !== PSG_TIMED_STATE_FORMAT ||
		snapshot.version !== PSG_TIMED_STATE_VERSION
	)
		throw TypeError("Unsupported PSG snapshot format or version");
	const copy = createPsgTimedSnapshot(snapshot.state, snapshot);
	if (
		expected.instanceId !== undefined &&
		copy.instanceId !== expected.instanceId
	)
		throw Error("Incompatible PSG snapshot instance");
	if (expected.clock !== undefined && copy.state.clock !== expected.clock)
		throw Error("Incompatible PSG snapshot clock");
	if (
		expected.stereoEnabled !== undefined &&
		copy.state.stereoEnabled !== expected.stereoEnabled
	)
		throw Error("Incompatible PSG snapshot stereo configuration");
	return copy;
}
