import test from 'node:test';
import assert from 'node:assert/strict';
import {createVirtualFileSystem} from '../src/filesystem.js';
import {planVirtualFileSync} from '../src/sync.js';

const ordered = snapshot => ({
  ...snapshot,
  files: [...snapshot.files].sort((left, right) => left.path.localeCompare(right.path)),
  directories: [...snapshot.directories].sort(),
});
const fileAt = (snapshot, path) => snapshot.files.find(file => file.path === path);
const setup = () => {
  const fs = createVirtualFileSystem([
    {path: '/source/code.js', data: 'current code'},
    {path: '/source/nested/sound.bin', data: new Uint8Array([0, 128, 255])},
    {path: '/outside.txt', data: 'outside'},
  ]);
  fs.mkdir('/source/empty');
  return fs;
};

test('exact-target file sync preserves type, leaves the source intact, and never appends a basename', () => {
  const fs = setup(), before = fs.snapshot();
  const result = planVirtualFileSync(before, '/source/code.js', '/copy/renamed.js');
  assert.equal(result.changed, true);
  assert.deepEqual(fileAt(result.snapshot, '/copy/renamed.js'), {path: '/copy/renamed.js', type: 'text', data: 'current code'});
  assert.equal(fileAt(result.snapshot, '/copy/renamed.js/code.js'), undefined);
  assert.equal(fileAt(result.snapshot, '/source/code.js').data, 'current code');
  assert.equal(fileAt(result.snapshot, '/outside.txt').data, 'outside');
  assert(result.snapshot.directories.includes('/copy'));
  assert.deepEqual(fs.snapshot(), before);
});

test('binary sync copies both source and destination bytes defensively', () => {
  const snapshot = setup().snapshot();
  const result = planVirtualFileSync(snapshot, '/source/nested/sound.bin', '/copy.bin');
  const source = fileAt(result.snapshot, '/source/nested/sound.bin');
  const copied = fileAt(result.snapshot, '/copy.bin');
  assert.equal(copied.type, 'binary');
  assert.deepEqual(copied.data, new Uint8Array([0, 128, 255]));
  copied.data[0] = 4;
  assert.equal(source.data[0], 0);
  assert.equal(fileAt(snapshot, '/source/nested/sound.bin').data[0], 0);
  source.data[1] = 5;
  assert.equal(fileAt(snapshot, '/source/nested/sound.bin').data[1], 128);
});

test('internal storage sharing retains unchanged bytes while keeping copied destination bytes independent', () => {
  const fs = createVirtualFileSystem([
    {path: '/source.bin', data: new Uint8Array([0, 128, 255])},
    {path: '/outside.bin', data: new Uint8Array([4, 5])},
    {path: '/target.bin', data: new Uint8Array([9])},
  ]);
  const snapshot = fs.snapshot();
  const result = planVirtualFileSync(snapshot, '/source.bin', '/target.bin', {shareUnchanged: true});
  const source = fileAt(snapshot, '/source.bin').data;
  const outside = fileAt(snapshot, '/outside.bin').data;
  const target = fileAt(result.snapshot, '/target.bin').data;
  assert.equal(fileAt(result.snapshot, '/source.bin').data, source);
  assert.equal(fileAt(result.snapshot, '/outside.bin').data, outside);
  assert.notEqual(target, source);
  assert.deepEqual(target, source);
  target[0] = 17;
  assert.equal(source[0], 0);
  assert.equal(fileAt(result.snapshot, '/source.bin').data[0], 0);
  for (const shareUnchanged of [1, 'true', null]) {
    assert.throws(() => planVirtualFileSync(snapshot, '/source.bin', '/target.bin', {shareUnchanged}), /boolean/);
  }
});

test('file sync replaces an existing file and regards text/binary representation as part of the content', () => {
  const fs = createVirtualFileSystem([
    {path: '/source', data: ''},
    {path: '/target', data: new Uint8Array()},
  ]);
  const result = planVirtualFileSync(fs.snapshot(), '/source', '/target');
  assert.equal(result.changed, true);
  assert.equal(fileAt(result.snapshot, '/target').type, 'text');
  assert.equal(fileAt(result.snapshot, '/target').data, '');
});

