import test from 'node:test';
import assert from 'node:assert/strict';
import {setupGameboyCodeFiles} from './code_files.js';
import {createGameboyCodeProject,GAMEBOY_PROJECT_FILE_BYTES} from './code_project.js';
import {createDefaultPreset,readPreset} from './preset.js';

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
function fixture(t,options={}){
  const doc=new Element(null,'document');doc.ownerDocument=doc;doc.body=doc;doc.createElement=tag=>new Element(doc,tag);doc.getElementById=id=>walk(doc).find(node=>node.id===id);doc.defaultView=new Element(doc,'window');
  const main=new Element(doc);doc.append(main);doc.querySelector=selector=>selector==='.dmg-main'?main:null;
  for(const id of ['dmgFilesPanel','dmgFilesToggle','synthWorkspace']){const node=new Element(doc);node.id=id;node.hidden=id==='dmgFilesPanel';doc.append(node);}
  const select=new Element(doc,'select');select.id='dmgPresetSelect';doc.append(select);
  const previous=globalThis.document;globalThis.document=doc;t.after(()=>{globalThis.document=previous;});
  let settings=readPreset(options.settings??createDefaultPreset());const project=options.project??createGameboyCodeProject({settings,starterCode:'// kept'}),writes=[],calls=[],opened=[],statuses=[];
  const store=options.store??{read:async()=>null,write:async value=>{writes.push(structuredClone(value));return true;},close:async()=>{}};
  const files=setupGameboyCodeFiles({project,document:doc,store,getSettings:()=>settings,applySettings:async value=>{calls.push(['apply',value]);settings=readPreset(value);},onBeforeSoundApply:async()=>calls.push(['sound']),onBeforeWorkspaceReplace:async()=>calls.push(['before']),setStatus:message=>statuses.push(message),...options});
  files.setCodeControls({flush:async()=>true,openFile:async(path,options)=>{opened.push({path,options});return true;},setBusy(){}});
  t.after(()=>files.dispose());return{files,project,doc,writes,calls,opened,statuses,setSettings(value){settings=readPreset(value);}};
}

test('DMG saves named presets without acquiring audio, applying or changing Code mode/focus',async t=>{
  const f=fixture(t);await f.files.ready;let flushes=0;
  f.files.setCodeControls({activePath:'/index.js',executionPath:'/index.js',isCodeMode:()=>false,setBusy(){},flush:async()=>{flushes++;return true;},openFile:async(path,options)=>f.opened.push({path,options}),stop:()=>assert.fail('Save never stops'),workspaceReplaced:()=>assert.fail('Save never replaces')});
  const one=await f.files.saveSound();assert.equal(one,'/presets/Pulse.dmg.json');assert.deepEqual(JSON.parse(f.project.fs.get(one).data),createDefaultPreset());
  f.project.fs.mkdir('/presets/PULSE (2).dmg.json');const two=await f.files.saveSound();assert.equal(two,'/presets/Pulse (3).dmg.json');
  assert.deepEqual(f.opened,[one,two].map(path=>({path,options:{show:false}})));assert.deepEqual(f.calls,[]);assert.equal(f.doc.getElementById('dmgFilesPanel').hidden,false);
  assert.equal(f.doc.getElementById('dmgFileTextEditor'),undefined);assert.equal(f.doc.getElementById('dmgPresetSelect').value,'','Saving does not imply a preset was loaded');
});

test('DMG file selection preserves mode, text edits do not apply, explicit valid preset selection does',async t=>{
  const f=fixture(t);await f.files.ready;let mode=false;
  f.files.setCodeControls({flush:async()=>true,isCodeMode:()=>mode,openFile:async(path,options)=>f.opened.push({path,options}),setBusy(){}});
  f.project.importFiles([{path:'/notes.json',data:'{}'},{path:'/presets/Pulse.dmg.json',data:JSON.stringify(createDefaultPreset())},{path:'/unfinished.json',data:'{unfinished'}]);
  for(const path of ['/index.js','/notes.json','/presets/Pulse.dmg.json','/unfinished.json'])await f.files.selectFile(path);
  assert(f.opened.every(entry=>entry.options.show===false));assert.deepEqual(f.calls.map(entry=>entry[0]),['sound','apply']);assert.match(f.statuses.at(-1),/current sound kept/);
  mode=true;await f.files.selectFile('/notes.json');assert.equal(f.opened.at(-1).options.show,true);f.project.writeEditorText('/notes.json','{"unfinished":');await f.files.persistCode();assert.equal(f.calls.length,2);
});

