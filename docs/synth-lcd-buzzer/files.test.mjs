// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVirtualFileWorkspace } from '../js/tetorica_virtual_files/workspace.js';
import { createPlaygroundCassetteZip, loadPlaygroundCassette } from '../playground/playground_cassette.js';
import { decodeBuzzerCassette, encodeBuzzerCassette } from './files.js';

const pattern = { notes: [60, null, 62, null, 64, null, 67, null], bpm: 116, gate: .5, volume: .6, loop: true };

function fixture(workspace) {
	return {
		format: 'tetorica-lcd-buzzer', version: 1, workspace: workspace.snapshot(),
		selected: '/index.js', activePattern: '/pattern.json', pattern, moves: [],
		codeState: { mode: 'code', path: '/index.js' }, filesVisible: true,
	};
}

test('LCD Buzzer Cassette restores saved and working files, directory edits and sequencer state', async () => {
	const workspace = createVirtualFileWorkspace([
		{ path: '/index.js', data: 'accepted source' },
		{ path: '/pattern.json', data: JSON.stringify(pattern) },
		{ path: '/archive/bin', data: Uint8Array.of(0, 255) },
		{ path: '/old.txt', data: 'old file' },
	], { autoSave: false });
	workspace.working.writeText('/index.js', 'new draft');
	workspace.working.writeFile('/archive/bin', Uint8Array.of(255, 0));
	workspace.working.remove('/old.txt');
	workspace.working.mkdir('/empty');

	const bytes = encodeBuzzerCassette(fixture(workspace));
	const plain = await loadPlaygroundCassette(bytes);
	assert.equal(new TextDecoder().decode(plain.files.get('index.js')), 'accepted source');
	assert.equal(plain.metadata.lcdBuzzer.changed.length, 2);

	const copy = await decodeBuzzerCassette(bytes);
	const restored = createVirtualFileWorkspace();
	restored.restore(copy.workspace);
	assert.equal(restored.working.get('/index.js').data, 'new draft');
	assert.equal(restored.saved.get('/index.js').data, 'accepted source');
	assert.deepEqual(restored.working.get('/archive/bin').data, Uint8Array.of(255, 0));
	assert(restored.saved.has('/old.txt'));
	assert(!restored.working.has('/old.txt'));
	assert(restored.working.listDirectories().includes('/empty'));
	assert(!restored.saved.listDirectories().includes('/empty'));
	assert(!restored.autoSave);
	assert.deepEqual(copy.pattern, pattern);
	assert.deepEqual(copy.codeState, { mode: 'code', path: '/index.js' });
});

test('LCD Buzzer Cassette rejects incompatible projects and unsafe state', async () => {
	const plain = createPlaygroundCassetteZip([{ path: '/index.js', type: 'text', data: 'test' }]);
	await assert.rejects(decodeBuzzerCassette(plain), /Choose an LCD Buzzer Cassette/);
	const workspace = createVirtualFileWorkspace([
		{ path: '/index.js', data: 'test' },
		{ path: '/pattern.json', data: JSON.stringify(pattern) },
	]);
	assert.throws(() => encodeBuzzerCassette({ ...fixture(workspace), activePattern: '/missing.lcd-buzzer.json' }), /active pattern/);
	assert.throws(() => encodeBuzzerCassette({ ...fixture(workspace), pattern: { ...pattern, notes: [60] } }), Error);
});
