import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVirtualFileSystem,
  transferVirtualFiles,
  applyTextPatch,
  undoFileChanges,
  createShell,
} from '../src/index.js';
import {createVirtualGit} from '../src/git.js';
import {
  createPlaygroundCassetteZip,
  loadPlaygroundCassette,
} from '../../../docs/playground/playground_cassette.js';

const ROOT = '/.tet.ss';
const savedPath = path => ROOT + path;
const setup = options => createVirtualFileSystem([
  {path: '/index.js', data: 'A'},
  {path: '/presets/bass.bin', data: new Uint8Array([0, 128, 255])},
], options);
const content = file => file && ({type: file.type, data: file.data});
const revisions = fs => Object.fromEntries(fs.list().map(file => [file.path, file.revision]));
const orderedSnapshot = snapshot => ({...snapshot, files: [...snapshot.files].sort((a, b) => a.path.localeCompare(b.path))});

test('auto checkpoint defaults off and can be enabled without changing an existing checkpoint', () => {
  const fs = setup();
  assert.equal(fs.checkpoints.auto, false);
  fs.writeText('/index.js', 'B');
  assert.equal(fs.checkpoints.has('/index.js'), false);
  assert.equal(fs.checkpoints.isModified('/index.js'), false);
  fs.checkpoints.setAuto(true);
  assert.equal(fs.checkpoints.auto, true);
  fs.writeText('/index.js', 'C');
  assert.equal(fs.checkpoints.get('/index.js').data, 'B');
  fs.checkpoints.setAuto(false);
  fs.writeText('/index.js', 'D');
  assert.equal(fs.checkpoints.get('/index.js').data, 'B');
  assert.equal(fs.checkpoints.isModified('/index.js'), true);
});

test('auto checkpoint configuration rejects ambiguous values without changing the existing setting', () => {
  for (const autoCheckpoint of [0, 1, 'on', null]) {
    assert.throws(() => setup({autoCheckpoint}), /boolean/);
  }
  const fs = setup({autoCheckpoint: true}), before = fs.snapshot();
  for (const enabled of [0, 1, 'off', undefined]) {
    assert.throws(() => fs.checkpoints.setAuto(enabled), /boolean/);
    assert.equal(fs.checkpoints.auto, true);
    assert.deepEqual(fs.snapshot(), before);
  }
});

test('the first real edit captures the previous contents, later edits preserve it, and only Set advances it', () => {
  const fs = setup({autoCheckpoint: true});
  fs.writeText('/index.js', 'A');
  assert.equal(fs.checkpoints.has('/index.js'), false);
  fs.writeText('/index.js', 'B');
  assert.equal(fs.checkpoints.get('/index.js').data, 'A');
  fs.writeText('/index.js', 'C');
  assert.equal(fs.checkpoints.get('/index.js').data, 'A');
  fs.checkpoints.set('/index.js');
  assert.equal(fs.checkpoints.get('/index.js').data, 'C');
  assert.equal(fs.checkpoints.isModified('/index.js'), false);
  fs.writeText('/index.js', 'D');
  fs.checkpoints.revert('/index.js');
  assert.equal(fs.get('/index.js').data, 'C');
  assert.equal(fs.checkpoints.get('/index.js').data, 'C');
  assert.equal(fs.checkpoints.isModified('/index.js'), false);
  fs.writeText('/index.js', 'E');
  assert.equal(fs.checkpoints.get('/index.js').data, 'C');
});