test('DMG JSON selection cancels pending execution before waiting for flush',async t=>{
  const f=fixture(t);await f.files.ready;f.project.importFiles([{path:'/notes.json',data:'{}'}]);const gate=deferred(),events=[];
  f.files.setCodeControls({cancelPendingExecution(){events.push('cancel');},flush:async()=>{events.push('flush');await gate.promise;},openFile:async()=>events.push('open'),setBusy(){}});
  const pending=f.files.selectFile('/notes.json');assert.deepEqual(events,['cancel']);await Promise.resolve();assert.deepEqual(events,['cancel','flush']);gate.resolve();await pending;assert.deepEqual(events,['cancel','flush','open']);
});

test('DMG sound selection has a separate hook and failed/cancelled apply never marks a preset loaded',async t=>{
  let result=false,settings=createDefaultPreset();
  const f=fixture(t,{getSettings:()=>settings,applySettings:async value=>{if(result instanceof Error)throw result;if(result)settings=value;return result;},onBeforeWorkspaceReplace:()=>assert.fail('A sound is not a workspace replacement')});
  await f.files.ready;const next=createDefaultPreset();next.source='wave';
  f.project.importFiles([{path:'/Selected.dmg.json',data:JSON.stringify(next)}]);const previous=f.project.settings;
  const initialSelection=f.project.selectedPath;
  assert.equal(await f.files.selectFile('/Selected.dmg.json'),false);assert.deepEqual(f.project.settings,previous);assert.equal(f.project.selectedPath,initialSelection);
  result=Error('upload failed');await assert.rejects(f.files.selectFile('/Selected.dmg.json'),/upload failed/);assert.deepEqual(f.project.settings,previous);
  assert.equal(f.doc.getElementById('dmgPresetSelect').value,'');assert.deepEqual(f.calls.map(call=>call[0]),['sound','sound']);
  result=true;assert.equal(await f.files.selectFile('/Selected.dmg.json'),true);assert.deepEqual(f.project.settings,next);
});

test('a Stop after sound commit persists the reconciled host sound without marking the cancelled selection applied',async t=>{
  let settings=createDefaultPreset();const next=structuredClone(settings);next.source='noise';
  const f=fixture(t,{getSettings:()=>settings,applySettings:async()=>{settings=next;return false;}});await f.files.ready;
  f.project.importFiles([{path:'/Selected.dmg.json',data:JSON.stringify(next)}]);const selected=f.project.selectedPath;
  assert.equal(await f.files.selectFile('/Selected.dmg.json'),false);
  assert.deepEqual(f.project.settings,next);assert.equal(f.project.selectedPath,selected);assert.equal(f.doc.getElementById('dmgPresetSelect').value,'');
  await f.files.persistCode();assert.deepEqual(f.writes.at(-1).settings,next);
});

test('DMG duplicate/rename/delete preserve binary data and stop only the executed JS path',async t=>{
  const f=fixture(t);await f.files.ready;f.project.importFiles([{path:'/folder/code.js',data:'kept'},{path:'/folder/raw.bin',type:'binary',data:Uint8Array.of(0,255)}]);
  let stops=0;const changes=[];f.files.setCodeControls({activePath:'/notes.json',executionPath:'/folder/code.js',flush:async()=>true,isCodeMode:()=>false,openFile:async()=>true,pathChanged:(...args)=>changes.push(args),stop:async()=>{stops++;},setBusy(){}});
  const copy=await f.files.duplicate('/folder');assert.equal(copy,'/folder-copy');assert.deepEqual(f.project.fs.get('/folder-copy/raw.bin').data,Uint8Array.of(0,255));assert.equal(stops,0);
  await f.files.move('/folder-copy/code.js','/folder-copy/code.json');assert.equal(stops,0);await f.files.remove('/folder-copy');assert.equal(stops,0);
  await f.files.move('/folder/code.js','/folder/code.json');assert.equal(stops,1);assert.deepEqual(changes.at(-1),['/folder/code.js','/folder/code.json']);
});

