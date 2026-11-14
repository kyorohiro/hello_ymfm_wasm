import test from 'node:test';
import assert from 'node:assert/strict';
import {setupHuc6280CodeFiles} from './code_files.js';
import {createHuc6280CodeProject,HUC6280_PROJECT_FILE_BYTES,isHuc6280SongPath} from './code_project.js';
import {createDefaultPreset,readPreset} from './preset.js';
import {encodeDdaData,MAX_PRESET_BYTES} from './dda_pcm.js';

class Element{
  constructor(doc,tag='div'){Object.assign(this,{ownerDocument:doc,tagName:tag.toUpperCase(),children:[],listeners:new Map(),attributes:{},dataset:{},style:{},parentNode:null,hidden:false,value:'',disabled:false});const names=new Set();this.classList={toggle:(name,on)=>on?names.add(name):names.delete(name),contains:name=>names.has(name),add:name=>names.add(name),remove:name=>names.delete(name)};}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}appendChild(node){this.append(node);return node;}replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this.append(...nodes);}remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  querySelectorAll(selector){return walk(this).filter(node=>selector==='button'&&node.tagName==='BUTTON');}
  focus(){this.ownerDocument.activeElement=this;}blur(){if(this.ownerDocument.activeElement===this)this.ownerDocument.activeElement=null;}select(){}showModal(){this.open=true;}close(){this.open=false;}
  async fire(type,extra={}){const event={target:this,preventDefault(){},stopPropagation(){},...extra};for(const fn of this.listeners.get(type)??[])await fn(event);}
}
const walk=node=>[node,...node.children.flatMap(walk)],deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const extractedVoice=(kind,name,volume=31,changes={})=>({kind,id:name,channel:1,occurrences:1,firstTime:0,
  preset:{...createDefaultPreset(),source:kind==='pcm'?'dda':kind==='noise'?'noise':'wave',name,volume,...changes}});
function fixture(t,options={}){
  const doc=new Element(null,'document');doc.ownerDocument=doc;doc.body=doc;doc.createElement=tag=>new Element(doc,tag);doc.getElementById=id=>walk(doc).find(node=>node.id===id);doc.defaultView=new Element(doc,'window');
  const main=new Element(doc);doc.append(main);doc.querySelector=selector=>selector==='.huc-main'?main:null;
  for(const id of ['hucFilesPanel','hucFilesToggle','synthWorkspace']){const node=new Element(doc);node.id=id;node.hidden=id==='hucFilesPanel';doc.append(node);}
  const select=new Element(doc,'select');select.id='hucPresetSelect';doc.append(select);
  const previous=globalThis.document;globalThis.document=doc;t.after(()=>{globalThis.document=previous;});
  let settings=readPreset(options.settings??createDefaultPreset());const project=options.project??createHuc6280CodeProject({settings,starterCode:'// kept'}),writes=[],calls=[],opened=[],statuses=[];
  const store=options.store??{read:async()=>null,write:async value=>{writes.push(structuredClone(value));return true;},close:async()=>{}};
  const files=setupHuc6280CodeFiles({project,document:doc,store,getSettings:()=>settings,applySettings:async value=>{calls.push(['apply',value]);settings=readPreset(value);},onBeforeSoundApply:async()=>calls.push(['sound']),onBeforeWorkspaceReplace:async()=>calls.push(['before']),setStatus:message=>statuses.push(message),...options});
  files.setCodeControls({flush:async()=>true,openFile:async(path,options)=>{opened.push({path,options});return true;},setBusy(){}});
  t.after(()=>files.dispose());return{files,project,doc,writes,calls,opened,statuses,setSettings(value){settings=readPreset(value);}};
}

test('HuC6280 saves named presets without acquiring audio, applying or changing Code mode/focus',async t=>{
  const f=fixture(t);await f.files.ready;let flushes=0;
  f.files.setCodeControls({activePath:'/index.js',executionPath:'/index.js',isCodeMode:()=>false,setBusy(){},flush:async()=>{flushes++;return true;},openFile:async(path,options)=>f.opened.push({path,options}),stop:()=>assert.fail('Save never stops'),workspaceReplaced:()=>assert.fail('Save never replaces')});
  const one=await f.files.saveSound();assert.equal(one,'/presets/Sine.huc6280.json');assert.deepEqual(JSON.parse(f.project.fs.get(one).data),createDefaultPreset());
  f.project.fs.mkdir('/presets/SINE (2).huc6280.json');const two=await f.files.saveSound();assert.equal(two,'/presets/Sine (3).huc6280.json');
  assert.deepEqual(f.opened,[one,two].map(path=>({path,options:{show:false}})));assert.deepEqual(f.calls,[]);assert.equal(f.doc.getElementById('hucFilesPanel').hidden,false);
  assert.equal(f.doc.getElementById('hucFileTextEditor'),undefined);assert.equal(f.doc.getElementById('hucPresetSelect').value,'','Saving does not imply a preset was loaded');
});

