// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVirtualFileWorkspace } from '../js/tetorica_virtual_files/workspace.js';
import { createPlaygroundCassetteZip, loadPlaygroundCassette } from '../playground/playground_cassette.js';
import { decodeBuzzerCassette, encodeBuzzerCassette, installBuzzerExamples } from './files.js';

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
	await assert.rejects(decodeBuzzerCassette(plain), /Choose a Tetorica SM510 Synth Cassette/);
	const workspace = createVirtualFileWorkspace([
		{ path: '/index.js', data: 'test' },
		{ path: '/pattern.json', data: JSON.stringify(pattern) },
	]);
	assert.throws(() => encodeBuzzerCassette({ ...fixture(workspace), activePattern: '/missing.lcd-buzzer.json' }), /active pattern/);
	assert.throws(() => encodeBuzzerCassette({ ...fixture(workspace), pattern: { ...pattern, notes: [60] } }), Error);
});

test('adding LCD Buzzer examples saves only new paths and respects a pending deletion', () => {
	const workspace = createVirtualFileWorkspace([
		{ path: '/index.js', data: 'saved user code' },
		{ path: '/examples/chirp.js', data: 'saved custom chirp' },
		{ path: '/examples/short-beep.js', data: 'pending deletion' },
	], { autoSave: false });
	workspace.working.writeText('/index.js', 'working user code');
	workspace.working.writeText('/examples/chirp.js', 'working custom chirp');
	workspace.working.remove('/examples/short-beep.js');
	const dirty = workspace.getDirtyPaths();

	assert.equal(installBuzzerExamples(workspace), 4);
	assert.match(workspace.saved.get('/examples/trill.js').data, /noteOn/);
	assert.deepEqual(workspace.working.get('/examples/trill.js').data, workspace.saved.get('/examples/trill.js').data);
	const registerExample = workspace.saved.get('/examples/sm510-r1.js').data;
	assert.match(registerExample, /useSoundChip\("sm510"\)/);
	assert.match(registerExample, /write\(sm510\.REG_R, 0x1\)[\s\S]+write\(sm510\.REG_R, 0x0\)/);
	assert.equal(workspace.working.get('/examples/sm510-r1.js').data, registerExample);
	assert.match(workspace.saved.get('/examples/sm510-cycles.js').data, /atCycle\(1640\).*write\(sm510\.REG_R, 0x0\)/);
	assert.match(workspace.saved.get('/examples/sm511-melody.js').data, /useSoundChip\("sm511"\)/);
	assert.equal(workspace.saved.get('/index.js').data, 'saved user code');
	assert.equal(workspace.working.get('/index.js').data, 'working user code');
	assert.equal(workspace.saved.get('/examples/chirp.js').data, 'saved custom chirp');
	assert.equal(workspace.working.get('/examples/chirp.js').data, 'working custom chirp');
	assert.equal(workspace.saved.get('/examples/short-beep.js').data, 'pending deletion');
	assert(!workspace.working.has('/examples/short-beep.js'));
	assert.deepEqual(workspace.getDirtyPaths(), dirty);
	assert.equal(installBuzzerExamples(workspace), 0);
});

test('an existing file at /examples blocks addition without changing the workspace', () => {
	const workspace = createVirtualFileWorkspace([{ path: '/examples', data: 'user file' }]);
	const before = workspace.snapshot();
	assert.throws(() => installBuzzerExamples(workspace), /blocks the examples folder/);
	assert.deepEqual(workspace.snapshot(), before);
});
