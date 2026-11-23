// SPDX-License-Identifier: BSD-3-Clause
import { createPerformanceQueue } from '../js/playground_performance_queue.js';
import {
	validateVsuOperations, validateVsuScheduleName, validateVsuScheduleOptions,
	validateVsuScheduleOwner, validateVsuScheduleTransaction,
} from './timed-operations.js';

const LEAD_FRAMES = 128;
const MAX_TRANSACTIONS = 128;
const MAX_STAGED_WRITES = 65536;
const DEFAULT_OWNER = 'vsu:client';

/** Host-clock write queue. The supplied renderer advances the existing VSU core. */
export function createVsuTimedProcessor({ nowFrame, sampleRate, write, release, vgmOwnsOutput, reportError }) {
	const timeline = createPerformanceQueue({
		nowFrame, sampleRate,
		apply({ register, value }, _reply, _frame, owner) { write(register, value, owner); },
		onReleasePattern: release,
	});
	const staged = new Map();
	const freshTime = () => (nowFrame() + LEAD_FRAMES) / sampleRate;

	function prepare(plan, options) {
		const validPlan = validateVsuOperations(plan);
		return { plan: validPlan, options: validateVsuScheduleOptions(options, validPlan) };
	}

	function specification({ plan, options }, session, owner, time) {
		return {
			...options,
			performance: { session, owner, time },
			entries: plan.writes.map(({ offsetSeconds, register, value }) => ({
				offsetSeconds, command: { type: 'write', register, value },
			})),
		};
	}

	function changesFor(records, session, owner) {
		const time = freshTime();
		return [...records.entries()].map(([name, record]) => record === null ? { name, clear: true }
			: specification(record, session, owner, time));
	}

	function replyTo(owner) {
		return message => {
			if (message.type === 'performance-error') reportError({ owner, message: message.error });
		};
	}

	function request(payload) {
		const { action } = payload ?? {};
		if (!['schedule', 'clear', 'stage', 'commit', 'abort', 'cancelOwner', 'releaseOwner'].includes(action))
			throw new TypeError('Unknown VSU timed action.');
		const owner = validateVsuScheduleOwner(payload.owner ?? DEFAULT_OWNER);
		const cleanup = ['abort', 'cancelOwner', 'releaseOwner'].includes(action);
		if (!cleanup && action !== 'clear' && vgmOwnsOutput()) throw new Error('Stop the VGM before scheduling the Synth.');
		let { activeSession: session, latestSession } = timeline.getStats();
		if (!session) {
			if (cleanup || action === 'clear') return false;
			session = latestSession + 1;
			timeline.receive({ type: 'performance-start', session });
		}
		if (action === 'schedule') {
			const record = prepare(payload.plan, payload.options);
			return timeline.schedulePattern(specification(record, session, owner, freshTime()), replyTo(owner));
		}
		if (action === 'clear') return timeline.clearPattern(validateVsuScheduleName(payload.name), { session, owner });
		if (action === 'cancelOwner' || action === 'releaseOwner') {
			for (const [key, entry] of staged) if (entry.owner === owner) staged.delete(key);
			return timeline.cancelPatternOwner(owner, { session });
		}
		const key = JSON.stringify([owner, String(validateVsuScheduleTransaction(payload.transactionId))]);
		if (action === 'abort') return staged.delete(key);
		if (action === 'commit') {
			const records = staged.get(key)?.records ?? new Map();
			const receipt = timeline.commitPatterns(changesFor(records, session, owner), { session, owner }, replyTo(owner));
			staged.delete(key);
			return receipt;
		}
		const { method, args } = payload;
		if (!Array.isArray(args)) throw new TypeError('Provide staged VSU arguments.');
		let record, name;
		if (method === 'schedule' && args.length === 2) {
			record = prepare(args[0], args[1]);
			name = record.options.name;
		} else if (method === 'clearSchedule' && args.length === 1) {
			record = null;
			name = validateVsuScheduleName(args[0]);
		} else throw new TypeError('Unknown staged VSU scheduling method.');
		if (staged.size >= MAX_TRANSACTIONS && !staged.has(key)) throw new RangeError('Too many VSU timed transactions.');
		const records = new Map(staged.get(key)?.records);
		records.set(name, record);
		const countWrites = entries => [...entries.values()].reduce((count, item) => count + (item?.plan.writes.length ?? 1), 0);
		let stored = countWrites(records);
		for (const [other, entry] of staged) if (other !== key) stored += countWrites(entry.records);
		if (stored > MAX_STAGED_WRITES) throw new RangeError('VSU staged write capacity exceeded.');
		const receipt = timeline.commitPatterns(changesFor(records, session, owner), { session, owner, dryRun: true });
		staged.set(key, { owner, records });
		if (!record) return true;
		const { startFrame: _, ...accepted } = receipt.reservations.find(item => item.name === name);
		return { ...accepted, staged: true };
	}

	return {
		request,
		clear() {
			staged.clear();
			const { activeSession: session } = timeline.getStats();
			if (session) timeline.receive({ type: 'performance-stop', session });
		},
		render(frames, renderFrames) {
			const start = nowFrame();
			let offset = 0;
			while (offset < frames) {
				const frame = start + offset;
				timeline.advance(frame);
				const count = Math.min(frames - offset, timeline.nextFrame() - frame);
				renderFrames(offset, count);
				offset += count;
			}
		},
	};
}