test('new files are not backed up until their first edit, including empty text and empty binary', () => {
  const fs = createVirtualFileSystem([], {autoCheckpoint: true});
  fs.writeText('/new.txt', '');
  fs.writeBinary('/empty.bin', new Uint8Array());
  assert.equal(fs.checkpoints.has('/new.txt'), false);
  assert.equal(fs.checkpoints.has('/empty.bin'), false);
  fs.writeText('/new.txt', '');
  fs.writeBinary('/empty.bin', new Uint8Array());
  assert.equal(fs.checkpoints.has('/new.txt'), false);
  assert.equal(fs.checkpoints.has('/empty.bin'), false);
  fs.writeText('/new.txt', 'first edit');
  fs.writeBinary('/empty.bin', new Uint8Array([1]));
  assert.deepEqual(content(fs.checkpoints.get('/new.txt')), {type: 'text', data: ''});
  assert.deepEqual(content(fs.checkpoints.get('/empty.bin')), {type: 'binary', data: new Uint8Array()});
});

test('manual checkpoints work with auto off and reads never expose mutable backing bytes', () => {
  const fs = setup();
  fs.checkpoints.set('/presets/bass.bin');
  const first = fs.checkpoints.get('/presets/bass.bin');
  assert.equal(first.path, savedPath('/presets/bass.bin'));
  first.data[0] = 17;
  assert.deepEqual(fs.checkpoints.get('/presets/bass.bin').data, new Uint8Array([0, 128, 255]));
  fs.writeBinary('/presets/bass.bin', new Uint8Array([4]));
  fs.checkpoints.revert('/presets/bass.bin');
  const current = fs.get('/presets/bass.bin');
  current.data[1] = 0;
  assert.deepEqual(fs.get('/presets/bass.bin').data, new Uint8Array([0, 128, 255]));
  assert.deepEqual(fs.checkpoints.get('/presets/bass.bin').data, new Uint8Array([0, 128, 255]));
});

test('binary input copies and text/binary transitions retain the exact prior representation', () => {
  const bytes = new Uint8Array([0, 127, 255]);
  const fs = createVirtualFileSystem([{path: '/kind', data: bytes}], {autoCheckpoint: true});
  bytes[0] = 9;
  fs.writeText('/kind', '\u0000\u007f\u00ff');
  assert.deepEqual(content(fs.checkpoints.get('/kind')), {type: 'binary', data: new Uint8Array([0, 127, 255])});
  fs.checkpoints.revert('/kind');
  assert.equal(fs.get('/kind').type, 'binary');
  fs.writeText('/text', '');
  fs.writeBinary('/text', new ArrayBuffer(0));
  assert.deepEqual(content(fs.checkpoints.get('/text')), {type: 'text', data: ''});
  assert.equal(fs.checkpoints.isModified('/text'), true);
});

test('invalid paths and directories cannot be treated as editable file checkpoints', () => {
  const fs = setup({autoCheckpoint: true});
  fs.mkdir('/empty');
  for (const path of ['/', '/empty', '/presets', '/.git', '/.git/HEAD', ROOT, ROOT + '/index.js']) {
    const before = fs.snapshot();
    for (const operation of ['set', 'revert', 'get', 'has', 'isModified']) {
      assert.throws(() => fs.checkpoints[operation](path), `${operation} should reject ${path}`);
      assert.deepEqual(fs.snapshot(), before);
    }
  }
  assert.equal(fs.checkpoints.get('/missing'), null);
  assert.equal(fs.checkpoints.has('/missing'), false);
  assert.throws(() => fs.checkpoints.set('/missing'));
  assert.throws(() => fs.checkpoints.revert('/index.js'));
});

test('checkpoint destination collisions fail before current content or revisions change', () => {
  for (const blocker of [ROOT, savedPath('/index.js') + '/child']) {
    const fs = createVirtualFileSystem([
      {path: '/index.js', data: 'A'},
      {path: blocker, data: 'blocks checkpoint'},
    ], {autoCheckpoint: true});
    const before = fs.snapshot(), beforeRevisions = revisions(fs);
    for (const change of [() => fs.writeText('/index.js', 'B'), () => fs.checkpoints.set('/index.js')]) {
      assert.throws(change);
      assert.deepEqual(fs.snapshot(), before);
      assert.deepEqual(revisions(fs), beforeRevisions);
    }
  }
});