test('DMG local restore and project import apply detached settings but never execute source',async t=>{
  const preset=createDefaultPreset();preset.source='wave';preset.wave.samples[2]=3;const saved=createGameboyCodeProject({settings:preset,starterCode:'throw Error("never run")'});saved.setCodeState({mode:'code',path:'/index.js'});
  const f=fixture(t,{store:{read:async()=>({...saved.snapshot(),workspaceId:'restored-dmg',filesVisible:true}),write:async()=>true,close:async()=>{}}});await f.files.ready;
  assert.equal(f.files.workspaceId,'restored-dmg');assert.deepEqual(f.project.settings,preset);assert.deepEqual(f.files.getCodeState(),{mode:'code',path:'/index.js'});assert.deepEqual(f.calls.map(entry=>entry[0]),['before','apply']);
  f.files.setCodeControls({flush:async()=>true,workspaceReplaced:async()=>true,restoreState:async()=>{},setBusy(){}});await f.files.importProject(saved.exportProject());assert.equal(f.project.fs.get('/index.js').data,'throw Error("never run")');assert.deepEqual(f.project.settings,preset);
});

test('DMG malformed imports and capacity failure leave Files atomic',async t=>{
  const gate=deferred();const f=fixture(t,{store:{read:async()=>{await gate.promise;return null;},write:async()=>true,close:async()=>{}}});
  gate.resolve();await f.files.ready;const before=f.project.snapshot();await assert.rejects(f.files.importProject(Uint8Array.of(1,2,3)));assert.deepEqual(f.project.snapshot(),before);
  f.project.importFiles([{path:'/padding.bin',type:'binary',data:new Uint8Array(GAMEBOY_PROJECT_FILE_BYTES-100)}]);const full=f.project.snapshot();await assert.rejects(f.files.saveSound(),/16 MiB/);assert.deepEqual(f.project.snapshot(),full);assert.equal(f.doc.querySelector('.dmg-main').inert,false);
});

test('late DMG file reads cannot overwrite a newer edit or a disposed workspace',async t=>{
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
    {name:'superseded.dmg.json',size:2,arrayBuffer:()=>gate.promise},
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
  assert.equal(f.doc.querySelector('.dmg-main').inert,false);
});

test('DMG local Files restoration retains a preset edited while storage was pending',async t=>{
  const gate=deferred(),old=createGameboyCodeProject({starterCode:'restored code'}),f=fixture(t,{store:{read:()=>gate.promise,write:async()=>true,close:async()=>{}}});
  const edited=createDefaultPreset();edited.source='wave';edited.wave.samples[0]=3;f.setSettings(edited);f.files.markSoundDirty();gate.resolve(old.snapshot());await f.files.ready;
  assert.deepEqual(f.project.settings,edited);assert.deepEqual(f.calls.at(-1),['apply',edited]);assert.equal(f.project.fs.get('/index.js').data,'restored code');
});

test('DMG automatically persists an early sound edit after a slow successful startup read',async t=>{
  const gate=deferred(),saved=createGameboyCodeProject({starterCode:'// durable source'}),writes=[];
  saved.importFiles([{path:'/raw/kept.bin',type:'binary',data:Uint8Array.of(0,128,255)}]);
  const f=fixture(t,{store:{read:()=>gate.promise,write:async value=>{writes.push(structuredClone(value));return true;},close:async()=>{}}});
  await Promise.resolve();
  // A selection change schedules a normal save while the source read is
  // pending. Let that debounce expire before allowing restoration to finish.
  f.files.rememberCodeState({mode:'code',path:'/index.js'});
  const edited=createDefaultPreset();edited.source='wave';edited.wave.samples[1]=3;f.setSettings(edited);f.files.markSoundDirty();
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(writes.length,0);
  gate.resolve(saved.snapshot());await f.files.ready;
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(writes.length,1,'successful startup must reschedule the early edited sound without a manual save');
  const restored=createGameboyCodeProject({snapshot:writes[0]});assert.deepEqual(restored.settings,edited);
  assert.equal(restored.fs.get('/index.js').data,'// durable source');assert.deepEqual(restored.fs.get('/raw/kept.bin').data,Uint8Array.of(0,128,255));
});

