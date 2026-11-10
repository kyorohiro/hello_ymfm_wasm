import test from 'node:test';
import assert from 'node:assert/strict';
import {createSidCodeProject,createSidProjectStore,readSidProjectSound,SID_PROJECT_MANIFEST,SID_PROJECT_STORAGE_KEY} from './code_project.js';
import {createDefaultPreset} from './preset.js';
import {createChannelSettings,readChannelSettings} from './channel_settings.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';

test('SID project code/module readers use detached current Files without starting an instrument',async()=>{
  const project=createSidCodeProject({getStarterCode:()=>"const sid=await useSoundChip('sid');"});
  project.importFiles([{path:'/lib/note.js',data:'export const note=(await file("../data/note.json",{type:"json"})).note;'},
    {path:'/data/note.json',data:'{"note":"E4"}'},{path:'/raw.sid',type:'binary',data:Uint8Array.of(0,255,13)}]);
  const context={};await new(Object.getPrototypeOf(async function(){}).constructor)('context',project.prepareSource('context.note=(await import("./lib/note.js")).note;'))(context);
  assert.deepEqual(context,{note:'E4'});delete globalThis.__tetoricaVirtualFiles;
  const bytes=new Uint8Array(await project.readFile('./raw.sid',{type:'arrayBuffer'}));bytes.fill(7);
  assert.deepEqual(new Uint8Array(await project.readFile('/raw.sid',{type:'arrayBuffer'})),Uint8Array.of(0,255,13));
  const before=project.snapshot();assert.throws(()=>project.prepareSource('await import("./missing.js")'),/not found/);assert.deepEqual(project.snapshot(),before);
});

test('project ZIP preserves code, opaque binaries, active path and legacy sound file bytes',async()=>{
  const settings=createChannelSettings();settings.target=2;settings.channels[2].voice.waveform='pulse';
  const project=createSidCodeProject({settings,starterCode:'globalThis.mustNotRun=true;'});
  const legacy=createDefaultPreset();delete legacy.model;legacy.version=1;const source=JSON.stringify(legacy)+'\n';
  project.importFiles([{path:'/presets/legacy.sid-voice.json',data:source},{path:'/lib/notes.mjs',data:'export const notes=[60,64];'},
    {path:'/data/opaque.bin',type:'binary',data:Uint8Array.of(255,1,0,254)}]);
  project.select('/lib/notes.mjs');project.setCodeState({mode:'code',path:'/lib/notes.mjs'});
  const copy=createSidCodeProject(),prepared=await copy.prepareImport(project.exportProject());
  assert.equal(copy.fs.list().length,0,'preflight is detached');copy.restore(prepared);
  assert.deepEqual(copy.settings,readChannelSettings(settings));assert.equal(copy.selectedPath,'/lib/notes.mjs');assert.deepEqual(copy.getCodeState(),{mode:'code',path:'/lib/notes.mjs'});
  assert.equal(copy.fs.get('/presets/legacy.sid-voice.json').data,source);assert.equal(JSON.parse(source).version,1);
  assert.deepEqual(copy.fs.get('/data/opaque.bin').data,Uint8Array.of(255,1,0,254));assert.equal(globalThis.mustNotRun,undefined);
  assert.equal(readSidProjectSound(source).channels[0].model,'6581');
  const cassette=await loadPlaygroundCassette(copy.exportProject());assert(cassette.files.has(SID_PROJECT_MANIFEST.slice(1)));assert.equal(new TextDecoder().decode(cassette.files.get('presets/legacy.sid-voice.json')),source);
});

test('malformed manifests and snapshots reject atomically; unfinished SID/data text remains opaque',async()=>{
  const project=createSidCodeProject({starterCode:'kept'}),before=project.snapshot();
  const invalid={...before,settings:{...before.settings,target:9}};assert.throws(()=>project.restore(invalid),/target/);assert.deepEqual(project.snapshot(),before);
  const badZip=createPlaygroundCassetteZip([{path:SID_PROJECT_MANIFEST,type:'text',data:'{"version":99}'},{path:'/index.js',type:'text',data:'replacement'}]);
  await assert.rejects(project.prepareImport(badZip),/format\/version/);assert.deepEqual(project.snapshot(),before);
  project.importFiles([{path:'/data/in-progress.json',data:'{unfinished'},{path:'/presets/editing.sid-voice.json',data:'{"voice":'},{path:'/data/readme.txt',data:'data'}]);assert.equal(project.fs.get('/data/in-progress.json').data,'{unfinished');
  const restored=createSidCodeProject({snapshot:await project.prepareImport(project.exportProject())});assert.equal(restored.fs.get('/presets/editing.sid-voice.json').data,'{"voice":');assert.deepEqual(restored.settings,project.settings);
  assert.throws(()=>project.importFiles([{path:SID_PROJECT_MANIFEST,data:'reserved'}]),/reserved/);
});

test('generic Playground cassette retains SID settings and keeps its index rather than reseeding it',async()=>{
  const settings=createChannelSettings();settings.channels.forEach(voice=>voice.voice.attack=8);
  const project=createSidCodeProject({settings,getStarterCode:()=> 'default'}),zip=createPlaygroundCassetteZip([{path:'/index.js',type:'text',data:'imported'}]);
  project.restore(await project.prepareImport(zip));assert.equal(project.fs.get('/index.js').data,'imported');assert.deepEqual(project.settings,settings);assert.deepEqual(project.getCodeState(),{mode:'keyboard',path:null});
});

test('SID local store is independent and round-trips binary snapshots',async()=>{
  const values=new Map([['tetorica-fm2612-synth-pending-code','FM kept']]),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const store=createSidProjectStore({indexedDB:null,storage}),project=createSidCodeProject();project.importFiles([{path:'/sample.bin',type:'binary',data:Uint8Array.of(3,255)}]);
  assert.equal(await store.read(),null);await store.write(project.snapshot());assert(values.has(SID_PROJECT_STORAGE_KEY));const restored=createSidCodeProject({snapshot:await store.read()});
  assert.deepEqual(restored.fs.get('/sample.bin').data,Uint8Array.of(3,255));assert.equal(values.get('tetorica-fm2612-synth-pending-code'),'FM kept');
});
