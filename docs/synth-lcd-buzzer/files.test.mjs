// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVirtualFileWorkspace } from '../js/tetorica_virtual_files/workspace.js';
import { createPlaygroundCassetteZip, loadPlaygroundCassette } from '../playground/playground_cassette.js';
import { decodeBuzzerCassette, encodeBuzzerCassette } from './files.js';
import { SM511_DEMO, SM511_ROM_STEPS } from './sm511.js';

const pattern = { notes: [60, null, 62, null, 64, null, 67, null], bpm: 116, gate: .5, volume: .6, loop: true };

function fixture(workspace) {
	return {
		format: 'tetorica-lcd-buzzer', version: 1, workspace: workspace.snapshot(),
		selected: '/index.js', activePattern: '/pattern.json', pattern, moves: [],
		codeState: { mode: 'code', path: '/index.js' }, filesVisible: true,
	};
}

test('LCD Buzzer Cassette restores saved and working files, directory edits, pattern and Melody ROM', async () => {
	const melody = new Uint8Array(SM511_ROM_STEPS);
	melody.set([0x1d, 0x20, 0x23, 0x01]);
	melody[SM511_ROM_STEPS - 1] = 0x2d;
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

	const bytes = encodeBuzzerCassette({ ...fixture(workspace), melody });
	const plain = await loadPlaygroundCassette(bytes);
	assert.equal(new TextDecoder().decode(plain.files.get('index.js')), 'accepted source');
	assert.equal(new TextDecoder().decode(plain.files.get('pattern.json')), JSON.stringify(pattern));
	assert.equal(plain.metadata.lcdBuzzer.changed.length, 2);
	assert.deepEqual(plain.metadata.lcdBuzzer.melody, Array.from(melody));

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
	assert.deepEqual(copy.melody, Array.from(melody));
	assert.deepEqual(copy.codeState, { mode: 'code', path: '/index.js' });
});

test('version 1 Cassettes accept a short Melody ROM and default to the demo when absent', async () => {
	const workspace = createVirtualFileWorkspace([
		{ path: '/index.js', data: 'test' },
		{ path: '/pattern.json', data: JSON.stringify(pattern) },
	]);
	const { workspace: { saved, working, autoSave }, ...state } = fixture(workspace);
	const archive = (overrides = {}) => createPlaygroundCassetteZip(saved.files, {
		directories: saved.directories,
		metadata: {
			lcdBuzzer: {
				...state, autoSave, changed: [], deleted: [],
				workingDirectories: working.directories, textPaths: saved.files.map(file => file.path),
				...overrides,
			},
		},
	});
	const legacy = await decodeBuzzerCassette(archive());
	assert.deepEqual(legacy.melody, SM511_DEMO);
	assert.deepEqual(legacy.pattern, pattern);
	const melody = [0x2d, 0x01];
	assert.deepEqual((await decodeBuzzerCassette(archive({ melody }))).melody, melody);
	await assert.rejects(decodeBuzzerCassette(archive({ melody: [0x0e] })), /6-bit SM511/);
	await assert.rejects(decodeBuzzerCassette(archive({ melody: Array(SM511_ROM_STEPS + 1).fill(0) })), /256 SM511/);
});

test('LCD Buzzer Cassette rejects incompatible projects and unsafe state', async () => {
	const plain = createPlaygroundCassetteZip([{ path: '/index.js', type: 'text', data: 'test' }]);
	await assert.rejects(decodeBuzzerCassette(plain), /Choose a Tetorica SM510 Synth Cassette/);
	const workspace = createVirtualFileWorkspace([
		{ path: '/index.js', data: 'test' },
		{ path: '/pattern.json', data: JSON.stringify(pattern) },
	]);
	assert.throws(() => encodeBuzzerCassette({ ...fixture(workspace), activePattern: '/missing.lcd-buzzer.json' }), /active pattern/);
	assert.throws(() => encodeBuzzerCassette({ ...fixture(workspace), pattern: { ...pattern, notes: [60] } }), Error);
});
