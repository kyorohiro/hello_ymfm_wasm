import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameboyCodeProject,createGameboyProjectStore,readGameboyProjectSound,GAMEBOY_PROJECT_MANIFEST,GAMEBOY_PROJECT_FILE_BYTES,GAMEBOY_PROJECT_STORAGE_KEY} from './code_project.js';
import {createDefaultPreset} from './preset.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';

test('DMG project ZIP retains detached sound settings, opaque Files and JSON editor mode without executing',async()=>{
  const settings=createDefaultPreset();settings.source='wave';settings.wave.samples[4]=1;
  const p=createGameboyCodeProject({settings,starterCode:'globalThis.mustNotRun=true;'}),json=JSON.stringify(settings)+'\n';
  p.importFiles([{path:'/presets/Wave.dmg.json',data:json},{path:'/data/raw.bin',type:'binary',data:Uint8Array.of(0,255,17)}]);
  p.select('/presets/Wave.dmg.json');p.setCodeState({mode:'keyboard',path:'/presets/Wave.dmg.json'});
  const snapshot=p.snapshot();snapshot.settings.wave.samples[4]=15;assert.equal(p.settings.wave.samples[4],1);
  const copy=createGameboyCodeProject(),prepared=await copy.prepareImport(p.exportProject());assert.equal(copy.fs.list().length,0);copy.restore(prepared);
  assert.deepEqual(copy.settings,settings);assert.deepEqual(copy.getCodeState(),{mode:'keyboard',path:'/presets/Wave.dmg.json'});
  assert.equal(copy.fs.get('/presets/Wave.dmg.json').data,json);assert.deepEqual(copy.fs.get('/data/raw.bin').data,Uint8Array.of(0,255,17));assert.equal(globalThis.mustNotRun,undefined);
  const cassette=await loadPlaygroundCassette(copy.exportProject());assert(cassette.files.has(GAMEBOY_PROJECT_MANIFEST.slice(1)));
  assert.deepEqual(readGameboyProjectSound(json),settings);
});

test('DMG files use current virtual modules and detached binary reads',async()=>{
  const p=createGameboyCodeProject({starterCode:'// starter'});
  p.importFiles([{path:'/lib/notes.js',data:'export const note=(await file("../data/note.json",{type:"json"})).note;'},
    {path:'/data/note.json',data:'{"note":"E4"}'},{path:'/data/raw.bin',type:'binary',data:Uint8Array.of(4,255)}]);
  const context={};await new(Object.getPrototypeOf(async function(){}).constructor)('context',p.prepareSource('context.note=(await import("./lib/notes.js")).note;'))(context);delete globalThis.__tetoricaVirtualFiles;
  assert.deepEqual(context,{note:'E4'});new Uint8Array(await p.readFile('/data/raw.bin',{type:'arrayBuffer'})).fill(0);
  assert.deepEqual(new Uint8Array(await p.readFile('/data/raw.bin',{type:'arrayBuffer'})),Uint8Array.of(4,255));
});

test('invalid DMG settings, manifests and capacity reject atomically; unfinished JSON remains editable',()=>{
  const p=createGameboyCodeProject({starterCode:'kept'}),before=p.snapshot();
  assert.throws(()=>p.restore({...before,settings:{...before.settings,source:'fds'}}));assert.deepEqual(p.snapshot(),before);
  assert.throws(()=>p.restore({...before,codeState:{mode:'code',path:'/missing.json'}}),/selection/);assert.deepEqual(p.snapshot(),before);
  assert.throws(()=>p.importFiles([{path:'/too-large.bin',type:'binary',data:new Uint8Array(GAMEBOY_PROJECT_FILE_BYTES)}]),/16 MiB/);assert.deepEqual(p.snapshot(),before);
  assert.throws(()=>p.importFiles([{path:GAMEBOY_PROJECT_MANIFEST,data:'reserved'}]),/reserved/);
  p.importFiles([{path:'/unfinished.json',data:'{not finished'}]);p.setCodeState({mode:'code',path:'/unfinished.json'});assert.equal(p.fs.get('/unfinished.json').data,'{not finished');
  assert.equal(readGameboyProjectSound('{"ordinary":1}'),null);assert.throws(()=>readGameboyProjectSound({...createDefaultPreset(),wave:{samples:[],level:1}}));
});

test('generic cassette keeps existing DMG settings and supplied JS instead of reseeding a starter',async()=>{
  const settings=createDefaultPreset();settings.noise.shift=8;settings.source='noise';
  const p=createGameboyCodeProject({settings,getStarterCode:()=> 'starter'}),zip=createPlaygroundCassetteZip([{path:'/index.js',type:'text',data:'imported'}]);
  p.restore(await p.prepareImport(zip));assert.equal(p.fs.get('/index.js').data,'imported');assert.deepEqual(p.settings,settings);
  const restored=createGameboyCodeProject({snapshot:p.snapshot(),getStarterCode:()=>assert.fail('No reseed')});assert.equal(restored.fs.get('/index.js').data,'imported');
});

test('JSON editor paths and large text preserve separate JS and total project limits',()=>{
  const p=createGameboyCodeProject({starterCode:'// js'}),large='x'.repeat(2*1024*1024+1);
  p.importFiles([{path:'/notes.json',data:large}]);p.writeEditorText('/notes.json',large+'!');assert.equal(p.fs.get('/notes.json').data.length,large.length+1);
  assert.throws(()=>p.writeEditorText('/index.js',large),/2 MiB/);assert.equal(p.fs.get('/index.js').data,'// js');
  p.importFiles([{path:'/binary.bin',type:'binary',data:Uint8Array.of(1)}]);assert.throws(()=>p.setCodeState({mode:'code',path:'/binary.bin'}),/selection/);
  p.setCodeState({mode:'code',path:'/notes.json'});assert.deepEqual(createGameboyCodeProject({snapshot:p.snapshot()}).getCodeState(),{mode:'code',path:'/notes.json'});
});

test('DMG local store has its own namespace and retains binary snapshots',async()=>{
  const values=new Map([['tetorica-spu-synth-project-v1','SPU kept']]),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const store=createGameboyProjectStore({indexedDB:null,storage}),p=createGameboyCodeProject();p.importFiles([{path:'/raw.bin',type:'binary',data:Uint8Array.of(3,255)}]);
  assert.equal(await store.read(),null);await store.write(p.snapshot());assert(values.has(GAMEBOY_PROJECT_STORAGE_KEY));
  const copy=createGameboyCodeProject({snapshot:await store.read()});assert.deepEqual(copy.fs.get('/raw.bin').data,Uint8Array.of(3,255));assert.equal(values.get('tetorica-spu-synth-project-v1'),'SPU kept');
});