test('DMG persistence waits for successful startup restoration and never reloads state during later saves',async t=>{
  const gate=deferred(),old=createGameboyCodeProject({starterCode:'// durable source'}),writes=[];let reads=0;
  old.importFiles([{path:'/raw/kept.bin',type:'binary',data:Uint8Array.of(0,255)}]);
  const f=fixture(t,{store:{read:()=>{reads++;return gate.promise;},write:async value=>{writes.push(structuredClone(value));return true;},close:async()=>{}}});
  await Promise.resolve();assert.equal(await f.files.persistCode(),false);assert.equal(writes.length,0,'pending startup read must not save a default workspace');
  const edited=createDefaultPreset();edited.source='wave';edited.wave.samples[0]=2;f.setSettings(edited);f.files.markSoundDirty();
  gate.resolve(old.snapshot());await f.files.ready;assert.equal(reads,1);assert.deepEqual(f.project.settings,edited);
  f.project.writeEditorText('/index.js','// latest live source');assert.equal(await f.files.persistCode(),true);
  assert.equal(reads,1,'save/reconnect never reruns startup restoration');
  assert.equal(writes.at(-1).filesystem.files.find(file=>file.path==='/index.js').data,'// latest live source');
  assert.deepEqual(f.project.fs.get('/raw/kept.bin').data,Uint8Array.of(0,255));
});

test('DMG unread or invalid initial drafts cannot be overwritten by later edits, Files operations or disposal',async t=>{
  for(const failure of ['read','invalid'])await t.test(failure,async t=>{
    const writes=[],durable=createGameboyCodeProject({starterCode:'// stored source'}).snapshot();
    const f=fixture(t,{store:{read:async()=>{if(failure==='read')throw new DOMException('Injected backend read error','UnknownError');return{...durable,format:'invalid'};},write:async value=>{writes.push(value);return true;},close:async()=>{}}});
    await f.files.ready;assert.match(f.statuses.at(-1),/Local project restore failed/);
    const edited=createDefaultPreset();edited.source='noise';f.setSettings(edited);f.files.markSoundDirty();
    f.project.writeEditorText('/index.js','// unsaved current edit');assert.equal(await f.files.persistCode(),false);
    await f.files.createFile('/notes.txt');assert.equal(writes.length,0);
    const exported=await f.files.exportProject(),copy=createGameboyCodeProject();copy.restore(await copy.prepareImport(exported));
    assert.equal(copy.fs.get('/index.js').data,'// unsaved current edit');assert.deepEqual(copy.settings,edited);
    await f.files.dispose();assert.equal(writes.length,0,'shutdown must not save defaults over an unread draft');
  });
});

test('DMG Load VGM and Add files retain exact sources under unique /vgm paths without audio or Code mode changes',async t=>{
  const f=fixture(t);await f.files.ready;let flushes=0;
  f.files.setCodeControls({activePath:'/index.js',executionPath:'/index.js',isCodeMode:()=>true,flush:async()=>{flushes++;return true;},setBusy(){},openFile:()=>assert.fail('Song import does not open Code'),workspaceReplaced:()=>assert.fail('Song import does not stop Code')});
  const data=Uint8Array.of(31,139,8,255),path=await f.files.saveSongSource({name:'Original.VGZ',bytes:data});
  assert.equal(path,'/vgm/Original.VGZ');assert.deepEqual(f.project.fs.get(path).data,data);assert.equal(f.project.selectedPath,path);
  const paths=await f.files.importFiles([{name:'Original.VGZ',size:data.length,arrayBuffer:async()=>data.buffer},{name:'invalid.vgm',size:1,arrayBuffer:async()=>Uint8Array.of(0).buffer}]);
  assert.deepEqual(paths,['/vgm/Original-2.VGZ','/vgm/invalid.vgm']);assert.equal(f.project.selectedPath,'/vgm/invalid.vgm');
  assert.equal(await f.files.selectFile(path),true);assert.match(f.statuses.at(-1),/Press Play.*instrument is kept/);assert.deepEqual(f.calls,[]);assert(flushes>=3);
});

