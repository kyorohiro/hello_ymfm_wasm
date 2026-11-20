import test from 'node:test';
import assert from 'node:assert/strict';
import {createSidCodeProject,readSidProjectSound,SID_PROJECT_FORMAT,SID_PROJECT_MANIFEST,SID_PROJECT_CODE_LENGTH} from './code_project.js';
import {createChannelSettings,readChannelSettings,selectChannelTarget} from './channel_settings.js';
import {readPreset,createDefaultPreset} from './preset.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {transferVirtualFiles} from '../js/tetorica_virtual_files/filesystem.js';

const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const snapshots=project=>({working:project.fs.snapshot(),saved:project.savedFs.snapshot()});
function setup(){
  const project=createSidCodeProject({starterCode:'context.value="saved";'}),sound=createChannelSettings();
  project.importFiles([{path:'/presets/voice.sid.json',data:JSON.stringify(sound)+'\n'},
    {path:'/lib/data.txt',data:'saved text'},{path:'/lib/bytes.bin',type:'binary',data:Uint8Array.of(0,255,17)}]);
  project.setActiveSoundPath('/presets/voice.sid.json');project.select('/presets/voice.sid.json');
  project.setCodeState({mode:'code',path:'/index.js'});return project;
}

test('manual text/binary edits are independent until Save/Save all, while settings stay separately accepted',()=>{
  const project=setup(),before=snapshots(project);assert.equal(project.autoApply,true);
  project.setAutoApply(false);project.writeEditorText('/index.js','context.value="working";');project.fs.writeFile('/lib/bytes.bin',Uint8Array.of(9,8));
  const sound=project.settings;sound.channels[1].voice.sustain=7;project.setSettings(sound);
  assert.equal(project.settings.channels[1].voice.sustain,7);assert.equal(project.savedSettings.channels[1].voice.sustain,createChannelSettings().channels[1].voice.sustain);
  assert.deepEqual(project.savedFs.snapshot(),before.saved);assert(project.isFileModified('/index.js'));assert(project.isFileModified('/lib'));
  project.saveFiles(['/index.js']);assert.equal(project.savedFs.get('/index.js').data,'context.value="working";');assert(project.isFileModified('/lib/bytes.bin'));
  project.setSavedSettings(sound);assert.equal(project.savedSettings.channels[1].voice.sustain,7);
  project.saveAll();assert.deepEqual(project.savedFs.snapshot(),project.fs.snapshot());assert.deepEqual(project.getDirtyPaths(),[]);
  const detached=project.savedSettings;detached.channels[1].voice.sustain=1;assert.equal(project.savedSettings.channels[1].voice.sustain,7);
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
  const fresh=createSidCodeProject({snapshot:project.prepareNew()});assert.equal(fresh.autoApply,false);assert.deepEqual(fresh.settings,createChannelSettings());
  assert.equal(fresh.fs.get('/index.js').data,'context.value="saved";');assert.deepEqual(fresh.fs.snapshot(),fresh.savedFs.snapshot());
  project.setAutoApply(true);assert.equal(project.autoApply,true);assert.equal(project.savedFs.get('/index.js').data,'draft');assert.deepEqual(project.getDirtyPaths(),[]);
  project.writeEditorText('/index.js','immediate');assert.equal(project.savedFs.get('/index.js').data,'immediate');
});

test('v2 snapshots preserve detached layers, active sound, pending rename mapping and invalid text without changing sound',()=>{
  const project=setup();project.setAutoApply(false);
  transferVirtualFiles(project.fs,'/presets/voice.sid.json','/presets/renamed.sid.json');
  project.setPendingMoves([['/presets/voice.sid.json','/presets/renamed.sid.json']]);project.setActiveSoundPath('/presets/renamed.sid.json');project.select('/presets/renamed.sid.json');
  project.writeEditorText('/presets/renamed.sid.json','{"unfinished":');const before=project.snapshot(),copy=createSidCodeProject({snapshot:before});
  assert.deepEqual(copy.snapshot(),before);assert.equal(copy.activeSoundPath,'/presets/renamed.sid.json');assert.equal(copy.savedFs.has('/presets/voice.sid.json'),true);
  assert.deepEqual(copy.getPendingMoves(),[['/presets/voice.sid.json','/presets/renamed.sid.json']]);assert.deepEqual(copy.settings,createChannelSettings());
  before.workspace.saved.files.find(file=>file.path==='/lib/bytes.bin').data.fill(0);assert.deepEqual(copy.savedFs.get('/lib/bytes.bin').data,Uint8Array.of(0,255,17));
  const stable=copy.snapshot();assert.throws(()=>copy.restore({...stable,filesystem:{...stable.filesystem,files:[]}}),/Inconsistent/);assert.deepEqual(copy.snapshot(),stable);
  const bad=structuredClone(stable);bad.workspace.saved.files.find(file=>file.path==='/lib/bytes.bin').type='text';assert.throws(()=>copy.restore(bad),/type/);assert.deepEqual(copy.snapshot(),stable);
  assert.throws(()=>copy.setPendingMoves([['/a','/b'],['/a','/c']]),/Duplicate/);assert.deepEqual(copy.snapshot(),stable);
});

