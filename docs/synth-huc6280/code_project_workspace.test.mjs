import test from 'node:test';
import assert from 'node:assert/strict';
import {createHuc6280CodeProject,HUC6280_PROJECT_FORMAT,HUC6280_PROJECT_MANIFEST} from './code_project.js';
import {createDefaultPreset} from './preset.js';
import {encodeDdaData} from './dda_pcm.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {transferVirtualFiles} from '../js/tetorica_virtual_files/filesystem.js';

const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const snapshots=project=>({working:project.fs.snapshot(),saved:project.savedFs.snapshot()});
function setup(){
  const project=createHuc6280CodeProject({starterCode:'context.value="saved";'}),sound=createDefaultPreset();
  project.importFiles([{path:'/presets/voice.huc6280.json',data:JSON.stringify(sound)+'\n'},
    {path:'/lib/data.txt',data:'saved text'},{path:'/lib/bytes.bin',type:'binary',data:Uint8Array.of(0,255,17)}]);
  project.setActiveSoundPath('/presets/voice.huc6280.json');project.select('/presets/voice.huc6280.json');
  project.setCodeState({mode:'code',path:'/index.js'});return project;
}

test('manual text/binary edits are independent until Save/Save all, while settings stay separately accepted',()=>{
  const project=setup(),before=snapshots(project);assert.equal(project.autoApply,true);
  project.setAutoApply(false);project.writeEditorText('/index.js','context.value="working";');project.fs.writeFile('/lib/bytes.bin',Uint8Array.of(9,8));
  const sound=project.settings;sound.volume=7;project.setSettings(sound);
  assert.equal(project.settings.volume,7);assert.equal(project.savedSettings.volume,createDefaultPreset().volume);
  assert.deepEqual(project.savedFs.snapshot(),before.saved);assert(project.isFileModified('/index.js'));assert(project.isFileModified('/lib'));
  project.saveFiles(['/index.js']);assert.equal(project.savedFs.get('/index.js').data,'context.value="working";');assert(project.isFileModified('/lib/bytes.bin'));
  project.setSavedSettings(sound);assert.equal(project.savedSettings.volume,7);
  project.saveAll();assert.deepEqual(project.savedFs.snapshot(),project.fs.snapshot());assert.deepEqual(project.getDirtyPaths(),[]);
  const detached=project.savedSettings;detached.volume=1;assert.equal(project.savedSettings.volume,7);
});

test('Discard handles new/deleted files and empty directories, and rejected batches leave both versions untouched',()=>{
  const project=setup();project.setAutoApply(false);
  project.fs.remove('/lib/data.txt');project.fs.writeText('/new.txt','new');project.fs.mkdir('/empty');
  project.discardFiles(['/lib/data.txt','/new.txt','/empty']);assert.equal(project.fs.get('/lib/data.txt').data,'saved text');assert.equal(project.fs.has('/new.txt'),false);
  assert(!project.fs.listDirectories().includes('/empty'));assert.deepEqual(project.getDirtyPaths(),[]);
  project.writeEditorText('/index.js','working');const before=project.snapshot();
  assert.throws(()=>project.saveFiles(['/index.js','/missing']),/not found/);assert.deepEqual(project.snapshot(),before);
  assert.throws(()=>project.discardFiles(['/index.js','/missing']),/not found/);assert.deepEqual(project.snapshot(),before);
});

test('enabling Auto apply accepts pending bytes once; new Cassette keeps that preference and original defaults',()=>{
  const project=setup();project.setAutoApply(false);project.writeEditorText('/index.js','draft');
  const fresh=createHuc6280CodeProject({snapshot:project.prepareNew()});assert.equal(fresh.autoApply,false);assert.deepEqual(fresh.settings,createDefaultPreset());
  assert.equal(fresh.fs.get('/index.js').data,'context.value="saved";');assert.deepEqual(fresh.fs.snapshot(),fresh.savedFs.snapshot());
  project.setAutoApply(true);assert.equal(project.autoApply,true);assert.equal(project.savedFs.get('/index.js').data,'draft');assert.deepEqual(project.getDirtyPaths(),[]);
  project.writeEditorText('/index.js','immediate');assert.equal(project.savedFs.get('/index.js').data,'immediate');
});

