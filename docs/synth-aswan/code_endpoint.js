// SPDX-License-Identifier: BSD-3-Clause
export const ASWAN_CODE_METHODS = Object.freeze([
	'getState',
	'initialize',
	'writeRegister',
	'writeMemory',
	'loadMemory',
	'setWaveform',
	'setVolume',
	'setPan',
	'setFrequency',
	'setNote',
	'keyOn',
	'keyOff',
	'noteOn',
	'noteOff',
	'allNotesOff',
	'setNoise',
	'setSweep',
	'setVoiceMode',
	'writeVoice',
]);
export function aswanCodeCancelled() {
	const error = new Error('ASWAN Code session stopped');
	error.name = 'AbortError';
	return error;
}
export function validateAswanCommand(method, args) {
	const arity = {
		setPreset: [1, 2],
		editPreset: [3],
		applyPreset: [1, 2],
		loadPreset: [1, 2],
		noteOn: [2, 3],
		noteOff: [1],
		setPitch: [1],
		setChannelEnabled: [2],
		read: [0],
		stop: [0],
		beginCode: [0],
		code: [3],
		endCode: [1],
	};
	if (
		!Object.hasOwn(arity, method) ||
		!Array.isArray(args) ||
		!arity[method].includes(args.length)
	)
		throw new TypeError('Invalid ASWAN host command / arguments');
}
export function validateAswanCodeCall(method, args) {
	if (!ASWAN_CODE_METHODS.includes(method)) throw new TypeError('Unknown ASWAN Code method');
	if (!Array.isArray(args)) throw new TypeError('ASWAN Code arguments must be an array');
	const arities = {
		getState: [0],
		initialize: [0],
		writeRegister: [2],
		writeMemory: [2],
		loadMemory: [1, 2],
		setWaveform: [2],
		setVolume: [2, 3],
		setPan: [2, 3],
		setFrequency: [2],
		setNote: [2],
		keyOn: [1],
		keyOff: [1],
		noteOn: [2],
		noteOff: [1],
		allNotesOff: [0],
		setNoise: [1],
		setSweep: [1],
		setVoiceMode: [1],
		writeVoice: [1],
	};
	if (!arities[method].includes(args.length))
		throw new TypeError(`Invalid ${method} argument count`);
	if (
		[
			'setWaveform',
			'setVolume',
			'setPan',
			'setFrequency',
			'setNote',
			'keyOn',
			'keyOff',
			'noteOn',
			'noteOff',
		].includes(method) &&
		(!Number.isInteger(args[0]) || args[0] < 0 || args[0] > 3)
	)
		throw new RangeError('ASWAN physical channel must be 0..3');
}
export function createAswanCodeClient({ metadata, invoke, isCurrent, dispose } = {}) {
	if (
		!Number.isSafeInteger(metadata?.session) ||
		metadata.session < 1 ||
		metadata.channels !== 4 ||
		metadata.clock !== 3072000
	)
		throw new TypeError('Invalid ASWAN Code session');
	for (const fn of [invoke, isCurrent, dispose])
		if (typeof fn !== 'function') throw new TypeError('ASWAN Code needs ownership callbacks');
	let closed = false,
		closing = null;
	const check = () => {
		if (closed || !isCurrent()) throw aswanCodeCancelled();
	};
	const client = {
		id: 'aswan:synth',
		chip: 'wonderswan',
		channels: 4,
		channelCount: 4,
		clock: metadata.clock,
		isCurrent: () => !closed && isCurrent(),
	};
	for (const method of ASWAN_CODE_METHODS)
		client[method] = (...args) => {
			check();
			validateAswanCodeCall(method, args);
			return Promise.resolve(invoke(method, args)).then((value) => {
				check();
				return value;
			});
		};
	client.dispose = () => {
		if (closing) return closing;
		check();
		closed = true;
		return (closing = Promise.resolve(dispose()));
	};
	return client;
}
