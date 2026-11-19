import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthProject,synthStatePath} from './synth_project.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';

const preset=feedback=>({algorithm:7,feedback,operators:{4:{tl:24,ar:31}}});
const ordered=store=>{const value=store.snapshot();value.files.sort((a,b)=>a.path.localeCompare(b.path));value.directories.sort();return value;};

test('Synth keeps independent working and saved versions, atomically saving or discarding FM sidecar changes',()=>{
  const p=createSynthProject(),path='/presets/Tone.vgi';p.writeTone(path,preset(1));
  assert.equal(p.autoApply,true);assert.equal(p.fs.checkpoints.auto,false);assert.equal(p.readTone(path,{version:'saved'}).preset.feedback,1);
  p.setAutoApply(false);p.writeTone(path,{...preset(6),lfo:{enabled:true,frequency:5}});
  assert.equal(p.readTone(path).preset.feedback,6);assert.equal(p.readTone(path,{version:'saved'}).preset.feedback,1);assert(p.isToneModified(path));
  let events=0;p.onDidChange(()=>{events++;assert.equal(p.readTone(path,{version:'saved'}).preset.feedback,6);});
  p.saveFiles([synthStatePath(path)]);assert.equal(events,1);assert.equal(p.isToneModified(path),false);
  p.writeTone(path,preset(3));p.discardTone(path);assert.equal(p.readTone(path).preset.feedback,6);assert.equal(p.readTone(path).preset.lfo.enabled,true);
  assert.equal(p.fs.list().some(file=>file.path.startsWith('/.tet.ss')),false);
});

test('manual rename chains save or discard only their original/current path pair across snapshot restoration',()=>{
  let p=createSynthProject();p.writeTone('/presets/Original.vgi',preset(1));p.fs.writeText('/other.js','saved');p.setAutoApply(false);
  p.writeTone('/presets/Original.vgi',preset(5));p.fs.writeText('/other.js','keep working');
  p.rename('/presets/Original.vgi','Middle.vgi');p.rename('/presets/Middle.vgi','Final.vgi');
  p=createSynthProject({snapshot:p.snapshot()});p.saveFiles(['/presets/Final.vgi']);
  assert.equal(p.savedFs.has('/presets/Original.vgi'),false);assert.equal(p.savedFs.has('/presets/Original.vgi.synth.json'),false);
  assert.equal(p.readTone('/presets/Final.vgi',{version:'saved'}).preset.feedback,5);assert.equal(p.savedFs.get('/other.js').data,'saved');assert(p.workspace.isDirty('/other.js'));
  p.rename('/presets/Final.vgi','Unsaved.vgi');p.writeTone('/presets/Unsaved.vgi',preset(7));
  p=createSynthProject({snapshot:p.snapshot()});assert.equal(p.getSavedPath('/presets/Unsaved.vgi'),'/presets/Final.vgi');p.discardFiles(['/presets/Unsaved.vgi']);
  assert.equal(p.fs.has('/presets/Unsaved.vgi'),false);assert.equal(p.readTone('/presets/Final.vgi').preset.feedback,5);assert(p.workspace.isDirty('/other.js'));
});

test('legacy project snapshots treat current content as saved while opaque old checkpoints remain preserved',()=>{
  const p=createSynthProject();p.fs.writeText('/index.js','current');p.fs.writeText('/.tet.ss/index.js','legacy checkpoint');
  const legacy={...p.fs.snapshot(),selectedPath:'/index.js',cassetteName:'Legacy'},migrated=createSynthProject({snapshot:legacy});
  assert.equal(migrated.savedFs.get('/index.js').data,'current');assert.equal(migrated.fs.get('/.tet.ss/index.js').data,'legacy checkpoint');
  assert.equal(migrated.autoApply,true);assert.deepEqual(migrated.getDirtyPaths(),[]);assert.equal(migrated.fs.checkpoints.auto,false);
});