test('legacy v1 projects migrate current bytes to saved without dropping opaque checkpoint/git data',()=>{
  const project=setup(),modern=project.snapshot();
  const legacy={format:SID_PROJECT_FORMAT,version:1,name:'Legacy',settings:modern.settings,selectedPath:'/index.js',codeState:{mode:'keyboard',path:'/index.js'},filesystem:modern.filesystem};
  legacy.filesystem.files.push({path:'/.tet.ss/legacy.txt',type:'text',data:'old checkpoint'},{path:'/.git/blob.bin',type:'binary',data:Uint8Array.of(8,9)});
  const copy=createSidCodeProject({snapshot:legacy});assert.equal(copy.snapshot().version,2);assert.equal(copy.autoApply,true);
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
  const draft=project.settings;draft.channels[1].voice.sustain=4;project.setSettings(draft);const before=project.snapshot(),bytes=project.exportProject(),archive=await loadPlaygroundCassette(bytes);
  assert.equal(new TextDecoder().decode(archive.files.get('index.js')),'context.value="saved";');assert(archive.files.has('lib/data.txt'));assert(!archive.files.has('new.txt'));
  const manifest=JSON.parse(new TextDecoder().decode(archive.files.get(SID_PROJECT_MANIFEST.slice(1))));
  assert(!manifest.workingDelta.files.some(file=>file.path==='/wave.bin'));assert.equal(manifest.workspace,undefined);assert.equal(manifest.filesystem,undefined);
  const copy=createSidCodeProject({snapshot:await project.prepareImport(bytes)});assert.deepEqual(copy.snapshot(),before);assert.deepEqual(project.snapshot(),before);
  assert.equal(copy.fs.get('/opaque.json').type,'binary');assert.equal(copy.savedFs.get('/metadata.json').data,'{ "version": 1, "workType": "NONE", "license": "NONE", "custom": "kept" }\n');
});

test('Cassette generated metadata does not become an extra original project file, and legacy opaque text keeps its type',async()=>{
  const project=setup();project.fs.writeText('/.tet.ss/old.json','opaque checkpoint');const before=project.snapshot();
  const restored=createSidCodeProject({snapshot:await project.prepareImport(project.exportProject())});assert.deepEqual(restored.snapshot(),before);assert.equal(restored.fs.has('/metadata.json'),false);
});

test('malformed dual recovery and superseded imports reject atomically',async()=>{
  const project=setup();project.setAutoApply(false);project.writeEditorText('/index.js','draft');const stable=project.snapshot(),archive=await loadPlaygroundCassette(project.exportProject());
  const original=JSON.parse(new TextDecoder().decode(archive.files.get(SID_PROJECT_MANIFEST.slice(1))));
  for(const corrupt of [value=>value.workingDelta.files.push({...value.workingDelta.files[0]}),value=>value.workingDelta.savedTextPaths.push('/missing.txt'),value=>value.workingDelta.autoSave=true,
    value=>value.savedSettings={...value.settings,target:9},value=>value.workingDelta.files[0].path='/../outside',value=>value.workingDelta.files.push({path:'/new.bin',type:'binary',data:'invalid!'})]){
    const manifest=structuredClone(original);corrupt(manifest);const files=[...archive.files].map(([path,data])=>({path:'/'+path,type:'binary',data}));files.find(file=>file.path===SID_PROJECT_MANIFEST).data=new TextEncoder().encode(JSON.stringify(manifest));
    const bytes=createPlaygroundCassetteZip(files,{directories:archive.directories,preserveMetadataFiles:true});await assert.rejects(project.prepareImport(bytes));assert.deepEqual(project.snapshot(),stable);
  }
  await assert.rejects(project.prepareImport(project.exportProject(),{isCurrent:()=>false}),/cancelled/);assert.deepEqual(project.snapshot(),stable);
});

