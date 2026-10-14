import test from 'node:test';
import assert from 'node:assert/strict';
import { createSynthProject, isSynthTonePath } from './synth_project.js';
import { createTfiFromPreset } from '../js/tfi.js';
import { createVgiFromPreset } from '../js/vgi.js';
import { createPlaygroundCassetteZip, loadPlaygroundCassette } from '../playground/playground_cassette.js';

const patch = {
  algorithm: 4, feedback: 2, ams: 2, pms: 5,
  pan: { left: false, right: true },
  operators: { 1: { ar: 23, tl: 12, dt: 3 }, 2: { tl: 31 }, 3: { tl: 45 }, 4: { tl: 22 } },
};
const instrument = (name, data = createTfiFromPreset(patch)) => ({ name, async arrayBuffer() { return data.slice().buffer; } });
function vgm(algorithm = 4) {
  const commands = [0x52, 0xb0, algorithm, 0x52, 0x28, 0xf0, 0x52, 0x28, 0xf0, 0x66];
  const bytes = new Uint8Array(256 + commands.length), view = new DataView(bytes.buffer);
  bytes.set([86, 103, 109, 32]);
  view.setUint32(4, bytes.length - 4, true);
  view.setUint32(8, 0x171, true);
  view.setUint32(0x34, 204, true);
  view.setUint32(0x2c, 7670454, true);
  bytes.set(commands, 256);
  return bytes;
}

test('each VGM import has its own source folder, including equal names in one batch', async () => {
  const project = createSynthProject();
  const result = await project.importInstrumentFiles([instrument('song.vgm', vgm(4)), instrument('song.vgm', vgm(7))]);
  assert.deepEqual(result.paths, ['/presets/song/ym2612_ch1_001.tfi', '/presets/song-2/ym2612_ch1_001.tfi']);
  assert.equal(project.readTone(result.paths[0]).preset.algorithm, 4);
  assert.equal(project.readTone(result.paths[1]).preset.algorithm, 7);
  const later = await project.importInstrumentFiles([instrument('song.vgm', vgm(1))]);
  assert.deepEqual(later.paths, ['/presets/song-3/ym2612_ch1_001.tfi']);
  assert.equal(project.listTones().length, 3);
});

test('TFI/VGI imports retain exact bytes and normalize renamed files for Playground', async () => {
  const project = createSynthProject();
  const vgi = createVgiFromPreset(patch);
  const result = await project.importInstrumentFiles([instrument('Lead.tfi', vgi)]);
  assert.deepEqual(result.paths, ['/presets/Lead/Lead.vgi']);
  assert.deepEqual(project.fs.get(result.paths[0]).data, vgi);
  const tone = project.readTone(result.paths[0]);
  tone.bytes[0] = 0;
  tone.preset.operators[1].tl = 0;
  assert.equal(project.readTone(result.paths[0]).preset.algorithm, 4, 'reads are independent copies');
  assert.equal(project.readTone(result.paths[0]).preset.operators[1].tl, 12);
});

test('valid imports append atomically and bad or empty imports preserve prior content', async () => {
  const project = createSynthProject();
  await project.importInstrumentFiles([instrument('first.tfi')]);
  let commits = 0;
  project.onDidChange(() => commits++);
  const result = await project.importInstrumentFiles([instrument('bad.tfi', new Uint8Array(2)), instrument('second.vgi', createVgiFromPreset(patch))]);
  assert.equal(commits, 1);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /bad\.tfi.*42 bytes/);
  assert.equal(project.listTones().length, 2);
  const before = project.snapshot();
  await project.importInstrumentFiles([instrument('wrong.vgm', new Uint8Array(7)), instrument('empty.vgm', vgm().slice(0, 256))]);
  assert.deepEqual(project.snapshot(), before);
  assert.equal(commits, 1);
});

