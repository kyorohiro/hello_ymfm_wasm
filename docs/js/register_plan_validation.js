// SPDX-License-Identifier: BSD-3-Clause
export function validateTimedFields(value, fields, label) {
	if (!value || typeof value !== 'object' ||
		![Object.prototype, null].includes(Object.getPrototypeOf(value)))
		throw new TypeError(`${label} must be a plain object.`);
	for (const key of Reflect.ownKeys(value)) {
		if (!fields.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
			throw new TypeError(`Unknown or invalid ${label} field: ${String(key)}.`);
	}
}

export function referenceSampleRate(value) {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new RangeError('Register referenceSampleRate must be a positive safe integer.');
	return value;
}

export function validOffset(value) {
	return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function validateIdentity(value, max, label) {
	if (typeof value !== 'string' || !value.length || value.length > max)
		throw new TypeError(`${label} must contain 1 to ${max} characters.`);
	return value;
}

export const validateScheduleName = value => validateIdentity(value, 128, 'Register schedule name');
export const validateScheduleOwner = value => validateIdentity(value, 256, 'Register schedule owner');

export function validateScheduleTransaction(value) {
	if (Number.isSafeInteger(value) && value > 0) return value;
	return validateIdentity(value, 256, 'Register schedule transaction');
}

export function validateScheduleOptions(options, plan) {
	validateTimedFields(options, ['name', 'repeatSeconds'], 'Register schedule options');
	const name = validateScheduleName(options.name);
	const { repeatSeconds } = options, last = plan.writes.at(-1);
	if (!last) throw new RangeError('Schedule requires a Register plan with at least one write.');
	if (repeatSeconds === undefined) return { name };
	if (!validOffset(repeatSeconds) || repeatSeconds <= last.offsetSeconds)
		throw new RangeError('Register repeatSeconds must exceed the final write offset.');
	return { name, repeatSeconds };
}
