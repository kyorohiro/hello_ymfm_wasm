import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {createVirtualFileSystem, normalizeVirtualPath, transferVirtualFiles, isCheckpointVirtualPath} from './playground_virtual_files.js';

async function createModelFixture() {
  const source = await readFile(new URL('./playground_monaco.js', import.meta.url), 'utf8');
  const models = new Map();
  function model(path, value, language = 'javascript') {
    const entry = {
      uri: { scheme: 'file', path }, language,
      getValue: () => value, setValue: text => { value = text; },
      getLanguageId: () => entry.language, dispose: () => models.delete(path),
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
        createModel: (text, language, uri) => model(uri.path, text, language),
        setModelLanguage: (entry, language) => { entry.language = language; },
      },
    },
  });
  vm.runInContext(source.slice(source.indexOf('    function getModelForVirtualPath'), source.indexOf('    syncVirtualFiles(options.')), context);
  return {context, models, active, model};
}

test('virtual model sync registers renamed modules and removes stale paths without overwriting active edits', async () => {
  const {context,models,active} = await createModelFixture();
  context.syncVirtualFiles([
    { path: '/index.js', type: 'text', data: 'saved text' },
    { path: '/lib/x.js', type: 'text', data: 'export const hello = 1;' },
  ]);
  assert.equal(models.has('/project/lib/old.js'), false);
  assert.equal(models.get('/project/lib/x.js').getValue(), 'export const hello = 1;');
  assert.equal(active.getValue(), 'unsaved editor text');
  assert.ok(models.has('/outside/global.js'));
});

test('large preset imports keep script models available without creating unopened JSON models', async () => {
  const {context,models,active} = await createModelFixture();
  const files = [
    {path:'/index.js', type:'text', data:'import {note} from "./lib/note.js";'},
    {path:'/lib/note.js', type:'text', data:'export const note = "C4";'},
    {path:'/lib/UPPER.JS', type:'text', data:'export const level = 1;'},
    ...Array.from({length:500}, (_, index) => ({
      path:`/presets/song/voice-${index}.opna.json`, type:'text', data:JSON.stringify({name:`Voice ${index}`}),
    })),
    {path:'/notes.md', type:'text', data:'# Notes'},
    {path:'/audio.js', type:'binary', data:new Uint8Array([0])},
  ];
  for (let iteration=0; iteration<3; iteration++) context.syncVirtualFiles(files);
  assert.deepEqual([...models.keys()].sort(),[
    '/outside/global.js', '/project/index.js', '/project/lib/UPPER.JS', '/project/lib/note.js',
  ]);
  assert.equal(active.getValue(),'unsaved editor text');
  assert.equal(models.get('/project/lib/note.js').getValue(),'export const note = "C4";');
});

test('opening JSON creates one editable model and releases it when another file is selected', async () => {
  const {context,models,active} = await createModelFixture();
  const index = {path:'/index.js', type:'text', data:'saved script'};
  const presets = Array.from({length:250}, (_, number) => ({
    path:`/presets/voice-${number}.json`, type:'text', data:JSON.stringify({number}),
  }));
  const files = [index,...presets];
  context.syncVirtualFiles(files);
  for (const preset of presets) {
    const opened = context.getModelForVirtualPath(preset.path,preset.data);
    context.currentModel = opened;
    context.syncVirtualFiles(files);
    assert.equal(opened.getLanguageId(),'json');
    assert.equal(opened.getValue(),preset.data);
    assert.equal([...models.keys()].filter(path => path.endsWith('.json')).length,1);
  }
  const selected = presets.at(-1), opened = context.currentModel;
  opened.setValue('{"edited":true}');
  context.syncVirtualFiles(files);
  assert.equal(opened.getValue(),'{"edited":true}','sync preserves edits in the attached JSON model');
  selected.data = opened.getValue();
  context.currentModel = active;
  context.syncVirtualFiles(files);
  assert.equal([...models.keys()].filter(path => path.endsWith('.json')).length,0);
  const reopened = context.getModelForVirtualPath(selected.path,selected.data);
  assert.equal(reopened.getValue(),'{"edited":true}','the project source restores the edited JSON on reopening');
});

test('attached text survives removal until switching, with the correct text language on opening', async () => {
  const {context,models,active} = await createModelFixture();
  for (const [path,language] of [['/voice.JSON','json'],['/notes.md','plaintext']]) {
    const opened = context.getModelForVirtualPath(path,'editable text');
    assert.equal(opened.getLanguageId(),language);
    context.currentModel = opened;
    context.syncVirtualFiles([{path:'/index.js', type:'text', data:'saved script'}]);
    assert.equal(models.get('/project'+path),opened);
    context.currentModel = active;
    context.syncVirtualFiles([{path:'/index.js', type:'text', data:'saved script'}]);
    assert.equal(models.has('/project'+path),false);
  }
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