test('a slow earlier load cannot append after a newer import or restored project', async () => {
  const project = createSynthProject();
  let finish;
  const slow = project.importInstrumentFiles([{ name: 'old.tfi', arrayBuffer: () => new Promise(resolve => { finish = resolve; }) }]);
  const next = await project.importInstrumentFiles([instrument('new.tfi')]);
  finish(createTfiFromPreset(patch).buffer);
  assert.equal((await slow).cancelled, true);
  assert.deepEqual(project.listTones().map(file => file.path), next.paths);
  const secondSlow = project.importInstrumentFiles([{ name: 'late.tfi', arrayBuffer: () => new Promise(resolve => { finish = resolve; }) }]);
  project.restore(createSynthProject().snapshot());
  finish(createTfiFromPreset(patch).buffer);
  assert.equal((await secondSlow).cancelled, true);
  assert.equal(project.listTones().length, 0);
});

test('a drop target receives direct tones and source folders for VGM logs', async () => {
  const project = createSynthProject();
  project.mkdir('/presets/My set');
  const result = await project.importInstrumentFiles([
    instrument('lead.tfi'), instrument('lead.tfi'), instrument('game.vgm', vgm()),
  ], { directory: '/presets/My set' });
  assert.deepEqual(result.paths, [
    '/presets/My set/game/ym2612_ch1_001.tfi', '/presets/My set/lead.tfi', '/presets/My set/lead-2.tfi',
  ]);
  await assert.rejects(project.importInstrumentFiles([], { directory: '/missing' }), /not found/);
});

test('import filenames cannot escape their source folder or collide with existing folders', async () => {
  const project = createSynthProject();
  project.mkdir('/presets/song');
  const result = await project.importInstrumentFiles([instrument('song.tfi'), instrument('../evil.tfi')]);
  assert.ok(result.paths.includes('/presets/song-2/song.tfi'));
  assert.ok(result.paths.every(path => path.startsWith('/presets/')));
  assert.equal(project.fs.has('/evil.tfi'), false);
  assert.ok(result.paths.some(path => path.includes('.._evil')));
});

test('Save encodes logical operators and keeps existing format, pan and reserved VGI bits', () => {
  const project = createSynthProject();
  const original = createVgiFromPreset(patch);
  original[2] |= 0x08;
  project.fs.writeBinary('/presets/renamed.tfi', original);
  const current = project.readTone('/presets/renamed.tfi');
  const edit = { ...current.preset, operators: { ...current.preset.operators, 1: { ...current.preset.operators[1], tl: 9 } }, ams: 1, pms: 7 };
  delete edit.b4;
  delete edit.pan;
  project.writeTone(current.path, edit);
  const saved = project.readTone(current.path);
  assert.equal(saved.format, 'vgi');
  assert.equal(saved.preset.operators[1].tl, 9);
  assert.equal(saved.preset.operators[3].tl, 45);
  assert.equal(saved.preset.ams, 1);
  assert.equal(saved.preset.pms, 7);
  assert.equal(saved.bytes[2] & 0x08, 0x08);
  assert.deepEqual(saved.preset.pan, { left: false, right: true });
  project.writeTone('/presets/new.tfi', patch);
  assert.equal(project.readTone('/presets/new.tfi').format, 'tfi');
  assert.equal(project.fs.get('/presets/new.tfi').data.byteLength, 42);
  const partial = { ...edit };
  delete partial.ams;
  delete partial.pms;
  project.writeTone(current.path, partial);
  assert.equal(project.readTone(current.path).preset.ams, 1);
  assert.equal(project.readTone(current.path).preset.pms, 7);
});

test('invalid and revision-conflicting saves do not change bytes or selection', () => {
  const project = createSynthProject();
  project.writeTone('/presets/new.vgi', patch);
  const before = project.snapshot();
  assert.throws(() => project.writeTone('/presets/new.vgi', { ...patch, feedback: 9 }), /feedback/);
  assert.throws(() => project.writeTone('/presets/new.vgi', { ...patch, ams: NaN }), /ams/);
  assert.throws(() => project.writeTone('/presets/new.vgi', { ...patch, pms: 8 }), /pms/);
  assert.throws(() => project.writeTone('/presets/new.vgi', patch, { overwrite: false }), /already exists/);
  assert.throws(() => project.writeTone('/presets/new.vgi', patch, { expectedRevision: 1 }), /Revision conflict/);
  assert.throws(() => project.writeTone('/presets/file.txt', patch), /\.tfi or \.vgi/);
  assert.deepEqual(project.snapshot(), before);
});