test('stale writes, Set and Revert cannot partially change current or checkpoints', () => {
  const fs = setup({autoCheckpoint: true});
  const oldRevision = fs.getRevision('/index.js');
  fs.writeText('/index.js', 'B', {expectedRevision: oldRevision});
  const before = fs.snapshot(), beforeRevisions = revisions(fs);
  for (const change of [
    () => fs.writeText('/index.js', 'C', {expectedRevision: oldRevision}),
    () => fs.checkpoints.set('/index.js', {expectedRevision: oldRevision}),
    () => fs.checkpoints.revert('/index.js', {expectedRevision: oldRevision}),
    () => fs.writeFile('/index.js', undefined),
  ]) {
    assert.throws(change);
    assert.deepEqual(fs.snapshot(), before);
    assert.deepEqual(revisions(fs), beforeRevisions);
  }
  const currentRevision = fs.getRevision('/index.js');
  fs.checkpoints.revert('/index.js', {expectedRevision: currentRevision});
  assert.equal(fs.get('/index.js').data, 'A');
  assert(fs.getRevision('/index.js') > currentRevision);
});

test('replace and restore stay exact, while explicitly marked bulk edits capture changes', () => {
  const fs = setup({autoCheckpoint: true});
  const initial = fs.snapshot();
  fs.replace([{path: '/index.js', data: 'Imported'}]);
  assert.equal(fs.checkpoints.has('/index.js'), false);
  assert.equal(fs.has('/presets/bass.bin'), false);
  fs.restore(initial);
  assert.deepEqual(fs.snapshot(), initial);
  fs.replace([
    {path: '/index.js', data: 'B'},
    {path: '/new.txt', data: 'new'},
  ], ['/empty'], {checkpointChanges: true});
  assert.equal(fs.checkpoints.get('/index.js').data, 'A');
  assert.equal(fs.checkpoints.has('/new.txt'), false);
  assert.equal(fs.has('/presets/bass.bin'), false);
  assert.equal(fs.stat('/empty').type, 'directory');
  const before = fs.snapshot();
  assert.throws(() => fs.replace([
    {path: '/index.js', data: 'C'},
    {path: '/bad', data: 'parent'},
    {path: '/bad/child', data: 'conflict'},
  ], [], {checkpointChanges: true}));
  assert.deepEqual(fs.snapshot(), before);
});

test('bulk deletion removes paired checkpoints even when automatic capture is off', () => {
  const fs = setup({autoCheckpoint: true});
  fs.writeText('/index.js', 'B');
  fs.checkpoints.setAuto(false);
  const entries = fs.list().filter(file => file.path !== '/index.js');
  fs.replace(entries, fs.listDirectories(), {checkpointChanges: true});
  assert.equal(fs.has('/index.js'), false);
  assert.equal(fs.has(savedPath('/index.js')), false);
  assert.deepEqual(fs.get('/presets/bass.bin').data, new Uint8Array([0, 128, 255]));
});

test('bulk editing retains the existing checkpoint of surviving files even if callers submit only current files', () => {
  const fs = setup({autoCheckpoint: true});
  fs.writeText('/index.js', 'B');
  for (const auto of [true, false]) {
    fs.checkpoints.setAuto(auto);
    fs.replace([{path: '/index.js', data: 'C'}], [], {checkpointChanges: true});
    assert.equal(fs.get('/index.js').data, 'C');
    assert.equal(fs.checkpoints.get('/index.js').data, 'A');
  }
  fs.replace([{path: '/index.js', data: 'Import'}]);
  assert.equal(fs.checkpoints.has('/index.js'), false);
});