test('equal accepted sound caches are aliased in ZIP recovery without changing public snapshots',async()=>{
  const project=setup(),archive=await loadPlaygroundCassette(project.exportProject());
  const manifest=JSON.parse(new TextDecoder().decode(archive.files.get(SID_PROJECT_MANIFEST.slice(1))));
  assert.equal(manifest.savedSettingsSource,'settings');assert.equal(manifest.savedSettings,undefined);
  assert.deepEqual(createSidCodeProject({snapshot:await project.prepareImport(project.exportProject())}).snapshot(),project.snapshot());
});

test('expanded Cassette budget includes changed binary recovery instead of silently omitting its working version',()=>{
  const project=setup(),bytes=new Uint8Array(7*1024*1024).fill(1);project.importFiles([{path:'/large.bin',type:'binary',data:bytes}]);project.setAutoApply(false);
  bytes.fill(2);project.fs.writeFile('/large.bin',bytes);const before=project.snapshot();assert.throws(()=>project.exportProject(),/16 MiB/);assert.deepEqual(project.snapshot(),before);
});

test('partial Save and Discard reject a combined version over capacity without publishing either layer',()=>{
  const project=createSidCodeProject();project.importFiles([{path:'/first.bin',type:'binary',data:new Uint8Array(9*1024*1024)},
    {path:'/second.bin',type:'binary',data:Uint8Array.of(1)}]);project.setAutoApply(false);
  project.fs.remove('/first.bin');project.fs.writeFile('/second.bin',new Uint8Array(9*1024*1024).fill(2));const before=project.snapshot();
  let changes=0;project.onDidChange(()=>changes++);
  assert.throws(()=>project.saveFiles(['/second.bin']),/16 MiB/);assert.deepEqual(project.snapshot(),before);
  assert.throws(()=>project.discardFiles(['/first.bin']),/16 MiB/);assert.deepEqual(project.snapshot(),before);assert.equal(changes,0);
  project.saveAll();assert.deepEqual(project.fs.snapshot(),project.savedFs.snapshot());
});

test('JavaScript UTF-8 bound and manifest reservation validate both snapshot layers before restore',()=>{
  const project=setup(),oversized='曲'.repeat(Math.floor(SID_PROJECT_CODE_LENGTH/3)+1),before=project.snapshot();
  assert(oversized.length<SID_PROJECT_CODE_LENGTH);assert.throws(()=>project.writeEditorText('/index.js',oversized),/2 MiB/);assert.deepEqual(project.snapshot(),before);
  for(const layer of ['working','saved']){
    const invalid=structuredClone(before);invalid.workspace.autoSave=false;
    invalid.workspace[layer].files.find(file=>file.path==='/index.js').data=oversized;
    if(layer==='working')invalid.filesystem=invalid.workspace.working;
    assert.throws(()=>project.restore(invalid),/2 MiB/);assert.deepEqual(project.snapshot(),before);
    const reserved=structuredClone(before);reserved.workspace.autoSave=false;reserved.workspace[layer].directories.push(SID_PROJECT_MANIFEST);
    if(layer==='working')reserved.filesystem=reserved.workspace.working;
    assert.throws(()=>project.restore(reserved),/reserved/);assert.deepEqual(project.snapshot(),before);
  }
  assert.throws(()=>project.importFiles([{path:SID_PROJECT_MANIFEST+'/entry.js',data:'reserved'}]),/reserved/);
  assert.deepEqual(project.snapshot(),before);
});

test('v1 Cassette migration preserves source formatting, opaque SID and unrelated UTF-8 bytes',async()=>{
  const project=setup(),sound=project.settings;sound.channels[2].voice.waveform='noise';const source='\uFEFF'+JSON.stringify(sound,null,4)+'\r\n';
  const manifest={format:SID_PROJECT_FORMAT,version:1,name:'Legacy SID',settings:sound,selectedPath:'/presets/old.json',codeState:{mode:'keyboard',path:'/presets/old.json'}};
  const vgm=Uint8Array.of(0x50,0x53,0x49,0x44,0xff),zip=createPlaygroundCassetteZip([
    {path:'/index.js',type:'text',data:'// original\r\n'}, {path:'/presets/old.json',type:'text',data:source},
    {path:'/notes.txt',type:'text',data:'\uFEFFuntouched\r\n'}, {path:'/songs/original.sid',type:'binary',data:vgm},
    {path:SID_PROJECT_MANIFEST,type:'text',data:JSON.stringify(manifest)},
  ]);
  const copy=createSidCodeProject({snapshot:await project.prepareImport(zip)});assert.equal(copy.autoApply,true);assert.equal(copy.snapshot().version,2);
  assert.equal(copy.fs.get('/presets/old.json').data,source);assert.equal(copy.savedFs.get('/notes.txt').data,'\uFEFFuntouched\r\n');
  assert.deepEqual(copy.savedFs.get('/songs/original.sid').data,vgm);assert.deepEqual(copy.settings,sound);assert.deepEqual(copy.savedSettings,sound);
  const archive=await loadPlaygroundCassette(copy.exportProject());assert.deepEqual(archive.files.get('presets/old.json'),new TextEncoder().encode(source));
});