test('duplicate, rename, move and delete operate on real files and preserve selected descendants', () => {
  const project = createSynthProject();
  project.writeTone('/presets/lead.vgi', patch);
  const copy = project.duplicate('/presets/lead.vgi');
  assert.equal(copy, '/presets/lead copy.vgi');
  assert.equal(project.duplicate('/presets/lead.vgi'), '/presets/lead copy-2.vgi');
  const renamed = project.rename(copy, 'Choir');
  assert.equal(renamed, '/presets/Choir.vgi');
  project.mkdir('/presets/Set/Empty');
  project.move(renamed, '/presets/Set/Choir.vgi');
  project.select('/presets/Set/Choir.vgi');
  project.rename('/presets/Set', 'Album');
  assert.equal(project.selectedPath, '/presets/Album/Choir.vgi');
  assert.ok(project.fs.listDirectories().includes('/presets/Album/Empty'));
  assert.throws(() => project.delete('/presets/Album'), /not empty/);
  project.delete('/presets/Album', { recursive: true });
  assert.equal(project.selectedPath, null);
  assert.equal(project.fs.has('/presets/Album/Choir.vgi'), false);
});

test('folder duplication preserves opaque .git bytes and empty directories', () => {
  const project = createSynthProject();
  project.fs.writeBinary('/.git/objects/ab/test', new Uint8Array([255, 0, 128]));
  project.mkdir('/.git/refs/heads');
  assert.equal(project.duplicate('/.git'), '/.git copy');
  assert.deepEqual(project.fs.get('/.git copy/objects/ab/test').data, new Uint8Array([255, 0, 128]));
  assert.ok(project.fs.listDirectories().includes('/.git copy/refs/heads'));
});

test('path and move conflicts fail before altering project state', () => {
  const project = createSynthProject();
  project.writeTone('/presets/a.tfi', patch);
  project.writeTone('/presets/b.vgi', patch);
  const before = project.snapshot();
  assert.throws(() => project.rename('/presets/a.tfi', '../bad'), /path separators/);
  assert.throws(() => project.rename('/presets/a.tfi', '..'), /Invalid/);
  assert.throws(() => project.move('/presets/a.tfi', '/presets/b.vgi'), /already exists/);
  assert.throws(() => project.move('/presets', '/presets/child'), /inside itself/);
  assert.throws(() => project.select('/missing'), /not found/);
  assert.deepEqual(project.snapshot(), before);
});

test('snapshot/restore supports Undo, including selection and empty folders', () => {
  const project = createSynthProject();
  project.mkdir('/presets/empty');
  project.writeTone('/presets/a.vgi', patch);
  const before = project.snapshot();
  project.delete('/presets/a.vgi');
  assert.equal(project.selectedPath, null);
  project.restore(before);
  assert.deepEqual(project.snapshot(), before);
  assert.equal(project.readTone(project.selectedPath).preset.algorithm, 4);
  const other = createSynthProject({ snapshot: before });
  assert.deepEqual(other.snapshot(), before);
  const invalid = { ...before, files: [{ path: '/../../escape', data: new Uint8Array() }] };
  assert.throws(() => project.restore(invalid), /escapes/);
  assert.deepEqual(project.snapshot(), before);
  assert.throws(() => project.restore({ ...before, selectedPath: '/missing' }), /not found/);
  assert.deepEqual(project.snapshot(), before);
});