test('VGM archive saves grouped portable presets and original bytes atomically without applying, selecting or stopping Code',async t=>{
  const f=fixture(t);await f.files.ready;
  f.project.select('/index.js');f.project.setCodeState({mode:'code',path:'/index.js'});
  const selection=f.project.selectedPath,codeState=f.project.getCodeState(),settings=f.project.settings;
  f.files.setCodeControls({activePath:'/index.js',executionPath:'/index.js',isCodeMode:()=>true,setBusy(){},flush:async()=>true,
    openFile:()=>assert.fail('Import must not open a preset'),stop:()=>assert.fail('Import must not stop Code'),workspaceReplaced:()=>assert.fail('Import must not replace Code')});
  const quiet=extractedVoice('wave','Quiet',3),loud=extractedVoice('wave','Loud',27),pan=extractedVoice('wave','Different balance',31,{pan:{left:2,right:7}});
  const pcmQuiet=extractedVoice('pcm','PCM quiet',2),pcmLoud=extractedVoice('pcm','PCM loud',19);
  const noiseA=extractedVoice('noise','Noise A',3),noiseB=extractedVoice('noise','Noise B',27);
  const lfoA=extractedVoice('lfo','LFO A',4),lfoB=extractedVoice('lfo','LFO B',29);
  const raw=Uint8Array.of(99,31,139,8,255,88).subarray(1,5),voices=[quiet,loud,pan,pcmQuiet,pcmLoud,noiseA,noiseB,lfoA,lfoB];
  const result=await f.files.importVgm({name:'Song.vgz',bytes:raw,voices},{announce:false});
  assert.equal(result.songPath,'/vgm/Song.vgz');assert.equal(result.presetDirectory,'/presets/Song');assert.equal(result.keepLoudestVolume,true);assert.equal(result.persisted,true);
  assert.equal(result.presetPaths.length,7);assert.deepEqual(f.project.fs.get(result.songPath).data,raw);
  const sounds=result.presetPaths.map(path=>JSON.parse(f.project.fs.get(path).data));
  assert.deepEqual(sounds.map(sound=>sound.name),['Loud','Different balance','PCM loud','Noise A','Noise B','LFO A','LFO B']);
  assert.deepEqual(sounds[0],readPreset(loud.preset));assert.deepEqual(sounds[2],readPreset(pcmLoud.preset));
  assert.equal(quiet.preset.volume,3);assert.equal(pcmQuiet.preset.volume,2,'grouping does not scale or mutate canonical sample data');
  assert.deepEqual(f.project.settings,settings);assert.equal(f.project.selectedPath,selection);assert.deepEqual(f.project.getCodeState(),codeState);assert.deepEqual(f.calls,[]);assert.deepEqual(f.opened,[]);
  assert.equal(f.doc.getElementById('hucPresetSelect').children.length,8,'all seven saved sounds immediately enter the preset picker');
  const exported=await f.files.exportProject(),restored=createHuc6280CodeProject();restored.restore(await restored.prepareImport(exported));
  assert.deepEqual(restored.fs.get(result.songPath).data,raw);
  for(const path of result.presetPaths)assert.deepEqual(readHuc6280ProjectSoundForTest(restored.fs.get(path).data),readHuc6280ProjectSoundForTest(f.project.fs.get(path).data));
});

function readHuc6280ProjectSoundForTest(data){return readPreset(JSON.parse(data));}

test('VGM preset directories and voice files avoid case-folded files and folders without overwriting earlier imports',async t=>{
  const f=fixture(t);await f.files.ready;
  f.project.importFiles([{path:'/presets/SONG',data:'user file'},{path:'/vgm/SONG.VGM',type:'binary',data:Uint8Array.of(7)}]);
  const one=await f.files.importVgm({name:'Song.vgm',bytes:Uint8Array.of(1),voices:[extractedVoice('noise','A/B'),extractedVoice('noise','A\\B')]});
  assert.equal(one.songPath,'/vgm/Song (2).vgm');assert.equal(one.presetDirectory,'/presets/Song (2)');
  assert.deepEqual(one.presetPaths,['/presets/Song (2)/A_B.huc6280.json','/presets/Song (2)/A_B (2).huc6280.json']);
  const two=await f.files.importVgm({name:'song.vgm',bytes:Uint8Array.of(2),voices:[extractedVoice('wave','CON')]});
  assert.equal(two.presetDirectory,'/presets/song (3)');assert.equal(two.presetPaths[0],'/presets/song (3)/_CON.huc6280.json');
  assert.equal(f.project.fs.get('/presets/SONG').data,'user file');assert.deepEqual(f.project.fs.get('/vgm/SONG.VGM').data,Uint8Array.of(7));
  assert.deepEqual(f.project.fs.get(one.songPath).data,Uint8Array.of(1));
});

test('VGM archive validation and cassette limits leave no source or partial preset files',async t=>{
  const f=fixture(t);await f.files.ready;const before=f.project.snapshot();
  const bad=extractedVoice('wave','Invalid');bad.preset.wave=[1];
  await assert.rejects(f.files.importVgm({name:'invalid.vgm',bytes:Uint8Array.of(1),voices:[extractedVoice('wave','Valid'),bad]}),/exactly 32 samples/);
  assert.deepEqual(f.project.snapshot(),before);
  f.project.importFiles([{path:'/padding.bin',type:'binary',data:new Uint8Array(HUC6280_PROJECT_FILE_BYTES-100)}]);const full=f.project.snapshot();
  await assert.rejects(f.files.importVgm({name:'full.vgm',bytes:Uint8Array.of(1),voices:[extractedVoice('wave','Sine')]}),/16 MiB/);
  assert.deepEqual(f.project.snapshot(),full);
});

