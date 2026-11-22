// SPDX-License-Identifier: BSD-3-Clause
import { noteToHz } from '../js/soundchip_pitch.js';
import { NDS_AUDIO_CLOCK, NDS_CHANNEL_COUNT, NDS_CHANNEL_DEFAULTS, ndsInteger, normalizeNdsChannel } from './nds-core.js?v=nds-keyboard-live-1';
import { ndsTimerForVoicePitch } from './nds-synth-api.js?v=nds-timed-1';

export const NDS_SOUND_REGISTER_BASE = 0x04000400;
export const NDS_SOUND_KEY_ON = 0x80000000;
const CHANNEL_STRIDE = 16;
const MAX_OPERATIONS = 4096;
const METHOD_ARGUMENT_COUNTS = {
	configure: [2, 2], setNote: [2, 2], setFrequency: [2, 2], noteOn: [2, 3],
	noteOff: [1, 1], keyOn: [1, 1], keyOff: [1, 1],
};
const LIVE_FIELDS = [['volume', 0x7f, 0], ['divider', 3, 8], ['pan', 0x7f, 16], ['duty', 7, 24]];
const PATCH_FIELDS = ['timer', ...LIVE_FIELDS.map(([field]) => field)];
const FORMAT = { pcm8: 0, pcm16: 1, adpcm: 2, pulse: 3, noise: 3 };
const SAMPLE_FIELDS = ['channel', 'mode', 'loop', 'loopStartWords', 'lengthWords', 'frames', 'sampleRate', 'rootNote', ...PATCH_FIELDS];
const REGISTER_FIELDS = ['control', 'timerRegister', 'sampleAddress', 'sampleLengthRegister'];

function plainFields(value, keys, label) {
	if (!value || typeof value !== 'object' || ![null, Object.prototype].includes(Object.getPrototypeOf(value)))
		throw new TypeError(`${label} must be a plain object.`);
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!keys.includes(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
			throw new TypeError(`Invalid ${label} field: ${String(key)}.`);
	}
}

function referenceRate(value) {
	if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('referenceSampleRate must be a positive safe integer.');
	return value;
}

function readTime(time) {
	plainFields(time, ['unit', 'value'], 'DS operation time');
	if (time.unit !== 'seconds' && time.unit !== 'sample') throw new TypeError('Invalid DS operation time unit.');
	const { value } = time;
	if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER ||
		(time.unit === 'sample' && !Number.isSafeInteger(value))) throw new RangeError('Invalid DS operation offset.');
	return { unit: time.unit, value };
}

export function ndsOperationOffsetSeconds(operation, referenceSampleRate = 44100) {
	const rate = referenceRate(referenceSampleRate);
	const { unit, value } = readTime(operation.time);
	return unit === 'sample' ? value / rate : value;
}

