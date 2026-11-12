import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpuCodeProject,createSpuProjectStore,readSpuProjectSound,SPU_PROJECT_MANIFEST,SPU_PROJECT_STORAGE_KEY,SPU_PROJECT_FILE_BYTES} from './code_project.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {writeSpuInstrument} from './spu_synth_instrument.js';
import {preparePs1Waveform} from '../js/ps1_waveform.js';

export function soundFixture(){
  const prepared=preparePs1Waveform(Array.from({length:112},(_,i)=>.65*Math.sin(2*Math.PI*i/112)));
  return writeSpuInstrument('Saved PCM',{preset:{sample:0,volumeLeft:.75,volumeRight:.75,adsr1:15,adsr2:0,pitch:4096,reverb:false},
    sample:{adpcm:prepared.adpcm,baseFrequencyHz:44100/112,loopStartSamples:0},waveform:prepared.pcm,
    reverb:{preset:'off',volumeLeft:.25,volumeRight:.25}});
}
test('SPU Files readers use current text and binary modules without acquiring or running an instrument',async()=>{
  const project=createSpuCodeProject({getStarterCode:()=>"const ps1=await useSoundChip('ps1');"});
  project.importFiles([{path:'/lib/note.js',data:'export const note=(await file("../data/note.json",{type:"json"})).note;'},
    {path:'/data/note.json',data:'{"note":"E4"}'},{path:'/raw.vab',type:'binary',data:Uint8Array.of(0,255,13)}]);
  const context={};await new(Object.getPrototypeOf(async function(){}).constructor)('context',project.prepareSource('context.note=(await import("./lib/note.js")).note;'))(context);
  assert.deepEqual(context,{note:'E4'});delete globalThis.__tetoricaVirtualFiles;
  const bytes=new Uint8Array(await project.readFile('./raw.vab',{type:'arrayBuffer'}));bytes.fill(7);
  assert.deepEqual(new Uint8Array(await project.readFile('/raw.vab',{type:'arrayBuffer'})),Uint8Array.of(0,255,13));
  const before=project.snapshot();assert.throws(()=>project.prepareSource('await import("./missing.js")'),/not found/);assert.deepEqual(project.snapshot(),before);
});
test('SPU project ZIP preserves sound JSON bytes but never stores or applies an automatic instrument manifest',async()=>{
  const project=createSpuCodeProject({starterCode:'globalThis.mustNotRun=true;'}),sound=soundFixture(),source=JSON.stringify(sound)+'\n';
  project.importFiles([{path:'/presets/edit.spu.json',data:source},{path:'/lib/notes.mjs',data:'export const notes=[60,64];'},
    {path:'/data/opaque.bin',type:'binary',data:Uint8Array.of(255,1,0,254)}]);
  project.select('/lib/notes.mjs');project.setCodeState({mode:'code',path:'/lib/notes.mjs'});
  const copy=createSpuCodeProject(),prepared=await copy.prepareImport(project.exportProject());
  assert.equal(copy.fs.list().length,0);copy.restore(prepared);
  assert.equal(copy.selectedPath,'/lib/notes.mjs');assert.deepEqual(copy.getCodeState(),{mode:'code',path:'/lib/notes.mjs'});
  assert.equal(copy.fs.get('/presets/edit.spu.json').data,source);assert.deepEqual(readSpuProjectSound(source),sound);
  assert.deepEqual(copy.fs.get('/data/opaque.bin').data,Uint8Array.of(255,1,0,254));assert.equal(globalThis.mustNotRun,undefined);
  const cassette=await loadPlaygroundCassette(copy.exportProject()),manifest=JSON.parse(new TextDecoder().decode(cassette.files.get(SPU_PROJECT_MANIFEST.slice(1))));
  assert.equal('settings' in manifest,false);assert.equal('instrument' in manifest,false);assert.equal(new TextDecoder().decode(cassette.files.get('presets/edit.spu.json')),source);
});
test('invalid sound, project and oversized Files reject before mutating a valid workspace',()=>{
  const project=createSpuCodeProject({starterCode:'kept'}),before=project.snapshot();
  assert.throws(()=>project.restore({...before,codeState:{mode:'code',path:'/missing.js'}}),/selection/);assert.deepEqual(project.snapshot(),before);
  assert.throws(()=>readSpuProjectSound({...soundFixture(),preset:{sample:1}}),/voice/);
  assert.equal(readSpuProjectSound('{"ordinary":"JSON"}'),null);
  assert.throws(()=>project.importFiles([{path:'/too-large.bin',type:'binary',data:new Uint8Array(SPU_PROJECT_FILE_BYTES)}]),/cassette limit/);assert.deepEqual(project.snapshot(),before);
  assert.throws(()=>project.importFiles([{path:SPU_PROJECT_MANIFEST,data:'reserved'}]),/reserved/);
});
test('generic cassette import and saved snapshots keep their Code instead of reseeding the new starter',async()=>{
  const project=createSpuCodeProject({getStarterCode:()=> 'default'}),zip=createPlaygroundCassetteZip([{path:'/index.js',type:'text',data:'imported'}]);
  project.restore(await project.prepareImport(zip));assert.equal(project.fs.get('/index.js').data,'imported');assert.deepEqual(project.getCodeState(),{mode:'keyboard',path:null});
  const restored=createSpuCodeProject({snapshot:project.snapshot(),getStarterCode:()=>{assert.fail('Saved project must not request a new starter');}});
  assert.equal(restored.fs.get('/index.js').data,'imported');
});
test('SPU local storage round-trips binary files under its own key',async()=>{
  const values=new Map([['tetorica-sid-synth-project-v1','SID kept']]),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const store=createSpuProjectStore({indexedDB:null,storage}),project=createSpuCodeProject();project.importFiles([{path:'/sample.bin',type:'binary',data:Uint8Array.of(3,255)}]);
  assert.equal(await store.read(),null);await store.write(project.snapshot());assert(values.has(SPU_PROJECT_STORAGE_KEY));const restored=createSpuCodeProject({snapshot:await store.read()});
  assert.deepEqual(restored.fs.get('/sample.bin').data,Uint8Array.of(3,255));assert.equal(values.get('tetorica-sid-synth-project-v1'),'SID kept');
});

