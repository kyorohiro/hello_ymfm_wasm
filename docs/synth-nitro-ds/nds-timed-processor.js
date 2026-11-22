// SPDX-License-Identifier: BSD-3-Clause
import {
	ndsOperationOffsetSeconds, validateNdsOperations,
} from './nds-timed-operations.js';

function identifier(value, label, limit = 128) {
	if (typeof value !== 'string' || !value.length || value.length > limit)
		throw new TypeError(`Invalid DS ${label}.`);
	return value;
}

/** The shared performance queue owns time, ordering and compact repetitions.
 * Only serializable DS operations cross the Worklet port. */
export function createNdsTimedProcessor({ performance, getState, canKeyOn, instanceId, sampleRate, onError, releaseHeld }) {
	const staged = new Map();
	const leadFrames = 128;
	const startTime = () => (performance.nowFrame() + leadFrames) / sampleRate;
	const report = owner => event => onError({ type: 'nds-timed-error', owner, message: event.error });
	function specification(plan, options, context) {
		if (!options || typeof options !== 'object' || Array.isArray(options) ||
			Object.keys(options).some(key => key !== 'name' && key !== 'repeatSeconds'))
			throw new TypeError('Invalid DS schedule options.');
		const attacks = new Set();
		for (const { method, args: [channel] } of plan.operations) {
			if (method === 'keyOn' || method === 'noteOn') attacks.add(channel);
		}
		// Scheduled operations cannot replace the source. Validate sample readiness
		// once per channel here, then resolve against live state at the event frame.
		for (const channel of attacks) {
			if (!canKeyOn(channel)) throw new Error(`Prepare the sample on DS CH${channel + 1} before scheduling Key On.`);
		}
		const name = identifier(options.name, 'schedule name');
		return {
			name, repeatSeconds: options.repeatSeconds,
			performance: context,
			entries: plan.operations.map(operation => ({
				offsetSeconds: ndsOperationOffsetSeconds(operation, plan.referenceSampleRate),
				command: { method: 'ndsTimedOperation', name, operation },
			})),
		};
	}
	function changesFor(records, context) {
		return Array.from(records?.values() ?? [], record => record.method === 'clearSchedule'
			? { name: record.args[0], clear: true }
			: specification(record.args[0], record.args[1], context));
	}
	function reset() {
		const { activeSession } = performance.getStats();
		if (activeSession) performance.receive({ type: 'performance-stop', session: activeSession }, { postMessage() {} });
		staged.clear();
		releaseHeld();
	}
	return {
		reset,
		invoke(payload) {
			if (!payload || typeof payload !== 'object') throw new TypeError('Invalid DS timed request.');
			const { action } = payload;
			if (action === 'capture') return {
				chip: 'nds', version: 1, instanceId, frame: performance.nowFrame(), sampleRate, state: getState(),
			};
			if (action === 'end') { reset(); return true; }
			if (!['schedule', 'clear', 'cancelOwner', 'releaseOwner', 'stage', 'commit', 'abort'].includes(action))
				throw new TypeError('Invalid DS timed action.');
			const owner = identifier(payload.owner ?? 'nds:code', 'schedule owner', 256);
			const stats = performance.getStats();
			if (!stats.activeSession && ['abort', 'cancelOwner', 'releaseOwner'].includes(action)) return false;
			const session = stats.activeSession || stats.latestSession + 1;
			if (!stats.activeSession) performance.receive({ type: 'performance-start', session }, { postMessage() {} });
			const context = { session, owner, time: startTime() };
			if (action === 'schedule') {
				const plan = validateNdsOperations(payload.operations);
				const receipt = performance.schedulePattern(specification(plan, payload.options, context), report(owner));
				releaseHeld(undefined, receipt.name);
				return receipt;
			}
			if (action === 'clear') {
				const name = identifier(payload.name, 'schedule name');
				const cleared = performance.clearPattern(name, context);
				return releaseHeld(owner, name) || cleared;
			}
			if (action === 'cancelOwner' || action === 'releaseOwner') {
				for (const [key, transaction] of staged) if (transaction.owner === owner) staged.delete(key);
				performance.cancelOwner(owner);
				releaseHeld(owner);
				return true;
			}

			const id = payload.transactionId;
			if (!(Number.isSafeInteger(id) && id > 0)) identifier(id, 'schedule transaction', 256);
			const key = JSON.stringify([owner, id]);
			if (action === 'abort') return staged.delete(key);
			if (action === 'commit') {
				const receipt = performance.commitPatterns(changesFor(staged.get(key)?.records, context), context, report(owner));
				staged.delete(key);
				releaseHeld(owner);
				for (const { name } of receipt.reservations) releaseHeld(undefined, name);
				return receipt;
			}

			const { method, args } = payload;
			if (!Array.isArray(args) || (method === 'schedule' ? args.length !== 2 : method !== 'clearSchedule' || args.length !== 1))
				throw new TypeError('Invalid DS staged schedule.');
			const isSchedule = method === 'schedule';
			const name = identifier(isSchedule ? args[1]?.name : args[0], 'schedule name');
			const records = new Map(staged.get(key)?.records);
			const validatedArgs = isSchedule ? [validateNdsOperations(args[0]), args[1]] : [name];
			records.set(name, { method, args: validatedArgs });
			if (staged.size >= 128 && !staged.has(key)) throw new RangeError('Too many DS staged schedule transactions.');
			let entries = 0;
			for (const [otherKey, transaction] of staged) {
				if (otherKey === key) continue;
				for (const record of transaction.records.values()) entries += record.args[0]?.operations?.length ?? 1;
			}
			for (const record of records.values()) entries += record.args[0]?.operations?.length ?? 1;
			if (entries > 65536) throw new RangeError('DS staged schedule capacity exceeded.');
			const receipt = performance.commitPatterns(changesFor(records, context), { ...context, dryRun: true });
			staged.set(key, { owner, records });
			if (!isSchedule) return true;
			const { startFrame: _previewStart, ...details } = receipt.reservations.find(item => item.name === name);
			return { ...details, staged: true };
		},
	};
}
