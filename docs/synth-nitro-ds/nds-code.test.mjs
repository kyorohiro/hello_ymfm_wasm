// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createNdsCodeRuntime, NDS_STARTER_CODE } from './nds-code.js';
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

test('DS editor declarations describe the default runtime and physical channels', async () => {
	const source = await readFile(new URL('../playground/tetorica-playground-globals.d.ts', import.meta.url), 'utf8');
	const declarations = selectNdsCodeDeclarations(source);
	assert.match(declarations, /declare function useSoundChip\(name: 'nds'\): Promise<NdsCodeClient>/);
	assert.match(declarations, /declare const CH16: 15/);
	assert.match(declarations, /interface NdsCodeAPI \{[\s\S]*CH16:typeof CH16/);
	assert.doesNotMatch(declarations, /declare function liveFx\b|interface YM2612FMApi\b/);
	assert.match(NDS_STARTER_CODE, /await nds\.noteOn\(CH1/);
	assert.match(NDS_STARTER_CODE, /await beat\(/);
});