test('SPU JSON and text editor path/mode survive local snapshots and ZIP without applying or executing them',async()=>{
  for(const mode of ['keyboard','code']) {
    const project=createSpuCodeProject({starterCode:'// retained JS'}),json=JSON.stringify(soundFixture())+'\n';
    project.importFiles([{path:'/presets/saved.spu.json',data:json},{path:'/notes.txt',data:'plain notes'}]);
    project.select('/presets/saved.spu.json');project.setCodeState({mode,path:'/presets/saved.spu.json'});
    const restored=createSpuCodeProject({snapshot:project.snapshot()});assert.deepEqual(restored.getCodeState(),{mode,path:'/presets/saved.spu.json'});
    const zipCopy=createSpuCodeProject();zipCopy.restore(await zipCopy.prepareImport(project.exportProject()));
    assert.deepEqual(zipCopy.getCodeState(),{mode,path:'/presets/saved.spu.json'});assert.equal(zipCopy.fs.get('/presets/saved.spu.json').data,json);
    zipCopy.setCodeState({mode,path:'/notes.txt'});assert.equal(zipCopy.getCodeState().path,'/notes.txt');
    zipCopy.importFiles([{path:'/data.bin',type:'binary',data:Uint8Array.of(1)}]);
    assert.throws(()=>zipCopy.setCodeState({mode,path:'/data.bin'}),/selection/);
    assert.throws(()=>zipCopy.setCodeState({mode,path:'/missing.json'}),/selection/);
  }
});

test('SPU editor writes accept large presets while preserving JavaScript and total-byte limits atomically',()=>{
  const project=createSpuCodeProject({starterCode:'// JS'}),large='{"sample":"'+'a'.repeat(2*1024*1024)+'"}';
  project.importFiles([{path:'/presets/large.json',data:large}]);project.writeEditorText('/presets/large.json',large+'\n');
  assert.equal(project.fs.get('/presets/large.json').data,large+'\n');
  assert.throws(()=>project.writeEditorText('/index.js','x'.repeat(2*1024*1024+1)),/2 MiB/);assert.equal(project.fs.get('/index.js').data,'// JS');
  const bytes=new TextEncoder().encode(large+'\n').length+new TextEncoder().encode('// JS').length;
  project.importFiles([{path:'/padding.bin',type:'binary',data:new Uint8Array(SPU_PROJECT_FILE_BYTES-bytes-64)}]);
  assert.throws(()=>project.writeEditorText('/presets/large.json',large+'\n'+'漢'.repeat(22)),/16 MiB cassette limit/);
  assert.equal(project.fs.get('/presets/large.json').data,large+'\n','UTF-8 growth exceeding the shared budget is rejected before writing');
  assert.throws(()=>project.writeEditorText('/padding.bin','do not replace binary'),/text file/);
});
