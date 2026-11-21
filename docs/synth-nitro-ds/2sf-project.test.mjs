// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { scspSsfCrc32 as crc32 } from '../synth-scsp/ssf_source.js';
import { assembleTwoSf } from './2sf_source.js';
import { listSavedTwoSfSets, saveTwoSfSong } from './2sf-project.js';
import { NDS_PROJECT_FILE_BYTES, createNdsProject } from './nds-project.js';

function container({ offset = 0, sample = [], tags = '' } = {}) {
	const overlay = Buffer.alloc(8 + sample.length);
	overlay.writeUInt32LE(offset);
	overlay.writeUInt32LE(sample.length, 4);
	Buffer.from(sample).copy(overlay, 8);
	const program = sample.length ? deflateSync(overlay) : Buffer.alloc(0);
	const header = Buffer.alloc(16);
	header.write('PSF\x24');
	header.writeUInt32LE(program.length, 8);
	header.writeUInt32LE(crc32(program), 12);
	return Buffer.concat([header, program, Buffer.from(tags ? `[TAG]${tags}` : '')]);
}

const song = 'Album/Disc/Track.mini2sf';
const anotherSong = 'Album/Disc/Track 2.mini2sf';
const library = 'Album/Shared.2sflib';
const chain = 'Album/Disc/Libraries/Chain.2sflib';
const sources = (sample = [1, 2, 3, 4]) => [
	{ path: song, file: new Blob([container({ offset: 2, sample: [7], tags: '_lib=Libraries\\Chain.2sflib' })]) },
	{ path: anotherSong, file: new Blob([container({ tags: '_lib=../Shared.2sflib' })]) },
	{ path: library, file: new Blob([container({ sample })]) },
	{ path: chain, file: new Blob([container({ offset: 1, sample: [5], tags: '_lib=../shared.2sflib' })]) },
];

test('saves only the selected 2SF and its exact source dependencies through a Cassette round trip', async () => {
	const project = createNdsProject({ starterCode: 'console.log("keep");\n' });
	project.setAutoApply(false);
	project.writeEditorText('/index.js', '// working edit\n');
	const entries = sources();
	const saved = await saveTwoSfSong(project, song, entries);
	assert.equal(saved.added, 3);
	assert.equal(saved.path, `${saved.root}/${song}`);
	assert.deepEqual(project.getDirtyPaths(), ['/index.js']);
	const reopened = createNdsProject();
	reopened.restore(await reopened.prepareImport(project.exportCassette()));
	const [group] = listSavedTwoSfSets(reopened.savedFs);
	assert.equal(group.root, saved.root);
	assert.deepEqual(group.tracks, [saved.path]);
	assert.equal(group.paths.length, 3);
	for (const entry of entries.filter(entry => entry.path !== anotherSong)) {
		assert.deepEqual(reopened.savedFs.get(`${group.root}/${entry.path}`).data, new Uint8Array(await entry.file.arrayBuffer()));
	}
	const { rom } = await assembleTwoSf(saved.path, group.paths.map(path => reopened.savedFs.get(path)), { setRoot: group.root });
	assert.deepEqual(rom, Uint8Array.of(1, 5, 7, 4));
	assert.equal(reopened.fs.get('/index.js').data, '// working edit\n');
});

test('reuse the same sources within a saved set and isolate conflicts', async () => {
	const project = createNdsProject();
	const first = await saveTwoSfSong(project, song, sources());
	const repeat = await saveTwoSfSong(project, song, sources());
	assert.deepEqual(repeat, { ...first, added: 0 });
	const second = await saveTwoSfSong(project, anotherSong, sources());
	assert.equal(second.root, first.root);
	assert.equal(second.added, 1);
	const replacement = await saveTwoSfSong(project, song, sources([11, 22, 33, 44]));
	assert.notEqual(replacement.root, first.root);
	assert.deepEqual(await saveTwoSfSong(project, song, sources([11, 22, 33, 44])), { ...replacement, added: 0 });
	assert.deepEqual(listSavedTwoSfSets(project.savedFs).map(group => group.tracks.length), [2, 1]);
	const edited = Uint8Array.of(0xde, 0xad);
	project.setAutoApply(false);
	project.importFiles([{ path: `${first.root}/${library}`, data: edited }]);
	const afterEdit = await saveTwoSfSong(project, song, sources());
	assert.notEqual(afterEdit.root, first.root);
	assert.deepEqual(project.fs.get(`${first.root}/${library}`).data, edited);
	assert(project.isFileModified(`${first.root}/${library}`));
});

test('a conflicting case variant cannot change library resolution and an existing numbered set is reused', async () => {
	const project = createNdsProject();
	const first = await saveTwoSfSong(project, song, sources());
	const caseVariant = `${first.root}/Album/shared.2sflib`;
	project.importFiles([{ path: caseVariant, data: container({ sample: [100, 101, 102, 103] }) }]);
	const second = await saveTwoSfSong(project, song, sources());
	assert.notEqual(second.root, first.root);
	const group = listSavedTwoSfSets(project.savedFs).find(group => group.root === second.root);
	const { rom } = await assembleTwoSf(second.path, group.paths.map(path => project.savedFs.get(path)), { setRoot: group.root });
	assert.deepEqual(rom, Uint8Array.of(1, 5, 7, 4));
	project.remove(first.root);
	assert.deepEqual(await saveTwoSfSong(project, song, sources()), { ...second, added: 0 });
});

test('a failed dependency, oversize source, or cancelled save makes no project changes', async () => {
	const project = createNdsProject();
	const before = project.snapshot();
	const entries = sources();
	await assert.rejects(saveTwoSfSong(project, song, entries.filter(entry => entry.path !== library)), /missing library/i);
	const reservedSong = 'Album/.git/Track.2sf';
	await assert.rejects(saveTwoSfSong(project, reservedSong, [{ path: reservedSong,
		file: new Blob([container({ sample: [1] })]) }]), /reserved or invalid/);
	await assert.rejects(saveTwoSfSong(project, song, [{ path: song, file: {
		size: NDS_PROJECT_FILE_BYTES + 1,
		arrayBuffer() { throw new Error('oversized input should not be read'); },
	} }]), /Cassette size limit/);
	let current = true;
	await assert.rejects(saveTwoSfSong(project, song, [{ path: song, file: {
		size: entries[0].file.size,
		arrayBuffer() { current = false; return entries[0].file.arrayBuffer(); },
	} }], { isCurrent: () => current }), { name: 'AbortError' });
	assert.deepEqual(project.snapshot(), before);
});

test('the 2SF save budget includes both the saved files and separate working changes', async () => {
	const project = createNdsProject();
	const half = 8 * 1024 * 1024;
	project.importFiles([{ path: '/existing.bin', data: new Uint8Array(half) }]);
	project.setAutoApply(false);
	project.importFiles([{ path: '/existing.bin', data: new Uint8Array(NDS_PROJECT_FILE_BYTES - half - 16) }]);
	const revision = project.fs.getRevision('/existing.bin');
	await assert.rejects(saveTwoSfSong(project, song, sources()), /current project exceed the Cassette size limit/);
	assert.equal(project.fs.getRevision('/existing.bin'), revision);
	assert.deepEqual(project.getDirtyPaths(), ['/existing.bin']);
	assert.deepEqual(listSavedTwoSfSets(project.savedFs), []);
});