test('DMG song save preflights total capacity after flushing and rejects stale/disposed requests',async t=>{
  const f=fixture(t);await f.files.ready;let current=true;
  const gate=deferred();f.files.setCodeControls({flush:async()=>{await gate.promise;return true;},setBusy(){}});
  const pending=f.files.saveSongSource({name:'stale.vgm',bytes:Uint8Array.of(1)},{isCurrent:()=>current});current=false;gate.resolve();assert.equal(await pending,false);assert(!f.project.fs.has('/vgm/stale.vgm'));
  f.files.setCodeControls({flush:async()=>true,setBusy(){}});
  f.project.importFiles([{path:'/padding.bin',type:'binary',data:new Uint8Array(GAMEBOY_PROJECT_FILE_BYTES-10)}]);
  const before=f.project.snapshot();await assert.rejects(f.files.saveSongSource({name:'large.vgm',bytes:new Uint8Array(20)}),/16 MiB/);assert.deepEqual(f.project.snapshot(),before);
  await f.files.dispose();assert.equal(await f.files.saveSongSource({name:'after.vgm',bytes:Uint8Array.of(1)}),false);
});

test('DMG Capture atomically keeps old/new presets and untouched song bytes/revision, without changing Code mode',async t=>{
  const f=fixture(t);await f.files.ready;
  const raw=Uint8Array.of(0,255,17);f.project.importSongSources([{name:'song.vgm',bytes:raw}]);
  const sourcePath='/vgm/song.vgm',revision=f.project.fs.getRevision(sourcePath);let flushes=0;
  f.files.setCodeControls({activePath:'/index.js',executionPath:null,isCodeMode:()=>false,setBusy(){},flush:async()=>{if(flushes++===0)f.project.writeEditorText('/index.js','latest editor draft');return true;},
    openFile:async(path,options)=>f.opened.push({path,options}),stop:()=>assert.fail('Capture Files never stops a transport'),workspaceReplaced:()=>assert.fail('Capture does not replace Code')});
  const original=readPreset(createDefaultPreset()),captured=readPreset(original);captured.source='wave';captured.wave.samples[0]=1;
  const result=await f.files.saveCapturedSound(captured,{apply:async(value,{isCurrent})=>{assert(isCurrent());f.setSettings(value);}});
  assert.equal(result.originalPath,'/presets/Pulse.dmg.json');assert.equal(result.path,'/presets/Pulse (2).dmg.json');
  assert.deepEqual(JSON.parse(f.project.fs.get(result.originalPath).data),original);assert.deepEqual(JSON.parse(f.project.fs.get(result.path).data),captured);
  assert.deepEqual(f.project.settings,captured);assert.equal(f.project.fs.get('/index.js').data,'latest editor draft');
  assert.equal(f.project.fs.getRevision(sourcePath),revision);assert.deepEqual(f.project.fs.get(sourcePath).data,raw);
  assert.deepEqual(f.opened,[{path:result.path,options:{show:false}}]);assert.deepEqual(f.calls,[]);assert.equal(flushes,1);
});

test('DMG Capture preflight/failed/stale apply leaves Files and source selection untouched',async t=>{
  const f=fixture(t);await f.files.ready;const before=f.project.snapshot();
  await assert.rejects(f.files.saveCapturedSound(createDefaultPreset(),{apply:async()=>{throw Error('apply failed');}}),/apply failed/);assert.deepEqual(f.project.snapshot(),before);
  let current=true;assert.equal(await f.files.saveCapturedSound(createDefaultPreset(),{isCurrent:()=>current,apply:async()=>{current=false;}}),false);assert.deepEqual(f.project.snapshot(),before);
  f.project.importFiles([{path:'/padding.bin',type:'binary',data:new Uint8Array(GAMEBOY_PROJECT_FILE_BYTES-20)}]);const full=f.project.snapshot();
  await assert.rejects(f.files.saveCapturedSound(createDefaultPreset(),{apply:()=>assert.fail('Capacity must be checked before author changes')}),/16 MiB/);assert.deepEqual(f.project.snapshot(),full);
});

test('DMG committed Capture remains successful if Stop cancels the pending Code display',async t=>{
  const f=fixture(t);await f.files.ready;const gate=deferred();let current=true;
  f.files.setCodeControls({flush:async()=>true,setBusy(){},openFile:()=>gate.promise});
  const captured=createDefaultPreset();captured.name='Committed Capture';captured.source='noise';
  const saving=f.files.saveCapturedSound(captured,{isCurrent:()=>current,apply:async value=>f.setSettings(value)});
  while(!f.project.fs.has('/presets/Committed Capture.dmg.json'))await Promise.resolve();
  current=false;gate.resolve();const result=await saving;
  assert.equal(result.committed,true);assert.equal(result.path,'/presets/Committed Capture.dmg.json');
  assert.deepEqual(f.project.settings,captured);assert.deepEqual(JSON.parse(f.project.fs.get(result.path).data),captured);
  assert(f.writes.some(snapshot=>snapshot.settings.source==='noise'));
});