test('a later checkpoint collision prevents every file in a bulk edit from changing', () => {
  const fs = createVirtualFileSystem([
    {path: '/first', data: 'A'},
    {path: '/second', data: 'B'},
    {path: savedPath('/second') + '/blocked', data: 'a directory occupies the checkpoint'},
  ], {autoCheckpoint: true});
  const before = fs.snapshot(), beforeRevisions = revisions(fs);
  const entries = fs.list().map(file => file.path === '/first' || file.path === '/second' ? {...file, data: 'changed'} : file);
  assert.throws(() => fs.replace(entries, fs.listDirectories(), {checkpointChanges: true}));
  assert.deepEqual(fs.snapshot(), before);
  assert.deepEqual(revisions(fs), beforeRevisions);
  assert.equal(fs.has(savedPath('/first')), false);
});

test('snapshots contain both states but do not serialize the auto-checkpoint setting', () => {
  const fs = setup({autoCheckpoint: true});
  fs.writeText('/index.js', 'B');
  const snapshot = fs.snapshot();
  assert.equal(snapshot.files.find(file => file.path === '/index.js').data, 'B');
  assert.equal(snapshot.files.find(file => file.path === savedPath('/index.js')).data, 'A');
  assert.equal(Object.hasOwn(snapshot, 'autoCheckpoint'), false);
  const restored = createVirtualFileSystem();
  restored.restore(snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);
  assert.equal(restored.checkpoints.auto, false);
  assert.equal(restored.checkpoints.get('/index.js').data, 'A');
  restored.checkpoints.revert('/index.js');
  assert.equal(restored.get('/index.js').data, 'A');
  fs.restore(initialSnapshot());
  assert.equal(fs.checkpoints.auto, true);
  assert.equal(fs.checkpoints.has('/index.js'), false);
  function initialSnapshot() {return {version: 1, files: [{path: '/index.js', type: 'text', data: 'Imported'}], directories: ['/']};}
});

test('file and folder transfers carry checkpoints together, retain empty directories, and copy independently', () => {
  const fs = setup({autoCheckpoint: true});
  fs.mkdir('/presets/empty');
  fs.writeBinary('/presets/bass.bin', new Uint8Array([1]));
  transferVirtualFiles(fs, '/presets', '/renamed');
  assert.equal(fs.has('/presets/bass.bin'), false);
  assert.equal(fs.has(savedPath('/presets/bass.bin')), false);
  assert.deepEqual(fs.checkpoints.get('/renamed/bass.bin').data, new Uint8Array([0, 128, 255]));
  assert.equal(fs.stat('/renamed/empty').type, 'directory');
  transferVirtualFiles(fs, '/renamed', '/copy', {copy: true});
  assert.equal(fs.stat('/copy/empty').type, 'directory');
  fs.checkpoints.set('/copy/bass.bin');
  assert.deepEqual(fs.checkpoints.get('/copy/bass.bin').data, new Uint8Array([1]));
  assert.deepEqual(fs.checkpoints.get('/renamed/bass.bin').data, new Uint8Array([0, 128, 255]));
  transferVirtualFiles(fs, '/copy/bass.bin', '/copy/lead.bin');
  assert.equal(fs.has(savedPath('/copy/bass.bin')), false);
  assert.deepEqual(fs.checkpoints.get('/copy/lead.bin').data, new Uint8Array([1]));
});

test('a checkpoint-only transfer collision cannot overwrite history or move part of a folder', () => {
  const fs = createVirtualFileSystem([
    {path: '/source/a', data: 'A'},
    {path: '/source/b', data: 'B'},
    {path: savedPath('/target/a'), data: 'orphan retained by imported snapshot'},
  ], {autoCheckpoint: true});
  fs.writeText('/source/a', 'edited A');
  const before = fs.snapshot(), beforeRevisions = revisions(fs);
  for (const copy of [true, false]) {
    assert.throws(() => transferVirtualFiles(fs, '/source', '/target', {copy}));
    assert.deepEqual(fs.snapshot(), before);
    assert.deepEqual(revisions(fs), beforeRevisions);
  }
});

