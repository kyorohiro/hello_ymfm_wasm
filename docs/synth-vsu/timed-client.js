// SPDX-License-Identifier: BSD-3-Clause
import {
	buildVsuOperations,
	validateVsuOperations,
	validateVsuScheduleName,
	validateVsuScheduleOptions,
	validateVsuScheduleOwner,
	validateVsuScheduleTransaction,
	validateVsuTimedFields,
} from './timed-operations.js?v=vsu-envelope-patch';

/** Attach stateless register plans and the Code runtime's reservation lifecycle. */
export function attachVsuTimedClient(api, request) {
	function prepare(plan, options) {
		const copy = validateVsuOperations(plan);
		return { plan: copy, options: validateVsuScheduleOptions(options, copy) };
	}
	function owned(payload, metadata = {}) {
		validateVsuTimedFields(metadata, ['owner'], 'VSU schedule metadata');
		return metadata.owner === undefined ? payload : { ...payload, owner: validateVsuScheduleOwner(metadata.owner) };
	}
	const capability = Object.freeze({
		async schedule(plan, options, metadata) {
			return request(owned({ action: 'schedule', ...prepare(plan, options) }, metadata));
		},
		async clearSchedule(name, metadata) {
			return request(owned({ action: 'clear', name: validateVsuScheduleName(name) }, metadata));
		},
		async stage(transactionId, owner, method, args) {
			const identity = {
				transactionId: validateVsuScheduleTransaction(transactionId),
				owner: validateVsuScheduleOwner(owner),
			};
			if (!Array.isArray(args)) throw new TypeError('Provide VSU staged schedule arguments.');
			let copied;
			if (method === 'schedule' && args.length === 2) {
				const { plan, options } = prepare(...args);
				copied = [plan, options];
			} else if (method === 'clearSchedule' && args.length === 1) {
				copied = [validateVsuScheduleName(args[0])];
			} else {
				throw new TypeError('Unsupported VSU staged scheduling method or arguments.');
			}
			return request({ action: 'stage', ...identity, method, args: copied });
		},
		async commit(transactionId, owner) {
			return request({ action: 'commit', transactionId: validateVsuScheduleTransaction(transactionId),
				owner: validateVsuScheduleOwner(owner) });
		},
		async abort(transactionId, owner) {
			return request({ action: 'abort', transactionId: validateVsuScheduleTransaction(transactionId),
				owner: validateVsuScheduleOwner(owner) });
		},
		async cancelOwner(owner) {
			return request({ action: 'cancelOwner', owner: validateVsuScheduleOwner(owner) });
		},
		async releaseOwner(owner) {
			return request({ action: 'releaseOwner', owner: validateVsuScheduleOwner(owner) });
		},
	});
	api.build = buildVsuOperations;
	api.compile = async (plan, options = {}) => {
		validateVsuTimedFields(options, [], 'VSU compile options');
		return validateVsuOperations(plan).writes;
	};
	api.schedule = (plan, options) => capability.schedule(plan, options);
	api.clearSchedule = name => capability.clearSchedule(name);
	Object.defineProperty(api, '_timedOperations', { value: capability });
	return api;
}