test('VGM archive cancellation, replacement and disposal during Code flush cannot insert late files',async t=>{
  const f=fixture(t);await f.files.ready;const original=f.project.snapshot();let current=true;
  const gate=deferred();f.files.setCodeControls({flush:()=>gate.promise,setBusy(){}});
  const pending=f.files.importVgm({name:'cancelled.vgm',bytes:Uint8Array.of(1),voices:[extractedVoice('wave','Cancelled')]},{isCurrent:()=>current});
  await new Promise(resolve=>setImmediate(resolve));current=false;gate.resolve();await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(f.project.snapshot(),original);
  const old=deferred();let flushes=0;f.files.setCodeControls({flush:async()=>{if(++flushes===1)await old.promise;},setBusy(){}});
  const first=f.files.importVgm({name:'old.vgm',bytes:Uint8Array.of(1),voices:[extractedVoice('wave','Old')]});
  await new Promise(resolve=>setImmediate(resolve));const latest=await f.files.importVgm({name:'latest.vgm',bytes:Uint8Array.of(2),voices:[extractedVoice('wave','Latest')]});old.resolve();
  await assert.rejects(first,{name:'AbortError'});assert(f.project.fs.has(latest.songPath));assert(!f.project.fs.has('/vgm/old.vgm'));
  const closing=deferred();let turns=0;f.files.setCodeControls({flush:async()=>{if(++turns===1)await closing.promise;},setBusy(){}});
  const late=f.files.importVgm({name:'closed.vgm',bytes:Uint8Array.of(3),voices:[extractedVoice('wave','Closed')]});
  await new Promise(resolve=>setImmediate(resolve));await f.files.dispose();closing.resolve();await assert.rejects(late,{name:'AbortError'});assert(!f.project.fs.has('/vgm/closed.vgm'));
});

test('song-only VGM import preserves compatibility and failed durable storage keeps exportable memory files',async t=>{
  let fail=false;const f=fixture(t,{store:{read:async()=>null,write:async()=>{if(fail)throw Error('quota');return true;},close:async()=>{}}});await f.files.ready;fail=true;
  const result=await f.files.importVgm({name:'silent.vgm',bytes:Uint8Array.of(1),voices:[]});
  assert.deepEqual(result.presetPaths,[]);assert.equal(result.presetDirectory,null);assert.equal(result.persisted,false);
  assert.deepEqual(f.project.fs.get(result.songPath).data,Uint8Array.of(1));assert.match(f.statuses.at(-1),/Local save unavailable.*export the project/);
  const exported=await f.files.exportProject(),copy=createHuc6280CodeProject();copy.restore(await copy.prepareImport(exported));assert.deepEqual(copy.fs.get(result.songPath).data,Uint8Array.of(1));
  assert.equal(await f.files.importSong(Uint8Array.of(9),'legacy.vgm',{announce:false}),'/vgm/legacy.vgm','existing importSong still returns a string');
});

test('workspace replacement during archive storage cannot publish old paths or roll back the new project',async t=>{
  const durable=deferred(),started=deferred();let writes=0;
  const f=fixture(t,{store:{read:async()=>null,write:async()=>{if(++writes===1){started.resolve();await durable.promise;}return true;},close:async()=>{}}});await f.files.ready;
  const pending=f.files.importVgm({name:'old.vgm',bytes:Uint8Array.of(1),voices:[extractedVoice('wave','Old')]});
  await started.promise;assert(f.project.fs.has('/vgm/old.vgm'),'the old batch committed before its durable write yielded');
  const fresh=createHuc6280CodeProject({starterCode:'// replacement project'});
  assert(await f.files.importProject(fresh.exportProject()));
  const latest=f.statuses.at(-1),snapshot=f.project.snapshot();durable.resolve();
  await assert.rejects(pending,{name:'AbortError'});
  assert.deepEqual(f.project.snapshot(),snapshot);assert.equal(f.statuses.at(-1),latest);assert.match(latest,/project imported/);
  assert(!f.project.fs.has('/vgm/old.vgm'));assert.equal(f.project.fs.get('/index.js').data,'// replacement project');
});

test('archive cancellation during Code flush is also guarded by project replacement',async t=>{
  const f=fixture(t);await f.files.ready;const gate=deferred(),begun=deferred();let flushes=0;
  f.files.setCodeControls({flush:async()=>{if(++flushes===1){begun.resolve();await gate.promise;}},setBusy(){}});
  const pending=f.files.importVgm({name:'late.vgm',bytes:Uint8Array.of(1),voices:[extractedVoice('wave','Late')]});
  await begun.promise;const fresh=createHuc6280CodeProject({starterCode:'// latest project'});assert(await f.files.importProject(fresh.exportProject()));
  const snapshot=f.project.snapshot();gate.resolve();await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(f.project.snapshot(),snapshot);
});

test('saving a selected channel snapshot keeps the common sound, editor path and running Code untouched',async t=>{
  const f=fixture(t);await f.files.ready;
  f.project.select('/index.js');f.project.setCodeState({mode:'code',path:'/index.js'});
  const common=f.project.settings,selection=f.project.selectedPath,state=f.project.getCodeState();let flushes=0;
  const snapshot=createDefaultPreset();snapshot.name='Song CH 3';snapshot.volume=9;snapshot.wave[0]=2;snapshot.envelope.enabled=false;
  f.files.setCodeControls({activePath:'/index.js',executionPath:'/index.js',isCodeMode:()=>true,setBusy(){},
    flush:async()=>{flushes++;return true;},
    openFile:()=>assert.fail('Saving a detached sound must not select the JSON'),
    stop:()=>assert.fail('Saving never stops Code'),workspaceReplaced:()=>assert.fail('Saving never replaces the workspace')});
  const saved=await f.files.saveSound({sound:snapshot,select:false});
  assert.equal(saved,'/presets/Song CH 3.huc6280.json');
  assert.deepEqual(JSON.parse(f.project.fs.get(saved).data),snapshot);
  assert.deepEqual(f.project.settings,common);assert.deepEqual(f.writes.at(-1).settings,common);
  assert.equal(f.project.selectedPath,selection);assert.deepEqual(f.project.getCodeState(),state);assert.deepEqual(f.calls,[]);
  assert.equal(flushes,0,'Saving a detached sound does not flush or change the active file');
  assert(f.doc.getElementById('hucPresetSelect').children.some(option=>option.value===saved),'Saved snapshot is immediately offered by the preset loader');
  assert.equal(f.doc.getElementById('hucPresetSelect').value,'','Saving does not imply the snapshot was applied');
  assert.match(f.statuses.at(-1),/Saved to \/presets\/Song CH 3/);
  snapshot.wave[0]=31;assert.equal(JSON.parse(f.project.fs.get(saved).data).wave[0],2,'Stored sound is detached from the observation');
});