test('workspace listeners observe fresh Files metadata and Save does not execute source',()=>{
  const project=setup();project.listEntries();let observed;
  project.onDidChange(()=>{observed=project.listEntries().find(file=>file.path==='/new.js');});
  project.setAutoApply(false);project.fs.writeText('/new.js','globalThis.__sidSaveExecuted=true;');assert(observed);assert.equal(observed.size,34);
  project.saveFiles(['/new.js']);assert.equal(globalThis.__sidSaveExecuted,undefined);assert.equal(project.savedFs.get('/new.js').data,'globalThis.__sidSaveExecuted=true;');
});

function independentSettings(model='6581'){
  const settings=createChannelSettings(createDefaultPreset({model}));
  settings.target=1;settings.keyboardMode='legato';
  settings.channels[0].voice.waveform='triangle+saw';settings.channels[0].voice.attack=3;
  settings.channels[1].voice.waveform='pulse';settings.channels[1].voice.pulseWidth=731;
  settings.channels[1].modulation={sync:true,ring:true,ratio:.25};
  settings.channels[2].voice.waveform='noise';settings.channels[2].voice.sustain=4;
  for(const preset of settings.channels)preset.filter={enabled:true,mode:'lowpass+bandpass+highpass',cutoff:417,resonance:9,volume:6};
  return readChannelSettings(settings);
}

test('each SID model and three independent patches survive pending edits and channel selection without unification',async()=>{
  for(const model of ['6581','8580']){
    const accepted=independentSettings(model),project=createSidCodeProject({settings:accepted,starterCode:'// never run'});
    project.importFiles([{path:'/presets/three.sid-channels.json',data:JSON.stringify(accepted,null,4)+'\r\n'}]);
    project.setAutoApply(false);project.setActiveSoundPath('/presets/three.sid-channels.json');
    const working=project.settings;working.channels[1].voice.pulseWidth=975;
    project.setSettings(working);project.writeEditorText('/presets/three.sid-channels.json',JSON.stringify(working));
    project.select('/presets/three.sid-channels.json');project.setCodeState({mode:'keyboard',path:'/presets/three.sid-channels.json'});
    assert.deepEqual(project.savedSettings,accepted);assert.deepEqual(project.settings,working);
    const roundRobin=selectChannelTarget(project.settings,'round-robin');
    assert.deepEqual(roundRobin.channels,working.channels,'selecting round robin retains each patch');
    project.setSettings(roundRobin);assert.deepEqual(project.savedSettings,accepted);
    const before=project.snapshot(),copy=createSidCodeProject({snapshot:await project.prepareImport(project.exportProject())});
    assert.deepEqual(copy.snapshot(),before);assert.deepEqual(copy.settings.channels,working.channels);
    assert.equal(copy.settings.channels[0].voice.waveform,'triangle+saw');
    assert.equal(copy.settings.channels[1].modulation.sync,true);assert.equal(copy.settings.channels[1].modulation.ring,true);
    assert(copy.settings.channels.every(preset=>preset.model===model&&preset.filter.cutoff===417));
    assert.equal(globalThis.mustNotRun,undefined);
  }
});

