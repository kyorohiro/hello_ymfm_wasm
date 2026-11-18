import test from 'node:test';
import assert from 'node:assert/strict';
import {createScspCodeProject,createScspProjectStore,createDefaultScspProjectSound,readScspProjectSound,SCSP_PROJECT_MANIFEST,SCSP_PROJECT_FILE_BYTES,SCSP_PROJECT_STORAGE_KEY} from './code_project.js';
import {readPatch} from './patch.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {readFile} from 'node:fs/promises';

test('fresh Files include the byte-exact editable DSP example, while saved projects are not reseeded',async()=>{
  const path='/examples/dsp-iir-motion.js',source=await readFile(new URL('./examples/dsp-iir-motion.js',import.meta.url),'utf8');
  const fresh=createScspCodeProject({getStarterCode:()=> '// same default melody'});
  assert.equal(fresh.fs.get('/index.js').data,'// same default melody');assert.equal(fresh.fs.get(path).data,source);
  fresh.fs.writeText(path,'// user edit');
  const restored=createScspCodeProject({snapshot:fresh.snapshot(),getStarterCode:()=>assert.fail('No reseed')});
  assert.equal(restored.fs.get(path).data,'// user edit');
  const empty=createScspCodeProject(),copy=createScspCodeProject({snapshot:empty.snapshot(),getStarterCode:()=>assert.fail('No reseed')});
  assert.equal(copy.fs.has(path),false);
});

test('new Cassette preparation resets sound and Files using the original starter without mutating the current project',()=>{
  let reads=0;
  const project=createScspCodeProject({getStarterCode:()=>{reads++;return '// original starter';}});
  project.writeEditorText('/index.js','globalThis.scspNewCassetteMustNotRun=true;');
  project.importFiles([{path:'/old.txt',data:'keep until confirmed'}]);
  const settings=project.settings;settings.transpose=12;project.setSettings(settings);
  project.select('/old.txt');project.setCodeState({mode:'code',path:'/index.js'});
  const before=project.snapshot(),prepared=project.prepareNew();
  assert.deepEqual(project.snapshot(),before);assert.equal(reads,2);
  const fresh=createScspCodeProject({snapshot:prepared});
  assert.equal(fresh.fs.get('/index.js').data,'// original starter');assert(!fresh.fs.has('/old.txt'));
  assert.deepEqual(fresh.settings,createDefaultScspProjectSound());
  assert.deepEqual(fresh.getCodeState(),{mode:'keyboard',path:'/index.js'});assert.equal(fresh.selectedPath,'/index.js');
  for(const path of ['/examples/dsp-iir-motion.js','/examples/self-feedback.js','/examples/self-feedback-6op.js','/examples/parallel-self-feedback.js','/examples/cycle2.js'])assert(fresh.fs.has(path),path);
  assert.equal(globalThis.scspNewCassetteMustNotRun,undefined);
});

test('failed new Cassette preparation preserves the existing project',()=>{
  let fail=false;
  const project=createScspCodeProject({getStarterCode:()=>{if(fail)throw Error('Starter unavailable');return '// kept';}}),before=project.snapshot();
  fail=true;assert.throws(()=>project.prepareNew(),/Starter unavailable/);assert.deepEqual(project.snapshot(),before);
});

test('SCSP project preserves the six-operator v4 patch, source text, binary audio/VGM and editor mode',async()=>{
  const settings=createDefaultScspProjectSound();settings.mode='fm6';settings.fm.algorithm='pairs';settings.effect.enabled=true;
  settings.operators.f.pcm[4]=129;
  const project=createScspCodeProject({settings,starterCode:'globalThis.scspMustNotRun=true;'}),json=JSON.stringify(settings)+'\n';
  project.importFiles([{path:'/presets/Voice.scsp.json',data:json},{path:'/audio/raw.pcm',type:'binary',data:Uint8Array.of(0,255,17)},{path:'/vgm/Song.vgm',type:'binary',data:Uint8Array.of(86,103,109,32)}]);
  project.select('/presets/Voice.scsp.json');project.setCodeState({mode:'keyboard',path:'/presets/Voice.scsp.json'});
  const snapshot=project.snapshot();snapshot.settings.operators.f.pcm[4]=99;assert.equal(project.settings.operators.f.pcm[4],129);
  const copy=createScspCodeProject(),prepared=await copy.prepareImport(project.exportProject());assert.equal(copy.fs.list().length,0);copy.restore(prepared);
  assert.deepEqual(copy.settings,settings);assert.deepEqual(copy.getCodeState(),{mode:'keyboard',path:'/presets/Voice.scsp.json'});
  assert.equal(copy.fs.get('/presets/Voice.scsp.json').data,json);assert.deepEqual(copy.fs.get('/audio/raw.pcm').data,Uint8Array.of(0,255,17));assert.equal(globalThis.scspMustNotRun,undefined);
  const cassette=await loadPlaygroundCassette(copy.exportProject());assert(cassette.files.has(SCSP_PROJECT_MANIFEST.slice(1)));
});