test('invalid selected snapshots leave preset files and the common instrument atomic',async t=>{
  const f=fixture(t);await f.files.ready;const before=f.project.snapshot();
  await assert.rejects(f.files.saveSound({sound:{format:'other'},select:false}),/Expected a HuC6280 instrument/);
  await assert.rejects(f.files.saveSound({sound:createDefaultPreset(),select:'false'}),/must be boolean/);
  const incomplete=createDefaultPreset();incomplete.wave=[0];
  await assert.rejects(f.files.saveSound({sound:incomplete,select:false}),/exactly 32 samples/);
  assert.deepEqual(f.project.snapshot(),before);assert.deepEqual(f.calls,[]);assert.equal(f.doc.querySelector('.huc-main').inert,false);
});

test('Files examples are explicit, add missing files only and preserve active Code and selection',async t=>{
  const f=fixture(t);await f.files.ready;
  assert(!f.project.fs.has('/examples/huc6280.js'),'Examples are not silently inserted into new or restored projects');
  f.project.importFiles([{path:'/examples/cdda.js',data:'// user CD track'}]);
  f.project.select('/index.js');f.project.setCodeState({mode:'keyboard',path:'/index.js'});
  let flushes=0;f.files.setCodeControls({activePath:'/index.js',executionPath:'/index.js',isCodeMode:()=>false,setBusy(){},
    flush:async()=>{flushes++;return true;},openFile:()=>assert.fail('Adding examples does not select Code'),
    stop:()=>assert.fail('Adding examples never stops Code'),workspaceReplaced:()=>assert.fail('Adding examples does not replace the workspace')});
  const selected=f.project.selectedPath,state=f.project.getCodeState(),settings=f.project.settings;
  assert.deepEqual(await f.files.addExamples(),['/examples/huc6280.js','/examples/msm5205.js']);
  assert.equal(f.project.selectedPath,selected);assert.deepEqual(f.project.getCodeState(),state);assert.deepEqual(f.project.settings,settings);
  assert.equal(f.project.fs.get('/examples/cdda.js').data,'// user CD track');assert.deepEqual(f.calls,[]);
  f.project.writeEditorText('/examples/huc6280.js','// modified melody');assert.deepEqual(await f.files.addExamples(),[]);
  assert.equal(f.project.fs.get('/examples/huc6280.js').data,'// modified melody');assert.equal(f.doc.getElementById('hucFilesPanel').hidden,false);
  assert.equal(flushes,0,'Adding examples keeps the current editor');
  assert.equal(f.doc.getElementById('hucFileExamplesButton').disabled,false);assert.match(f.statuses.at(-1),/existing files were kept/);
});

test('Files examples reject a full project before adding any file',async t=>{
  const f=fixture(t);await f.files.ready;
  f.project.importFiles([{path:'/padding.bin',type:'binary',data:new Uint8Array(HUC6280_PROJECT_FILE_BYTES-100)}]);
  const before=f.project.snapshot();await assert.rejects(f.files.addExamples(),/16 MiB/);
  assert.deepEqual(f.project.snapshot(),before);assert.equal(f.doc.querySelector('.huc-main').inert,false);assert.equal(f.doc.getElementById('hucFileExamplesButton').disabled,false);
});

test('HuC6280 file selection preserves mode, text edits do not apply, explicit valid preset selection does',async t=>{
  const f=fixture(t);await f.files.ready;let mode=false;
  f.files.setCodeControls({flush:async()=>true,isCodeMode:()=>mode,openFile:async(path,options)=>f.opened.push({path,options}),setBusy(){}});
  f.project.importFiles([{path:'/notes.json',data:'{}'},{path:'/presets/Sine.huc6280.json',data:JSON.stringify(createDefaultPreset())},{path:'/unfinished.json',data:'{unfinished'}]);
  for(const path of ['/index.js','/notes.json','/presets/Sine.huc6280.json','/unfinished.json'])await f.files.selectFile(path);
  assert(f.opened.every(entry=>entry.options.show===false));assert.deepEqual(f.calls.map(entry=>entry[0]),['sound','apply']);assert.match(f.statuses.at(-1),/current sound kept/);
  mode=true;await f.files.selectFile('/notes.json');assert.equal(f.opened.at(-1).options.show,true);f.project.writeEditorText('/notes.json','{"unfinished":');await f.files.persistCode();assert.equal(f.calls.length,2);
});