test('Cassette import/export preserves metadata bytes, unknown files, .git and empty folders', async () => {
  const metadata = new TextEncoder().encode(' { "version": 1, "workType": "ORIGINAL", "license": "CUSTOM", "licenseName": "Mine", "future": { "nested": 123 } }\n');
  const entries = [
    { path: '/index.js', type: 'binary', data: new Uint8Array([239, 187, 191, 120, 255]) },
    { path: '/presets/Game/lead.vgi', type: 'binary', data: createVgiFromPreset(patch) },
    { path: '/.git/objects/ab/cd', type: 'binary', data: new Uint8Array([0, 255, 128]) },
    { path: '/misc/opaque.dat', type: 'binary', data: new Uint8Array([42, 0, 9]) },
    { path: '/metadata.json', type: 'binary', data: metadata },
  ];
  const zip = createPlaygroundCassetteZip(entries, { directories: ['/empty', '/.git/refs/heads'], preserveMetadataFiles: true });
  const project = createSynthProject();
  await project.importCassette(zip, { name: 'Shared.cassette.zip' });
  assert.equal(project.cassetteName, 'Shared');
  assert.equal(project.cassetteMetadata.future.nested, 123);
  assert.equal(project.selectedPath, '/presets/Game/lead.vgi');
  const cassette = await loadPlaygroundCassette(project.exportCassette());
  for (const file of entries) assert.deepEqual(cassette.files.get(file.path.slice(1)), file.data, file.path);
  assert.ok(cassette.directories.includes('/empty'));
  assert.ok(cassette.directories.includes('/.git/refs/heads'));
  project.writeTone(project.selectedPath, { ...patch, algorithm: 6 });
  const changed = await loadPlaygroundCassette(project.exportCassette());
  assert.equal(changed.files.get('presets/Game/lead.vgi')[0], 6);
  assert.deepEqual(changed.files.get('metadata.json'), metadata, 'tone Save leaves imported metadata untouched');
  assert.deepEqual(changed.files.get('index.js'), entries[0].data);
});

test('Synth Cassette imports the legacy Playground timbres folder and exports compatible metadata', async () => {
  const project = createSynthProject();
  const zip = createPlaygroundCassetteZip([
    { path: '/timbres/Legacy.tfi', type: 'binary', data: createTfiFromPreset(patch) },
    { path: '/examples/main.js', type: 'text', data: 'play("C4");\n' },
  ], { license: 'CC0-1.0', workType: 'ORIGINAL' });
  await project.importCassette(zip);
  assert.equal(project.readTone('/timbres/Legacy.tfi').preset.algorithm, 4);
  const again = await loadPlaygroundCassette(project.exportCassette());
  assert.equal(again.timbres[0].name, 'Legacy');
  assert.equal(again.metadata.license, 'CC0-1.0');
  assert.equal(again.examples[0].source, 'play("C4");\n');
});

test('new Synth projects export a valid Cassette, and bad Cassette imports are atomic', async () => {
  const project = createSynthProject();
  const cassette = await loadPlaygroundCassette(project.exportCassette({ license: 'PRIVATE' }));
  assert.equal(cassette.metadata.license, 'PRIVATE');
  assert.ok(cassette.directories.includes('/presets'));
  project.writeTone('/presets/a.tfi', patch);
  const before = project.snapshot();
  await assert.rejects(project.importCassette(new Uint8Array([1, 2])), /zip archive/);
  assert.deepEqual(project.snapshot(), before);
  const invalidTone = createPlaygroundCassetteZip([{ path: '/presets/broken.tfi', type: 'binary', data: new Uint8Array(5) }]);
  await assert.rejects(project.importCassette(invalidTone), /Invalid instrument.*broken\.tfi.*42 bytes/);
  assert.deepEqual(project.snapshot(), before);
  const rejected = await project.importCassette(project.exportCassette(), { isCurrent: () => false });
  assert.equal(rejected.cancelled, true);
  assert.deepEqual(project.snapshot(), before);
});

test('non-instrument files are preserved without being parsed and subscriptions can be removed', () => {
  const project = createSynthProject();
  let changes = 0;
  const unsubscribe = project.onDidChange(() => { changes++; });
  project.fs.writeText('/index.js', 'hello');
  project.select('/index.js');
  assert.equal(changes, 2);
  assert.throws(() => project.readTone('/index.js'), /TFI or VGI/);
  assert.equal(isSynthTonePath('/presets/A.VGI'), true);
  assert.equal(isSynthTonePath('/index.js'), false);
  unsubscribe();
  project.fs.writeText('/index.js', 'updated');
  assert.equal(changes, 2);
});

