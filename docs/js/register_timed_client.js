// SPDX-License-Identifier: BSD-3-Clause
/** Attach stateless register plans and the Code runtime's reservation lifecycle. */
export function attachRegisterTimedClient(api, request, {buildOperations,validateOperations,validateScheduleOptions,validateScheduleName,validateScheduleOwner,validateScheduleTransaction,validateTimedFields}) {
	function prepare(plan, options) {
		const copy = validateOperations(plan);
		return { plan: copy, options: validateScheduleOptions(options, copy) };
	}
	function owned(payload, metadata = {}) {
		validateTimedFields(metadata, ['owner'], 'register schedule metadata');
		return metadata.owner === undefined ? payload : { ...payload, owner: validateScheduleOwner(metadata.owner) };
	}
	const capability = Object.freeze({
		async schedule(plan, options, metadata) {
			return request(owned({ action: 'schedule', ...prepare(plan, options) }, metadata));
		},
		async clearSchedule(name, metadata) {
			return request(owned({ action: 'clear', name: validateScheduleName(name) }, metadata));
		},
		async stage(transactionId, owner, method, args) {
			const identity = {
				transactionId: validateScheduleTransaction(transactionId),
				owner: validateScheduleOwner(owner),
			};
			if (!Array.isArray(args)) throw new TypeError('Provide register staged schedule arguments.');
			let copied;
			if (method === 'schedule' && args.length === 2) {
				const { plan, options } = prepare(...args);
				copied = [plan, options];
			} else if (method === 'clearSchedule' && args.length === 1) {
				copied = [validateScheduleName(args[0])];
			} else {
				throw new TypeError('Unsupported register staged scheduling method or arguments.');
			}
			return request({ action: 'stage', ...identity, method, args: copied });
		},
		async commit(transactionId, owner) {
			return request({ action: 'commit', transactionId: validateScheduleTransaction(transactionId),
				owner: validateScheduleOwner(owner) });
		},
		async abort(transactionId, owner) {
			return request({ action: 'abort', transactionId: validateScheduleTransaction(transactionId),
				owner: validateScheduleOwner(owner) });
		},
		async cancelOwner(owner) {
			return request({ action: 'cancelOwner', owner: validateScheduleOwner(owner) });
		},
		async releaseOwner(owner) {
			return request({ action: 'releaseOwner', owner: validateScheduleOwner(owner) });
		},
	});
	api.build = buildOperations;
	api.compile = async (plan, options = {}) => {
		validateTimedFields(options, [], 'register compile options');
		return validateOperations(plan).writes;
	};
	api.schedule = (plan, options) => capability.schedule(plan, options);
	api.clearSchedule = name => capability.clearSchedule(name);
	Object.defineProperty(api, '_timedOperations', { value: capability });
	return api;
}
