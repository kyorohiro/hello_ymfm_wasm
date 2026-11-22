// SPDX-License-Identifier: BSD-3-Clause
import {
	buildNdsOperations, compileNdsOperations, createNdsResetOperationState,
	ndsOperationOffsetSeconds, validateNdsOperations, validateNdsOperationState,
} from './nds-timed-operations.js';

function checkOptions(value, allowed, label) {
	if (!value || typeof value !== 'object' ||
		![Object.prototype, null].includes(Object.getPrototypeOf(value)))
		throw new TypeError(`${label} must be an object.`);
	for (const field of Reflect.ownKeys(value)) {
		if (!allowed.includes(field) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, field), 'value'))
			throw new TypeError(`Unknown or invalid ${label} field: ${String(field)}.`);
	}
}

function scheduleName(value) {
	if (typeof value !== 'string' || !value.length || value.length > 128)
		throw new TypeError('DS schedule name must contain 1–128 characters.');
	return value;
}

function scheduleArguments(operations, settings) {
	const plan = validateNdsOperations(operations);
	checkOptions(settings, ['name', 'repeatSeconds'], 'DS schedule options');
	const options = { name: scheduleName(settings.name) };
	if (settings.repeatSeconds !== undefined) {
		const period = settings.repeatSeconds, last = plan.operations.at(-1);
		if (!Number.isFinite(period) || period <= 0 || !last ||
			period <= ndsOperationOffsetSeconds(last, plan.referenceSampleRate))
			throw new RangeError('DS repeatSeconds must exceed the last operation offset in a nonempty program.');
		options.repeatSeconds = period;
	}
	return [plan, options];
}

function readSnapshot(value, { instanceId, sampleRate }) {
	if (value?.chip !== 'nds' || value.version !== 1 ||
		typeof value.instanceId !== 'string' || !value.instanceId ||
		(instanceId !== undefined && value.instanceId !== instanceId) ||
		!Number.isSafeInteger(value.frame) || value.frame < 0 || value.sampleRate !== sampleRate)
		throw new TypeError('Incompatible DS timed snapshot. Capture it from this renderer.');
	const state = validateNdsOperationState(value.state);
	return Object.freeze({ chip: 'nds', version: 1, instanceId: value.instanceId,
		frame: value.frame, sampleRate, state: Object.freeze(state.map(Object.freeze)) });
}

/** Attach the Code scheduler to the same Worklet instance as immediate DS operations. */
export function attachNdsTimedClient(client, { request, sampleRate, onTimedError }) {
	let instanceId;
	const captureState = async () => {
		const value = readSnapshot(await request({ action: 'capture' }), { instanceId, sampleRate });
		instanceId = value.instanceId;
		return value;
	};
	const controller = Object.freeze({
		onError: listener => onTimedError?.(listener) ?? (() => {}),
		async schedule(operations, options, { owner } = {}) {
			const [plan, settings] = scheduleArguments(operations, options);
			return request({ action: 'schedule', owner, operations: plan, options: settings });
		},
		async clearSchedule(name, { owner } = {}) {
			return request({ action: 'clear', owner, name: scheduleName(name) });
		},
		async stage(transactionId, owner, method, args) {
			let staged;
			if (method === 'schedule' && args.length === 2) staged = scheduleArguments(...args);
			else if (method === 'clearSchedule' && args.length === 1) staged = [scheduleName(args[0])];
			else throw new TypeError('Invalid DS schedule arguments.');
			return request({ action: 'stage', transactionId, owner, method, args: staged });
		},
		commit: (transactionId, owner) => request({ action: 'commit', transactionId, owner }),
		abort: (transactionId, owner) => request({ action: 'abort', transactionId, owner }),
		cancelOwner: owner => request({ action: 'cancelOwner', owner }),
		releaseOwner: owner => request({ action: 'releaseOwner', owner }),
	});
	Object.assign(client, {
		build: buildNdsOperations,
		captureState,
		async compile(operations, settings = {}) {
			const plan = validateNdsOperations(operations);
			checkOptions(settings, ['initialState'], 'DS compile options');
			const { initialState = 'current' } = settings;
			let state;
			if (initialState === 'current') state = (await captureState()).state;
			else if (initialState === 'reset') state = createNdsResetOperationState();
			else if (initialState === 'client')
				throw new Error('Incomplete DS client state: use captureState() to read the applied registers and prepared sample metadata.');
			else if (initialState && typeof initialState === 'object') {
				if (instanceId === undefined) throw new Error('Capture DS state from this renderer before reusing a snapshot.');
				state = readSnapshot(initialState, { instanceId, sampleRate }).state;
			} else throw new TypeError('DS initialState must be current, client, reset or a captured state snapshot.');
			return compileNdsOperations(plan, state);
		},
		schedule: (operations, settings) => controller.schedule(operations, settings),
		clearSchedule: name => controller.clearSchedule(name),
	});
	Object.defineProperty(client, '_timedOperations', { value: controller });
	return client;
}