test('HuC6280 JSON selection cancels pending execution before waiting for flush',async t=>{
  const f=fixture(t);await f.files.ready;f.project.importFiles([{path:'/notes.json',data:'{}'}]);const gate=deferred(),events=[];
  f.files.setCodeControls({cancelPendingExecution(){events.push('cancel');},flush:async()=>{events.push('flush');await gate.promise;},openFile:async()=>events.push('open'),setBusy(){}});
  const pending=f.files.selectFile('/notes.json');assert.deepEqual(events,['cancel']);await Promise.resolve();assert.deepEqual(events,['cancel','flush']);gate.resolve();await pending;assert.deepEqual(events,['cancel','flush','open']);
});

test('HuC6280 sound selection has a separate hook and failed/cancelled apply never marks a preset loaded',async t=>{
  let result=false,settings=createDefaultPreset();
  const f=fixture(t,{getSettings:()=>settings,applySettings:async value=>{if(result instanceof Error)throw result;if(result)settings=value;return result;},onBeforeWorkspaceReplace:()=>assert.fail('A sound is not a workspace replacement')});
  await f.files.ready;const next=createDefaultPreset();next.source='wave';next.wave[2]=3;
  f.project.importFiles([{path:'/Selected.huc6280.json',data:JSON.stringify(next)}]);const previous=f.project.settings;
  const initialSelection=f.project.selectedPath;
  assert.equal(await f.files.selectFile('/Selected.huc6280.json'),false);assert.deepEqual(f.project.settings,previous);assert.equal(f.project.selectedPath,initialSelection);
  result=Error('upload failed');await assert.rejects(f.files.selectFile('/Selected.huc6280.json'),/upload failed/);assert.deepEqual(f.project.settings,previous);
  assert.equal(f.doc.getElementById('hucPresetSelect').value,'');assert.deepEqual(f.calls.map(call=>call[0]),['sound','sound']);
  result=true;assert.equal(await f.files.selectFile('/Selected.huc6280.json'),true);assert.deepEqual(f.project.settings,next);
});

test('a Stop after sound commit persists the reconciled host sound without marking the cancelled selection applied',async t=>{
  let settings=createDefaultPreset();const next=structuredClone(settings);next.source='noise';
  const f=fixture(t,{getSettings:()=>settings,applySettings:async()=>{settings=next;return false;}});await f.files.ready;
  f.project.importFiles([{path:'/Selected.huc6280.json',data:JSON.stringify(next)}]);const selected=f.project.selectedPath;
  assert.equal(await f.files.selectFile('/Selected.huc6280.json'),false);
  assert.deepEqual(f.project.settings,next);assert.equal(f.project.selectedPath,selected);assert.equal(f.doc.getElementById('hucPresetSelect').value,'');
  await f.files.persistCode();assert.deepEqual(f.writes.at(-1).settings,next);
});

test('HuC6280 duplicate/rename/delete preserve binary data and stop only the executed JS path',async t=>{
  const f=fixture(t);await f.files.ready;f.project.importFiles([{path:'/folder/code.js',data:'kept'},{path:'/folder/raw.bin',type:'binary',data:Uint8Array.of(0,255)}]);
  let stops=0;const changes=[];f.files.setCodeControls({activePath:'/notes.json',executionPath:'/folder/code.js',flush:async()=>true,isCodeMode:()=>false,openFile:async()=>true,pathChanged:(...args)=>changes.push(args),stop:async()=>{stops++;},setBusy(){}});
  const copy=await f.files.duplicate('/folder');assert.equal(copy,'/folder-copy');assert.deepEqual(f.project.fs.get('/folder-copy/raw.bin').data,Uint8Array.of(0,255));assert.equal(stops,0);
  await f.files.move('/folder-copy/code.js','/folder-copy/code.json');assert.equal(stops,0);await f.files.remove('/folder-copy');assert.equal(stops,0);
  await f.files.move('/folder/code.js','/folder/code.json');assert.equal(stops,1);assert.deepEqual(changes.at(-1),['/folder/code.js','/folder/code.json']);
});

test('HuC6280 local restore and project import apply detached settings but never execute source',async t=>{
  const preset=createDefaultPreset();preset.source='wave';preset.wave[2]=3;const saved=createHuc6280CodeProject({settings:preset,starterCode:'throw Error("never run")'});saved.setCodeState({mode:'code',path:'/index.js'});
  const f=fixture(t,{store:{read:async()=>({...saved.snapshot(),workspaceId:'restored-huc',filesVisible:true}),write:async()=>true,close:async()=>{}}});await f.files.ready;
  assert.equal(f.files.workspaceId,'restored-huc');assert.deepEqual(f.project.settings,preset);assert.deepEqual(f.files.getCodeState(),{mode:'code',path:'/index.js'});assert.deepEqual(f.calls.map(entry=>entry[0]),['before','apply']);
  f.files.setCodeControls({flush:async()=>true,workspaceReplaced:async()=>true,restoreState:async()=>{},setBusy(){}});await f.files.importProject(saved.exportProject());assert.equal(f.project.fs.get('/index.js').data,'throw Error("never run")');assert.deepEqual(f.project.settings,preset);
});

test('HuC6280 malformed imports and capacity failure leave Files atomic',async t=>{
  const gate=deferred();const f=fixture(t,{store:{read:async()=>{await gate.promise;return null;},write:async()=>true,close:async()=>{}}});
  gate.resolve();await f.files.ready;const before=f.project.snapshot();await assert.rejects(f.files.importProject(Uint8Array.of(1,2,3)));assert.deepEqual(f.project.snapshot(),before);
  f.project.importFiles([{path:'/padding.bin',type:'binary',data:new Uint8Array(HUC6280_PROJECT_FILE_BYTES-100)}]);const full=f.project.snapshot();await assert.rejects(f.files.saveSound(),/16 MiB/);assert.deepEqual(f.project.snapshot(),full);assert.equal(f.doc.querySelector('.huc-main').inert,false);
});

