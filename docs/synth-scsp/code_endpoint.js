// SPDX-License-Identifier: BSD-3-Clause
import { noteToHz } from '../js/soundchip_pitch.js';
import { checkScspSynthDspSource } from './dsp_program.js?v=scsp-dsp-ui-routing-1';

export const SCSP_CODE_METHODS = Object.freeze([
	'getState',
	'loadPCM',
	'getPCM',
	'applyPCM',
	'setPreset',
	'setEnvelope',
	'setMix',
	'setLfo',
	'setConfig',
	'setEffect',
	'setDspSend',
	'setDspSourceSend',
	'setDspReturn',
	'getDspProgram',
	'applyDspProgram',
	'getDspCoefficients',
	'setDspCoefficients',
	'exportPatch',
	'loadPatch',
	'setFrequency',
	'setNote',
	'noteOn',
	'noteOff',
	'keyOn',
	'keyOff',
	'allNotesOff',
	'dispose',
]);
export function scspCodeCancelled() {
	const error = new Error('SCSP Code session was stopped');
	error.name = 'AbortError';
	return error;
}
export function validateScspCodeCall(method, args) {
	if (!SCSP_CODE_METHODS.includes(method)) throw new Error('Unknown SCSP Code method');
	if (!Array.isArray(args)) throw new TypeError('SCSP Code arguments must be an array');
	const arity = {
		getState: 0,
		loadPCM: 2,
		getPCM: 1,
		applyPCM: 3,
		setPreset: 2,
		setEnvelope: 2,
		setMix: 2,
		setLfo: 2,
		setConfig: 1,
		setEffect: 1,
		setDspSend: 2,
		setDspSourceSend: 2,
		setDspReturn: 2,
		getDspProgram: 0,
		applyDspProgram: 1,
		getDspCoefficients: 0,
		setDspCoefficients: 1,
		exportPatch: 0,
		loadPatch: 1,
		setFrequency: 2,
		setNote: 2,
		noteOn: 2,
		noteOff: 1,
		keyOn: 1,
		keyOff: 1,
		allNotesOff: 0,
		dispose: 0,
	};
	if (args.length !== arity[method] && !(method === 'applyDspProgram' && args.length === 2)) {
		const expected = method === 'applyDspProgram' ? '1 or 2' : arity[method];
		throw new TypeError(`${method} takes ${expected} arguments`);
	}
	if (
		['setFrequency', 'setNote', 'noteOn', 'noteOff', 'keyOn', 'keyOff'].includes(method) &&
		(!Number.isInteger(args[0]) || args[0] < 0 || args[0] > 31)
	)
		throw new RangeError('SCSP Code lane must be 0..31');
	if (
		['getPCM', 'applyPCM', 'setPreset', 'setEnvelope', 'setMix', 'setLfo'].includes(method) &&
		(!Number.isInteger(args[0]) || args[0] < 0 || args[0] > 5)
	)
		throw new RangeError('SCSP source operator must be A–F (0..5)');
	if (method === 'setPreset' && args[1]?.sample === null)
		throw new TypeError('Assign a sample from this bank to the SCSP source operator.');
	if (method === 'setNote' || method === 'noteOn') noteToHz(args[1]);
	if (['setDspSend', 'setDspSourceSend', 'setDspReturn'].includes(method)) {
		const maximum = method === 'setDspSend' ? 31 : method === 'setDspSourceSend' ? 5 : 1;
		if (!Number.isInteger(args[0]) || args[0] < 0 || args[0] > maximum)
			throw new RangeError(`${method} target must be 0..${maximum}`);
		const patch = args[1], isReturn = method === 'setDspReturn';
		if (patch === null && !isReturn) return;
		const fields = isReturn ? ['level', 'pan'] : ['input', 'level'];
		if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
			Reflect.ownKeys(patch).some(key => !fields.includes(key)))
			throw new TypeError(`Invalid ${method} patch`);
		for (const key of fields) if (Object.hasOwn(patch, key)) {
			const maximum = key === 'input' ? 1 : key === 'pan' ? 31 : 7;
			if (!Number.isInteger(patch[key]) || patch[key] < 0 || patch[key] > maximum)
				throw new RangeError(`${key} must be 0..${maximum}`);
		}
	}
	if (method === 'setFrequency' && (!Number.isFinite(args[1]) || args[1] <= 0))
		throw new RangeError('Frequency must be positive finite Hz');
}

/** Borrowed musical facade, not a rawScspSynth. Note/pitch methods address
 * logical lanes whose voices use the editor's current PCM / FM patch. Source
 * editing methods address operators A–F. All mutations are acknowledged and
 * ordered by the owning Worklet; no second SCSP or sample bank is created.
 */
export function createScspCodeClient({ metadata, invoke, isCurrent, dispose } = {}) {
	if (
		!Number.isSafeInteger(metadata?.session) ||
		metadata.session < 1 ||
		metadata.channels !== 32 ||
		metadata.operators !== 6 ||
		metadata.sampleRate !== 44100
	)
		throw new Error('Invalid SCSP Code session');
	for (const callback of [invoke, isCurrent, dispose])
		if (typeof callback !== 'function')
			throw new TypeError('SCSP Code requires ownership callbacks');
	let closed = false,
		closing = null;
	const current = () => !closed && isCurrent(),
		check = () => {
			if (!current()) throw scspCodeCancelled();
		};
	const client = {
		id: 'scsp:synth',
		chip: 'scsp',
		apiKind: 'scsp-performance',
		channels: 32,
		channelCount: 32,
		logicalChannels: 32,
		operators: 6,
		sampleRate: 44100,
		nativeSampleRate: 44100,
		isCurrent: current,
		compileDsp(...args) {
			check();
			if (args.length !== 1) throw new TypeError('compileDsp takes 1 argument');
			return checkScspSynthDspSource(args[0]).words;
		},
	};
	for (const method of SCSP_CODE_METHODS) {
		if (method === 'dispose') continue;
		client[method] = (...args) => {
			check();
			validateScspCodeCall(method, args);
			// Clone before enqueueing so edits after this call cannot change its PCM
			// or turn a validated owned handle into a different request.
			return Promise.resolve(invoke(method, structuredClone(args))).then((value) => {
				check();
				return value;
			});
		};
	}
	client.dispose = (...args) => {
		if (closing) return closing;
		check();
		validateScspCodeCall('dispose', args);
		closed = true;
		return (closing = Promise.resolve(dispose()));
	};
	return client;
}
