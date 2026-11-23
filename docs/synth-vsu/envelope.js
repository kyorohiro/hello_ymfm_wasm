// SPDX-License-Identifier: BSD-3-Clause

const ENVELOPE_STEP_MS = 15.36;

export function createVsuEnvelope() {
	return { initial: 15, rate: 0, direction: 'down', enabled: false, repeat: false };
}

export function validateVsuEnvelope(value) {
	const { initial, rate, direction, enabled, repeat } = value ?? {};
	if (!Number.isInteger(initial) || initial < 0 || initial > 15)
		throw new RangeError('Envelope initial level must be an integer from 0 to 15.');
	if (!Number.isInteger(rate) || rate < 0 || rate > 7)
		throw new RangeError('Envelope rate must be an integer from 0 to 7.');
	if (direction !== 'up' && direction !== 'down')
		throw new RangeError('Choose up or down for the envelope direction.');
	if (typeof enabled !== 'boolean' || typeof repeat !== 'boolean')
		throw new TypeError('Envelope enable and repeat must be true or false.');
	return { initial, rate, direction, enabled, repeat };
}

export function decodeVsuEnvelope(ev0, ev1) {
	if (![ev0, ev1].every(value => Number.isInteger(value) && value >= 0 && value <= 255))
		throw new RangeError('Envelope registers must be bytes.');
	// Virtual Boy Development Manual §6.4.12. CH5/CH6 share EV1
	// with their other controls, so read only its envelope bits here.
	return {
		initial: ev0 >> 4,
		rate: ev0 & 7,
		direction: (ev0 & 8) ? 'up' : 'down',
		enabled: Boolean(ev1 & 1),
		repeat: Boolean(ev1 & 2),
	};
}

export function vsuEnvelopeRegisterValues(envelope) {
	const { initial, rate, direction, enabled, repeat } = validateVsuEnvelope(envelope);
	return {
		ev0: (initial << 4) | (direction === 'up' ? 8 : 0) | rate,
		ev1: (repeat ? 2 : 0) | (enabled ? 1 : 0),
	};
}

export function isVsuEnvelopeEdit(register, mask, value) {
	return (register === 'EV0' || register === 'EV1') &&
		Number.isInteger(mask) && mask > 0 && mask <= (register === 'EV1' ? 3 : 255) &&
		Number.isInteger(value) && value >= 0 && value <= 255;
}

export function envelopeStepMs(envelope) {
	return (validateVsuEnvelope(envelope).rate + 1) * ENVELOPE_STEP_MS;
}

export function envelopeLevels(envelope) {
	const { initial, direction, enabled, repeat } = validateVsuEnvelope(envelope);
	if (!enabled) return [initial, initial];

	const end = direction === 'up' ? 15 : 0;
	const delta = direction === 'up' ? 1 : -1;
	const levels = Array.from({ length: Math.abs(end - initial) + 1 }, (_, index) => initial + index * delta);
	// The terminal level lasts a full step before the repeating counter
	// returns to its programmed starting level.
	levels.push(repeat ? initial : end);
	return levels;
}
