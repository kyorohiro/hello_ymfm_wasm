// SPDX-License-Identifier: BSD-3-Clause
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ndsTimerForFrequency } from './nds-synth-api.js';
import {
	NDS_SOUND_REGISTER_BASE, NDS_SOUND_KEY_ON, buildNdsOperations, validateNdsOperations,
	compileNdsOperations, createNdsResetOperationState, resolveNdsOperation,
} from './nds-timed-operations.js';

test('DS build detaches authoring inputs and preserves mixed time and same-time order', () => {
	const patch = { volume: 63 };
	let saved, calls = 0;
	const plan = buildNdsOperations(recorder => {
		saved = recorder;
		calls++;
		recorder.atSample(480).configure(0, patch).atSeconds(.01).configure(0, { pan: 41 });
	}, { referenceSampleRate: 48000 });
	patch.volume = 1;
	assert.equal(calls, 1);
	assert.throws(() => saved.keyOff(0), /no longer active/);
	assert.deepEqual(validateNdsOperations(structuredClone(plan)), plan);
	const reset = createNdsResetOperationState();
	assert.deepEqual(compileNdsOperations(plan, reset), [
		{ offsetSeconds: .01, register: NDS_SOUND_REGISTER_BASE, value: 63, width: 32, operationIndex: 0, writeIndex: 0 },
		{ offsetSeconds: .01, register: NDS_SOUND_REGISTER_BASE, value: (41 << 16) | 63, width: 32, operationIndex: 1, writeIndex: 0 },
	]);
	assert.equal(reset[0].control, 0);
});

test('DS resolver preserves active unrelated bits and resolves musical pitch using prepared source tuning', () => {
	const state = createNdsResetOperationState();
	Object.assign(state[0], {
		mode: 'adpcm', loop: true, loopStartWords: 12, lengthWords: 32, frames: 256,
		timer: 65000, volume: 75, pan: 64, divider: 1, duty: 4, sampleRate: 32000, rootNote: 'A4',
		control: (NDS_SOUND_KEY_ON | 75 | (1 << 8) | (64 << 16) | (4 << 24) | (1 << 27) | (2 << 29)) >>> 0,
		timerRegister: (8 << 16) | 65000, canKeyOn: true, nextSampleAddress: 0x08100000,
	});
	const noteTimer = ndsTimerForFrequency(64000, 1).timer;
	const plan = buildNdsOperations(recorder => recorder.configure(0, { pan: 23 }).setNote(0, 'A5')
		.keyOn(0).keyOn(0).noteOff(0).keyOff(0));
	const first = resolveNdsOperation(plan.operations[0], state[0]);
	assert.deepEqual(first.writes, [{ register: NDS_SOUND_REGISTER_BASE,
		value: ((state[0].control & ~(0x7f << 16)) | 23 << 16) >>> 0, width: 32 }]);
	const writes = compileNdsOperations(plan, state);
	assert.equal(writes[1].value, (8 << 16) | noteTimer);
	assert.deepEqual(writes.filter(row => row.operationIndex === 2).map(({ register, value }) => [register, value]), [
		[NDS_SOUND_REGISTER_BASE, 0],
		[NDS_SOUND_REGISTER_BASE + 4, 0x08100000],
		[NDS_SOUND_REGISTER_BASE + 12, 32],
		[NDS_SOUND_REGISTER_BASE + 8, (12 << 16) | noteTimer],
		[NDS_SOUND_REGISTER_BASE, first.writes[0].value],
	]);
	assert.deepEqual(writes.filter(row => row.operationIndex === 2).map(row => row.value),
		writes.filter(row => row.operationIndex === 3).map(row => row.value));
	assert.equal(writes.some(row => row.operationIndex === 4), false);
	assert.equal(writes.at(-1).value, first.writes[0].value & ~NDS_SOUND_KEY_ON);
	assert.equal(state[0].timer, 65000);
});

test('DS timed programs reject sample transfer, invalid modes, descending offsets and unprepared gates', () => {
	assert.throws(() => buildNdsOperations(recorder => recorder.configure(0, { bytes: new Uint8Array(16) })), /timed settings field/);
	assert.throws(() => buildNdsOperations(recorder => recorder.configure(0, { mode: 'noise' })), /timed settings field/);
	assert.throws(() => buildNdsOperations(recorder => recorder.configure(0, { divider: 4 })), /DS volume divider/);
	assert.throws(() => buildNdsOperations(recorder => recorder.atSeconds(1).atSample(20)), /nondecreasing/);
	assert.throws(() => buildNdsOperations(async recorder => recorder.keyOff(0)), /synchronous/);
	const reset = createNdsResetOperationState();
	assert.throws(() => compileNdsOperations(buildNdsOperations(recorder => recorder.keyOn(0)), reset), /Prepare the sample/);
	assert.deepEqual(compileNdsOperations(buildNdsOperations(recorder => recorder.configure(15, { volume: 23 })), reset), [
		{ offsetSeconds: 0, register: NDS_SOUND_REGISTER_BASE + 240, value: 23, width: 32, operationIndex: 0, writeIndex: 0 },
	]);
});
