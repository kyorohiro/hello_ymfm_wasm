import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createAswanCodeClient,
	validateAswanCommand,
	ASWAN_CODE_METHODS,
} from './code_endpoint.js';
test('borrowed WonderSwan client exposes only the shared four-channel API and fences pending replies / disposal', async () => {
	let current = true,
		finish,
		disposed = 0;
	const calls = [];
	const client = createAswanCodeClient({
		metadata: { session: 1, clock: 3072000, channels: 4 },
		isCurrent: () => current,
		invoke: (method, args) => {
			calls.push({ method, args });
			return new Promise((resolve) => (finish = resolve));
		},
		dispose: () => {
			disposed++;
		},
	});
	for (const method of ASWAN_CODE_METHODS) assert.equal(typeof client[method], 'function');
	assert.equal(client.chip, 'wonderswan');
	assert.equal(client.channels, 4);
	assert.equal(client.reset, undefined);
	assert.equal(client.createTimeline, undefined);
	assert.throws(() => client.noteOn(4, 60));
	assert.throws(() => client.getState(1));
	assert.equal(calls.length, 0);
	const pending = client.noteOn(0, 'C4');
	current = false;
	finish(true);
	await assert.rejects(pending, { name: 'AbortError' });
	assert.throws(() => client.noteOff(0), { name: 'AbortError' });
	assert.equal(disposed, 0);
	current = true;
	await client.dispose();
	await client.dispose();
	assert.equal(disposed, 1);
	assert(!client.isCurrent());
});
test('host edits and raw operations validate argument shapes before ownership changes', () => {
	assert.doesNotThrow(() => validateAswanCommand('editPreset', [{}, {}, 0]));
	for (const [method, args] of [
		['stop', [1]],
		['read', [0]],
		['noteOn', ['id']],
		['code', [1, 'noteOn']],
		['constructor', []],
		['setPreset', {}],
	])
		assert.throws(() => validateAswanCommand(method, args));
});