test('file-tree and tone listing avoid copying opaque sample and Git data', () => {
  const project = createSynthProject();
  project.writeTone('/presets/tone.vgi', patch);
  project.fs.writeBinary('/samples/large.wav', new Uint8Array(1024 * 1024));
  project.fs.writeBinary('/.git/objects/pack/large.pack', new Uint8Array(1024 * 1024));
  project.mkdir('/empty');
  // A tree render must not ask for the full contents of every file. Verify
  // through the public VFS calls, rather than a timing-sensitive benchmark.
  const fsGet = project.fs.get;
  const reads = [];
  project.fs.list = () => assert.fail('Listing the tree copied all project bytes');
  project.fs.get = path => { reads.push(path); return fsGet(path); };
  const entries = project.listEntries();
  assert.deepEqual(reads, []);
  assert.ok(entries.some(entry => entry.path === '/empty' && entry.type === 'directory'));
  assert.ok(entries.some(entry => entry.path === '/samples/large.wav' && entry.type === 'file' && entry.size === 1024 * 1024));
  assert.ok(entries.every(entry => !Object.hasOwn(entry, 'data')));
  assert.equal(project.uniquePath('/presets/tone.vgi'), '/presets/tone-2.vgi');
  assert.deepEqual(reads, []);
  const tones = project.listTones();
  assert.deepEqual(reads, ['/presets/tone.vgi']);
  assert.deepEqual(tones[0].data, createVgiFromPreset(patch));
});

test('Cassette export rejects a generated metadata file conflicting with a folder', async () => {
  const project = createSynthProject();
  project.mkdir('/metadata.json');
  const before = project.snapshot();
  assert.throws(() => project.exportCassette(), /metadata\.json is a folder.*Rename/);
  assert.deepEqual(project.snapshot(), before);
  // A preserved module uses its original metadata path, so an opaque folder
  // with the other metadata name is legal and must remain available.
  project.fs.writeText('/cassette.metadata.js', 'export default {"version":1,"license":"PRIVATE","workType":"NONE"};\n');
  const restored = createSynthProject();
  await restored.importCassette(project.exportCassette());
  assert.ok(restored.fs.listDirectories().includes('/metadata.json'));
  assert.equal(restored.cassetteMetadata.license, 'PRIVATE');
  const moduleProject = createSynthProject();
  moduleProject.mkdir('/cassette.metadata.js');
  assert.throws(() => moduleProject.exportCassette({ metadataFileName: 'cassette.metadata.js' }), /cassette\.metadata\.js is a folder/);
  await createSynthProject().importCassette(moduleProject.exportCassette());
});

test('Git refs with instrument extensions remain opaque through Cassette round trips', async () => {
  const ref = new TextEncoder().encode('0123456789012345678901234567890123456789\n');
  const files = [
    { path: '/.git/refs/heads/song.vgi', type: 'binary', data: ref },
    { path: '/.git/refs/heads/song.tfi', type: 'binary', data: ref },
    { path: '/nested/.git/refs/tags/tone.VGI', type: 'binary', data: ref },
    { path: '/presets/real.vgi', type: 'binary', data: createVgiFromPreset(patch) },
  ];
  const project = createSynthProject();
  await project.importCassette(createPlaygroundCassetteZip(files));
  assert.deepEqual(project.listTones().map(file => file.path), ['/presets/real.vgi']);
  assert.equal(project.selectedPath, '/presets/real.vgi');
  assert.equal(isSynthTonePath('/.git/refs/heads/song.vgi'), false);
  assert.equal(isSynthTonePath('/nested/.git/refs/heads/song.tfi'), false);
  assert.throws(() => project.readTone('/.git/refs/heads/song.vgi'), /Choose a TFI or VGI/);
  const exported = await loadPlaygroundCassette(project.exportCassette());
  for (const file of files) assert.deepEqual(exported.files.get(file.path.slice(1)), file.data, file.path);
  const instrumentResult = await project.importInstrumentFiles([instrument('.git.tfi')]);
  assert.deepEqual(instrumentResult.paths, ['/presets/.git-instruments/.git.tfi']);
  assert.equal(project.readTone(instrumentResult.paths[0]).preset.algorithm, 4);
  const before = project.snapshot();
  await assert.rejects(project.importInstrumentFiles([instrument('tone.tfi')], { directory: '/.git/refs/heads' }), /cannot target a \.git folder/);
  assert.deepEqual(project.snapshot(), before);
});
