// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createVirtualFileWorkspace } from '../js/tetorica_virtual_files/workspace.js';
import { createNdsCodeRuntime, NDS_STARTER_CODE, NDS_STARTER_FILES } from './nds-code.js';
import { selectNdsCodeDeclarations } from './nds-code-declarations.js';

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

test('DS editor declarations describe the default runtime and physical channels', async () => {
	const source = await readFile(new URL('../playground/tetorica-playground-globals.d.ts', import.meta.url), 'utf8');
	const declarations = selectNdsCodeDeclarations(source);
	assert.match(declarations, /declare function useSoundChip\(name: 'nds'\): Promise<NdsCodeClient>/);
	assert.match(declarations, /declare const CH16: 15/);
	assert.match(declarations, /interface NdsCodeAPI \{[\s\S]*CH16:typeof CH16/);
	assert.doesNotMatch(declarations, /declare function liveFx\b|interface YM2612FMApi\b/);
	assert.match(NDS_STARTER_CODE, /await nds\.noteOn\(CH1/);
	assert.match(NDS_STARTER_CODE, /await beat\(/);
	for (const { path, data } of NDS_STARTER_FILES) {
		assert.match(path, /^\/examples\/[\w-]+\.js$/);
		assert.match(data, /await useSoundChip\("nds"\)/);
		assert.match(data, /await beat\(/);
	}
});