test('portable voice and setup v1/v2 are decoded contextually without rewriting their original source files',async()=>{
  const baseline=independentSettings(),voice=createDefaultPreset({model:'8580'});voice.voice.waveform='triangle+pulse';voice.voice.pulseWidth=1234;
  const oldVoice=createDefaultPreset();oldVoice.version=1;delete oldVoice.model;
  const setup=independentSettings('8580'),oldSetup=independentSettings();oldSetup.version=1;delete oldSetup.keyboardMode;
  const sources=[oldVoice,voice,oldSetup,setup].map((sound,index)=>({path:`/presets/original-${index}.json`,type:'text',data:JSON.stringify(sound,null,'\t')+'\r\n'}));
  const project=createSidCodeProject({settings:baseline});project.importFiles(sources);
  const before=project.snapshot();
  for(const file of sources){
    const parsed=readSidProjectSound(file.data,baseline);assert(parsed);project.select(file.path);
    assert.deepEqual(project.settings,baseline,'file metadata selection alone does not apply its sound');
    assert.deepEqual(project.savedSettings,baseline);assert.equal(project.fs.get(file.path).data,file.data);
  }
  const selected=readSidProjectSound(sources[1].data,baseline);
  assert.equal(selected.target,1);assert.equal(selected.keyboardMode,'legato');assert.equal(selected.channels[1].voice.waveform,'triangle+pulse');
  assert.equal(selected.channels[0].voice.waveform,baseline.channels[0].voice.waveform);
  assert.equal(selected.channels[2].voice.waveform,baseline.channels[2].voice.waveform);
  assert(selected.channels.every(preset=>preset.model==='8580'),'the SID model remains shared when one voice is loaded');
  assert.equal(readSidProjectSound(sources[0].data,baseline).channels[1].model,'6581');
  assert.equal(readSidProjectSound(sources[2].data,baseline).keyboardMode,'retrigger');
  const copy=createSidCodeProject({snapshot:await project.prepareImport(project.exportProject())});
  for(const file of sources)assert.equal(copy.savedFs.get(file.path).data,file.data);
  assert.deepEqual(copy.settings,before.settings);
});

test('a true SID v1 project migrates independent channel data, source files and raw SID bytes without reseeding',async()=>{
  const current=independentSettings('8580'),settingsV1=structuredClone(current);settingsV1.version=1;delete settingsV1.keyboardMode;
  const raw=Uint8Array.of(0x50,0x53,0x49,0x44,0,2,0,0x7c,0xff,0);
  const portable=createDefaultPreset();portable.version=1;delete portable.model;
  const source=JSON.stringify(portable,null,2)+'\r\n',manifest={format:SID_PROJECT_FORMAT,version:1,name:'SID legacy',settings:settingsV1,
    selectedPath:'/presets/old.sid-voice.json',codeState:{mode:'keyboard',path:'/index.js'}};
  const zip=createPlaygroundCassetteZip([{path:'/index.js',type:'text',data:'// old source\r\n'},
    {path:'/presets/old.sid-voice.json',type:'text',data:source},{path:'/songs/original.sid',type:'binary',data:raw},
    {path:SID_PROJECT_MANIFEST,type:'text',data:JSON.stringify(manifest)}]);
  const original=createSidCodeProject({getStarterCode:()=>{throw Error('restoring must not reseed starter Code');},snapshot:await createSidCodeProject().prepareImport(zip)});
  assert.equal(original.snapshot().version,2);assert.equal(original.autoApply,true);assert.deepEqual(original.fs.snapshot(),original.savedFs.snapshot());
  assert.deepEqual(original.settings.channels,current.channels);assert.equal(original.settings.keyboardMode,'retrigger');
  assert.equal(original.savedFs.get('/index.js').data,'// old source\r\n');assert.equal(original.fs.get('/presets/old.sid-voice.json').data,source);
  const archive=await loadPlaygroundCassette(original.exportProject());assert.deepEqual(archive.files.get('songs/original.sid'),raw);
  const v2=JSON.parse(new TextDecoder().decode(archive.files.get(SID_PROJECT_MANIFEST.slice(1))));
  assert(!v2.workingDelta.files.some(file=>file.path==='/songs/original.sid'),'unchanged SID source is stored once');
  assert.deepEqual(archive.files.get('presets/old.sid-voice.json'),new TextEncoder().encode(source));
});

test('incompatible accepted or working SID caches reject both layers atomically',()=>{
  const project=createSidCodeProject({settings:independentSettings('8580'),starterCode:'// kept'}),before=project.snapshot();
  for(const key of ['settings','savedSettings'])for(const corrupt of [
    value=>value.channels[1].model='6581',value=>value.channels[2].filter.cutoff++,value=>value.target=3,
  ]){
    const invalid=structuredClone(before);corrupt(invalid[key]);
    assert.throws(()=>project.restore(invalid));assert.deepEqual(project.snapshot(),before);
  }
});