function arrayData(value, length, label) {
	if (!Array.isArray(value) || value.length > length) throw new RangeError(`Invalid ${label} length.`);
	if (Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError(`Invalid ${label} properties.`);
	return Array.from({ length: value.length }, (_, i) => {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${label} must contain plain values.`);
		return descriptor.value;
	});
}

function copyPatch(patch) {
	plainFields(patch, PATCH_FIELDS, 'DS timed settings');
	// Reuse the immediate control limits. Applying these fields never requires sample bytes.
	normalizeNdsChannel(0, NDS_CHANNEL_DEFAULTS, patch);
	return { ...patch };
}

function copyArgs(method, input) {
	if (typeof method !== 'string' || !Object.hasOwn(METHOD_ARGUMENT_COUNTS, method)) throw new TypeError('Unsupported DS timed operation.');
	const [min, max] = METHOD_ARGUMENT_COUNTS[method];
	const args = arrayData(input, max, `DS ${method} arguments`);
	if (args.length < min) throw new TypeError(`Invalid DS ${method} argument count.`);
	const [channel, value, patch] = args;
	ndsInteger(channel, 0, NDS_CHANNEL_COUNT - 1, 'DS channel');
	if (method === 'configure') return [channel, copyPatch(value)];
	if (method === 'setFrequency') {
		if (!Number.isFinite(value) || value <= 0) throw new RangeError('DS frequency must be positive finite Hz.');
	} else if (method === 'setNote' || method === 'noteOn') {
		if (typeof value === 'string' && value.length > 12) throw new RangeError('DS note name is too long.');
		noteToHz(value);
		if (method === 'noteOn' && patch !== undefined) return [channel, value, copyPatch(patch)];
	}
	return args.length > 1 ? [channel, value] : [channel];
}

export function validateNdsOperations(plan) {
	plainFields(plan, ['kind', 'referenceSampleRate', 'operations'], 'DS operation program');
	if (plan.kind !== 'nds-operations') throw new TypeError('Expected a DS operation program.');
	const rate = referenceRate(plan.referenceSampleRate);
	let previous = 0;
	const operations = arrayData(plan.operations, MAX_OPERATIONS, 'DS operation list').map(operation => {
		plainFields(operation, ['method', 'args', 'time'], 'DS operation');
		const time = readTime(operation.time);
		const seconds = time.unit === 'sample' ? time.value / rate : time.value;
		if (seconds < previous) throw new RangeError('DS operation offsets must be nondecreasing.');
		previous = seconds;
		return { method: operation.method, args: copyArgs(operation.method, operation.args), time };
	});
	return { kind: 'nds-operations', referenceSampleRate: rate, operations };
}

/** Record operations once without looking up the chip's current state. */
export function buildNdsOperations(callback, options = {}) {
	if (typeof callback !== 'function') throw new TypeError('DS build requires a synchronous callback.');
	plainFields(options, ['referenceSampleRate'], 'DS build options');
	const rate = referenceRate(options.referenceSampleRate ?? 44100);
	const operations = [];
	let time = { unit: 'sample', value: 0 }, previous = 0, active = true;
	const checkActive = () => { if (!active) throw new Error('The DS operation recorder is no longer active.'); };
	const at = (unit, value) => {
		checkActive();
		const candidate = readTime({ unit, value });
		const seconds = unit === 'sample' ? value / rate : value;
		if (seconds < previous) throw new RangeError('DS operation offsets must be nondecreasing.');
		time = candidate;
		previous = seconds;
		return recorder;
	};
	const recorder = Object.create(null);
	recorder.atSample = value => at('sample', value);
	recorder.atSeconds = value => at('seconds', value);
	for (const method of Object.keys(METHOD_ARGUMENT_COUNTS)) recorder[method] = (...args) => {
		checkActive();
		if (operations.length === MAX_OPERATIONS) throw new RangeError(`DS programs support at most ${MAX_OPERATIONS} operations.`);
		operations.push({ method, args: copyArgs(method, args), time: { ...time } });
		return recorder;
	};
	try {
		const result = callback(Object.freeze(recorder));
		if (result && typeof result.then === 'function') {
			Promise.resolve(result).catch(() => {});
			throw new TypeError('DS build callbacks must be synchronous.');
		}
		return { kind: 'nds-operations', referenceSampleRate: rate, operations };
	} finally {
		active = false;
	}
}

/** Only detached resolver metadata and register values are needed for a snapshot. */
export function validateNdsOperationState(state) {
	const rows = arrayData(state, NDS_CHANNEL_COUNT, 'DS operation state');
	if (rows.length !== NDS_CHANNEL_COUNT) throw new TypeError('DS operation state must contain all 16 channels.');
	return rows.map((row, channel) => {
		if (!row || typeof row !== 'object') throw new TypeError('Invalid DS snapshot channel.');
		const fields = Object.fromEntries([...SAMPLE_FIELDS, ...REGISTER_FIELDS, 'nextSampleAddress', 'canKeyOn'].map(key => {
			const entry = Object.getOwnPropertyDescriptor(row, key);
			if (!entry || !Object.hasOwn(entry, 'value')) throw new TypeError(`DS operation state is missing ${key}.`);
			return [key, entry.value];
		}));
		if (fields.channel !== channel) throw new TypeError('Invalid DS snapshot channel number.');
		normalizeNdsChannel(channel, fields, {});
		ndsInteger(fields.frames, 1, 2097152, 'DS sample frames');
		for (const name of REGISTER_FIELDS) ndsInteger(fields[name], 0, 0xffffffff, `DS ${name}`);
		if (fields.nextSampleAddress !== null) ndsInteger(fields.nextSampleAddress, 0, 0xffffffff, 'DS sample address');
		if (typeof fields.canKeyOn !== 'boolean') throw new TypeError('Invalid DS sample preparation state.');
		if (fields.canKeyOn && FORMAT[fields.mode] !== 3 && (fields.nextSampleAddress === null || fields.lengthWords === null))
			throw new TypeError('A ready DS sample requires a sample address and length.');
		if (fields.sampleRate === null && fields.rootNote === null) return fields;
		if (!Number.isFinite(fields.sampleRate) || fields.sampleRate < 1 || fields.sampleRate > NDS_AUDIO_CLOCK)
			throw new RangeError('Invalid DS snapshot source sample rate.');
		noteToHz(fields.rootNote);
		return fields;
	});
}

export function createNdsResetOperationState() {
	return Array.from({ length: NDS_CHANNEL_COUNT }, (_, channel) => ({
		channel, mode: 'pcm8', loop: false, loopStartWords: 0, lengthWords: null, frames: 1,
		sampleRate: null, rootNote: null, timer: 0, volume: 0, pan: 0, divider: 0, duty: 0,
		control: 0, timerRegister: 0, sampleAddress: 0, sampleLengthRegister: 0, nextSampleAddress: null, canKeyOn: false,
	}));
}

function write(channel, offset, value) {
	return { register: NDS_SOUND_REGISTER_BASE + channel * CHANNEL_STRIDE + offset, value: value >>> 0, width: 32 };
}

/** Preserve live register bits outside the requested fields (including KEY_ON). */
export function ndsLiveRegisterWrites(state, patch) {
	const writes = [];
	if (Object.hasOwn(patch, 'timer') && (state.timerRegister & 0xffff) !== patch.timer)
		writes.push(write(state.channel, 8, (state.timerRegister & 0xffff0000) | patch.timer));
	let control = state.control;
	for (const [field, mask, shift] of LIVE_FIELDS) {
		if (Object.hasOwn(patch, field)) control = (control & ~(mask << shift)) | (patch[field] << shift);
	}
	if ((control >>> 0) !== state.control) writes.push(write(state.channel, 0, control));
	return writes;
}

export function ndsChannelStartControl({ mode, loop, volume, divider, pan, duty }) {
	const repeat = loop || FORMAT[mode] === 3 ? 1 : 2;
	return (NDS_SOUND_KEY_ON | volume | (divider << 8) | (pan << 16) | (duty << 24) | (repeat << 27) | (FORMAT[mode] << 29)) >>> 0;
}

function pitchTimer(state, frequency) {
	const tuning = state.sampleRate === null ? null : { sampleRate: state.sampleRate, rootHz: noteToHz(state.rootNote) };
	return ndsTimerForVoicePitch(frequency, state.frames, tuning);
}

/** Resolve an already validated operation against application-time state.
 * A software noteOff starts the renderer fade without an immediate MMIO write. */
export function resolveNdsOperation({ method, args }, state) {
	const [channel, value, settings] = args;
	const current = Array.isArray(state) ? state[channel] : state;
	if (current?.channel !== channel) throw new TypeError('The DS operation requires matching channel state.');
	const patch = method === 'configure' ? value : method === 'noteOn' ? { ...settings } : {};
	if (method === 'setFrequency') patch.timer = pitchTimer(current, value);
	if ((method === 'setNote' || method === 'noteOn') && !Object.hasOwn(patch, 'timer'))
		patch.timer = pitchTimer(current, noteToHz(value));
	const nextState = { ...current, ...patch };
	let writes, gate = null;
	if (method === 'keyOn' || method === 'noteOn') {
		if (!current.canKeyOn) throw new Error(`Prepare the sample on DS CH${channel + 1} before scheduling Key On.`);
		gate = 'keyOn';
		writes = [write(channel, 0, 0)];
		const usesSample = FORMAT[current.mode] !== 3;
		if (usesSample) {
			writes.push(write(channel, 4, current.nextSampleAddress), write(channel, 12, current.lengthWords));
			nextState.sampleAddress = current.nextSampleAddress;
			nextState.sampleLengthRegister = current.lengthWords;
		}
		nextState.timerRegister = (((usesSample ? current.loopStartWords : 0) << 16) | nextState.timer) >>> 0;
		nextState.control = ndsChannelStartControl(nextState);
		writes.push(write(channel, 8, nextState.timerRegister), write(channel, 0, nextState.control));
	} else if (method === 'keyOff') {
		gate = 'keyOff';
		nextState.control = (current.control & ~NDS_SOUND_KEY_ON) >>> 0;
		writes = current.control & NDS_SOUND_KEY_ON ? [write(channel, 0, nextState.control)] : [];
	} else if (method === 'noteOff') {
		gate = 'noteOff';
		writes = [];
	} else {
		writes = ndsLiveRegisterWrites(current, patch);
		for (const row of writes) {
			if ((row.register - NDS_SOUND_REGISTER_BASE) % CHANNEL_STRIDE === 0) nextState.control = row.value;
			else nextState.timerRegister = row.value;
		}
	}
	return { channel, patch, gate, writes, nextState };
}

export function compileNdsOperations(plan, state) {
	const { operations, referenceSampleRate } = validateNdsOperations(plan);
	const working = validateNdsOperationState(state);
	const writes = [];
	for (let operationIndex = 0; operationIndex < operations.length; operationIndex++) {
		const operation = operations[operationIndex];
		const { channel, nextState, writes: nextWrites } = resolveNdsOperation(operation, working);
		working[channel] = nextState;
		const offsetSeconds = ndsOperationOffsetSeconds(operation, referenceSampleRate);
		for (let writeIndex = 0; writeIndex < nextWrites.length; writeIndex++) {
			writes.push({ offsetSeconds, ...nextWrites[writeIndex], operationIndex, writeIndex });
		}
	}
	return writes;
}
