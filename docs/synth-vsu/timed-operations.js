// SPDX-License-Identifier: BSD-3-Clause
import { PERFORMANCE_PATTERN_LIMITS } from '../js/playground_performance_queue.js';
import { createVsuClient, VSU_SOUND_STOP, vsuMaskedEnvelopeTarget, vsuPcmReleaseTarget } from './vsu.js?v=vsu-note-gate';

const DEFAULT_SAMPLE_RATE = 44100;
const MAX_WRITES = PERFORMANCE_PATTERN_LIMITS.maxPatternEntries;

import {referenceSampleRate,validOffset,validateTimedFields as validateVsuTimedFields, validateScheduleName as validateVsuScheduleName, validateScheduleOwner as validateVsuScheduleOwner, validateScheduleTransaction as validateVsuScheduleTransaction, validateScheduleOptions as validateVsuScheduleOptions} from '../js/register_plan_validation.js';
export {validateVsuTimedFields, validateVsuScheduleName, validateVsuScheduleOwner, validateVsuScheduleTransaction, validateVsuScheduleOptions};

function validateWrite(register, value) {
	if (!Number.isInteger(register) || register < 0 || register > VSU_SOUND_STOP || register % 4 !== 0)
		throw new RangeError('VSU timed writes require an aligned offset from 0x000 to 0x580.');
	if (!Number.isInteger(value) || value < 0 || value > 255)
		throw new RangeError('VSU timed writes require one register byte.');
}

/** Copy a plan's register intent before compiling or handing it to the Worklet. */
export function validateVsuOperations(plan) {
	validateVsuTimedFields(plan, ['version', 'chip', 'referenceSampleRate', 'writes'], 'VSU plan');
	if (plan.version !== 1 || plan.chip !== 'vsu')
		throw new TypeError('Unsupported VSU plan version or chip.');
	const rate = referenceSampleRate(plan.referenceSampleRate);
	if (!Array.isArray(plan.writes) || plan.writes.length > MAX_WRITES)
		throw new RangeError(`A VSU plan must contain an array of at most ${MAX_WRITES} writes.`);
	let lastOffset = 0, lastOperation = -1, lastWrite = -1;
	const writes = Array.from(plan.writes, row => {
		validateVsuTimedFields(row, ['offsetSeconds', 'register', 'value', 'mask', 'fadeMs', 'operationIndex', 'writeIndex'], 'VSU write');
		const { offsetSeconds, register, value, mask, fadeMs, operationIndex, writeIndex } = row;
		if (!validOffset(offsetSeconds) || offsetSeconds < lastOffset)
			throw new RangeError('VSU operation offsets must be nonnegative and nondecreasing.');
		const ordered = operationIndex === lastOperation && lastOperation >= 0
			? writeIndex === lastWrite + 1 && offsetSeconds === lastOffset
			: operationIndex === lastOperation + 1 && writeIndex === 0;
		if (!ordered) throw new TypeError('Invalid VSU operation or write order.');
		validateWrite(register, value);
		if (mask !== undefined && !vsuMaskedEnvelopeTarget(register, mask, value))
			throw new RangeError('Invalid VSU masked envelope write.');
		if (fadeMs !== undefined && (mask !== undefined || vsuPcmReleaseTarget(register, value, fadeMs) === null))
			throw new RangeError('Invalid VSU PCM release.');
		lastOffset = offsetSeconds;
		lastOperation = operationIndex;
		lastWrite = writeIndex;
		return { offsetSeconds, register, value, operationIndex, writeIndex,
			...(mask === undefined ? {} : { mask }), ...(fadeMs === undefined ? {} : { fadeMs }) };
	});
	return { version: 1, chip: 'vsu', referenceSampleRate: rate, writes };
}

/** Record a synchronous callback using the same register conversions as immediate VSU calls. */
export function buildVsuOperations(callback, options = {}) {
	if (typeof callback !== 'function') throw new TypeError('VSU build requires a synchronous callback.');
	validateVsuTimedFields(options, ['referenceSampleRate'], 'VSU build options');
	const rate = referenceSampleRate(options.referenceSampleRate ?? DEFAULT_SAMPLE_RATE);
	const writes = [];
	let offsetSeconds = 0, operationIndex = 0, active = true;
	const checkActive = () => {
		if (!active) throw new Error('The VSU operation recorder is no longer active.');
	};
	const when = seconds => {
		checkActive();
		if (!validOffset(seconds) || seconds < offsetSeconds)
			throw new RangeError('VSU operation offsets must be nonnegative and nondecreasing.');
		offsetSeconds = seconds;
		return builder;
	};
	const builder = {
		atSeconds: when,
		atSample(sample) {
			if (!Number.isSafeInteger(sample) || sample < 0)
				throw new RangeError('VSU sample offsets must be nonnegative safe integers.');
			return when(sample / rate);
		},
	};
	function record(pairs) {
		if (writes.length + pairs.length > MAX_WRITES)
			throw new RangeError(`A VSU plan can contain at most ${MAX_WRITES} writes.`);
		for (const [writeIndex, [register, value, mask, fadeMs]] of pairs.entries())
			writes.push({ offsetSeconds, register, value, operationIndex, writeIndex,
				...(mask === undefined ? {} : { mask }), ...(fadeMs === undefined ? {} : { fadeMs }) });
		operationIndex++;
	}
	const recorder = createVsuClient({
		write(register, value) { record([[register, value]]); },
		writeBatch: record,
		writeEnvelope: record,
		writeNote: record,
	});
	for (const [name, method] of Object.entries(recorder)) {
		if (typeof method !== 'function') continue;
		builder[name] = (...args) => {
			checkActive();
			method(...args);
			return builder;
		};
	}
	try {
		const result = callback(builder);
		if (result && typeof result.then === 'function') {
			Promise.resolve(result).catch(() => {});
			throw new TypeError('VSU build callbacks must be synchronous.');
		}
		return { version: 1, chip: 'vsu', referenceSampleRate: rate, writes };
	} finally {
		active = false;
	}
}