test('v2 snapshots preserve detached layers, active sound, pending rename mapping and invalid text without changing sound',()=>{
  const project=setup();project.setAutoApply(false);
  transferVirtualFiles(project.fs,'/presets/voice.huc6280.json','/presets/renamed.huc6280.json');
  project.setPendingMoves([['/presets/voice.huc6280.json','/presets/renamed.huc6280.json']]);project.setActiveSoundPath('/presets/renamed.huc6280.json');project.select('/presets/renamed.huc6280.json');
  project.writeEditorText('/presets/renamed.huc6280.json','{"unfinished":');const before=project.snapshot(),copy=createHuc6280CodeProject({snapshot:before});
  assert.deepEqual(copy.snapshot(),before);assert.equal(copy.activeSoundPath,'/presets/renamed.huc6280.json');assert.equal(copy.savedFs.has('/presets/voice.huc6280.json'),true);
  assert.deepEqual(copy.getPendingMoves(),[['/presets/voice.huc6280.json','/presets/renamed.huc6280.json']]);assert.deepEqual(copy.settings,createDefaultPreset());
  before.workspace.saved.files.find(file=>file.path==='/lib/bytes.bin').data.fill(0);assert.deepEqual(copy.savedFs.get('/lib/bytes.bin').data,Uint8Array.of(0,255,17));
  const stable=copy.snapshot();assert.throws(()=>copy.restore({...stable,filesystem:{...stable.filesystem,files:[]}}),/Inconsistent/);assert.deepEqual(copy.snapshot(),stable);
  const bad=structuredClone(stable);bad.workspace.saved.files.find(file=>file.path==='/lib/bytes.bin').type='text';assert.throws(()=>copy.restore(bad),/type/);assert.deepEqual(copy.snapshot(),stable);
  assert.throws(()=>copy.setPendingMoves([['/a','/b'],['/a','/c']]),/Duplicate/);assert.deepEqual(copy.snapshot(),stable);
});

test('legacy v1 projects migrate current bytes to saved without dropping opaque checkpoint/git data',()=>{
  const project=setup(),modern=project.snapshot();
  const legacy={format:HUC6280_PROJECT_FORMAT,version:1,name:'Legacy',settings:modern.settings,selectedPath:'/index.js',codeState:{mode:'keyboard',path:'/index.js'},filesystem:modern.filesystem};
  legacy.filesystem.files.push({path:'/.tet.ss/legacy.txt',type:'text',data:'old checkpoint'},{path:'/.git/blob.bin',type:'binary',data:Uint8Array.of(8,9)});
  const copy=createHuc6280CodeProject({snapshot:legacy});assert.equal(copy.snapshot().version,2);assert.equal(copy.autoApply,true);
  assert.deepEqual(copy.fs.snapshot(),copy.savedFs.snapshot());assert.equal(copy.fs.get('/.tet.ss/legacy.txt').data,'old checkpoint');assert.deepEqual(copy.savedFs.get('/.git/blob.bin').data,Uint8Array.of(8,9));
});

test('saved execution reads accepted entry/modules/data and rejects a never-saved entry without mutating files',async()=>{
  const project=setup();project.importFiles([{path:'/entry.js',data:'context.value=(await import("./module.js")).value;context.data=await file("./lib/data.txt");'},{path:'/module.js',data:'export const value="saved module";'}]);
  project.setAutoApply(false);project.writeEditorText('/entry.js','throw Error("working entry ran");');project.writeEditorText('/module.js','throw Error("working module ran");');project.writeEditorText('/lib/data.txt','working text');
  const before=project.snapshot(),context={};
  try{await new AsyncFunction('context',project.prepareSavedSource('ignored working input',{path:'/entry.js'}))(context);}
  finally{delete globalThis.__tetoricaVirtualFiles;}
  assert.deepEqual(context,{value:'saved module',data:'saved text'});assert.deepEqual(project.snapshot(),before);
  assert.equal(await project.readSavedFile('/lib/data.txt'),'saved text');assert.equal(await project.readFile('/lib/data.txt'),'working text');
  project.fs.writeText('/new.js','context.new=true;');assert.throws(()=>project.prepareSavedSource('',{path:'/new.js'}),/Save.*before running/);
});

test('Code recovery restores accepted and working source without promoting a manual draft',()=>{
  const project=setup();project.recoverCode('/index.js',{source:'working recovered',savedSource:'saved recovered',autoSave:false});
  assert.equal(project.fs.get('/index.js').data,'working recovered');assert.equal(project.savedFs.get('/index.js').data,'saved recovered');assert.equal(project.autoApply,false);
  project.recoverCode('/new.js',{source:'new recovered',savedSource:null,autoSave:false});assert.equal(project.savedFs.has('/new.js'),false);
  const stable=project.snapshot();assert.throws(()=>project.recoverCode('/index.js',{source:'invalid promotion',savedSource:'different',autoSave:true}),/matching/);assert.deepEqual(project.snapshot(),stable);
});

test('Cassette ordinary files are saved; compact recovery restores working bytes, paths, metadata and settings exactly',async()=>{
  const project=setup();project.importFiles([{path:'/metadata.json',data:'{ "version": 1, "workType": "NONE", "license": "NONE", "custom": "kept" }\n'},
    {path:'/opaque.json',type:'binary',data:new TextEncoder().encode('{"binary":"despite extension"}')},{path:'/wave.bin',type:'binary',data:new Uint8Array(1024*1024).fill(11)}]);
  project.fs.mkdir('/empty-before');project.setAutoApply(false);project.writeEditorText('/index.js','working');project.fs.remove('/lib/data.txt');project.fs.mkdir('/empty-after');project.fs.remove('/empty-before');
  project.fs.writeText('/new.txt','new');project.fs.writeText('/metadata.json','{"version":1,"workType":"NONE","license":"NONE","custom":"working"}');
  const draft=project.settings;draft.volume=4;project.setSettings(draft);const before=project.snapshot(),bytes=project.exportProject(),archive=await loadPlaygroundCassette(bytes);
  assert.equal(new TextDecoder().decode(archive.files.get('index.js')),'context.value="saved";');assert(archive.files.has('lib/data.txt'));assert(!archive.files.has('new.txt'));
  const manifest=JSON.parse(new TextDecoder().decode(archive.files.get(HUC6280_PROJECT_MANIFEST.slice(1))));
  assert(!manifest.workingDelta.files.some(file=>file.path==='/wave.bin'));assert.equal(manifest.workspace,undefined);assert.equal(manifest.filesystem,undefined);
  const copy=createHuc6280CodeProject({snapshot:await project.prepareImport(bytes)});assert.deepEqual(copy.snapshot(),before);assert.deepEqual(project.snapshot(),before);
  assert.equal(copy.fs.get('/opaque.json').type,'binary');assert.equal(copy.savedFs.get('/metadata.json').data,'{ "version": 1, "workType": "NONE", "license": "NONE", "custom": "kept" }\n');
});

