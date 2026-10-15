import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {createVirtualFileSystem, normalizeVirtualPath, transferVirtualFiles, isCheckpointVirtualPath} from './playground_virtual_files.js';

test('virtual model sync registers renamed modules and removes stale paths without overwriting active edits', async () => {
  const source = await readFile(new URL('./playground_monaco.js', import.meta.url), 'utf8');
  const models = new Map();
  function model(path, value) {
    const entry = {
      uri: { scheme: 'file', path },
      getValue: () => value, setValue: text => { value = text; },
      getLanguageId: () => 'javascript', dispose: () => models.delete(path),
    };
    models.set(path, entry);
    return entry;
  }
  const active = model('/project/index.js', 'unsaved editor text');
  model('/project/lib/old.js', 'export const hello = 1;');
  model('/outside/global.js', 'external');
  const context = vm.createContext({
    currentModel: active,
    monaco: {
      Uri: { parse: uri => ({ path: uri.slice('file://'.length) }) },
      editor: {
        getModel: uri => models.get(uri.path), getModels: () => [...models.values()],
        createModel: (text, language, uri) => model(uri.path, text),
      },
    },
  });
  vm.runInContext(source.slice(source.indexOf('    function getModelForVirtualPath'), source.indexOf('    syncVirtualFiles(options.')), context);
  context.syncVirtualFiles([
    { path: '/index.js', type: 'text', data: 'saved text' },
    { path: '/lib/x.js', type: 'text', data: 'export const hello = 1;' },
  ]);
  assert.equal(models.has('/project/lib/old.js'), false);
  assert.equal(models.get('/project/lib/x.js').getValue(), 'export const hello = 1;');
  assert.equal(active.getValue(), 'unsaved editor text');
  assert.ok(models.has('/outside/global.js'));
});

test('rename opens the new model before synchronizing virtual files', async () => {
  const source = await readFile(new URL('./playground.js', import.meta.url), 'utf8');
  const files = createVirtualFileSystem([
    {path:'/lib/old.js', data:'export const hello = 1;'},
    {path:'/.tet.ss/lib/old.js', data:'previous synced code'},
  ]);
  const events = [];
  const context = vm.createContext({
    activeVirtualPath: '/lib/old.js', runVirtualPath: '/lib/old.js',
    isSystemVirtualPath: () => false, window: { prompt: () => '/lib/x.js' },
    normalizeVirtualPath, transferVirtualFiles, isCheckpointVirtualPath, saveActiveVirtualFile() {},
    virtualFiles: files,
    showVirtualFile: file => events.push(['open', file.path]),
    editorAdapter: { syncVirtualFiles: entries => events.push(['sync', ...entries.map(file => file.path)]) },
    renderVirtualFileExplorer() {}, renderRunFileOptions() {},
    setStatus: message => assert.fail(message),
  });
  vm.runInContext(source.slice(source.indexOf('function renameActiveVirtualFile()'), source.indexOf('function deleteActiveVirtualFile()')), context);
  context.renameActiveVirtualFile();
  assert.deepEqual(events, [['open', '/lib/x.js'], ['sync', '/lib/x.js']]);
  assert.equal(context.runVirtualPath, '/lib/x.js');
  assert.equal(files.get('/.tet.ss/lib/x.js').data, 'previous synced code');
  assert.equal(files.has('/.tet.ss/lib/old.js'), false);
});