test('SCSP Files accepts and preserves portable preset versions 1 through 4',()=>{
  const full=createDefaultScspProjectSound(),legacy={...full.operators.carrier,format:'tetorica-scsp-voice',version:1};
  const second={...full,version:2,mode:'fm2',fm:{depth:9,ratio:3},operators:{carrier:full.operators.carrier,modulator:full.operators.modulator}};
  const third={...full,version:3,mode:'fm4'};
  for(const sound of [legacy,second,third,full]){
    const source=JSON.stringify(sound),read=readScspProjectSound(source),project=createScspCodeProject({settings:read});
    assert.deepEqual(read,sound);assert.equal(project.settings.version,sound.version);assert.deepEqual(readPatch(project.settings),readPatch(sound));
    read.pcm?.fill(0);assert.equal(JSON.stringify(project.settings),source);
  }
});

test('SCSP virtual modules use the current snapshot and detached binary reads',async()=>{
  const project=createScspCodeProject({starterCode:'// starter'});
  project.importFiles([{path:'/lib/notes.js',data:'export const note=(await file("../data/note.json",{type:"json"})).note;'},
    {path:'/data/note.json',data:'{"note":"E4"}'},{path:'/audio/raw.bin',type:'binary',data:Uint8Array.of(4,255)}]);
  const context={};await new(Object.getPrototypeOf(async function(){}).constructor)('context',project.prepareSource('context.note=(await import("./lib/notes.js")).note;'))(context);delete globalThis.__tetoricaVirtualFiles;
  assert.deepEqual(context,{note:'E4'});new Uint8Array(await project.readFile('/audio/raw.bin',{type:'arrayBuffer'})).fill(0);
  assert.deepEqual(new Uint8Array(await project.readFile('/audio/raw.bin',{type:'arrayBuffer'})),Uint8Array.of(4,255));
});

test('SCSP invalid patches, manifests and oversized files reject atomically while unfinished JSON remains editable',()=>{
  const project=createScspCodeProject({starterCode:'kept'}),before=project.snapshot();
  assert.throws(()=>project.restore({...before,settings:{...before.settings,mode:'invalid'}}));assert.deepEqual(project.snapshot(),before);
  assert.throws(()=>project.restore({...before,codeState:{mode:'code',path:'/missing.json'}}),/selection/);assert.deepEqual(project.snapshot(),before);
  assert.throws(()=>project.importFiles([{path:'/large.bin',type:'binary',data:new Uint8Array(SCSP_PROJECT_FILE_BYTES)}]),/12 MiB/);assert.deepEqual(project.snapshot(),before);
  assert.throws(()=>project.importFiles([{path:SCSP_PROJECT_MANIFEST,data:'reserved'}]),/reserved/);
  project.importFiles([{path:'/unfinished.json',data:'{unfinished'}]);project.setCodeState({mode:'code',path:'/unfinished.json'});assert.equal(project.fs.get('/unfinished.json').data,'{unfinished');
  assert.equal(readScspProjectSound('{"ordinary":1}'),null);assert.throws(()=>readScspProjectSound({...createDefaultScspProjectSound(),version:5}));
});

test('generic SCSP cassette keeps current sound and imported source without reseeding a starter',async()=>{
  const settings=createDefaultScspProjectSound();settings.transpose=4;
  const project=createScspCodeProject({settings,getStarterCode:()=> 'starter'}),zip=createPlaygroundCassetteZip([{path:'/index.js',type:'text',data:'imported'}]);
  project.restore(await project.prepareImport(zip));assert.equal(project.fs.get('/index.js').data,'imported');assert.deepEqual(project.settings,settings);
  const restored=createScspCodeProject({snapshot:project.snapshot(),getStarterCode:()=>assert.fail('No reseed')});assert.equal(restored.fs.get('/index.js').data,'imported');
});

test('SCSP JSON editing has a separate size limit and requires a text file',()=>{
  const project=createScspCodeProject({starterCode:'// js'}),large='x'.repeat(2*1024*1024+1);
  project.importFiles([{path:'/notes.json',data:large}]);project.writeEditorText('/notes.json',large+'!');assert.equal(project.fs.get('/notes.json').data.length,large.length+1);
  assert.throws(()=>project.writeEditorText('/index.js',large),/2 MiB/);assert.equal(project.fs.get('/index.js').data,'// js');
  project.importFiles([{path:'/binary.bin',type:'binary',data:Uint8Array.of(1)}]);assert.throws(()=>project.setCodeState({mode:'code',path:'/binary.bin'}),/selection/);
});

test('SCSP local fallback has an independent namespace and preserves opaque binary snapshots',async()=>{
  const values=new Map([['tetorica-snes-synth-project-v1','kept']]),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const store=createScspProjectStore({indexedDB:null,storage}),project=createScspCodeProject();project.importFiles([{path:'/raw.bin',type:'binary',data:Uint8Array.of(3,255)}]);
  assert.equal(await store.read(),null);await store.write(project.snapshot());assert(values.has(SCSP_PROJECT_STORAGE_KEY));
  const copy=createScspCodeProject({snapshot:await store.read()});assert.deepEqual(copy.fs.get('/raw.bin').data,Uint8Array.of(3,255));assert.equal(values.get('tetorica-snes-synth-project-v1'),'kept');
  assert.match(values.get(SCSP_PROJECT_STORAGE_KEY),/"\$scspBytes"/);await store.close();
});
