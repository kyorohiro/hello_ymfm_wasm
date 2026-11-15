// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultPreset } from './preset.js';
import { aswanSongVoiceChanges, AswanSongEditJournal } from './song_voice_edits.js';
import { aswanSongLiveView } from './song_live.js';
const snapshot = () => ({
	frame: 100,
	clock: 3072000,
	registers: Array(32).fill(0),
	registerKnown: Array(32).fill(1),
	waveforms: Array.from({ length: 4 }, () => Array(32).fill(7)),
	waveKnown: [true, true, true, true],
	channels: Array.from({ length: 4 }, () => ({})),
});
test('hardware edits are sparse, validated and independent of software Envelope / names', () => {
	const before = createDefaultPreset(),
		next = structuredClone(before);
	next.envelope.attack = 0.3;
	next.envelope.enabled = false;
	next.name = 'Preview';
	assert.deepEqual(aswanSongVoiceChanges(0, before, next), {});
	next.left = 3;
	assert.deepEqual(aswanSongVoiceChanges(0, before, next), { left: 3 });
	const invalid = structuredClone(next);
	invalid.wave[0] = 16;
	assert.throws(() => aswanSongVoiceChanges(0, before, invalid), /Wave sample/);
	const pcm = structuredClone(before);
	pcm.source = 'pcm';
	assert.throws(() => aswanSongVoiceChanges(1, before, pcm), /Transient Voice PCM/);
	const noise = structuredClone(before);
	noise.source = 'noise';
	assert.throws(() => aswanSongVoiceChanges(0, before, noise), /CH4/);
	const sweep = structuredClone(before);
	sweep.sweep.enabled = true;
	assert.throws(() => aswanSongVoiceChanges(0, before, sweep), /CH3/);
});
test('journal merges disjoint fields/channels and clears only after their native edit boundaries', () => {
	const journal = new AswanSongEditJournal(),
		source = snapshot();
	source.registers[8] = 0xab;
	const original = structuredClone(source);
	journal.record(0, { left: 4 }, 512);
	journal.record(0, { right: 2 }, 768);
	journal.record(2, { sweepEnabled: true, sweepStep: -4, sweepTime: 7 }, 768);
	assert.equal(journal.revision, 3);
	let view = journal.project(source);
	assert.equal(view.frame, 100);
	assert.equal(view.registers[8], 0x42);
	assert.equal(view.registers[12], 252);
	assert(view.registers[16] & 64);
	assert.deepEqual(source, original);
	journal.prune(512);
	assert.equal(journal.project(source).registers[8], 0x42);
	journal.prune(513);
	assert.equal(journal.project(source).registers[8], 0xa2);
	journal.prune(769);
	assert.equal(journal.channels.size, 0);
	assert.equal(journal.revision, 3);
});
test('complete voice availability distinguishes unknown settings, nonstandard clock and transient PCM', () => {
	const s = snapshot();
	s.registers[16] = 1;
	s.registers[17] = 8;
	s.registers[8] = 0x99;
	assert(aswanSongLiveView(s, 0).canAudition);
	s.registerKnown[0] = 0;
	assert.match(aswanSongLiveView(s, 0).reason, /incomplete recorded/);
	s.registerKnown[0] = 1;
	s.waveKnown[0] = false;
	assert.match(aswanSongLiveView(s, 0).reason, /incomplete written Wave/);
	s.waveKnown[0] = true;
	s.clock = 3579545;
	assert(aswanSongLiveView(s, 0).canCapture);
	assert(!aswanSongLiveView(s, 0).canAudition);
	assert.match(aswanSongLiveView(s, 0).reason, /3072000/);
	s.clock = 3072000;
	s.registers[16] = 0x22;
	assert(!aswanSongLiveView(s, 1).playable);
	assert.match(aswanSongLiveView(s, 1).reason, /Transient Voice PCM/);
	s.registers[16] = 0x88;
	s.registers[14] = 0x10;
	s.waveKnown[3] = false;
	assert(aswanSongLiveView(s, 3).canAudition);
	s.registerKnown[14] = 0;
	assert(!aswanSongLiveView(s, 3).canAudition);
	s.registerKnown[14] = 1;
	s.registers[14] = 0;
	assert.match(aswanSongLiveView(s, 3).reason, /generator is disabled/);
});