test('deleting files or folders deletes their paired checkpoints without retaining deletion history', () => {
  const fs = setup({autoCheckpoint: true});
  fs.writeText('/index.js', 'B');
  fs.writeBinary('/presets/bass.bin', new Uint8Array([7]));
  assert.equal(fs.delete('/index.js'), true);
  assert.equal(fs.has(savedPath('/index.js')), false);
  fs.remove('/presets', {recursive: true});
  assert.equal(fs.has(savedPath('/presets/bass.bin')), false);
  assert.equal(fs.has('/presets/bass.bin'), false);
  fs.writeText('/index.js', 'new incarnation');
  assert.equal(fs.checkpoints.has('/index.js'), false);
});

test('automatic ignore rules preserve existing text, appear only once, and do not recursively checkpoint metadata', () => {
  const fs = createVirtualFileSystem([
    {path: '/index.js', data: 'A'},
    {path: '/.gitignore', data: '# user rules\n*.tmp'},
    {path: '/.git/config', data: 'initial config'},
  ], {autoCheckpoint: true});
  fs.writeText('/index.js', 'B');
  const ignore = fs.get('/.gitignore').data;
  assert.match(ignore, /^# user rules\n\*\.tmp\n/);
  assert.equal(ignore.split('\n').filter(line => line === '/.tet.ss/').length, 1);
  fs.checkpoints.set('/index.js');
  fs.writeText('/.git/config', 'changed config');
  fs.writeText(savedPath('/index.js'), 'direct imported checkpoint bytes');
  assert.equal(fs.has(savedPath('/.git/config')), false);
  assert.equal(fs.has(savedPath('/.gitignore')), false);
  assert.equal(fs.has(ROOT + ROOT + '/index.js'), false);
  assert.equal(fs.get('/.gitignore').data, ignore);
});

test('checkpoint creation refuses an invalid or directory gitignore atomically instead of replacing user data', () => {
  for (const blocker of [
    {path: '/.gitignore/child', data: 'directory contents'},
    {path: '/.gitignore', data: new Uint8Array([255, 254, 253])},
  ]) {
    const fs = createVirtualFileSystem([{path: '/index.js', data: 'A'}, blocker], {autoCheckpoint: true});
    const before = fs.snapshot(), beforeRevisions = revisions(fs);
    for (const change of [() => fs.writeText('/index.js', 'B'), () => fs.checkpoints.set('/index.js')]) {
      assert.throws(change);
      assert.deepEqual(fs.snapshot(), before);
      assert.deepEqual(revisions(fs), beforeRevisions);
    }
  }
});

test('Set and Revert on gitignore retain the reserved rule without immediately marking it modified', () => {
  const fs = createVirtualFileSystem([{path: '/.gitignore', data: '*.tmp'}], {autoCheckpoint: true});
  fs.checkpoints.set('/.gitignore');
  assert.equal(fs.checkpoints.isModified('/.gitignore'), false);
  fs.writeText('/.gitignore', '*.log\n');
  assert.equal(fs.checkpoints.isModified('/.gitignore'), true);
  fs.checkpoints.revert('/.gitignore');
  assert.match(fs.get('/.gitignore').data, /\*\.tmp/);
  assert.match(fs.get('/.gitignore').data, /^\/\.tet\.ss\/$/m);
  assert.equal(fs.checkpoints.isModified('/.gitignore'), false);
});

test('patch and shell redirection use the same automatic checkpoint policy', async () => {
  const fs = setup({autoCheckpoint: true});
  const patch = [{path: '/index.js', oldText: 'A', newText: 'B'}];
  applyTextPatch(fs, patch, {dryRun: true});
  assert.equal(fs.checkpoints.has('/index.js'), false);
  applyTextPatch(fs, patch);
  assert.equal(fs.checkpoints.get('/index.js').data, 'A');
  const shell = createShell({fs});
  const result = await shell.execute('echo C > /index.js');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.get('/index.js').data, 'C\n');
  assert.equal(fs.checkpoints.get('/index.js').data, 'A');
  const fresh = setup({autoCheckpoint: true}), freshShell = createShell({fs: fresh});
  const redirected = await freshShell.execute('echo B > /index.js');
  assert.equal(redirected.code, 0, redirected.stderr);
  assert.equal(fresh.checkpoints.get('/index.js').data, 'A');
});

