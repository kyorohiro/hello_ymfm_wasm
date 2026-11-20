// SPDX-License-Identifier: BSD-3-Clause
import {
	buildPsgOperations,
	validatePsgOperations,
	compilePsgOperations,
	createPsgOperationResetState,
	validatePsgOperationState,
	psgOperationOffsetSeconds,
} from "./psg_operations.js";
import { validatePsgTimedSnapshot } from "./psg_timed_state.js";

function options(value, allowed, label) {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		![Object.prototype, null].includes(Object.getPrototypeOf(value))
	)
		throw new TypeError(`${label} must be an object`);
	for (const key of Reflect.ownKeys(value)) {
		if (
			typeof key !== "string" ||
			!allowed.includes(key) ||
			!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")
		) {
			throw new TypeError(
				`Unknown or invalid ${label} field: ${String(key)}`,
			);
		}
	}
}

function name(value) {
	if (typeof value !== "string" || !value.length || value.length > 128)
		throw new TypeError("PSG schedule name must contain 1..128 characters");
	return value;
}

function transaction(value) {
	if (
		(typeof value === "string" &&
			value.length > 0 &&
			value.length <= 256) ||
		(Number.isSafeInteger(value) && value > 0)
	)
		return value;
	throw new TypeError("PSG schedule transaction identity is invalid");
}

function owner(value) {
	if (typeof value !== "string" || !value.length || value.length > 256)
		throw new TypeError(
			"PSG schedule owner must contain 1..256 characters",
		);
	return value;
}

function scheduleOptions(value, program) {
	options(value, ["name", "repeatSeconds"], "PSG schedule options");
	const result = { name: name(value.name) };
	if (value.repeatSeconds !== undefined) {
		const interval = value.repeatSeconds,
			last = program.operations.at(-1);
		if (
			!Number.isFinite(interval) ||
			interval <= 0 ||
			!last ||
			interval <=
				psgOperationOffsetSeconds(last, program.referenceSampleRate)
		) {
			throw new RangeError(
				"PSG repeatSeconds must exceed the last operation offset in a nonempty program",
			);
		}
		result.repeatSeconds = interval;
	}
	return result;
}

/** Attach the additive live PSG API after its acknowledged control transport.
 * Existing getters and immediate authoring methods retain their semantics. */
