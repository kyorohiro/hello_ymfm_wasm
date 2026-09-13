import test from 'node:test';
import assert from 'node:assert/strict';
import { createVirtualFileSystem, transferVirtualFiles } from './playground_virtual_files.js';

test('folder move retains text and binary contents and returns path mappings', () => {
  const fs = createVirtualFileSystem([
    { path: '/lib/x.js', data: 'export const x = 1;' },
    { path: '/lib/tone.tfi', data: new Uint8Array([1, 2, 3]) },
    { path: '/index.js', data: 'entry' },
  ]);
  const mappings = transferVirtualFiles(fs, '/lib', '/src/lib');
  assert.equal(mappings.length, 2);
  assert.equal(fs.has('/lib/x.js'), false);
  assert.equal(fs.get('/src/lib/x.js').data, 'export const x = 1;');
  assert.deepEqual(fs.get('/src/lib/tone.tfi').data, new Uint8Array([1, 2, 3]));
  transferVirtualFiles(fs, '/src/lib', '/copy', { copy: true });
  assert.ok(fs.has('/src/lib/x.js'));
  assert.ok(fs.has('/copy/x.js'));
});

test('conflicts, recursive moves, reserved paths and entry-point moves leave files intact', () => {
  const fs = createVirtualFileSystem([
    { path: '/lib/a.js', data: 'a' }, { path: '/lib/b.js', data: 'b' },
    { path: '/dst/b.js', data: 'existing' }, { path: '/index.js', data: 'entry' },
  ]);
  const before = fs.list();
  for (const [source, destination] of [
    ['/lib', '/dst'], ['/lib', '/lib/child'], ['/lib', '/sys/lib'],
    ['/index.js', '/entry.js'], ['/lib/a.js', '/index.js/child.js'],
  ]) {
    assert.throws(() => transferVirtualFiles(fs, source, destination));
    assert.deepEqual(fs.list(), before);
  }
  transferVirtualFiles(fs, '/index.js', '/index-copy.js', { copy: true });
  assert.equal(fs.get('/index-copy.js').data, 'entry');
});