test('legacy transactional Undo remains distinct and restores both current and checkpoint files atomically', () => {
  const fs = setup({autoCheckpoint: true}), before = fs.checkpoint();
  fs.writeText('/index.js', 'B');
  const after = fs.checkpoint();
  assert.equal(fs.checkpoints.get('/index.js').data, 'A');
  const undo = undoFileChanges(fs, before, after);
  assert.equal(undo.applied, true);
  assert.deepEqual(orderedSnapshot(fs.snapshot()), orderedSnapshot(before.snapshot));
  assert.equal(fs.checkpoints.auto, true);
  assert.equal(fs.checkpoints.has('/index.js'), false);
});

test('Git status and stage exclude checkpoints even when ignore rules are missing, while current remains tracked', async () => {
  const fs = setup({autoCheckpoint: true});
  fs.writeText('/index.js', 'B');
  fs.delete('/.gitignore'); // Imported/old projects must also remain protected.
  const repo = createVirtualGit({fs});
  await repo.execute('init');
  const initial = await repo.execute('status');
  assert(initial.files.some(file => file.path === 'index.js'));
  assert(initial.files.every(file => !file.path.startsWith('.tet.ss/')));
  await assert.rejects(repo.execute('stage', {paths: [savedPath('/index.js')]}));
  await repo.execute('stage', {paths: ['/']});
  assert.doesNotMatch((await repo.execute('diff', {staged: true})).text, /\.tet\.ss/);
  await repo.execute('commit', {message: 'Current work', name: 'Test', email: 'test@example.com'});
  assert.equal((await repo.execute('status')).files.length, 0);
  assert.equal(fs.checkpoints.get('/index.js').data, 'A');
  assert.equal(fs.has(ROOT + '/.git/HEAD'), false);
  fs.writeText('/index.js', 'C');
  const state = await repo.execute('status');
  assert(state.files.some(file => file.path === 'index.js' && file.worktree));
  assert.equal(fs.checkpoints.get('/index.js').data, 'A');
});

test('Cassette exports current and checkpoints together without updating either saved content', async () => {
  const fs = setup({autoCheckpoint: true});
  fs.writeText('/index.js', 'B');
  fs.writeBinary('/presets/bass.bin', new Uint8Array([7, 8]));
  const before = fs.snapshot();
  const cassette = await loadPlaygroundCassette(createPlaygroundCassetteZip(fs.list(), {
    directories: fs.listDirectories(),
  }));
  assert.deepEqual(fs.snapshot(), before);
  assert.equal(new TextDecoder().decode(cassette.files.get('index.js')), 'B');
  assert.equal(new TextDecoder().decode(cassette.files.get('.tet.ss/index.js')), 'A');
  assert.deepEqual(cassette.files.get('presets/bass.bin'), new Uint8Array([7, 8]));
  assert.deepEqual(cassette.files.get('.tet.ss/presets/bass.bin'), new Uint8Array([0, 128, 255]));
  const restored = createVirtualFileSystem([], {autoCheckpoint: true});
  restored.replace([...cassette.files].map(([path, data]) => ({path: '/' + path, data})), cassette.directories);
  assert.deepEqual(restored.checkpoints.get('/presets/bass.bin').data, new Uint8Array([0, 128, 255]));
  restored.checkpoints.revert('/presets/bass.bin');
  assert.deepEqual(restored.get('/presets/bass.bin').data, new Uint8Array([0, 128, 255]));
  assert.equal(restored.has(ROOT + ROOT + '/presets/bass.bin'), false);
});