test('late HuC6280 file reads cannot overwrite a newer edit or a disposed workspace',async t=>{
  const f=fixture(t);await f.files.ready;const gate=deferred();
  const pending=f.files.importFiles([{name:'stale.txt',size:4,arrayBuffer:()=>gate.promise}]);
  await f.files.createFile('/new.js');f.project.writeEditorText('/new.js','latest unflushed text');
  gate.resolve(new TextEncoder().encode('late').buffer);assert.deepEqual(await pending,[]);assert(!f.project.fs.has('/stale.txt'));assert.equal(f.project.fs.get('/new.js').data,'latest unflushed text');
  const disposedRead=deferred(),late=f.files.importFiles([{name:'after-close.txt',size:4,arrayBuffer:()=>disposedRead.promise}]);
  await f.files.dispose();disposedRead.resolve(new TextEncoder().encode('late').buffer);assert.deepEqual(await late,[]);assert(!f.project.fs.has('/after-close.txt'));
});

test('an external import generation can cancel a pending read without a newer Files operation',async t=>{
  const f=fixture(t);await f.files.ready;const before=f.project.snapshot(),gate=deferred();let current=true,secondReads=0,flushes=0;
  f.files.setCodeControls({flush:async()=>{flushes++;return true;},setBusy(){}});
  const pending=f.files.importFiles([
    {name:'superseded.huc6280.json',size:2,arrayBuffer:()=>gate.promise},
    {name:'never-read.txt',size:1,arrayBuffer:async()=>{secondReads++;return Uint8Array.of(1).buffer;}},
  ],{isCurrent:()=>current});
  await Promise.resolve();current=false;gate.resolve(new TextEncoder().encode('{}').buffer);
  assert.deepEqual(await pending,[]);assert.deepEqual(f.project.snapshot(),before);
  assert.equal(secondReads,0);assert.equal(flushes,0);assert.deepEqual(f.calls,[]);
  let reads=0;assert.deepEqual(await f.files.importFiles([{name:'already-old.txt',size:1,arrayBuffer:async()=>{reads++;return new ArrayBuffer(1);}}],{isCurrent:()=>false}),[]);
  assert.equal(reads,0);
});

test('an externally superseded import cannot commit after a pending editor flush',async t=>{
  const f=fixture(t);await f.files.ready;const before=f.project.snapshot(),gate=deferred();let current=true,entered;
  const begun=new Promise(resolve=>entered=resolve);
  f.files.setCodeControls({flush:async()=>{entered();await gate.promise;return true;},setBusy(){}});
  const pending=f.files.importFiles([{name:'superseded.json',size:2,arrayBuffer:async()=>new TextEncoder().encode('{}').buffer}],{isCurrent:()=>current});
  await begun;current=false;gate.resolve();assert.deepEqual(await pending,[]);assert.deepEqual(f.project.snapshot(),before);
  assert.deepEqual(f.calls,[]);
});

test('external import invalidation is checked after workspace retirement and before atomic replacement',async t=>{
  const f=fixture(t);await f.files.ready;const before=f.project.snapshot(),gate=deferred();let current=true,entered;
  const begun=new Promise(resolve=>entered=resolve);
  f.files.setCodeControls({activePath:'/index.js',executionPath:'/index.js',flush:async()=>true,setBusy(){},
    workspaceReplaced:async()=>{entered();await gate.promise;return true;},restoreState:()=>assert.fail('A cancelled replacement must not restore Code')});
  const pending=f.files.importFiles([{name:'index.js',size:4,arrayBuffer:async()=>new TextEncoder().encode('late').buffer}],{isCurrent:()=>current});
  await begun;current=false;gate.resolve();assert.deepEqual(await pending,[]);assert.deepEqual(f.project.snapshot(),before);
  assert.equal(f.doc.querySelector('.huc-main').inert,false);
});

test('HuC6280 local Files restoration retains a preset edited while storage was pending',async t=>{
  const gate=deferred(),old=createHuc6280CodeProject({starterCode:'restored code'}),f=fixture(t,{store:{read:()=>gate.promise,write:async()=>true,close:async()=>{}}});
  const edited=createDefaultPreset();edited.source='wave';edited.wave[0]=3;f.setSettings(edited);f.files.markSoundDirty();gate.resolve(old.snapshot());await f.files.ready;
  assert.deepEqual(f.project.settings,edited);assert.deepEqual(f.calls.at(-1),['apply',edited]);assert.equal(f.project.fs.get('/index.js').data,'restored code');
});

test('HuC6280 automatically persists an early sound edit after a slow successful startup read',async t=>{
  const gate=deferred(),saved=createHuc6280CodeProject({starterCode:'// durable source'}),writes=[];
  saved.importFiles([{path:'/raw/kept.bin',type:'binary',data:Uint8Array.of(0,128,255)}]);
  const f=fixture(t,{store:{read:()=>gate.promise,write:async value=>{writes.push(structuredClone(value));return true;},close:async()=>{}}});
  await Promise.resolve();
  // A selection change schedules a normal save while the source read is
  // pending. Let that debounce expire before allowing restoration to finish.
  f.files.rememberCodeState({mode:'code',path:'/index.js'});
  const edited=createDefaultPreset();edited.source='wave';edited.wave[1]=3;f.setSettings(edited);f.files.markSoundDirty();
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(writes.length,0);
  gate.resolve(saved.snapshot());await f.files.ready;
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(writes.length,1,'successful startup must reschedule the early edited sound without a manual save');
  const restored=createHuc6280CodeProject({snapshot:writes[0]});assert.deepEqual(restored.settings,edited);
  assert.equal(restored.fs.get('/index.js').data,'// durable source');assert.deepEqual(restored.fs.get('/raw/kept.bin').data,Uint8Array.of(0,128,255));
});

