// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createVirtualFileWorkspace } from '../js/tetorica_virtual_files/workspace.js';
import { createNdsCodeRuntime, NDS_STARTER_CODE, NDS_STARTER_FILES } from './nds-code.js';
import { selectNdsCodeDeclarations } from './nds-code-declarations.js';
import { writeNdsPreset } from './nds-preset.js';
import { createNdsResetOperationState } from './nds-timed-operations.js';

test('DS Code handles all physical channels and stops only Code notes', async () => {
	const active = new Map([[0, 'keyboard']]), owners = [];
	const client = {
		async noteOn(channel) { active.set(channel, 'code'); },
		async configure() {},
		async noteOff(channel) { if (active.get(channel) === 'code') active.delete(channel); },
		async stopOwned() {
			for (const [channel, owner] of active) if (owner === 'code') active.delete(channel);
		},
	};
	const audio = {
		context: { get currentTime() { return performance.now() / 1000; } },
		chip: { forOwner(owner) { owners.push(owner); return client; } },
	};
	const runtime = createNdsCodeRuntime({ ensureAudio: async () => audio });
	await runtime.run(`
		const nds = await useSoundChip('nds');
		await nds.noteOn(CH9, 'C4', { mode: 'pulse' });
		await nds.noteOn(pg.CH16, 'C4', { mode: 'noise' });
		context.nds = nds;
	`);
	assert.equal(active.get(8), 'code');
	assert.equal(active.get(15), 'code');
	await runtime.apply('await context.nds.configure(CH9, { duty: 2 });');
	assert.equal(active.get(8), 'code');
	// Keyboard replaces a Code-owned voice after Apply.
	active.set(8, 'keyboard');
	await runtime.stop();
	assert.deepEqual([...active], [[0, 'keyboard'], [8, 'keyboard']]);
	assert(owners.every((owner) => owner === 'code'));
});

test('Run and Apply read the saved entry, imported module, and project file', async () => {
	const acceptedSource = (label) => `
		const { value } = await import('./part.js');
		log('${label}', value, await file('./sample.txt'));
	`;
	const workspace = createVirtualFileWorkspace([
		{ path: '/examples/test.js', data: acceptedSource('baseline') },
		{ path: '/examples/part.js', data: 'export const value = 1;' },
		{ path: '/examples/sample.txt', data: 'C4' },
	]);
	const project = { savedFs: workspace.saved };
	const audio = { context: { currentTime: 0 }, chip: { forOwner: () => ({ stopOwned() {} }) } };
	const log = [];
	const runtime = createNdsCodeRuntime({
		project, ensureAudio: async () => audio, onLog: (line) => log.push(line),
	});
	workspace.setAutoSave(false);
	workspace.working.writeText('/examples/test.js', acceptedSource('changed'));
	workspace.working.writeText('/examples/part.js', 'export const value = 2;');
	workspace.working.writeText('/examples/sample.txt', 'E4');
	const runOptions = { path: '/examples/test.js' };
	const workingSource = workspace.working.get(runOptions.path).data;
	await runtime.run(workingSource, runOptions);
	await runtime.apply(workingSource, runOptions);
	assert.deepEqual(log, ['baseline 1 C4', 'baseline 1 C4']);

	workspace.saveAll();
	await runtime.apply(workingSource, runOptions);
	assert.equal(log.at(-1), 'changed 2 E4');
	workspace.working.writeText('/examples/unsaved.js', 'log("unsaved")');
	await assert.rejects(
		() => runtime.apply('log("unsaved")', { path: '/examples/unsaved.js' }),
		/Save \/examples\/unsaved\.js before running Code/,
	);
	await runtime.stop();
});

test('Code loads a saved sound into one channel without triggering it, with the exact sample and tuning', async (t) => {
	const sample = { sampleRate: 24000, rootNote: 72, loopStartWords: 3, lengthWords: 9,
		bytes: Uint8Array.from({ length: 64 }, (_, index) => index) };
	const sound = { mode: 'pcm16', shape: 'sine', volume: 94, pan: 27, divider: 1, duty: 3, loop: true, sample };
	const pulse = { ...sound, mode: 'pulse', duty: 5, sample: null };
	const script = `
		const nds = await useSoundChip('nds');
		const sample = await file('../presets/Sample.nds.json');
		const state = await nds.loadPreset(CH2, sample);
		if (state.active) throw new Error('Unexpected gate');
		await nds.noteOn(CH2, 'C4');
		await nds.loadPreset(CH9, await file('../presets/Pulse.nds.json', { type: 'json' }));
	`;
	const workspace = createVirtualFileWorkspace([
		{ path: '/presets/Sample.nds.json', data: writeNdsPreset('Sample', sound) },
		{ path: '/presets/Pulse.nds.json', data: writeNdsPreset('Pulse', pulse) },
		{ path: '/examples/play.js', data: script },
	]);
	workspace.setAutoSave(false);
	workspace.working.writeText('/presets/Sample.nds.json', writeNdsPreset('Draft', { ...sound, volume: 24 }));
	const calls = [];
	const chip = {
		async configure(channel, settings) { calls.push(['configure', channel, settings]); return { active: false }; },
		async noteOn(...args) { calls.push(['noteOn', ...args]); },
		async stopOwned() {},
	};
	const runtime = createNdsCodeRuntime({ project: { savedFs: workspace.saved },
		ensureAudio: async () => ({ context: { currentTime: 0 }, chip: { forOwner: () => chip } }) });
	t.after(() => runtime.stop());
	await runtime.run(script, { path: '/examples/play.js' });
	assert.deepEqual(calls, [
		['configure', 1, { mode: 'pcm16', volume: 94, pan: 27, divider: 1, duty: 3, loop: true, ...sample }],
		['noteOn', 1, 'C4'],
		['configure', 8, { mode: 'pulse', volume: 94, pan: 27, divider: 1, duty: 5, loop: true }],
	]);
});

