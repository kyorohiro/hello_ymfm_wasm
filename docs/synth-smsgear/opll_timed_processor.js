// SPDX-License-Identifier: BSD-3-Clause
import {
	validateOpllOperations,
	opllOperationOffsetSeconds,
	createOpllOperationResolver,
	compileOpllOperations,
} from "./opll_operations.js";
import { createOpllTimedSnapshot } from "./opll_timed_state.js";

const identity = (value, label) => {
	if (typeof value !== "string" || !value.length || value.length > 256)
		throw new TypeError(`Invalid OPLL ${label}`);
	return value;
};
const transactionKey = (value) => {
	if (Number.isSafeInteger(value) && value > 0) return String(value);
	return identity(value, "transaction");
};

// Conservatively bound a complete User patch / preset batch.
export const opllTimedCommandCost = (command) =>
	command.method === "applyOpllTimedOperation" ? 64 : 1;

/** OPLL-specific resolution and RPC. Time/order/storage belong to Performance Queue.
 * No user functions cross this boundary; captures occur between complete batches.
 */
export function createOpllTimedProcessor({
	performance: timeline,
	getState,
	getConfig,
	dispatch,
	nowFrame,
	sampleRate,
	leadFrames = 128,
	validatePlan,
}) {
	const staged = new Map(),
		gates = new Map();
	let resolver, resolverClock;
	function release(filter = {}) {
		let released = false;
		for (const [channel, token] of [...gates]) {
			if (
				Object.entries(filter).some(
					([key, value]) =>
						value !== undefined && token[key] !== value,
				)
			)
				continue;
			gates.delete(channel);
			dispatch(
				typeof channel === "number"
					? { method: "forceKeyOff", args: [channel] }
					: {
							method: "forceRhythmOff",
							args: [Number(channel.split(":")[1])],
						},
				token.port,
				nowFrame(),
				{ owner: token.owner, timedOperation: true },
			);
			released = true;
		}
		return released;
	}
	const releaseOwner = (owner) => release({ owner });
	const releasePattern = (pattern, owner) => release({ pattern, owner });
	const releaseAll = () => release();
	let nextReservation = 0;
	const freshTime = () => (nowFrame() + leadFrames) / sampleRate;
	const reportTo = (port, context) => (event) => {
		// Reservation failures are recoverable and must not retire the audio engine.
		const message = {
			type: "opll-timed-error",
			message: String(event.error),
			session: event.session,
			owner: context.owner,
		};
		try {
			port.postMessage(message);
		} catch {
			console.error("[OPLL timed reservation]", message.message);
		}
	};
	function context(payload, metadata) {
		let stats = timeline.getStats();
		if (metadata && metadata.session !== stats.activeSession)
			throw new Error("Performance session has expired");
		if (!stats.activeSession) {
			timeline.receive(
				{ type: "performance-start", session: stats.latestSession + 1 },
				{ postMessage() {} },
			);
			stats = timeline.getStats();
		}
		return {
			session: stats.activeSession,
			owner: identity(
				metadata?.owner ?? payload.owner ?? "opll-timed:client",
				"owner",
			),
			time: metadata?.time ?? freshTime(),
		};
	}
	function admit(operations) {
		const plan = validateOpllOperations(operations, {
			validateArguments: false,
		});
		// Admission is a virtual pass over authoritative authoring state and shared mode bits.
		// Actual execution resolves again, so intervening manual writes are retained.
		const state = getState();
		validatePlan?.(plan, state);
		compileOpllOperations(plan, state, getConfig());
		return plan;
	}
	function specification(operations, options, ownerContext) {
		if (
			!options ||
			typeof options !== "object" ||
			Array.isArray(options) ||
			Object.keys(options).some(
				(key) => !["name", "repeatSeconds"].includes(key),
			)
		)
			throw new TypeError("Invalid OPLL schedule options");
		const plan = admit(operations);
		const reservation = ++nextReservation;
		return {
			name: identity(options.name, "schedule name"),
			repeatSeconds: options.repeatSeconds,
			performance: ownerContext,
			entries: plan.operations.map((operation) => ({
				offsetSeconds: opllOperationOffsetSeconds(
					operation,
					plan.referenceSampleRate,
				),
				command: {
					method: "applyOpllTimedOperation",
					operation,
					reservation,
					pattern: options.name,
				},
			})),
		};
	}
	function changesFor(records, ownerContext) {
		return [...records.values()].map((record) =>
			record.method === "clearSchedule"
				? {
						name: identity(record.args[0], "schedule name"),
						clear: true,
					}
				: specification(record.args[0], record.args[1], ownerContext),
		);
	}
	function stagingKey(session, owner, transactionId) {
		return JSON.stringify([session, owner, transactionKey(transactionId)]);
	}
	function prune() {
		const session = timeline.getStats().activeSession;
		for (const [key, value] of staged)
			if (value.session !== session) staged.delete(key);
	}
	function invoke(payload, metadata, port) {
		if (!payload || typeof payload !== "object")
			throw new TypeError("Invalid OPLL timed request");
		if (
			![
				"capture",
				"edit",
				"schedule",
				"clear",
				"cancelOwner",
				"releaseOwner",
				"abort",
				"stage",
				"commit",
			].includes(payload.action)
		)
			throw new TypeError("Invalid OPLL timed action");
		if (
			metadata &&
			(!Number.isSafeInteger(metadata.session) ||
				metadata.session <= 0 ||
				!Number.isFinite(metadata.time) ||
				metadata.time < 0)
		)
			throw new TypeError("Invalid OPLL performance context");
		if (metadata) identity(metadata.owner, "owner");
		if (payload.action === "capture")
			return createOpllTimedSnapshot(getState(), {
				...getConfig(),
				frame: nowFrame(),
				sampleRate,
			});
		if (payload.action === "edit") {
			const plan = validateOpllOperations(payload.operations, {
				validateArguments: false,
			});
			if (plan.operations.length > 32)
				throw RangeError("OPLL parameter edit is too large");
			const permitted = [
				"setUserPatch",
				"setUserOperator",
				"setVoice",
				"setPreset",
				"setInstrument",
				"setAttenuation",
				"setSustain",
				"setPitch",
				"setFrequency",
				"setNote",
				"setRhythm",
				"setRhythmLevels",
				"setRhythmLevel",
			];
			if (
				plan.operations.some(
					(op) =>
						opllOperationOffsetSeconds(
							op,
							plan.referenceSampleRate,
						) !== 0 ||
						!permitted.includes(op.method) ||
						(op.method === "setRhythm" &&
							Object.keys(op.args[0]).some(
								(key) => key !== "enabled",
							)),
				)
			)
				throw Error(
					"OPLL parameter edit cannot trigger or release notes",
				);
			const writes = compileOpllOperations(plan, getState(), getConfig());
			if (writes.length > 128)
				throw RangeError("OPLL parameter edit is too large");
			// Fully validate before the first write; resolve from actual current
			// registers so an old Main shadow cannot switch a held Gate off.
			for (const row of writes)
				dispatch(
					{
						method: "writeRegister",
						args: [row.register, row.value],
						intentMask: row.intentMask,
					},
					port,
					nowFrame(),
					{ preserveOwner: true, keyIntent: false },
				);
			return true;
		}
		const ownerContext = context(payload, metadata);
		prune();
		const { session, owner } = ownerContext;
		if (payload.action === "schedule") {
			const receipt = timeline.schedulePattern(
				specification(
					payload.operations,
					payload.options,
					ownerContext,
				),
				reportTo(port, ownerContext),
			);
			releasePattern(receipt.name); // also retire a completed one-shot's held note
			return receipt;
		}
		if (payload.action === "clear") {
			const name = identity(payload.name, "schedule name");
			const cleared = timeline.clearPattern(name, { session, owner });
			return releasePattern(name, owner) || cleared;
		}
		if (
			payload.action === "cancelOwner" ||
			payload.action === "releaseOwner"
		) {
			for (const [key, value] of staged)
				if (value.session === session && value.owner === owner)
					staged.delete(key);
			if (payload.action === "releaseOwner") {
				timeline.cancelOwner(owner);
				releaseOwner(owner);
				return true;
			}
			const canceled = timeline.cancelPatternOwner(owner, { session });
			releaseOwner(owner);
			return canceled;
		}
		const key = stagingKey(session, owner, payload.transactionId);
		if (payload.action === "abort") {
			staged.delete(key);
			return true;
		}
		if (payload.action === "stage") {
			if (
				!["schedule", "clearSchedule"].includes(payload.method) ||
				!Array.isArray(payload.args)
			)
				throw new TypeError("Invalid OPLL staged operation");
			const records = new Map(staged.get(key)?.records);
			const name =
				payload.method === "schedule"
					? payload.args[1]?.name
					: payload.args[0];
			identity(name, "schedule name");
			if (payload.method === "schedule") {
				if (payload.args.length !== 2)
					throw new TypeError(
						"Invalid OPLL staged schedule arguments",
					);
				records.set(name, {
					method: payload.method,
					args: [admit(payload.args[0]), { ...payload.args[1] }],
				});
			} else {
				if (payload.args.length !== 1)
					throw new TypeError("Invalid OPLL staged clear arguments");
				records.set(name, { method: payload.method, args: [name] });
			}
			if (staged.size >= 128 && !staged.has(key))
				throw new RangeError("Too many OPLL staged transactions");
			let stored = 0;
			for (const [otherKey, transaction] of staged)
				if (otherKey !== key) {
					for (const record of transaction.records.values())
						stored += record.args[0]?.operations?.length ?? 1;
				}
			for (const record of records.values())
				stored += record.args[0]?.operations?.length ?? 1;
			if (stored > 65536)
				throw new RangeError("OPLL staged operation capacity exceeded");
			const changes = changesFor(records, {
				...ownerContext,
				time: freshTime(),
			});
			// Stage acceptance checks all arguments / projected capacity without replacing sound.
			const receipt = timeline.commitPatterns(changes, {
				session,
				owner,
				dryRun: true,
			});
			staged.set(key, { session, owner, records });
			if (payload.method === "clearSchedule") return true;
			const accepted = receipt.reservations.find(
				(value) => value.name === name,
			);
			const { startFrame, ...details } = accepted;
			return { ...details, staged: true };
		}
		if (payload.action === "commit") {
			// Use one fresh anchor after the user evaluation has completed, not its old stage time.
			const records = staged.get(key)?.records ?? new Map();
			const receipt = timeline.commitPatterns(
				changesFor(records, {
					...ownerContext,
					time: Math.max(freshTime(), ownerContext.time),
				}),
				{ session, owner },
				reportTo(port, ownerContext),
			);
			releaseOwner(owner);
			for (const record of records.values()) {
				const name =
					record.method === "schedule"
						? record.args[1].name
						: record.args[0];
				releasePattern(
					name,
					record.method === "schedule" ? undefined : owner,
				);
			}
			staged.delete(key);
			return receipt;
		}
		throw new Error(`Unsupported OPLL timed action: ${payload.action}`);
	}
	return {
		receive(data, port) {
			if (data?.method !== "opllTimed") return false;
			try {
				port.postMessage({
					id: data.id,
					value: invoke(data.args?.[0], data.timedPerformance, port),
				});
			} catch (error) {
				port.postMessage({
					id: data.id,
					error: error.message,
					name: error.name,
				});
			}
			return true;
		},
		apply(command, port, frame, metadata) {
			const { operation, reservation, pattern } = command;
			const keyOff = ["keyOff", "noteOff"].includes(operation.method);
			if (keyOff) {
				const token = gates.get(operation.args[0]);
				if (
					!token ||
					token.owner !== metadata.owner ||
					token.reservation !== reservation
				)
					return false;
			}
			// A partial Rhythm Off may release this reservation's drums only.
			let resolvedOperation = operation;
			if (operation.method === "setRhythm") {
				const settings = { ...operation.args[0] };
				for (const [index, name] of [
					"bassDrum",
					"snare",
					"tom",
					"cymbal",
					"hiHat",
				].entries())
					if (settings[name] === false) {
						const token = gates.get(`rhythm:${index}`);
						if (
							!token ||
							token.owner !== metadata.owner ||
							token.reservation !== reservation
						)
							delete settings[name];
					}
				resolvedOperation = { ...operation, args: [settings] };
			}
			const state = getState(),
				clock = state.clock;
			validatePlan?.({ operations: [resolvedOperation] }, state);
			if (resolverClock !== clock) {
				resolver = createOpllOperationResolver({ clock });
				resolverClock = clock;
			}
			const { writes } = resolver.resolve(resolvedOperation, state);
			const keyIntent = [
				"keyOn",
				"keyOff",
				"noteOn",
				"noteOff",
				"writeRegister",
			].includes(operation.method);
			for (const { register, value, intentMask } of writes) {
				// A raw R14 byte explicitly addresses every percussion Gate, even
				// when it repeats the already-applied value. Keep trace rows raw.
				const writeIntentMask =
					intentMask ??
					(operation.method === "writeRegister" && register === 14
						? 31
						: undefined);
				dispatch(
					{
						method: "writeRegister",
						args: [register, value],
						...(writeIntentMask === undefined
							? {}
							: { intentMask: writeIntentMask }),
					},
					port,
					frame,
					{
						...metadata,
						reservation,
						pattern,
						timedOperation: true,
						keyIntent,
						preserveOwner: !keyIntent && register !== 14,
					},
				);
			}
			return true;
		},
		// Parameter writes which preserve the Gate bit do not acquire a note.
		// Rhythm's authored bit mask prevents shared-register neighbors from
		// being claimed or released by another pattern.
		observeWrite(register, value, previous, intentMask, metadata, port) {
			if (register >= 0x20 && register <= 0x28) {
				const ch = register - 0x20;
				if (getState().registers[14] & 32 && ch >= 6) return;
				if (!((value ^ previous) & 16) && !metadata?.keyIntent) return;
				gates.delete(ch);
				if (
					value & 16 &&
					metadata?.timedOperation &&
					metadata.reservation !== undefined
				)
					gates.set(ch, {
						owner: metadata.owner,
						reservation: metadata.reservation,
						pattern: metadata.pattern,
						port,
					});
			}
			if (register !== 14) return;
			if ((value ^ previous) & 32) {
				for (let ch = 6; ch < 9; ch++) gates.delete(ch);
				for (let i = 0; i < 5; i++) gates.delete(`rhythm:${i}`);
			}
			const mask = intentMask ?? (value ^ previous) & 31;
			for (let i = 0; i < 5; i++)
				if (mask & (16 >> i)) {
					const key = `rhythm:${i}`;
					gates.delete(key);
					if (
						value & 32 &&
						value & (16 >> i) &&
						metadata?.timedOperation &&
						metadata.reservation !== undefined
					)
						gates.set(key, {
							owner: metadata.owner,
							reservation: metadata.reservation,
							pattern: metadata.pattern,
							port,
						});
				}
		},
		forget(key) {
			gates.delete(key);
		},
		discard(command, metadata) {
			release({
				owner: metadata.owner,
				reservation: command.reservation,
			});
		},
		clear() {
			timeline.clearPatterns();
			staged.clear();
			releaseAll();
		},
	};
}
