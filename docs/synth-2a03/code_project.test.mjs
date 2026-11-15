import test from 'node:test';
import assert from 'node:assert/strict';
import {createNesCodeProject, createNesProjectStore, readNesProjectSound,
  NES_PROJECT_MANIFEST, NES_PROJECT_FILE_BYTES} from './code_project.js';
import {createDefaultPreset} from './preset.js';

test('NES + FDS project roundtrip preserves settings, DPCM bytes, binary files and separate editor mode', async () => {
  const settings = createDefaultPreset();
  settings.noise.period = 7; settings.dmc.data = [0, 255, 17];
  const project = createNesCodeProject({settings, starterCode:'globalThis.mustNotExecute = true;'});
  const json = JSON.stringify(settings) + '\n';
  project.importFiles([{path:'/presets/Bell.nes.json', data:json},
    {path:'/data/sample.bin', type:'binary', data:Uint8Array.of(0, 255, 17)}]);
  project.select('/presets/Bell.nes.json');
  project.setCodeState({mode:'keyboard', path:'/presets/Bell.nes.json'});
  const snapshot = project.snapshot();
  snapshot.settings.pulse.volume = 15;
  assert.notEqual(project.settings.pulse.volume, 15);
  const copy = createNesCodeProject();
  copy.restore(await copy.prepareImport(project.exportProject()));
  assert.deepEqual(copy.settings, settings);
  assert.deepEqual(copy.getCodeState(), {mode:'keyboard', path:'/presets/Bell.nes.json'});
  assert.equal(copy.fs.get('/presets/Bell.nes.json').data, json);
  assert.deepEqual(copy.fs.get('/data/sample.bin').data, Uint8Array.of(0, 255, 17));
  assert.deepEqual(readNesProjectSound(json), settings);
  assert.equal(globalThis.mustNotExecute, undefined);
});

test('invalid NES + FDS project imports preserve the previous workspace and unfinished JSON stays editable', () => {
  const project = createNesCodeProject({starterCode:'// kept'}), before = project.snapshot();
  assert.throws(() => project.restore({...before, settings:{...before.settings, fds:{}}}));
  assert.deepEqual(project.snapshot(), before);
  assert.throws(() => project.importFiles([{path:NES_PROJECT_MANIFEST, data:'reserved'}]), /reserved/);
  assert.throws(() => project.importFiles([{path:'/huge.bin', type:'binary', data:new Uint8Array(NES_PROJECT_FILE_BYTES)}]), /16 MiB/);
  assert.deepEqual(project.snapshot(), before);
  project.importFiles([{path:'/unfinished.json', data:'{ unfinished'}]);
  project.setCodeState({mode:'code', path:'/unfinished.json'});
  assert.equal(project.fs.get('/unfinished.json').data, '{ unfinished');
  assert.equal(readNesProjectSound('{"ordinary":1}'), null);
});

test('NES + FDS virtual imports and file reads retain local scope and detached sample data', async () => {
  const project = createNesCodeProject({starterCode:'// code'});
  project.importFiles([{path:'/lib/notes.js', data:'export const note=(await file("../data/note.json",{type:"json"})).note;'},
    {path:'/data/note.json', data:'{"note":"E3"}'},
    {path:'/data/raw.bin', type:'binary', data:Uint8Array.of(0, 255)}]);
  const context = {};
  try {
    const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
    await new AsyncFunction('context', project.prepareSource('context.note=(await import("./lib/notes.js")).note;'))(context);
    assert.equal(context.note, 'E3');
    new Uint8Array(await project.readFile('/data/raw.bin', {type:'arrayBuffer'})).fill(0);
    assert.deepEqual(new Uint8Array(await project.readFile('/data/raw.bin', {type:'arrayBuffer'})), Uint8Array.of(0, 255));
  } finally {
    delete globalThis.__tetoricaVirtualFiles;
  }
});

test('NES + FDS local drafts use an isolated namespace and retain typed binary files', async () => {
  const values = new Map([['tetorica-snes-synth-project-v1', 'kept']]);
  const storage = {getItem:key => values.get(key) ?? null, setItem:(key, value) => values.set(key, value)};
  const store = createNesProjectStore({indexedDB:null, storage});
  const project = createNesCodeProject({starterCode:'// saved'});
  project.importFiles([{path:'/sample.bin', type:'binary', data:Uint8Array.of(0, 255)}]);
  await store.write(project.snapshot());
  assert.deepEqual(createNesCodeProject({snapshot:await store.read()}).snapshot(), project.snapshot());
  assert.equal(values.get('tetorica-snes-synth-project-v1'), 'kept');
  await store.close();
});