test('DMG committed Capture survives an editor display rejection and still persists the two presets',async t=>{
  const f=fixture(t);await f.files.ready;
  f.files.setCodeControls({flush:async()=>true,setBusy(){},openFile:async()=>{throw Error('Editor unavailable');}});
  const captured=createDefaultPreset();captured.name='Saved despite editor';captured.source='wave';
  const result=await f.files.saveCapturedSound(captured,{apply:async value=>f.setSettings(value)});
  assert.equal(result.committed,true);assert(f.project.fs.has(result.originalPath));assert(f.project.fs.has(result.path));
  assert.deepEqual(f.project.settings,captured);assert.match(f.statuses.at(-1),/Captured to.*Code display failed: Editor unavailable/);
  assert(f.writes.some(snapshot=>snapshot.settings.source==='wave'));
});

test('DMG VGM sounds save as a passive folder batch, keeping raw selection, unflushed Code and author settings',async t=>{
  const f=fixture(t);await f.files.ready;const raw=Uint8Array.of(1,255,0),song=await f.files.saveSongSource({name:'Reference.vgz',bytes:raw}),revision=f.project.fs.getRevision(song);
  f.project.setCodeState({mode:'code',path:'/index.js'});const original=f.project.settings;
  const focus=f.doc.createElement('textarea');f.doc.append(focus);focus.focus();let flushes=0;
  f.files.setCodeControls({activePath:'/index.js',executionPath:'/index.js',isCodeMode:()=>true,setBusy(){},flush:async()=>{if(flushes++===0)f.project.writeEditorText('/index.js','unflushed performance');return true;},
    openFile:()=>assert.fail('Batch save must not open Code'),stop:()=>assert.fail('Batch save must not stop Code'),workspaceReplaced:()=>assert.fail('Batch save must not replace Code')});
  const one=createDefaultPreset(),two=readPreset(one);two.name='Wave';two.source='wave';
  const result=await f.files.saveVgmSounds({name:'Reference.vgz',voices:[{preset:one},{preset:two}]});
  assert.deepEqual(result,{paths:['/presets/Reference/Pulse.dmg.json','/presets/Reference/Wave.dmg.json'],directory:'/presets/Reference'});
  assert.deepEqual(JSON.parse(f.project.fs.get(result.paths[0]).data),one);assert.deepEqual(JSON.parse(f.project.fs.get(result.paths[1]).data),two);
  assert.equal(f.project.selectedPath,song);assert.equal(f.project.fs.getRevision(song),revision);assert.deepEqual(f.project.fs.get(song).data,raw);
  assert.deepEqual(f.project.getCodeState(),{mode:'code',path:'/index.js'});assert.equal(f.project.fs.get('/index.js').data,'unflushed performance');assert.deepEqual(f.project.settings,original);
  assert.equal(f.doc.activeElement,focus);assert.deepEqual(f.calls,[]);assert.equal(f.doc.getElementById('dmgFilesPanel').hidden,false);assert.equal(f.doc.getElementById('dmgPresetSelect').value,'');
  assert.match(f.statuses.at(-1),/Saved 2 VGM sound\(s\).*Choose a preset/);
  const restored=createGameboyCodeProject({snapshot:await f.project.prepareImport(f.project.exportProject())});
  assert.deepEqual(restored.settings,original);assert.deepEqual(restored.fs.get(song).data,raw);assert.deepEqual(JSON.parse(restored.fs.get(result.paths[1]).data),two);
});