test('HuC6280 persistence waits for successful startup restoration and never reloads state during later saves',async t=>{
  const gate=deferred(),old=createHuc6280CodeProject({starterCode:'// durable source'}),writes=[];let reads=0;
  old.importFiles([{path:'/raw/kept.bin',type:'binary',data:Uint8Array.of(0,255)}]);
  const f=fixture(t,{store:{read:()=>{reads++;return gate.promise;},write:async value=>{writes.push(structuredClone(value));return true;},close:async()=>{}}});
  await Promise.resolve();assert.equal(await f.files.persistCode(),false);assert.equal(writes.length,0,'pending startup read must not save a default workspace');
  const edited=createDefaultPreset();edited.source='wave';edited.wave[0]=2;f.setSettings(edited);f.files.markSoundDirty();
  gate.resolve(old.snapshot());await f.files.ready;assert.equal(reads,1);assert.deepEqual(f.project.settings,edited);
  f.project.writeEditorText('/index.js','// latest live source');assert.equal(await f.files.persistCode(),true);
  assert.equal(reads,1,'save/reconnect never reruns startup restoration');
  assert.equal(writes.at(-1).filesystem.files.find(file=>file.path==='/index.js').data,'// latest live source');
  assert.deepEqual(f.project.fs.get('/raw/kept.bin').data,Uint8Array.of(0,255));
});

test('HuC6280 unread or invalid initial drafts cannot be overwritten by later edits, Files operations or disposal',async t=>{
  for(const failure of ['read','invalid'])await t.test(failure,async t=>{
    const writes=[],durable=createHuc6280CodeProject({starterCode:'// stored source'}).snapshot();
    const f=fixture(t,{store:{read:async()=>{if(failure==='read')throw new DOMException('Injected backend read error','UnknownError');return{...durable,format:'invalid'};},write:async value=>{writes.push(value);return true;},close:async()=>{}}});
    await f.files.ready;assert.match(f.statuses.at(-1),/Local project restore failed/);
    const edited=createDefaultPreset();edited.source='noise';f.setSettings(edited);f.files.markSoundDirty();
    f.project.writeEditorText('/index.js','// unsaved current edit');assert.equal(await f.files.persistCode(),false);
    await f.files.createFile('/notes.txt');assert.equal(writes.length,0);
    const exported=await f.files.exportProject(),copy=createHuc6280CodeProject();copy.restore(await copy.prepareImport(exported));
    assert.equal(copy.fs.get('/index.js').data,'// unsaved current edit');assert.deepEqual(copy.settings,edited);
    await f.files.dispose();assert.equal(writes.length,0,'shutdown must not save defaults over an unread draft');
  });
});

test('imported valid presets immediately enter the picker under unique paths without applying or stopping Code',async t=>{
  const f=fixture(t);await f.files.ready;const original=f.project.settings;
  f.project.fs.mkdir('/presets/Original.json',{recursive:true});
  let flushes=0;f.files.setCodeControls({activePath:'/index.js',executionPath:'/index.js',isCodeMode:()=>true,setBusy(){},
    flush:async()=>{flushes++;return true;},openFile:()=>assert.fail('Passive import never opens Code'),stop:()=>assert.fail('Passive import never stops Code'),workspaceReplaced:()=>assert.fail('Passive sound import never replaces Code')});
  const one=createDefaultPreset();one.name='Imported Wave';one.wave[0]=3;
  const two=createDefaultPreset();two.name='Imported DDA';two.source='dda';two.dda.data=encodeDdaData(Uint8Array.of(0,7,16,31));
  const sources=[JSON.stringify(one,null,3)+'\n',JSON.stringify(two,null,2)+'\n'];
  const make=(name,text)=>({name,size:new TextEncoder().encode(text).byteLength,arrayBuffer:async()=>new TextEncoder().encode(text).buffer});
  const paths=await f.files.importFiles([make('Original.json',sources[0]),make('ORIGINAL.JSON',sources[1]),make('notes.txt','plain notes'),
    {name:'raw.bin',size:3,arrayBuffer:async()=>Uint8Array.of(0,255,17).buffer}]);
  assert.deepEqual(paths,['/presets/Original (2).json','/presets/ORIGINAL (3).JSON','/notes.txt','/raw.bin']);
  assert.equal(f.project.fs.get(paths[0]).data,sources[0]);assert.equal(f.project.fs.get(paths[1]).data,sources[1]);
  assert.equal(f.project.fs.get('/notes.txt').data,'plain notes');assert.deepEqual(f.project.fs.get('/raw.bin').data,Uint8Array.of(0,255,17));
  assert.deepEqual(f.project.settings,original);assert.deepEqual(f.calls,[]);assert.equal(flushes,1);
  const values=f.doc.getElementById('hucPresetSelect').children.map(option=>option.value);assert(values.includes(paths[0]));assert(values.includes(paths[1]));
  assert.equal(f.doc.getElementById('hucPresetSelect').value,'','adding a preset does not imply selecting it');
});