test('Cassette generated metadata does not become an extra original project file, and legacy opaque text keeps its type',async()=>{
  const project=setup();project.fs.writeText('/.tet.ss/old.json','opaque checkpoint');const before=project.snapshot();
  const restored=createHuc6280CodeProject({snapshot:await project.prepareImport(project.exportProject())});assert.deepEqual(restored.snapshot(),before);assert.equal(restored.fs.has('/metadata.json'),false);
});

test('malformed dual recovery and superseded imports reject atomically',async()=>{
  const project=setup();project.setAutoApply(false);project.writeEditorText('/index.js','draft');const stable=project.snapshot(),archive=await loadPlaygroundCassette(project.exportProject());
  const original=JSON.parse(new TextDecoder().decode(archive.files.get(HUC6280_PROJECT_MANIFEST.slice(1))));
  for(const corrupt of [value=>value.workingDelta.files.push({...value.workingDelta.files[0]}),value=>value.workingDelta.savedTextPaths.push('/missing.txt'),value=>value.workingDelta.autoSave=true,
    value=>value.savedSettings={...value.settings,source:'pulse'},value=>value.workingDelta.files[0].path='/../outside',value=>value.workingDelta.files.push({path:'/new.bin',type:'binary',data:'invalid!'})]){
    const manifest=structuredClone(original);corrupt(manifest);const files=[...archive.files].map(([path,data])=>({path:'/'+path,type:'binary',data}));files.find(file=>file.path===HUC6280_PROJECT_MANIFEST).data=new TextEncoder().encode(JSON.stringify(manifest));
    const bytes=createPlaygroundCassetteZip(files,{directories:archive.directories,preserveMetadataFiles:true});await assert.rejects(project.prepareImport(bytes));assert.deepEqual(project.snapshot(),stable);
  }
  await assert.rejects(project.prepareImport(project.exportProject(),{isCurrent:()=>false}),/cancelled/);assert.deepEqual(project.snapshot(),stable);
});

test('accepted author cache aliases unchanged large DDA payloads instead of adding a second recovery copy',async()=>{
  const sound=createDefaultPreset();sound.source='dda';sound.dda.data=encodeDdaData(new Uint8Array(1024*1024).fill(17));
  const project=createHuc6280CodeProject({settings:sound});project.setAutoApply(false);
  const edited=project.settings;edited.volume=7;project.setSettings(edited);
  const before=project.snapshot(),archive=await loadPlaygroundCassette(project.exportProject()),source=new TextDecoder().decode(archive.files.get(HUC6280_PROJECT_MANIFEST.slice(1))),manifest=JSON.parse(source);
  assert.equal(manifest.savedDdaSource,'settings');assert.equal(manifest.savedSettings.dda.data,undefined);assert.equal(source.split(sound.dda.data).length-1,1);
  const restored=createHuc6280CodeProject({snapshot:await project.prepareImport(project.exportProject())});assert.deepEqual(restored.snapshot(),before);assert.equal(restored.savedSettings.volume,sound.volume);assert.equal(restored.settings.volume,7);
  project.setSavedSettings(edited);const sameArchive=await loadPlaygroundCassette(project.exportProject()),sameManifest=JSON.parse(new TextDecoder().decode(sameArchive.files.get(HUC6280_PROJECT_MANIFEST.slice(1))));
  assert.equal(sameManifest.savedSettingsSource,'settings');assert.equal(sameManifest.savedSettings,undefined);assert.equal(sameManifest.savedDdaSource,undefined);
  assert.deepEqual(createHuc6280CodeProject({snapshot:await project.prepareImport(project.exportProject())}).snapshot(),project.snapshot());
});

test('expanded Cassette budget includes changed binary recovery instead of silently omitting its working version',()=>{
  const project=setup(),bytes=new Uint8Array(7*1024*1024).fill(1);project.importFiles([{path:'/large.bin',type:'binary',data:bytes}]);project.setAutoApply(false);
  bytes.fill(2);project.fs.writeFile('/large.bin',bytes);const before=project.snapshot();assert.throws(()=>project.exportProject(),/16 MiB/);assert.deepEqual(project.snapshot(),before);
});
