import test from 'node:test';
import assert from 'node:assert/strict';
import {createFm2608CodeProject, createFm2608ProjectStore, readFm2608ProjectSound,
  FM2608_PROJECT_MANIFEST, FM2608_PROJECT_FILE_BYTES} from './code_project.js';
import {createDefaultPreset} from './preset.js';

test('OPNA project roundtrip preserves settings, ADPCM bytes, binary files and separate editor mode', async () => {
  const settings = createDefaultPreset();
  settings.ssg.noisePeriod = 7;
  const project = createFm2608CodeProject({settings, starterCode:'globalThis.mustNotExecute = true;'});
  const json = JSON.stringify(settings) + '\n';
  project.importFiles([{path:'/presets/Bell.opna.json', data:json},
    {path:'/data/sample.bin', type:'binary', data:Uint8Array.of(0, 255, 17)}]);
  project.select('/presets/Bell.opna.json');
  project.setCodeState({mode:'keyboard', path:'/presets/Bell.opna.json'});
  const snapshot = project.snapshot();
  snapshot.settings.fm[0].operators[0].tl = 127;
  assert.notEqual(project.settings.fm[0].operators[0].tl, 127);
  const copy = createFm2608CodeProject();
  copy.restore(await copy.prepareImport(project.exportProject()));
  assert.deepEqual(copy.settings, settings);
  assert.deepEqual(copy.getCodeState(), {mode:'keyboard', path:'/presets/Bell.opna.json'});
  assert.equal(copy.fs.get('/presets/Bell.opna.json').data, json);
  assert.deepEqual(copy.fs.get('/data/sample.bin').data, Uint8Array.of(0, 255, 17));
  assert.deepEqual(readFm2608ProjectSound(json), settings);
  assert.equal(globalThis.mustNotExecute, undefined);
});

test('invalid OPNA project imports preserve the previous workspace and unfinished JSON stays editable', () => {
  const project = createFm2608CodeProject({starterCode:'// kept'}), before = project.snapshot();
  assert.throws(() => project.restore({...before, settings:{...before.settings, fm:[]}}));
  assert.deepEqual(project.snapshot(), before);
  assert.throws(() => project.importFiles([{path:FM2608_PROJECT_MANIFEST, data:'reserved'}]), /reserved/);
  assert.throws(() => project.importFiles([{path:'/huge.bin', type:'binary', data:new Uint8Array(FM2608_PROJECT_FILE_BYTES)}]), /12 MiB/);
  assert.deepEqual(project.snapshot(), before);
  project.importFiles([{path:'/unfinished.json', data:'{ unfinished'}]);
  project.setCodeState({mode:'code', path:'/unfinished.json'});
  assert.equal(project.fs.get('/unfinished.json').data, '{ unfinished');
  assert.equal(readFm2608ProjectSound('{"ordinary":1}'), null);
});

test('OPNA virtual imports and file reads retain local scope and detached sample data', async () => {
  const project = createFm2608CodeProject({starterCode:'// code'});
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

test('OPNA local drafts use an isolated namespace and retain typed binary files', async () => {
  const values = new Map([['tetorica-snes-synth-project-v1', 'kept']]);
  const storage = {getItem:key => values.get(key) ?? null, setItem:(key, value) => values.set(key, value)};
  const store = createFm2608ProjectStore({indexedDB:null, storage});
  const project = createFm2608CodeProject({starterCode:'// saved'});
  project.importFiles([{path:'/sample.bin', type:'binary', data:Uint8Array.of(0, 255)}]);
  await store.write(project.snapshot());
  assert.deepEqual(createFm2608CodeProject({snapshot:await store.read()}).snapshot(), project.snapshot());
  assert.equal(values.get('tetorica-snes-synth-project-v1'), 'kept');
  await store.close();
});


test('PC-98 New Cassette preparation uses original starter and defaults without mutating the existing project',()=>{
  let reads=0;const project=createFm2608CodeProject({getStarterCode:()=>{reads++;return '// Original starter';}});
  project.writeEditorText('/index.js','globalThis.newCassetteMustNotRun=true;');project.importFiles([{path:'/keep.txt',data:'Keep until confirmation'}]);
  const edited=project.settings;edited.ssg.noisePeriod=7;project.setSettings(edited);project.select('/keep.txt');project.setCodeState({mode:'code',path:'/index.js'});
  const before=project.snapshot(),fresh=createFm2608CodeProject({snapshot:project.prepareNew()});
  assert.deepEqual(project.snapshot(),before);assert.equal(reads,2);assert.deepEqual(fresh.settings,createDefaultPreset());
  assert.equal(fresh.fs.get('/index.js').data,'// Original starter');assert(!fresh.fs.has('/keep.txt'));
  assert.deepEqual(fresh.getCodeState(),{mode:'keyboard',path:'/index.js'});assert.equal(fresh.selectedPath,'/index.js');
  assert.deepEqual(fresh.fs.list().map(file=>file.path),['/index.js','/examples/timed-fm-ssg.js','/examples/timed-rhythm.js','/examples/timed-adpcm.js']);
  assert.equal(globalThis.newCassetteMustNotRun,undefined);
});

test('PC-98 failed default preparation keeps all previous Files intact',()=>{
  let fail=false;const project=createFm2608CodeProject({getStarterCode:()=>{if(fail)throw Error('Starter unavailable');return '// Kept';}});
  const before=project.snapshot();fail=true;assert.throws(()=>project.prepareNew(),/Starter unavailable/);assert.deepEqual(project.snapshot(),before);
});