test('folder sync mirrors only the selected destination subtree, pruning stale files and preserving empty folders', () => {
  const fs = setup();
  fs.writeText('/archive/stale/deleted.txt', 'stale');
  fs.writeText('/archive/code.js', 'old code');
  fs.writeText('/archive-adjacent.txt', 'keep nearby');
  fs.mkdir('/archive/stale/empty');
  const before = fs.snapshot();
  const result = planVirtualFileSync(before, '/source', '/archive');
  assert.equal(result.changed, true);
  assert.equal(fileAt(result.snapshot, '/archive/code.js').data, 'current code');
  assert.deepEqual(fileAt(result.snapshot, '/archive/nested/sound.bin').data, new Uint8Array([0, 128, 255]));
  assert.equal(fileAt(result.snapshot, '/archive/stale/deleted.txt'), undefined);
  assert(result.snapshot.directories.includes('/archive/empty'));
  assert(!result.snapshot.directories.some(path => path === '/archive/stale' || path.startsWith('/archive/stale/')));
  assert.equal(fileAt(result.snapshot, '/archive-adjacent.txt').data, 'keep nearby');
  assert.equal(fileAt(result.snapshot, '/outside.txt').data, 'outside');
  assert.deepEqual(fs.snapshot(), before);
});

test('syncing an empty folder clears only its destination contents while retaining the destination folder', () => {
  const fs = createVirtualFileSystem([{path: '/target/old/file.txt', data: 'old'}, {path: '/outside', data: 'keep'}]);
  fs.mkdir('/empty');
  const result = planVirtualFileSync(fs.snapshot(), '/empty', '/target');
  assert.equal(result.changed, true);
  assert.deepEqual(result.snapshot.files.map(file => file.path), ['/outside']);
  assert(result.snapshot.directories.includes('/empty'));
  assert(result.snapshot.directories.includes('/target'));
  assert(!result.snapshot.directories.includes('/target/old'));
});

test('identical files, already mirrored folders and identical source/destination are no-ops', () => {
  const initial = setup().snapshot();
  const first = planVirtualFileSync(initial, '/source', '/archive');
  const repeated = planVirtualFileSync(first.snapshot, '/source', '/archive');
  assert.equal(repeated.changed, false);
  assert.deepEqual(ordered(repeated.snapshot), ordered(first.snapshot));
  const sameFile = planVirtualFileSync(first.snapshot, '/source/code.js', '/archive/code.js');
  assert.equal(sameFile.changed, false);
  const identity = planVirtualFileSync(initial, '/source', '/source');
  assert.equal(identity.changed, false);
  assert.deepEqual(ordered(identity.snapshot), ordered(initial));
});

test('directory/file type conflicts are rejected at the root and inside a mirrored subtree without changing input', () => {
  for (const entries of [
    [{path: '/target', data: 'file blocks a folder'}],
    [{path: '/target/code.js/child', data: 'directory blocks a file'}],
    [{path: '/target/nested', data: 'file blocks nested folder'}],
  ]) {
    const fs = setup();
    for (const entry of entries) fs.writeFile(entry.path, entry.data);
    const before = fs.snapshot();
    assert.throws(() => planVirtualFileSync(before, '/source', '/target'));
    assert.deepEqual(fs.snapshot(), before);
  }
  const fs = setup(), before = fs.snapshot();
  assert.throws(() => planVirtualFileSync(before, '/source/code.js', '/source/empty'));
  assert.deepEqual(fs.snapshot(), before);
});

test('a file blocking a destination parent causes the entire plan to fail', () => {
  const fs = setup();
  fs.writeText('/blocked', 'parent is a file');
  const before = fs.snapshot();
  assert.throws(() => planVirtualFileSync(before, '/source', '/blocked/archive'));
  assert.deepEqual(fs.snapshot(), before);
});

test('ancestor/descendant overlap and nonexistent sources are rejected before mutation', () => {
  const fs = setup(), before = fs.snapshot();
  for (const [source, target] of [
    ['/source', '/source/copy'],
    ['/source/nested', '/source'],
    ['/', '/archive'],
    ['/missing', '/copy'],
    ['/missing', '/missing'],
  ]) {
    assert.throws(() => planVirtualFileSync(before, source, target), `${source} -> ${target}`);
    assert.deepEqual(fs.snapshot(), before);
  }
});

test('unsupported URI schemes and invalid virtual paths cannot be mistaken for local filenames', () => {
  const before = setup().snapshot();
  for (const [source, target] of [
    ['/source', 'app-storage://~/'],
    ['app-storage://~/source', '/copy'],
    ['/source', 'https://example.test/copy'],
    ['/source', '../escape'],
    ['/source', '/bad\\path'],
    ['/source', '/bad\u0000path'],
  ]) {
    assert.throws(() => planVirtualFileSync(before, source, target));
  }
});