test('Invalid DS presets fail before configuring a channel', async (t) => {
	let configured = 0;
	const chip = { async configure() { configured++; }, async stopOwned() {} };
	const runtime = createNdsCodeRuntime({ ensureAudio: async () => ({ context: { currentTime: 0 },
		chip: { forOwner: () => chip } }) });
	t.after(() => runtime.stop());
	await assert.rejects(runtime.run(`
		const nds = await useSoundChip('nds');
		await nds.loadPreset(CH1, '{"format":"other","version":1}');
	`), /Unsupported DS sound preset/);
	assert.equal(configured, 0);
});

test('DS timed Code compiles detached state and only commits a successful evaluation', async (t) => {
	const actions = [];
	const chip = {
		prepareVoice(channel) { actions.push({ action: 'prepareVoice', channel }); },
		async timedControl(payload) {
			actions.push(payload);
			if (payload.action === 'capture') return { chip: 'nds', version: 1, instanceId: 'test-audio',
				frame: 128, sampleRate: 48000, state: createNdsResetOperationState() };
			return true;
		},
		stopOwned() { actions.push({ action: 'releaseImmediate' }); },
	};
	const audio = { context: { currentTime: 0, sampleRate: 48000 }, chip: { forOwner: () => chip } };
	const runtime = createNdsCodeRuntime({ ensureAudio: async () => audio });
	t.after(() => runtime.stop());
	await runtime.run(`
		const nds = await useSoundChip('nds');
		const plan = nds.build(b => b.atSample(100).configure(CH1, { volume: 42 }));
		const snapshot = await nds.captureState();
		const writes = await nds.compile(plan, { initialState: snapshot });
		if (!Object.isFrozen(snapshot.state[0]) || writes[0]?.value !== 42) throw Error('Wrong DS writes');
		await nds.compile(plan, { initialState: 'reset' });
		await nds.prepareVoice(CH2);
		await nds.schedule(plan, { name: 'phrase', repeatSeconds: 0.5 });
		Object.assign(context, { nds, plan, snapshot });
	`);
	assert.deepEqual(actions.map(({ action }) => action), ['capture', 'prepareVoice', 'stage', 'commit']);
	assert.equal(actions[1].channel, 1);
	assert.equal(actions[2].args[1].name, 'phrase');
	assert.equal(actions[2].owner, actions[3].owner);
	assert.equal(actions[2].transactionId, actions[3].transactionId);
	await assert.rejects(runtime.apply(`
		await context.nds.schedule(context.plan, { name: 'phrase', repeatSeconds: 1 });
		throw Error('Abort replacement');
	`), /Abort replacement/);
	assert.deepEqual(actions.slice(-2).map(({ action }) => action), ['stage', 'abort']);
	assert.equal(actions.at(-1).owner, actions[2].owner);
	assert.notEqual(actions.at(-1).transactionId, actions[2].transactionId);
	await assert.rejects(runtime.apply(`
		await context.nds.compile(context.plan, { initialState: { ...context.snapshot, instanceId: 'other-audio' } });
	`), /Incompatible DS timed snapshot/);
	await assert.rejects(runtime.apply(`
		await context.nds.compile(context.plan, { initialState: 'client' });
	`), /Incomplete DS client state/);
	assert.equal(actions.filter(({ action }) => action === 'capture').length, 1);
	await runtime.apply(`await context.nds.clearSchedule('phrase');`);
	assert.deepEqual(actions.slice(-2).map(({ action }) => action), ['stage', 'commit']);
	assert.equal(actions.at(-2).method, 'clearSchedule');
	await runtime.stop();
	assert.deepEqual(actions.slice(-3).map(({ action }) => action), ['cancelOwner', 'end', 'releaseImmediate']);
});

test('DS editor declarations describe the default runtime and physical channels', async () => {
	const source = await readFile(new URL('../playground/tetorica-playground-globals.d.ts', import.meta.url), 'utf8');
	const declarations = selectNdsCodeDeclarations(source);
	assert.match(declarations, /declare function useSoundChip\(name: 'nds'\): Promise<NdsCodeClient>/);
	assert.match(declarations, /declare const CH16: 15/);
	assert.match(declarations, /interface NdsCodeAPI \{[\s\S]*CH16:typeof CH16/);
	assert.match(declarations, /loadPreset\(channel: NdsCodeChannel, preset: string \| NdsCodePreset\): Promise<NdsCodeChannelState>/);
	assert.match(declarations, /atSample\(sample: number\): NdsOperationRecorder/);
	assert.match(declarations, /prepareVoice\(channel: NdsCodeChannel\): Promise<NdsCodeChannelState>/);
	assert.match(declarations, /compile\(operations: NdsOperationProgram,[^\n]*NdsTimedSnapshot/);
	assert.doesNotMatch(declarations, /declare function liveFx\b|interface YM2612FMApi\b/);
	assert.match(NDS_STARTER_CODE, /await nds\.noteOn\(CH1/);
	assert.match(NDS_STARTER_CODE, /await beat\(/);
	for (const { path, data } of NDS_STARTER_FILES) {
		assert.match(path, /^\/examples\/[\w-]+\.js$/);
		assert.match(data, /await useSoundChip\("nds"\)/);
		if (path === '/examples/timed-phrase.js') {
			assert.match(data, /nds\.build\(/);
			assert.match(data, /await nds\.compile\(/);
			assert.match(data, /await nds\.schedule\(/);
		} else assert.match(data, /await beat\(/);
	}
});
