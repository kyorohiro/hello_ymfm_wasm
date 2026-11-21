// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaygroundCassetteZip, loadPlaygroundCassette } from '../playground/playground_cassette.js';
import { NDS_PROJECT_MANIFEST, createNdsProject, createNdsProjectStore } from './nds-project.js';

const starterCode = 'console.log("DS");\n';
const starterFiles = [{ path: '/examples/pcm.js', data: '// PCM example\n' }];
const create = () => createNdsProject({ starterCode, starterFiles });
const file = (path, data, type) => ({ path, data, type });

test('DS Cassette restores ordinary saved files and only the working differences', async () => {
	const project = create();
	project.makeDirectory('/empty');
	project.importFiles([file('/samples/original.raw', Uint8Array.of(0, 255)), file('/opaque.txt', Uint8Array.of(255), 'binary')]);
	project.setAutoApply(false);
	project.writeEditorText('/index.js', '// draft · 演奏\n');
	project.transfer('/empty', '/renamed');
	project.remove('/examples/pcm.js');
	project.importFiles([file('/samples/pending.raw', Uint8Array.of(90, 2)), file('/examples/draft.mjs', 'export const note = "C4";')]);
	const expected = project.snapshot();
	const zip = project.exportCassette();
	const { files } = await loadPlaygroundCassette(zip);
	assert.equal(new TextDecoder().decode(files.get('index.js')), starterCode);
	assert(files.has('examples/pcm.js'));
	assert(!files.has('examples/draft.mjs'));
	assert(!files.has('samples/pending.raw'));
	assert.equal([...files.keys()].filter(path => path.startsWith('.nds-working/')).length, 3);
	const opened = createNdsProject({ starterCode: '// remain here while preparing' });
	const candidate = await opened.prepareImport(zip);
	assert.match(opened.fs.get('/index.js').data, /remain here/);
	opened.restore(candidate);
	assert.deepEqual(opened.snapshot(), expected);
	assert.deepEqual(opened.fs.get('/opaque.txt').data, Uint8Array.of(255));
	assert.equal(opened.fs.get('/examples/pcm.js'), null);
	assert(opened.savedFs.get('/examples/pcm.js'));
});

test('plain Cassette imports text, binary and folders into Auto apply', async () => {
	const project = create();
	const zip = createPlaygroundCassetteZip([
		{ path: '/index.js', type: 'text', data: starterCode },
		{ path: '/sounds/kick.raw', type: 'binary', data: Uint8Array.of(0xca, 0xfe) },
	], { directories: ['/empty'] });
	project.restore(await project.prepareImport(zip));
	assert.equal(project.autoApply, true);
	assert.deepEqual(project.getDirtyPaths(), []);
	assert.equal(project.fs.get('/index.js').data, starterCode);
	assert.deepEqual(project.savedFs.get('/sounds/kick.raw').data, Uint8Array.of(0xca, 0xfe));
	assert(project.fs.listDirectories().includes('/empty'));
	assert.equal(project.fs.get('/metadata.json'), null);
});

test('invalid edits and malformed Cassette imports leave both versions intact', async () => {
	const project = create();
	const before = project.snapshot();
	assert.throws(() => project.importFiles([file('/good.md', 'should be atomic'), file('/bad.js', Uint8Array.of(255))]));
	assert.throws(() => project.importFiles([file('/.nds-working/0', 'reserved')]));
	assert.throws(() => project.importFiles([file('/missing.js', undefined)]));
	assert.deepEqual(project.snapshot(), before);
	const malformed = { format: before.format, version: 1, autoSave: false, textPaths: ['/index.js'],
		changes: [{ path: '/index.js', type: 'text' }], removed: [], addedDirectories: [], removedDirectories: [] };
	const zip = createPlaygroundCassetteZip([
		{ path: '/index.js', type: 'text', data: starterCode },
		{ path: NDS_PROJECT_MANIFEST, type: 'text', data: JSON.stringify(malformed) },
	]);
	await assert.rejects(project.prepareImport(zip), /working file payload/);
	await assert.rejects(project.prepareImport(zip, { isCurrent: () => false }), { name: 'AbortError' });
	const invalidSnapshot = project.snapshot();
	invalidSnapshot.workspace.working.directories = ['/'];
	assert.throws(() => project.restore(invalidSnapshot), /Invalid DS project file/);
	assert.deepEqual(project.snapshot(), before);
});

test('Save, Discard and New maintain the accepted file baseline', () => {
	const project = create();
	project.setAutoApply(false);
	project.writeEditorText('/index.js', '// draft');
	project.writeEditorText('/added.js', '// new');
	project.saveFiles(['/index.js']);
	assert.equal(project.savedFs.get('/index.js').data, '// draft');
	assert.equal(project.savedFs.get('/added.js'), null);
	project.discardFiles(['/added.js']);
	assert.equal(project.fs.get('/added.js'), null);
	project.importFiles([{ path: '/another.js', data: '// second' }]);
	assert(project.isFileModified('/another.js'));
	project.saveAll();
	project.remove('/another.js');
	project.discardAll();
	assert.equal(project.fs.get('/another.js').data, '// second');
	project.reset();
	assert.equal(project.autoApply, false);
	assert.equal(project.savedFs.get('/index.js').data, starterCode);
	assert(project.fs.has('/examples/pcm.js'));
	assert.equal(project.fs.get('/another.js'), null);
});

test('Code recovery keeps working and accepted text distinct', () => {
	const project = create();
	project.recoverCode('/index.js', { source: '// repaired draft', savedSource: starterCode, autoSave: false });
	assert.equal(project.fs.get('/index.js').data, '// repaired draft');
	assert.equal(project.savedFs.get('/index.js').data, starterCode);
	assert(project.isFileModified('/index.js'));
	const before = project.snapshot();
	assert.throws(() => project.recoverCode('/index.js', { source: 'A', savedSource: 'B', autoSave: true }), /recovery versions/);
	assert.deepEqual(project.snapshot(), before);
	project.recoverCode('/index.js', { source: '// accepted', savedSource: '// accepted', autoSave: true });
	assert.deepEqual(project.getDirtyPaths(), []);
	assert.equal(project.savedFs.get('/index.js').data, '// accepted');
});

test('local persistence fallback serializes binary bytes in both layers', async () => {
	const storage = new Map();
	const options = { indexedDB: null, storage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
	const project = create();
	project.importFiles([{ path: '/sample.raw', data: Uint8Array.of(0, 255, 0) }]);
	project.setAutoApply(false);
	project.importFiles([{ path: '/sample.raw', data: Uint8Array.of(255, 0, 255) }]);
	const receipt = { workspaceId: 'saved-instance', project: project.snapshot(), codeState: { mode: 'code', path: '/index.js' } };
	const writer = createNdsProjectStore(options);
	assert.equal(await writer.write(receipt), true);
	await writer.close();
	const reader = createNdsProjectStore(options);
	assert.deepEqual(await reader.read(), receipt);
	await reader.close();
});