test('Git metadata and arbitrary .tet paths are ordinary data for the generic planner', () => {
  const fs = createVirtualFileSystem([
    {path: '/source/.git/config', data: '[core]\n'},
    {path: '/source/.git/objects/ab/cd', data: new Uint8Array([0, 255])},
    {path: '/source/.tet.other/note', data: 'keep this'},
    {path: '/.gitignore', data: '# unchanged\n'},
  ]);
  const result = planVirtualFileSync(fs.snapshot(), '/source', '/archive');
  assert.equal(fileAt(result.snapshot, '/archive/.git/config').data, '[core]\n');
  assert.deepEqual(fileAt(result.snapshot, '/archive/.git/objects/ab/cd').data, new Uint8Array([0, 255]));
  assert.equal(fileAt(result.snapshot, '/archive/.tet.other/note').data, 'keep this');
  assert.equal(fileAt(result.snapshot, '/.gitignore').data, '# unchanged\n');
  assert.equal(result.snapshot.files.some(file => file.path.startsWith('/.tet.ss/')), false);
});

test('root sync can explicitly exclude its destination subtree and remain idempotent without nested copies', () => {
  const fs = setup();
  fs.writeText('/.tet.ss/stale.txt', 'old snapshot');
  const first = planVirtualFileSync(fs.snapshot(), '/', '/.tet.ss', {exclude: ['/.tet.ss']});
  assert.equal(fileAt(first.snapshot, '/.tet.ss/source/code.js').data, 'current code');
  assert.equal(fileAt(first.snapshot, '/.tet.ss/stale.txt'), undefined);
  assert.equal(first.snapshot.files.some(file => file.path.startsWith('/.tet.ss/.tet.ss/')), false);
  assert(first.snapshot.directories.includes('/.tet.ss/source/empty'));
  const second = planVirtualFileSync(first.snapshot, '/', '/.tet.ss', {exclude: ['/.tet.ss']});
  assert.equal(second.changed, false);
  assert.deepEqual(ordered(second.snapshot), ordered(first.snapshot));
});

test('source-only exclusions prune their mapped destination entries while preserving excluded source data', () => {
  const fs = setup();
  fs.writeText('/source/.git/config', 'private source metadata');
  fs.writeText('/archive/.git/config', 'stale mirrored metadata');
  const result = planVirtualFileSync(fs.snapshot(), '/source', '/archive', {exclude: ['/source/.git']});
  assert.equal(fileAt(result.snapshot, '/source/.git/config').data, 'private source metadata');
  assert.equal(fileAt(result.snapshot, '/archive/.git/config'), undefined);
  assert.equal(fileAt(result.snapshot, '/archive/code.js').data, 'current code');
  assert.throws(() => planVirtualFileSync(fs.snapshot(), '/source', '/archive', {exclude: ['/source']}));
});

test('public sync defaults to the saved-state root and returns an asynchronous mapped-path result', async () => {
  const fs = setup();
  const pending = fs.sync('/source/code.js');
  assert.equal(typeof pending.then, 'function');
  assert.deepEqual(await pending, {
    sourcePath: '/source/code.js',
    destinationPath: '/.tet.ss/source/code.js',
    changed: true,
  });
  assert.equal(fs.get('/.tet.ss/source/code.js').data, 'current code');
  assert.equal(fs.get('/source/code.js').data, 'current code');
  assert.equal(fs.has('/.gitignore'), false);
  const revisions = fs.checkpoint().revisions;
  let notifications = 0;
  fs.onDidChange(() => notifications++);
  assert.equal((await fs.sync('/source/code.js')).changed, false);
  assert.deepEqual(fs.checkpoint().revisions, revisions);
  assert.equal(notifications, 0);
});

