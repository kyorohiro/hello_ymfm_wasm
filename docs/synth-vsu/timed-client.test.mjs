// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import { attachVsuTimedClient } from './timed-client.js';
import { buildVsuOperations, validateVsuOperations } from './timed-operations.js';
import { createVsuClient } from './vsu.js';

test('the VSU recorder matches immediate writes and preserves equal-time and helper order', async () => {
	const immediate = [];
	const api = attachVsuTimedClient(createVsuClient({
		write(offset, value) { immediate.push([offset, value]); },
		writeBatch(writes) { immediate.push(...writes); },
	}), () => assert.fail('Building or compiling must not call the Worklet.'));
	const wave = Uint8Array.from({ length: 32 }, (_, index) => index * 2);
	const groups = [
		['allNotesOff'],
		['setWave', 4, wave],
		['setWaveSample', 4, 31, 63],
		['setVolume', 4, 15, 5],
		['setWaveBank', 4, 4],
		['write', 0x514, 0x70],
		['noteOn', 4, 'A4'],
		['noteOff', 4],
	];
	for (const [method, ...args] of groups) api[method](...args);
	const plan = api.build(builder => {
		for (const [method, ...args] of groups.slice(0, 6)) builder.atSample(0)[method](...args);
		builder.atSample(2400).noteOn(4, 'A4').atSeconds(0.075).noteOff(4);
	}, { referenceSampleRate: 48000 });
	wave.fill(0);

	const rows = await api.compile(JSON.parse(JSON.stringify(plan)));
	assert.deepEqual(rows.map(({ register, value }) => [register, value]), immediate);
	assert.deepEqual(rows.slice(-4).map(({ offsetSeconds, operationIndex, writeIndex }) =>
		[offsetSeconds, operationIndex, writeIndex]), [
		[0.05, 6, 0], [0.05, 6, 1], [0.05, 6, 2], [0.075, 7, 0],
	]);
	rows[0].value = 0;
	assert.equal(plan.writes[0].value, 1);
});

test('the VSU plan rejects invalid timing, incomplete writes, and asynchronous callbacks', () => {
	const valid = buildVsuOperations(builder => builder.atSample(1).write(0x400, 0x80).atSample(2).noteOff(0));
	assert.equal(valid.writes[0].offsetSeconds, 1 / 44100);
	assert.throws(() => buildVsuOperations(builder => builder.atSeconds(1).atSample(100)), /nondecreasing/);
	assert.throws(() => buildVsuOperations(builder => builder.atSample(0.5)), /safe integers/);
	assert.throws(() => buildVsuOperations(builder => builder.write(0x401, 1)), /aligned/);
	assert.throws(() => buildVsuOperations(async builder => builder.write(0x400, 1)), /synchronous/);

	const unordered = structuredClone(valid);
	unordered.writes.reverse();
	assert.throws(() => validateVsuOperations(unordered), /order/);
	const invalid = structuredClone(valid);
	invalid.writes[1].value = 256;
	assert.throws(() => validateVsuOperations(invalid), /byte/);

	let escaped;
	buildVsuOperations(builder => { escaped = builder; });
	assert.throws(() => escaped.noteOff(0), /no longer active/);
});

test('compile preserves envelope masks whose final values depend on playback-time registers', async () => {
	const api = attachVsuTimedClient({}, () => assert.fail('Compilation must not use the Worklet.'));
	const plan = api.build(builder => builder
		.write(0x554, 0x50)
		.setEnvelope(5, { level: 9, rate: 4, direction: 'down', enabled: true, repeat: false })
		.atSeconds(0.25).resetEnvelope(5));
	const rows = await api.compile(JSON.parse(JSON.stringify(plan)));
	assert.deepEqual(rows, [
		{ offsetSeconds: 0, register: 0x554, value: 0x50, operationIndex: 0, writeIndex: 0 },
		{ offsetSeconds: 0, register: 0x550, value: 0x94, operationIndex: 1, writeIndex: 0 },
		{ offsetSeconds: 0, register: 0x554, value: 1, mask: 3, operationIndex: 1, writeIndex: 1 },
		{ offsetSeconds: 0.25, register: 0x550, value: 0, mask: 0, operationIndex: 2, writeIndex: 0 },
	]);
	for (const change of [{ register: 0x54c }, { mask: 1 }, { value: 4 }]) {
		const invalid = structuredClone(plan);
		Object.assign(invalid.writes[2], change);
		assert.throws(() => validateVsuOperations(invalid), /masked envelope/);
	}
	const invalidReset = structuredClone(plan);
	invalidReset.writes[3].value = 1;
	assert.throws(() => validateVsuOperations(invalidReset), /masked envelope/);
});

test('the VSU client sends detached schedules and supports Code stage, commit and cleanup', async () => {
	const requests = [];
	const api = attachVsuTimedClient({}, async request => { requests.push(request); return true; });
	const plan = api.build(builder => builder.write(0x400, 0x80).atSeconds(0.125).noteOff(0));
	const options = { name: 'phrase', repeatSeconds: 0.5 };
	const owner = 'entry';
	assert(!Object.keys(api).includes('_timedOperations'));
	await assert.rejects(api.schedule(plan, { ...options, repeatSeconds: 0.125 }), /exceed/);
	await assert.rejects(api.schedule(api.build(() => {}), options), /at least one write/);
	await assert.rejects(api.compile(plan, { initialState: 'reset' }), /compile options/);
	assert.equal(requests.length, 0);

	const staged = api._timedOperations.stage('apply:1', owner, 'schedule', [plan, options]);
	plan.writes[0].value = 1;
	options.name = 'edited';
	await staged;
	assert.equal(requests[0].args[0].writes[0].value, 0x80);
	assert.deepEqual(requests[0].args[1], { name: 'phrase', repeatSeconds: 0.5 });
	await api._timedOperations.commit('apply:1', owner);
	await api._timedOperations.abort('apply:2', owner);
	await api._timedOperations.releaseOwner(owner);
	await api._timedOperations.schedule(plan, options, { owner: 'loop' });
	await api._timedOperations.clearSchedule('edited', { owner: 'loop' });
	await api._timedOperations.cancelOwner('loop');
	await api.clearSchedule('phrase');
	assert.deepEqual(requests.map(request => [request.action, request.owner]), [
		['stage', 'entry'], ['commit', 'entry'], ['abort', 'entry'], ['releaseOwner', 'entry'],
		['schedule', 'loop'], ['clear', 'loop'], ['cancelOwner', 'loop'], ['clear', undefined],
	]);
});
