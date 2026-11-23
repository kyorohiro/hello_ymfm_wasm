// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUZZER_EXAMPLES } from './code_examples.js';
import { createSm510CodeChip, readSm510CycleSequence } from './sm510.js';
import { createSm511CodeChip, readSm511MelodySequence, sm511MelodyDuration } from './sm511.js';
import { createTimedSchedule } from './timed-schedule.js';

function fixture() {
	const events = [];
	let time = 0;
	const broker = createTimedSchedule({ nextStartTime: () => time });
	const sm510 = broker.createClient({ channel: 'sm510', prepare: sequence => sequence });
	const sm511 = broker.createClient({ channel: 'sm511', prepare: sequence => sequence });
	function sequence(id, duration = 1, startDelay = 0) {
		return {
			duration,
			play(start, repeatSeconds) {
				const startTime = start + startDelay;
				events.push({ id, startTime, repeatSeconds });
				return { startTime, stop() { events.push({ id, stopped: time }); return time + .01; } };
			},
		};
	}
	return { broker, sm510, sm511, events, sequence, setTime: value => { time = value; } };
}

test('the bundled duet stages one two-second loop per chip on a shared clock', async () => {
	const { data } = BUZZER_EXAMPLES.find(({ path }) => path === '/examples/sm5xx-duet.js');
	const schedules = fixture(), rhythm = createSm510CodeChip({ id: 'sm510-dk52' }), melody = createSm511CodeChip({});
	rhythm.schedule = (plan, options) => {
		const { end } = readSm510CycleSequence(plan);
		assert.deepEqual(rhythm.compile(plan).filter(write => write.value === 1).map(write => write.machineCycle),
			[0, 6, 8, 12, 16, 22, 24, 28, 30].map(slot => slot * 1024 + 2));
		return schedules.sm510.stage('run', 'entry', 'schedule', [schedules.sequence('rhythm', end / rhythm.clock), options]);
	};
	melody.schedule = (plan, options) => {
		const duration = sm511MelodyDuration(readSm511MelodySequence(plan));
		return schedules.sm511.stage('run', 'entry', 'schedule', [schedules.sequence('melody', duration), options]);
	};
	const chips = { 'sm510-dk52': rhythm, sm511: melody };
	const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
	await new AsyncFunction('useSoundChip', data)(async id => chips[id]);
	assert.deepEqual(schedules.events, []);
	schedules.setTime(1);
	const { reservations } = schedules.sm510.commit('run', 'entry');
	assert.deepEqual(reservations, [
		{ name: 'dk52-rhythm', duration: 2, repeatSeconds: 2, startTime: 1 },
		{ name: 'sm511-melody', duration: 2, repeatSeconds: 2, startTime: 1 },
	]);
});

test('Apply commits prepared channel reservations together and removes omitted names', async () => {
	const { sm510, sm511, events, sequence, setTime } = fixture();
	await sm510.schedule(sequence('old'), { name: 'pulse' }, { owner: 'entry' });
	await sm510.stage('aborted', 'entry', 'schedule', [sequence('unused'), { name: 'pulse' }]);
	await sm510.stage('aborted', 'entry', 'clearSchedule', ['pulse']);
	sm511.abort('aborted', 'entry');
	assert.equal(sm510.commit('aborted', 'entry'), false);
	assert.deepEqual(events, [{ id: 'old', startTime: 0, repeatSeconds: undefined }]);

	assert.deepEqual(await sm510.stage('apply', 'entry', 'schedule', [sequence('new'), { name: 'pulse', repeatSeconds: 2 }]),
		{ name: 'pulse', duration: 1, repeatSeconds: 2, staged: true });
	await sm511.stage('apply', 'entry', 'schedule', [sequence('melody'), { name: 'phrase' }]);
	await sm511.stage('late-abort', 'entry', 'schedule', [sequence('to-abort'), { name: 'other' }]);
	setTime(3);
	const committed = sm511.commit('apply', 'entry');
	sm511.abort('late-abort', 'entry');
	assert.equal(sm510.commit('apply', 'entry'), committed);
	assert.deepEqual(committed.reservations, [
		{ name: 'pulse', duration: 1, repeatSeconds: 2, startTime: 3.01 },
		{ name: 'phrase', duration: 1, startTime: 3.01 },
	]);
	assert.deepEqual(events.slice(1), [
		{ id: 'old', stopped: 3 },
		{ id: 'new', startTime: 3.01, repeatSeconds: 2 },
		{ id: 'melody', startTime: 3.01, repeatSeconds: undefined },
	]);
	sm510.commit('no-schedules', 'entry');
	assert.deepEqual(events.slice(4), [{ id: 'new', stopped: 3 }, { id: 'melody', stopped: 3 }]);
});

test('superseded and canceled preparations cannot start or clear a newer owner', async () => {
	const { broker, sm510, sm511, events, sequence } = fixture();
	let completeSlow;
	const slow = new Promise(resolve => { completeSlow = resolve; });
	const old = sm510.schedule(slow, { name: 'shared' }, { owner: 'older' });
	const latest = await sm510.schedule(sequence('latest', 1, .05), { name: 'shared' }, { owner: 'newer' });
	assert.equal(latest.startTime, .05);
	completeSlow(sequence('stale'));
	assert.equal(await old, false);
	assert.equal(await sm510.clearSchedule('shared', { owner: 'older' }), false);
	sm510.cancelOwner('older');
	await sm511.schedule(sequence('other-chip'), { name: 'shared' }, { owner: 'other' });

	let completePending, completeStaged;
	const pending = sm510.schedule(new Promise(resolve => { completePending = resolve; }), { name: 'pending' }, { owner: 'loop' });
	const staged = sm510.stage('staged', 'entry', 'schedule', [new Promise(resolve => { completeStaged = resolve; }), { name: 'staged' }]);
	assert.equal(broker.stop('sm510'), .01);
	completePending(sequence('canceled'));
	completeStaged(sequence('canceled-stage'));
	assert.equal(await pending, false);
	assert.equal(await staged, false);
	assert.deepEqual(sm510.commit('staged', 'entry'), { reservations: [] });
	assert.deepEqual(events.map(event => event.id), ['latest', 'other-chip', 'latest']);
	assert.equal(await sm511.clearSchedule('shared', { owner: 'other' }), true);
});

test('schedule accepts silence and exact periods and rejects invalid timing before replacement', async () => {
	const { sm511, sequence, events } = fixture();
	assert.deepEqual(await sm511.schedule(sequence('rom', 32), { name: 'rom', repeatSeconds: 32 }),
		{ name: 'rom', duration: 32, repeatSeconds: 32, startTime: 0 });
	await assert.rejects(sm511.schedule(sequence('too-short', 32), { name: 'rom', repeatSeconds: 31 }), /entire sequence/);
	await assert.rejects(sm511.schedule(sequence('too-long'), { name: 'rom', repeatSeconds: 61 }), /at most 60/);
	assert.deepEqual(events.map(event => event.id), ['rom']);
	assert.deepEqual(await sm511.schedule({ duration: 0, play: () => () => {} }, { name: 'stop' }),
		{ name: 'stop', duration: 0, startTime: .01 });
});