test('DMG VGM folders and batch filenames avoid portable Unicode, casefold, file and directory collisions',async t=>{
  const f=fixture(t);await f.files.ready;f.project.importFiles([{path:'/presets/CAFÉ',data:'existing file'}]);
  const one=createDefaultPreset();one.name='e\u0301';const two=readPreset(one);two.name='É';
  const result=await f.files.saveVgmSounds({name:'cafe\u0301.vgm',voices:[{preset:one},{preset:two}]});
  assert.deepEqual(result,{directory:'/presets/café (2)',paths:['/presets/café (2)/é.dmg.json','/presets/café (2)/É (2).dmg.json']});
  const next=await f.files.saveVgmSounds({name:'Café.VGZ',voices:[{preset:one}]});assert.equal(next.directory,'/presets/Café (3)');
  const reserved=await f.files.saveVgmSounds({name:'CON.vgm',voices:[{preset:one}]});assert.equal(reserved.directory,'/presets/_CON');
  const portable=await f.files.saveVgmSounds({name:'bad:*?.vgz',voices:[{preset:{...one,name:'A/B:*?'}}]});
  assert.equal(portable.directory,'/presets/bad___');assert.equal(portable.paths[0],'/presets/bad___/A_B___.dmg.json');
});

test('DMG VGM sound capacity or invalid voices fail atomically without removing the separately saved raw log',async t=>{
  const f=fixture(t);await f.files.ready;const source=await f.files.saveSongSource({name:'kept.vgm',bytes:Uint8Array.of(0,255)});
  const before=f.project.snapshot();await assert.rejects(f.files.saveVgmSounds({name:'bad.vgm',voices:[{preset:createDefaultPreset()},{preset:{}}]}));assert.deepEqual(f.project.snapshot(),before);
  const total=f.project.listEntries().reduce((sum,file)=>sum+file.size,0);f.project.importFiles([{path:'/padding.bin',type:'binary',data:new Uint8Array(GAMEBOY_PROJECT_FILE_BYTES-total-20)}]);
  const full=f.project.snapshot();await assert.rejects(f.files.saveVgmSounds({name:'full.vgm',voices:[{preset:createDefaultPreset()}]}),/16 MiB/);
  assert.deepEqual(f.project.snapshot(),full);assert.deepEqual(f.project.fs.get(source).data,Uint8Array.of(0,255));assert(!f.project.fs.listDirectories().includes('/presets/full'));
});

test('DMG VGM batch rejects stale flush and disposal before committing any files',async t=>{
  const f=fixture(t);await f.files.ready;const flush=deferred();let current=true;
  f.files.setCodeControls({flush:()=>flush.promise,setBusy(){}});
  const saving=f.files.saveVgmSounds({name:'stale.vgm',voices:[{preset:createDefaultPreset()}]},{isCurrent:()=>current});
  current=false;flush.resolve();assert.equal(await saving,false);assert(!f.project.fs.has('/presets/stale/Pulse.dmg.json'));
  await f.files.dispose();assert.equal(await f.files.saveVgmSounds({name:'disposed.vgm',voices:[{preset:createDefaultPreset()}]}),false);
});

test('DMG committed VGM batch returns success after late cancellation during local persistence',async t=>{
  const gate=deferred();let block=false;
  const f=fixture(t,{store:{read:async()=>null,write:async()=>{if(block)await gate.promise;return true;},close:async()=>{}}});await f.files.ready;
  let current=true;block=true;const saving=f.files.saveVgmSounds({name:'committed.vgm',voices:[{preset:createDefaultPreset()}]},{isCurrent:()=>current});
  while(!f.project.fs.has('/presets/committed/Pulse.dmg.json'))await Promise.resolve();current=false;gate.resolve();
  assert.deepEqual(await saving,{directory:'/presets/committed',paths:['/presets/committed/Pulse.dmg.json']});
});

test('zero extracted DMG voices and plain JSON import remain passive without choosing or applying a sound',async t=>{
  const f=fixture(t);await f.files.ready;const before=f.project.snapshot();let flushed=0;
  f.files.setCodeControls({flush:async()=>{flushed++;return true;},setBusy(){}});
  assert.deepEqual(await f.files.saveVgmSounds({name:'silent.vgm',voices:[]}),{paths:[],directory:null});assert.deepEqual(f.project.snapshot(),before);assert.equal(flushed,0);
  const bytes=new TextEncoder().encode(JSON.stringify(createDefaultPreset()));
  assert.deepEqual(await f.files.importFiles([{name:'imported.dmg.json',size:bytes.length,arrayBuffer:async()=>bytes.buffer}]),['/imported.dmg.json']);
  assert.equal(f.project.selectedPath,before.selectedPath);assert.deepEqual(f.calls,[]);assert.deepEqual(f.project.settings,before.settings);assert.match(f.statuses.at(-1),/Code was not run/);
});