test('Cassette stores ordinary saved files and only working differences, preserving original metadata and unchanged audio once',async()=>{
  const p=createSynthProject(),metadata=' {"version":1,"workType":"ORIGINAL","license":{"type":"CUSTOM","name":"Original license"},"author":"Example"}\n';
  p.fs.writeText('/metadata.json',metadata);p.fs.writeText('/index.js','// saved');p.fs.writeText('/deleted.js','saved then deleted');
  p.fs.writeBinary('/audio/large.wav',new Uint8Array(1024*1024));p.mkdir('/old-empty');p.setAutoApply(false);
  p.fs.writeText('/index.js','// working');p.fs.remove('/deleted.js');p.fs.writeBinary('/new.bin',new Uint8Array([0,128,255]));p.fs.remove('/old-empty');p.mkdir('/new-empty');
  const working=ordered(p.fs),saved=ordered(p.savedFs),before=p.snapshot(),bytes=p.exportCassette({includeWorkingState:true});assert.deepEqual(p.snapshot(),before);
  const archive=await loadPlaygroundCassette(bytes),delta=archive.metadata.tetoricaWorkingState;
  assert.equal(new TextDecoder().decode(archive.files.get('index.js')),'// saved');assert(archive.files.has('deleted.js'));assert.equal(archive.files.has('new.bin'),false);
  assert.equal(archive.metadata.author,'Example');assert.equal(archive.metadata.workType,'ORIGINAL');assert.equal(archive.metadata.license,'CUSTOM');
  assert.deepEqual(delta.files.map(file=>file.path).sort(),['/index.js','/new.bin']);assert.deepEqual(delta.deleted,['/deleted.js']);assert.equal(delta.autoSave,false);
  assert.equal(JSON.stringify(delta).includes('large.wav'),false);assert.deepEqual(delta.directories,{created:['/new-empty'],deleted:['/old-empty']});
  const restored=createSynthProject();await restored.importCassette(bytes);assert.equal(restored.autoApply,false);
  assert.deepEqual(ordered(restored.fs),working);assert.deepEqual(ordered(restored.savedFs),saved);assert.equal(restored.savedFs.get('/metadata.json').data,metadata);
  assert.equal(restored.cassetteMetadata.tetoricaWorkingState,undefined);
});

test('malformed Cassette working differences reject before mutating either live version',async()=>{
  const p=createSynthProject();p.fs.writeText('/index.js','keep');p.setAutoApply(false);const before=p.snapshot();
  const base={version:1,autoSave:false,files:[],deleted:[],directories:{created:[],deleted:[]},metadataFiles:[],pendingMoves:[]};
  for(const patch of [
    {files:[{path:'/../escape.js',type:'text',data:'unsafe'}]},
    {files:[{path:'/bad.bin',type:'binary',data:'not base64!'}]},
    {autoSave:true,files:[{path:'/index.js',type:'text',data:'contradictory working'}]},
    {files:[{path:'/a.js',type:'text',data:'one'},{path:'/a.js',type:'text',data:'two'}]},
  ]){
    const bytes=createPlaygroundCassetteZip([{path:'/index.js',type:'text',data:'saved'}],{metadata:{tetoricaWorkingState:{...base,...patch}}});
    await assert.rejects(p.importCassette(bytes));assert.deepEqual(p.snapshot(),before);
  }
});

test('the Cassette expanded-size limit includes the encoded working delta without mutating either version',()=>{
  const p=createSynthProject(),size=7*1024*1024;p.fs.writeBinary('/large.wav',new Uint8Array(size));p.setAutoApply(false);p.fs.writeBinary('/large.wav',new Uint8Array(size).fill(1));
  assert.throws(()=>p.exportCassette({includeWorkingState:true}),/16 MiB/);assert.equal(p.savedFs.get('/large.wav').data[0],0);assert.equal(p.fs.get('/large.wav').data[0],1);assert.equal(p.autoApply,false);
});
