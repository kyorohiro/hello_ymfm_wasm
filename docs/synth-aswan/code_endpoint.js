// SPDX-License-Identifier: BSD-3-Clause
import { attachAswanTimedClient } from './timed_client.js';
import { readPreset } from './preset.js';
import { noteToHz } from '../js/soundchip_pitch.js';
export function aswanAuditionCancelled() {
	const error = new Error('ASWAN song audition selection changed');
	error.name = 'AbortError';
	return error;
}
export function readAswanAuditionLoad(value, options = {}) {
	const preset = readPreset(value);
	if (typeof options === 'string') options = { token: options };
	if (
		!options ||
		typeof options !== 'object' ||
		Array.isArray(options) ||
		Reflect.ownKeys(options).some(
			(key) => !['token', 'channel', 'frequencyHz', 'referenceMidi', 'clock'].includes(key),
		)
	)
		throw new TypeError('Invalid ASWAN audition options');
	const { token, channel = 0, referenceMidi = 60, clock = 3072000 } = options;
	if (typeof token !== 'string' || !token.length || token.length > 256)
		throw new TypeError('Audition token must be a nonempty string of at most256 characters');
	if (!Number.isInteger(channel) || channel < 0 || channel > 3)
		throw new RangeError('Audition channel must be 0..3');
	if (!Number.isInteger(referenceMidi) || referenceMidi < 0 || referenceMidi > 127)
		throw new RangeError('Audition Reference must be MIDI0..127');
	if (clock !== 3072000)
		throw new RangeError(
			'Keyboard audition currently requires the standard3072000Hz clock. Original VGM playback is unchanged.',
		);
	if (preset.source === 'pcm')
		throw new TypeError(
			'A frozen Voice PCM byte is not a captured sample; use extracted PCM presets instead.',
		);
	if ((preset.source === 'noise' && channel !== 3) || (preset.sweep.enabled && channel !== 2))
		throw new RangeError('Noise audition uses CH4; hardwareSweep uses CH3');
	const frequencyHz = options.frequencyHz ?? noteToHz(referenceMidi);
	if (
		!Number.isFinite(frequencyHz) ||
		frequencyHz < 3072000 / (32 * 2048) ||
		frequencyHz > 3072000 / 32
	)
		throw new RangeError('Audition frequency must be within the hardware period range');
	return { preset, options: { token, channel, referenceMidi, clock, frequencyHz } };
}
export function validateAswanAuditionCall(method, args) {
	const arity = { noteOn: 2, noteOff: 1, setPreset: 1, editPreset: 2, setPitch: 1, read: 0 };
	if (!Object.hasOwn(arity, method) || !Array.isArray(args) || args.length !== arity[method])
		throw new TypeError('Invalid ASWAN audition method / arguments');
	if (method === 'noteOn' || method === 'noteOff') {
		if (typeof args[0] !== 'string' || !args[0].length)
			throw new TypeError('Audition note identity must be a nonempty string');
	}
	if (method === 'noteOn') noteToHz(args[1]);
	if (method === 'setPitch' && (!Number.isFinite(args[0]) || args[0] < -48 || args[0] > 48))
		throw new RangeError('Audition Pitch must be -48..48');
}
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
		timed: [2],
		endCode: [1],
		loadAudition: [2],
		invokeAudition: [3],
		stopAudition: [0, 1],
		readAudition: [1],
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
export function createAswanCodeClient({ metadata, invoke, isCurrent, dispose, requestControl, port } = {}) {
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
	if (requestControl) client._requestControl = (_method, args) => { check(); return requestControl(args[0]); };
	return attachAswanTimedClient(client, {instanceId: metadata.instanceId}, port);
}