test('public sync accepts a custom root and mirrors the selected folder below that root', async () => {
  const fs = setup();
  fs.writeText('/backup/source/stale', 'remove this');
  fs.writeText('/backup/unrelated', 'keep this');
  const sourceRevision = fs.getRevision('/source/code.js');
  let notifications = 0;
  fs.onDidChange(() => notifications++);
  const result = await fs.sync('/source', {syncRoot: '/backup'});
  assert.deepEqual(result, {sourcePath: '/source', destinationPath: '/backup/source', changed: true});
  assert.equal(fs.has('/backup/source/stale'), false);
  assert.equal(fs.get('/backup/source/code.js').data, 'current code');
  assert.deepEqual(fs.get('/backup/source/nested/sound.bin').data, new Uint8Array([0, 128, 255]));
  assert.equal(fs.stat('/backup/source/empty').type, 'directory');
  assert.equal(fs.get('/backup/unrelated').data, 'keep this');
  assert.equal(fs.getRevision('/source/code.js'), sourceRevision);
  assert.equal(notifications, 1);

  fs.writeText('/source/renamed.js', fs.get('/source/code.js').data);
  fs.delete('/source/code.js');
  fs.remove('/source/nested', {recursive: true});
  notifications = 0;
  assert.equal((await fs.sync('/source', {syncRoot: '/backup'})).changed, true);
  assert.equal(fs.has('/backup/source/code.js'), false);
  assert.equal(fs.has('/backup/source/nested/sound.bin'), false);
  assert.equal(fs.get('/backup/source/renamed.js').data, 'current code');
  assert.equal(fs.stat('/backup/source/empty').type, 'directory');
  assert.equal(fs.get('/backup/unrelated').data, 'keep this');
  assert.equal(notifications, 1);
  assert.equal((await fs.sync('/source', {syncRoot: '/backup'})).changed, false);

  fs.writeText('/source/kind', 'a file');
  await fs.sync('/source', {syncRoot: '/backup'});
  fs.delete('/source/kind');
  fs.writeText('/source/kind/child', 'now a folder');
  const beforeConflict = fs.snapshot(), beforeRevisions = fs.checkpoint().revisions;
  notifications = 0;
  await assert.rejects(fs.sync('/source', {syncRoot: '/backup'}));
  assert.deepEqual(fs.snapshot(), beforeConflict);
  assert.deepEqual(fs.checkpoint().revisions, beforeRevisions);
  assert.equal(notifications, 0);
});

test('public root sync omits its own destination and remains stable on repeated calls', async () => {
  const fs = setup();
  fs.writeText('/.git/config', 'Git is ordinary synced data');
  const first = await fs.sync('/');
  assert.deepEqual(first, {sourcePath: '/', destinationPath: '/.tet.ss', changed: true});
  assert.equal(fs.get('/.tet.ss/.git/config').data, 'Git is ordinary synced data');
  assert.equal(fs.get('/.tet.ss/source/code.js').data, 'current code');
  assert.equal(fs.list().some(file => file.path.startsWith('/.tet.ss/.tet.ss/')), false);
  assert.equal((await fs.sync('/')).changed, false);
});

test('public sync is an exact transaction independent of automatic checkpoints and hidden-data policies', async () => {
  const fs = createVirtualFileSystem([
    {path: '/source', data: 'new'},
    {path: '/backup/source', data: 'old'},
    {path: '/.git/config', data: 'Git content'},
    {path: '/.tet.other/file', data: 'ordinary hidden content'},
    {path: '/.tet.ss/one', data: 'existing checkpoint data'},
  ], {autoCheckpoint: true});
  await fs.sync('/source', {syncRoot: '/backup'});
  assert.equal(fs.get('/backup/source').data, 'new');
  assert.equal(fs.has('/.tet.ss/backup/source'), false);
  assert.equal(fs.has('/.gitignore'), false);
  await fs.sync('/.git/config', {syncRoot: '/backup'});
  await fs.sync('/.tet.other/file', {syncRoot: '/backup'});
  await fs.sync('/.tet.ss/one', {syncRoot: '/backup'});
  assert.equal(fs.get('/backup/.git/config').data, 'Git content');
  assert.equal(fs.get('/backup/.tet.other/file').data, 'ordinary hidden content');
  assert.equal(fs.get('/backup/.tet.ss/one').data, 'existing checkpoint data');
  await assert.rejects(fs.sync('/.tet.ss/one'));
  assert.equal(fs.has('/.tet.ss/.tet.ss/one'), false);
});

test('public sync rejects positional destinations, unsupported schemes, missing sources and collisions atomically', async () => {
  const fs = setup();
  fs.writeText('/blocked', 'parent file');
  const before = fs.snapshot(), revisions = fs.checkpoint().revisions;
  let notifications = 0;
  fs.onDidChange(() => notifications++);
  for (const call of [
    () => fs.sync('/source', '/backup'),
    () => fs.sync('/source', {syncRoot: 'app-storage://~/'}),
    () => fs.sync('app-storage://~/source', {syncRoot: '/backup'}),
    () => fs.sync('/missing'),
    () => fs.sync('/source', {syncRoot: '/blocked'}),
  ]) {
    await assert.rejects(call);
    assert.deepEqual(fs.snapshot(), before);
    assert.deepEqual(fs.checkpoint().revisions, revisions);
  }
  assert.equal(notifications, 0);
});
