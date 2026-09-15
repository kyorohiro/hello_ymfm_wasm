import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { zipSync, unzipSync } from './vendor/fflate.js';
import { createVirtualFileSystem, normalizeVirtualPath } from './playground_virtual_files.js';

const source = readFileSync(new URL('./playground.js', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('async function importDroppedFiles('), source.indexOf('\nfunction installFileExplorerDropTarget'));
function setup(accept = true) {
  const fs = createVirtualFileSystem([{ path: '/presets/README.md', data: 'keep' }]);
  const registered = [], confirmations = [];
  const context = vm.createContext({
    virtualFiles: fs, normalizeVirtualPath, unzipSync, Uint8Array,
    isSystemVirtualPath: path => path.startsWith('/sys/'),
    registerVirtualTfiPreset: path => registered.push(path),
    expandedFileFolders: new Map(), renderVirtualFileExplorer() {}, renderRunFileOptions() {}, setStatus() {},
    window: { confirm: message => { confirmations.push(message); return accept; } },
  });
  vm.runInContext(handler, context);
  return { fs, registered, confirmations, run: context.importDroppedFiles };
}
const file = (name, bytes = new Uint8Array([42])) => ({ name, arrayBuffer: async () => bytes });

test('imports multiple files into the selected folder and ZIP hierarchy beneath it', async () => {
  const { fs, run, registered } = setup();
  await run([file('bass.tfi'), file('lead.tfi')], '/presets');
  assert.deepEqual(registered, ['/presets/bass.tfi', '/presets/lead.tfi']);
  assert.deepEqual(fs.get('/presets/bass.tfi').data, new Uint8Array([42]));
  await run([file('tones.zip', zipSync({ 'song/one.tfi': new Uint8Array([7]) }))], '/presets');
  assert.deepEqual(fs.get('/presets/song/one.tfi').data, new Uint8Array([7]));
  await run([file('root.js')]);
  assert.ok(fs.has('/root.js'));
});

test('declining replacement leaves the whole batch unchanged; accepting replaces', async () => {
  const { fs, run, confirmations } = setup(false);
  await run([file('new.tfi'), file('README.md')], '/presets');
  assert.equal(fs.has('/presets/new.tfi'), false);
  assert.equal(fs.get('/presets/README.md').data, 'keep');
  assert.equal(confirmations.length, 1);
  const accepted = setup();
  await accepted.run([file('README.md')], '/presets');
  assert.deepEqual(accepted.fs.get('/presets/README.md').data, new Uint8Array([42]));
});

test('invalid ZIP paths, reserved destinations and file/folder conflicts do not partially import', async () => {
  for (const [files, directory] of [
    [[file('ok.tfi'), file('bad.zip', zipSync({ '../outside.tfi': new Uint8Array([1]) }))], '/presets'],
    [[file('x.js')], '/sys/examples'],
    [[file('ok.tfi'), file('x.tfi')], '/presets/README.md'],
    [[file('same.tfi'), file('same.tfi')], '/presets'],
  ]) {
    const { fs, run } = setup();
    await assert.rejects(run(files, directory));
    assert.deepEqual(fs.list().map(entry => entry.path), ['/presets/README.md']);
  }
});