test('silent import retains status ownership and invalid JSON remains editable at its original root path',async t=>{
  const f=fixture(t);await f.files.ready;const before=f.statuses.length;
  const valid=JSON.stringify(createDefaultPreset())+'\n',unfinished='{"format":"tetorica-huc6280-voice",';
  const make=(name,text)=>({name,size:text.length,arrayBuffer:async()=>new TextEncoder().encode(text).buffer});
  const paths=await f.files.importFiles([make('simple.json',valid),make('unfinished.json',unfinished)],{announce:false});
  assert.deepEqual(paths,['/presets/simple.json','/unfinished.json']);assert.equal(f.statuses.length,before);assert.equal(f.project.fs.get('/unfinished.json').data,unfinished);
  assert.equal(await f.files.selectFile('/unfinished.json'),true);assert.match(f.statuses.at(-1),/current sound kept/);assert.deepEqual(f.calls,[]);
});

test('an original 32 MiB preset remains an instrument concern rather than being truncated into a 16 MiB project',async t=>{
  const f=fixture(t);await f.files.ready;const before=f.project.snapshot();let reads=0;
  await assert.rejects(f.files.importFiles([{name:'large-pcm.json',size:MAX_PRESET_BYTES,arrayBuffer:async()=>{reads++;return new ArrayBuffer(0);}}]),/16 MiB.*Load preset/);
  assert.equal(reads,0);assert.deepEqual(f.project.snapshot(),before);assert.deepEqual(f.calls,[]);
});

test('DDA preset saves and project reload retain every DAC value and sample setting',async t=>{
  const value=createDefaultPreset();value.name='DAC sample';value.source='dda';
  value.dda={name:'Authored DAC',data:encodeDdaData(Uint8Array.from({length:4096},(_,i)=>i%32)),sampleRate:12000,rootNote:55,loop:true,speed:.5};
  const f=fixture(t,{settings:value});await f.files.ready;const path=await f.files.saveSound();
  assert.equal(path,'/presets/DAC sample.huc6280.json');assert.deepEqual(JSON.parse(f.project.fs.get(path).data),value);
  const exported=await f.files.exportProject(),copy=createHuc6280CodeProject();copy.restore(await copy.prepareImport(exported));
  assert.deepEqual(copy.settings,value);assert.deepEqual(JSON.parse(copy.fs.get(path).data),value);assert.deepEqual(f.calls,[]);
});

test('VGM imports preserve exact compressed bytes in unique portable paths without applying sounds or stopping Code',async t=>{
  const f=fixture(t);await f.files.ready;const before=f.project.settings,source=Uint8Array.of(0,31,139,8,255,7).subarray(1,5);
  f.project.fs.mkdir('/vgm/SONG.VGZ',{recursive:true});
  f.files.setCodeControls({activePath:'/index.js',executionPath:'/index.js',isCodeMode:()=>true,setBusy(){},flush:async()=>true,
    stop:()=>assert.fail('Import never stops Code'),openFile:()=>assert.fail('Song bytes never open Code'),workspaceReplaced:()=>assert.fail('Song import is not a workspace replacement')});
  const first=await f.files.importSong(source,'song.vgz');assert.equal(first,'/vgm/song (2).vgz');
  const paths=await f.files.importFiles([{name:'SONG.VGZ',size:source.byteLength,arrayBuffer:async()=>source.slice().buffer}]);
  assert.deepEqual(paths,['/vgm/SONG (3).VGZ']);assert.deepEqual(f.project.fs.get(first).data,source);
  assert.deepEqual(f.project.fs.get(paths[0]).data,source);assert.deepEqual(f.project.settings,before);assert.deepEqual(f.calls,[]);
  assert(isHuc6280SongPath(first));assert(!isHuc6280SongPath('/song.vgz'));assert(!isHuc6280SongPath('/vgm/../song.vgz'));
  await f.files.selectFile(first);assert.match(f.statuses.at(-1),/reference song selected.*Press Play.*instrument and Code are kept/);
  assert.deepEqual(f.opened,[]);assert.deepEqual(f.calls,[]);
  const copy=createHuc6280CodeProject();copy.restore(await copy.prepareImport(await f.files.exportProject()));
  assert.deepEqual(copy.fs.get(first).data,source);assert.deepEqual(copy.fs.get(paths[0]).data,source);
});

test('song copy cancellation and cassette limits keep prior source bytes and instrument intact',async t=>{
  const f=fixture(t);await f.files.ready;const raw=Uint8Array.of(1,2,3);
  await f.files.importSong(raw,'kept.vgm',{announce:false});const before=f.project.snapshot(),statuses=f.statuses.length;
  assert.equal(await f.files.importSong(raw,'ignored.vgm',{isCurrent:()=>false}),null);assert.deepEqual(f.project.snapshot(),before);
  await assert.rejects(f.files.importSong(new Uint8Array(16*1024*1024+1),'too-large.vgm'),/16 MiB/);assert.deepEqual(f.project.snapshot(),before);
  await assert.rejects(f.files.importSong(raw,'not-a-song.bin'),/\.vgm or .vgz/);assert.equal(f.statuses.length,statuses);
  const gate=deferred();let current=true,entered;const begun=new Promise(resolve=>entered=resolve);
  f.files.setCodeControls({setBusy(){},flush:async()=>{entered();await gate.promise;}});
  const pending=f.files.importSong(raw,'cancelled.vgm',{isCurrent:()=>current});await begun;current=false;gate.resolve();
  assert.equal(await pending,null);assert.deepEqual(f.project.snapshot(),before);assert.deepEqual(f.calls,[]);
});