export function attachPsgTimedClient(api, configuration = {}, port) {
	let disposed = false,
		instanceId = configuration.instanceId;
	const errorListeners = new Set();
	const native = !!configuration.native;
	const check = () => {
		if (disposed || (api.isCurrent && !api.isCurrent())) {
			const error = new Error("PSG Code session was stopped");
			error.name = "AbortError";
			throw error;
		}
	};
	const config = () => {
		const value = { clock: api.clock, stereoEnabled: api.stereoEnabled };
		return value;
	};
	const requireLive = () => {
		check();
		if (native)
			throw new Error(
				"PSG timed scheduling and authoritative capture require an AudioWorklet; Native is not supported",
			);
		if (typeof api._requestControl !== "function")
			throw new Error(
				"PSG timed operations require an acknowledged AudioWorklet control transport",
			);
	};
	const request = (payload) => {
		requireLive();
		return api._requestControl("psgTimed", [payload]);
	};
	const owned = (payload, metadata = {}) => {
		options(metadata, ["owner"], "PSG schedule metadata");
		return metadata.owner === undefined
			? payload
			: { ...payload, owner: owner(metadata.owner) };
	};
	const prepared = (operations, settings) => {
		// Only structural copying here. Backend admission validates at its actual
		// clock; local authoring may legitimately lag a renderer clock edit.
		const program = validatePsgOperations(operations, {
			validateArguments: false,
		});
		return {
			operations: program,
			options: scheduleOptions(settings, program),
		};
	};
	const reportError = (event) => {
		const data = event.data;
		if (disposed || data?.type !== "psg-timed-error") return;
		const diagnostic = Object.freeze({
			type: "psg-timed-error",
			message: String(data.message ?? "PSG timed operation failed"),
			owner: data.owner,
			session: data.session,
		});
		if (!errorListeners.size) {
			console.error(`[PSG timed] ${diagnostic.message}`);
			return;
		}
		for (const listener of [...errorListeners]) {
			try {
				listener(diagnostic);
			} catch (error) {
				console.error("[PSG timed error observer]", error);
			}
		}
	};
	const previousMessage = port?.onmessage;
	let messageListener;
	if (port?.addEventListener) {
		port.addEventListener("message", reportError);
		port.start?.();
	} else if (port) {
		messageListener = (event) => {
			reportError(event);
			previousMessage?.call(port, event);
		};
		port.onmessage = messageListener;
	}

	const capability = Object.freeze({
		onError(listener) {
			check();
			if (typeof listener !== "function")
				throw new TypeError(
					"PSG timed error observer must be a function",
				);
			errorListeners.add(listener);
			return () => errorListeners.delete(listener);
		},
		async schedule(operations, settings, metadata) {
			requireLive();
			return request(
				owned(
					{ action: "schedule", ...prepared(operations, settings) },
					metadata,
				),
			);
		},
		async clearSchedule(scheduleName, metadata) {
			requireLive();
			return request(
				owned({ action: "clear", name: name(scheduleName) }, metadata),
			);
		},
		async stage(transactionId, scheduleOwner, method, args) {
			requireLive();
			if (!Array.isArray(args))
				throw new TypeError(
					"PSG staged schedule args must be an array",
				);
			let copied;
			if (method === "schedule" && args.length === 2) {
				const value = prepared(args[0], args[1]);
				copied = [value.operations, value.options];
			} else if (method === "clearSchedule" && args.length === 1)
				copied = [name(args[0])];
			else
				throw new TypeError("Unsupported PSG staged scheduling method");
			return request({
				action: "stage",
				transactionId: transaction(transactionId),
				owner: owner(scheduleOwner),
				method,
				args: copied,
			});
		},
		async commit(transactionId, scheduleOwner) {
			check();
			if (native) return false;
			return request({
				action: "commit",
				transactionId: transaction(transactionId),
				owner: owner(scheduleOwner),
			});
		},
		async abort(transactionId, scheduleOwner) {
			check();
			if (native) return false;
			return request({
				action: "abort",
				transactionId: transaction(transactionId),
				owner: owner(scheduleOwner),
			});
		},
		async cancelOwner(scheduleOwner) {
			check();
			if (native) return false;
			return request({
				action: "cancelOwner",
				owner: owner(scheduleOwner),
			});
		},
		async releaseOwner(scheduleOwner) {
			check();
			if (native) return false;
			return request({
				action: "releaseOwner",
				owner: owner(scheduleOwner),
			});
		},
	});

	// PSG keyOff and explicit level15 have identical hardware bytes. Carry the
	// existing client's retained next-note levels after an immediate authoring
	// batch so the renderer can resolve a later scheduled keyOn correctly.
	// This is command metadata, not polling or a claim of a complete client shadow.
	if (port?.postMessage)
		for (const method of [
			"write",
			"setAttenuation",
			"keyOn",
			"keyOff",
			"noteOn",
			"off",
			"tone",
			"noise",
			"noiseVolume",
			"noiseOff",
			"_forceKeyOff",
			"allNotesOff",
			"reset",
			"resetAll",
		]) {
			const original = api[method];
			if (typeof original !== "function") continue;
			api[method] = (...args) => {
				check();
				const value = original.apply(api, args);
				port.postMessage({
					method: "psgConfiguredLevels",
					args: [api._getState().attenuations],
				});
				return value;
			};
		}

	api.build = (callback, settings) => {
		check();
		return buildPsgOperations(callback, settings);
	};
	api.captureState = async () => {
		requireLive();
		const value = await request({ action: "capture" });
		check();
		// A renderer clock can differ from its last local acknowledgement. Return
		// the actual captured clock without silently adopting it into live state.
		const snapshot = validatePsgTimedSnapshot(value, {
			...(instanceId === undefined ? {} : { instanceId }),
		});
		if (instanceId === undefined) instanceId = snapshot.instanceId;
		return snapshot;
	};
	api.compile = async (operations, settings = {}) => {
		check();
		options(settings, ["initialState"], "PSG compile options");
		const recorded = validatePsgOperations(operations, {
			validateArguments: false,
		});
		const initialState =
			settings.initialState === undefined
				? "current"
				: settings.initialState;
		let state, clock;
		if (initialState === "current") {
			const snapshot = await api.captureState();
			state = snapshot.state;
			clock = state.clock;
		} else if (initialState === "client") {
			const current = config();
			if (
				api._timedClientStateComplete !== true ||
				typeof api._getState !== "function"
			) {
				throw new Error(
					"Incomplete PSG client state: tone periods and Noise control metadata are unavailable",
				);
			}
			state = validatePsgOperationState(api._getState());
			clock = current.clock;
		} else if (initialState === "reset") {
			clock = config().clock;
			state = createPsgOperationResetState({ ...config(), clock });
		} else if (initialState && typeof initialState === "object") {
			if (instanceId === undefined)
				throw new Error(
					"PSG snapshot chip identity is unknown; capture from this client first",
				);
			state = validatePsgTimedSnapshot(initialState, {
				...config(),
				instanceId,
			}).state;
			clock = state.clock;
		} else
			throw new TypeError(
				"PSG initialState must be current, client, reset or a captured state snapshot",
			);
		// Local/client/reset/supplied-snapshot paths reach here without an await or
		// RPC, so later local edits cannot alter this compilation's copied state.
		// Compilation itself validates every call through the shared resolver and
		// returns no partial trace on failure; do not run the same conversion twice.
		configuration.validatePlan?.(recorded, state);
		return compilePsgOperations(recorded, state, {
			clock,
			stereoEnabled: state.stereoEnabled,
		});
	};
	api.schedule = (operations, settings) =>
		capability.schedule(operations, settings);
	api.clearSchedule = (scheduleName) =>
		capability.clearSchedule(scheduleName);
	Object.defineProperty(api, "_timedOperations", { value: capability });
	const dispose = api.dispose;
	let closing;
	api.dispose = () => {
		if (disposed) return closing;
		disposed = true;
		errorListeners.clear();
		if (port?.removeEventListener)
			port.removeEventListener("message", reportError);
		else if (port && port.onmessage === messageListener)
			port.onmessage = previousMessage;
		return (closing = dispose?.call(api));
	};
	return api;
}
