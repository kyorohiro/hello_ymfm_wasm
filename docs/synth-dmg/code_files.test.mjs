import test from 'node:test';
import assert from 'node:assert/strict';
import {setupGameboyCodeFiles,GAMEBOY_SOUND_JOURNAL_KEY} from './code_files.js';
import {createGameboyCodeProject,GAMEBOY_PROJECT_FILE_BYTES} from './code_project.js';
import {createDefaultPreset,readPreset} from './preset.js';

class Element{
  constructor(doc,tag='div'){Object.assign(this,{ownerDocument:doc,tagName:tag.toUpperCase(),children:[],listeners:new Map(),attributes:{},dataset:{},style:{},parentNode:null,hidden:false,value:'',disabled:false});const names=new Set();this.classList={toggle:(name,on)=>on?names.add(name):names.delete(name),contains:name=>names.has(name),add:name=>names.add(name),remove:name=>names.delete(name)};}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}appendChild(node){this.append(node);return node;}replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this.append(...nodes);}remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  querySelectorAll(selector){return walk(this).filter(node=>selector==='button'?node.tagName==='BUTTON':selector==='[data-file-path]'?node.getAttribute('data-file-path')!==null:false);}
  focus(){this.ownerDocument.activeElement=this;}blur(){if(this.ownerDocument.activeElement===this)this.ownerDocument.activeElement=null;}select(){}showModal(){this.open=true;}close(){this.open=false;}
  async fire(type,extra={}){const event={target:this,preventDefault(){},stopPropagation(){},...extra};for(const fn of this.listeners.get(type)??[])await fn(event);}
}
const walk=node=>[node,...node.children.flatMap(walk)],deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(t,options={}){
  const doc=new Element(null,'document');doc.ownerDocument=doc;doc.body=doc;doc.createElement=tag=>new Element(doc,tag);doc.getElementById=id=>walk(doc).find(node=>node.id===id);doc.defaultView=new Element(doc,'window');
  const main=new Element(doc);doc.append(main);doc.querySelector=selector=>selector==='.dmg-main'?main:selector==='dialog[open]'?walk(doc).find(node=>node.tagName==='DIALOG'&&node.open)??null:null;
  for(const id of ['dmgFilesPanel','dmgFilesToggle','synthWorkspace']){const node=new Element(doc);node.id=id;node.hidden=id==='dmgFilesPanel';doc.append(node);}
  const select=new Element(doc,'select');select.id='dmgPresetSelect';doc.append(select);
  const previous=globalThis.document;globalThis.document=doc;t.after(()=>{globalThis.document=previous;});
  let settings=readPreset(options.settings??createDefaultPreset());const project=options.project??createGameboyCodeProject({settings,starterCode:'// kept'}),writes=[],calls=[],opened=[],statuses=[];
  const store=options.store??{read:async()=>null,write:async value=>{writes.push(structuredClone(value));return true;},close:async()=>{}};
  const files=setupGameboyCodeFiles({project,document:doc,store,storage:null,getSettings:()=>settings,applySettings:async value=>{calls.push(['apply',value]);settings=readPreset(value);},onBeforeSoundApply:async()=>calls.push(['sound']),onBeforeWorkspaceReplace:async()=>calls.push(['before']),setStatus:message=>statuses.push(message),...options});
  files.setCodeControls({flush:async()=>true,openFile:async(path,options)=>{opened.push({path,options});return true;},setBusy(){}});
  t.after(()=>files.dispose());return{files,project,doc,writes,calls,opened,statuses,setSettings(value){settings=readPreset(value);}};
}

test('DMG saves and adopts named presets without changing Code mode/focus or retiring performance',async t=>{
  const f=fixture(t);await f.files.ready;let flushes=0;
  f.files.setCodeControls({activePath:'/index.js',executionPath:'/index.js',isCodeMode:()=>false,setBusy(){},flush:async()=>{flushes++;return true;},openFile:async(path,options)=>f.opened.push({path,options}),stop:()=>assert.fail('Save never stops'),workspaceReplaced:()=>assert.fail('Save never replaces')});
  const one=await f.files.saveSound();assert.equal(one,'/presets/Pulse.dmg.json');assert.deepEqual(JSON.parse(f.project.fs.get(one).data),createDefaultPreset());
  f.project.fs.mkdir('/presets/PULSE (2).dmg.json');const two=await f.files.saveSound();assert.equal(two,'/presets/Pulse (3).dmg.json');
  assert.deepEqual(f.opened,[one,two].map(path=>({path,options:{show:false}})));assert.deepEqual(f.calls.map(call=>call[0]),['apply','apply']);assert.equal(f.doc.getElementById('dmgFilesPanel').hidden,false);
  assert.equal(f.doc.getElementById('dmgFileTextEditor'),undefined);assert.equal(f.doc.getElementById('dmgPresetSelect').value,two,'An explicitly saved instrument becomes the linked sound document');assert.equal(f.project.activeSoundPath,two);
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
  await f.files.move('/folder/code.js','/folder/code.json');assert.equal(stops,1);assert.deepEqual(changes.at(-1),['/folder/code.js','/folder/code.json',{preserveExecution:false}]);
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
  assert.equal(await f.files.selectFile(path),true);assert.match(f.statuses.at(-1),/Press Play.*instrument and Code are kept/);assert.deepEqual(f.calls,[]);assert(flushes>=3);
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

const settle=async()=>{for(let index=0;index<8;index++)await Promise.resolve();};
const editedWave=()=>{const sound=createDefaultPreset();sound.source='wave';sound.wave.samples[0]=3;return sound;};
const memoryStorage=()=>{const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};};

test('DMG Auto apply defaults on; manual source Save accepts text without executing or changing view',async t=>{
  const f=fixture(t);await f.files.ready;assert.equal(f.project.autoApply,true);assert.equal(f.doc.getElementById('dmgAutoApplyToggle').checked,true);
  assert.equal(f.doc.getElementById('dmgFileUndoButton'),undefined,'Basic Files has no extra Undo toolbar');
  let runs=0;f.files.setCodeControls({activePath:'/index.js',isCodeMode:()=>false,flush:async()=>true,setBusy(){},run:()=>runs++,apply:()=>runs++,openFile:async(path,options)=>f.opened.push({path,options})});
  await f.files.setAutoApply(false);await f.files.selectFile('/index.js');f.project.writeEditorText('/index.js','// working DMG source');
  assert.equal(f.project.savedFs.get('/index.js').data,'// kept');
  const entry=f.doc.getElementById('dmgFilesTree').querySelectorAll('[data-file-path]').find(node=>node.getAttribute('data-file-path')==='/index.js');
  assert.equal(entry.dataset.unsaved,'true');assert(entry.children.some(child=>child.textContent===' ●'));
  assert.equal(await f.files.saveCurrent(),true);assert.equal(f.project.savedFs.get('/index.js').data,'// working DMG source');assert.equal(f.project.isFileModified('/index.js'),false);
  assert.equal(runs,0);assert.deepEqual(f.opened,[{path:'/index.js',options:{show:false}}]);
});

test('DMG controls edit their linked JSON while manual mode retains accepted sound until Save',async t=>{
  const options=[],f=fixture(t,{applySettings:async(value,context)=>{options.push({value:readPreset(value),...context});}});await f.files.ready;
  const path=await f.files.saveSound();await f.files.setAutoApply(false);const accepted=f.project.savedSettings,sound=editedWave();
  assert.equal(f.files.markSoundDirty(sound),path);assert.deepEqual(f.project.settings,sound);assert.deepEqual(JSON.parse(f.project.fs.get(path).data),sound);
  assert.deepEqual(f.project.savedSettings,accepted);assert.deepEqual(JSON.parse(f.project.savedFs.get(path).data),accepted);assert.equal(f.project.isFileModified(path),true);
  await f.files.persistCode();assert.deepEqual(f.project.savedSettings,accepted,'background persistence never accepts a preview');
  assert.equal(await f.files.saveCurrent(),true);assert.deepEqual(f.project.savedSettings,sound);assert.deepEqual(JSON.parse(f.project.savedFs.get(path).data),sound);
  assert.equal(options.at(-1).source,'save');assert.equal(options.at(-1).applyAudio,true);assert.deepEqual(options.at(-1).displayPreset,sound);
});

test('DMG valid active JSON previews controls in manual mode and invalid pending JSON keeps its last sound',async t=>{
  const options=[],f=fixture(t,{applySettings:async(value,context)=>options.push({value:readPreset(value),...context})});await f.files.ready;
  const path=await f.files.saveSound();await f.files.setAutoApply(false);const accepted=f.project.savedSettings,sound=editedWave();
  f.project.writeEditorText(path,JSON.stringify(sound));await f.files.codeEdited(path);
  assert.deepEqual(f.files.getWorkingSound(),sound);assert.deepEqual(f.files.getAcceptedSound(),accepted);assert.equal(options.at(-1).applyAudio,false);assert.equal(options.at(-1).source,'json');
  const count=options.length;f.project.writeEditorText(path,'{"format":');await f.files.codeEdited(path);await f.files.persistCode();
  assert.equal(options.length,count);assert.deepEqual(f.project.settings,sound);assert.deepEqual(f.project.savedSettings,accepted);assert.match(f.statuses.at(-1),/JSON not applied; current sound kept/);
  assert.throws(()=>f.files.canEditSound(),/Finish or Discard/);assert.equal(f.project.fs.get(path).data,'{"format":');
  await f.files.saveCurrent();assert.equal(f.project.savedFs.get(path).data,'{"format":');assert.deepEqual(f.project.savedSettings,accepted,'invalid source is saved without replacing playable sound');
  f.project.writeEditorText(path,JSON.stringify(sound));await f.files.codeEdited(path);await f.files.discardCurrent();
  assert.equal(f.project.fs.get(path).data,'{"format":');assert.deepEqual(f.project.settings,accepted,'Discard to invalid source retains a valid playable cache');
});

test('DMG Auto apply accepts valid JSON and pending valid update survives a later incomplete edit',async t=>{
  const gate=deferred(),options=[],f=fixture(t,{applySettings:async(value,context)=>{options.push({value:readPreset(value),...context});if(context.source==='json')await gate.promise;return context.isCurrent?.()??true;}});await f.files.ready;
  const path=await f.files.saveSound(),sound=editedWave();f.project.writeEditorText(path,JSON.stringify(sound));const valid=f.files.codeEdited(path);await settle();
  f.project.writeEditorText(path,'{incomplete');await f.files.codeEdited(path);gate.resolve();await valid;
  assert.deepEqual(f.project.settings,sound);assert.deepEqual(f.project.savedSettings,sound);assert.equal(f.project.savedFs.get(path).data,'{incomplete');
  assert.equal(options.at(-1).applyAudio,true);assert.equal(options.at(-1).isCurrent(),true);assert.match(f.statuses.at(-1),/JSON not applied/);
});

test('DMG Save all and Discard all cover creations, deletions, binary sources and renamed linked sounds',async t=>{
  const f=fixture(t);await f.files.ready;const path=await f.files.saveSound();const raw=Uint8Array.of(0,255,128);f.project.importSongSources([{name:'kept.vgz',bytes:raw}]);
  await f.files.setAutoApply(false);f.project.writeEditorText('/index.js','// draft');await f.files.createFile('/new.js');await f.files.move(path,'/presets/Renamed.dmg.json');
  assert.equal(f.project.activeSoundPath,'/presets/Renamed.dmg.json');assert(f.project.savedFs.has(path));
  await f.files.discardAll();assert.equal(f.project.activeSoundPath,path);assert.equal(f.project.fs.get('/index.js').data,'// kept');assert(!f.project.fs.has('/new.js'));assert(f.project.fs.has(path));assert.deepEqual(f.project.fs.get('/vgm/kept.vgz').data,raw);
  await f.files.move(path,'/presets/Accepted.dmg.json');await f.files.remove('/vgm/kept.vgz');await f.files.saveAll();
  assert.deepEqual(f.project.getDirtyPaths(),[]);assert(!f.project.savedFs.has(path));assert(f.project.savedFs.has('/presets/Accepted.dmg.json'));assert(!f.project.savedFs.has('/vgm/kept.vgz'));assert.deepEqual(f.project.getPendingMoves(),[]);
});

test('DMG manual rename preserves saved execution identity and selected Save accepts the entire rename',async t=>{
  const f=fixture(t);await f.files.ready;await f.files.setAutoApply(false);let stopped=0;const changed=[];
  f.files.setCodeControls({activePath:'/index.js',executionPath:'/index.js',flush:async()=>true,setBusy(){},pathChanged:(...args)=>changed.push(args),stop:async()=>stopped++});
  await f.files.move('/index.js','/renamed.json');assert.equal(stopped,0);assert.deepEqual(changed.at(-1),['/index.js','/renamed.json',{preserveExecution:true}]);
  assert.equal(await f.project.readSavedFile('/index.js'),'// kept');assert(!f.project.savedFs.has('/renamed.json'));
  f.project.select('/renamed.json');await f.files.saveCurrent();assert(!f.project.savedFs.has('/index.js'));assert.equal(f.project.savedFs.get('/renamed.json').data,'// kept');assert.deepEqual(f.project.getPendingMoves(),[]);
});

test('DMG keyboard Save accepts the focused file and ignores modifier variants and open dialogs',async t=>{
  const f=fixture(t);await f.files.ready;await f.files.setAutoApply(false);f.project.select('/index.js');f.project.writeEditorText('/index.js','// keyboard save');let prevented=0;
  await f.doc.fire('keydown',{key:'s',ctrlKey:true,preventDefault:()=>prevented++});await settle();assert.equal(f.project.savedFs.get('/index.js').data,'// keyboard save');assert.equal(prevented,1);
  f.project.writeEditorText('/index.js','// keep pending');await f.doc.fire('keydown',{key:'S',metaKey:true,shiftKey:true});await settle();assert.equal(f.project.savedFs.get('/index.js').data,'// keyboard save');
  const dialog=f.doc.getElementById('dmgFileNameDialog');dialog.showModal();await f.doc.fire('keydown',{key:'s',metaKey:true});await settle();assert.equal(f.project.savedFs.get('/index.js').data,'// keyboard save');dialog.close();
  await f.doc.fire('keydown',{key:'S',metaKey:true});await settle();assert.equal(f.project.savedFs.get('/index.js').data,'// keep pending');
});

test('DMG undo restores both author versions without running saved or working Code',async t=>{
  const f=fixture(t);await f.files.ready;await f.files.setAutoApply(false);f.project.writeEditorText('/index.js','// pending first');const before=f.project.snapshot();let retired=0;
  f.files.setCodeControls({flush:async()=>true,setBusy(){},workspaceReplaced:async()=>retired++,restoreState:async()=>true,run:()=>assert.fail('Undo never runs')});
  await f.files.createFile('/second.js');assert(f.project.fs.has('/second.js'));assert.equal(await f.files.undo(),true);assert(!f.project.fs.has('/second.js'));
  assert.deepEqual(f.project.snapshot(),before);assert.equal(retired,1);assert.equal(f.project.savedFs.get('/index.js').data,'// kept');assert.equal(f.project.fs.get('/index.js').data,'// pending first');
});

test('DMG New Cassette backup awaits native cancellation and keeps both versions and all owners',async t=>{
  const f=fixture(t);await f.files.ready;await f.files.setAutoApply(false);f.project.writeEditorText('/index.js','// precious draft');const before=f.project.snapshot(),identity=f.files.workspaceId,gate=deferred();let retired=0,savedBytes;
  f.doc.defaultView.tetoricaSynthSave=async bytes=>{savedBytes=bytes;return gate.promise;};
  f.files.setCodeControls({flush:async()=>true,setBusy(){},workspaceReplaced:async()=>retired++,restoreState:async()=>true});
  const creating=f.files.newProject({exportCurrent:true});await settle();assert(savedBytes instanceof Uint8Array);assert.equal(retired,0);assert.deepEqual(f.project.snapshot(),before);
  const backup=createGameboyCodeProject({snapshot:await f.project.prepareImport(savedBytes)});assert.equal(backup.fs.get('/index.js').data,'// precious draft');assert.equal(backup.savedFs.get('/index.js').data,'// kept');
  gate.resolve(false);assert.equal(await creating,false);assert.deepEqual(f.project.snapshot(),before);assert.equal(f.files.workspaceId,identity);assert.equal(retired,0);
});

test('DMG Import backup cancellation and editor failure keep both old layers; valid import never runs',async t=>{
  const gate=deferred(),f=fixture(t,{downloadFile:async()=>gate.promise});await f.files.ready;await f.files.setAutoApply(false);f.project.writeEditorText('/index.js','// old draft');const before=f.project.snapshot(),incoming=createGameboyCodeProject({starterCode:'// incoming'});let retired=0,fail=false;
  f.files.setCodeControls({flush:async()=>true,setBusy(){},workspaceReplaced:async()=>retired++,restoreState:async()=>!fail,run:()=>assert.fail('Import never runs')});
  const importing=f.files.importProject(incoming.exportProject(),{exportCurrent:true});await settle();assert.equal(retired,0);gate.resolve(false);assert.equal(await importing,false);assert.deepEqual(f.project.snapshot(),before);
  fail=true;assert.equal(await f.files.importProject(incoming.exportProject()),false);assert.deepEqual(f.project.snapshot(),before);
  fail=false;assert.equal(await f.files.importProject(incoming.exportProject()),true);assert.equal(f.project.fs.get('/index.js').data,'// incoming');assert.equal(f.project.savedFs.get('/index.js').data,'// incoming');
});

test('DMG immediate journal restores incomplete JSON plus valid working and accepted sound caches without Code execution',async t=>{
  const storage=memoryStorage(),f=fixture(t,{storage,store:{read:async()=>null,write:async()=>false,close:async()=>{}}});await f.files.ready;
  const path=await f.files.saveSound();await f.files.setAutoApply(false);const accepted=f.project.savedSettings,durable={...f.project.snapshot(),workspaceId:f.files.workspaceId,soundGeneration:0},sound=editedWave();
  f.files.markSoundDirty(sound);f.project.writeEditorText(path,'{pending');await f.files.codeEdited(path);const journal=storage.getItem(GAMEBOY_SOUND_JOURNAL_KEY);assert(journal);await f.files.dispose();
  const applied=[],restored=fixture(t,{storage,store:{read:async()=>durable,write:async()=>false,close:async()=>{}},applySettings:async(value,options)=>applied.push({value,...options})});
  restored.files.setCodeControls({setBusy(){},restoreState:()=>assert.fail('Restore never auto-runs or opens Code'),flush:async()=>true});await restored.files.ready;
  assert.equal(restored.project.fs.get(path).data,'{pending');assert.deepEqual(restored.project.settings,sound);assert.deepEqual(restored.project.savedSettings,accepted);assert.equal(restored.project.autoApply,false);
  assert.equal(applied.at(-1).source,'restore');assert.deepEqual(applied.at(-1).value,accepted);assert.deepEqual(applied.at(-1).displayPreset,sound);assert.equal(storage.getItem(GAMEBOY_SOUND_JOURNAL_KEY),journal);
});

test('DMG a successful matching draft write clears only its own immediate sound journal',async t=>{
  const storage=memoryStorage(),gate=deferred();let block=false;
  const f=fixture(t,{storage,store:{read:async()=>null,write:async()=>{if(block)await gate.promise;return true;},close:async()=>{}}});await f.files.ready;await f.files.saveSound();await f.files.setAutoApply(false);
  f.files.markSoundDirty(editedWave());const first=storage.getItem(GAMEBOY_SOUND_JOURNAL_KEY);assert(first);block=true;const writing=f.files.persistCode();await settle();
  const newer=editedWave();newer.wave.samples[1]=9;f.files.markSoundDirty(newer);assert.notEqual(storage.getItem(GAMEBOY_SOUND_JOURNAL_KEY),first);gate.resolve();await writing;
  assert(storage.getItem(GAMEBOY_SOUND_JOURNAL_KEY),'older persistence must not clear newer recovery');block=false;await f.files.persistCode();assert.equal(storage.getItem(GAMEBOY_SOUND_JOURNAL_KEY),null);
});

test('DMG New Cassette resets to starter and default Pulse; history restores pending old Code and sound',async t=>{
  const f=fixture(t);await f.files.ready;const path=await f.files.saveSound();await f.files.setAutoApply(false);f.files.markSoundDirty(editedWave());f.project.writeEditorText('/index.js','// pending old code');
  const before=f.project.snapshot(),identity=f.files.workspaceId;let runs=0;
  f.files.setCodeControls({setBusy(){},flush:async()=>true,workspaceReplaced:async()=>true,restoreState:async()=>true,run:()=>runs++});
  assert.equal(await f.files.newProject(),true);assert.equal(f.project.autoApply,false);assert.deepEqual(f.project.settings,createDefaultPreset());assert.equal(f.project.fs.get('/index.js').data,'// kept');assert.equal(f.project.savedFs.get('/index.js').data,'// kept');assert(!f.project.fs.has(path));assert.notEqual(f.files.workspaceId,identity);assert.equal(runs,0);
  assert.equal(await f.files.undo(),true);assert.deepEqual(f.project.snapshot(),before);assert.equal(f.project.fs.get('/index.js').data,'// pending old code');assert.equal(f.project.savedFs.get('/index.js').data,'// kept');assert.equal(runs,0);
});

test('DMG legacy local projects recover equal versions with opaque song bytes and never execute Code',async t=>{
  const old=createGameboyCodeProject({starterCode:'// legacy source',settings:editedWave()});old.importSongSources([{name:'legacy.vgm',bytes:Uint8Array.of(0,255,17)}]);
  const snapshot=old.snapshot(),legacy={format:snapshot.format,version:1,name:snapshot.name,settings:snapshot.settings,selectedPath:'/index.js',codeState:{mode:'code',path:'/index.js'},filesystem:snapshot.filesystem};
  const applied=[],f=fixture(t,{store:{read:async()=>legacy,write:async()=>true,close:async()=>{}},applySettings:async(value,context)=>applied.push({value,...context})});
  f.files.setCodeControls({setBusy(){},flush:async()=>true,restoreState:()=>assert.fail('local restore must not run or open Code'),run:()=>assert.fail('legacy source must not run')});await f.files.ready;
  assert.equal(f.project.autoApply,true);assert.deepEqual(f.project.getDirtyPaths(),[]);assert.equal(f.project.savedFs.get('/index.js').data,'// legacy source');assert.deepEqual(f.project.fs.get('/vgm/legacy.vgm').data,Uint8Array.of(0,255,17));assert.deepEqual(f.project.savedSettings,editedWave());assert.equal(applied.at(-1).source,'restore');
});

test('DMG corrupt journals are ignored without replacing a valid local project or starting Code',async t=>{
  const storage=memoryStorage();storage.setItem(GAMEBOY_SOUND_JOURNAL_KEY,'{"version":1,"path":"/../outside.json"}');const old=createGameboyCodeProject({starterCode:'// safe durable'});
  const f=fixture(t,{storage,store:{read:async()=>old.snapshot(),write:async()=>true,close:async()=>{}}});await f.files.ready;
  assert.equal(f.project.fs.get('/index.js').data,'// safe durable');assert.deepEqual(f.project.getDirtyPaths(),[]);assert(f.statuses.some(message=>message.includes('Could not restore the last sound edit')));assert.equal(await f.files.persistCode(),true);
});

test('DMG sound preflight shares capacity policy and never mutates files, caches, selection or recovery',async t=>{
  const storage=memoryStorage(),f=fixture(t,{storage});await f.files.ready;await f.files.saveSound();
  const sound=editedWave();sound.name='Boundary DMG sound '+ 'x'.repeat(50);
  const size=f.project.listEntries().reduce((sum,file)=>sum+file.size,0);f.project.importFiles([{path:'/padding.bin',type:'binary',data:new Uint8Array(GAMEBOY_PROJECT_FILE_BYTES-size)}]);
  const before=f.project.snapshot(),journal=storage.getItem(GAMEBOY_SOUND_JOURNAL_KEY),history=f.files.getUndoState();
  assert.throws(()=>f.files.validateSoundEdit(sound),/linked JSON was kept/);assert.throws(()=>f.files.recordSoundEdit(sound),/linked JSON was kept/);
  assert.equal(f.files.validateSoundEdit(sound,{allowExternal:true}),true,'explicit external-sound policy is shared without adopting it');
  assert.deepEqual(f.project.snapshot(),before);assert.equal(storage.getItem(GAMEBOY_SOUND_JOURNAL_KEY),journal);assert.deepEqual(f.files.getUndoState(),history);
  await f.files.setAutoApply(false);const manual=f.project.snapshot();assert.throws(()=>f.files.validateSoundEdit(sound,{allowExternal:true}),/controls were not changed/);assert.deepEqual(f.project.snapshot(),manual);
});

test('DMG manual Save keeps the pending source and accepted caches on rejected, cancelled or failed native apply',async t=>{
  let result=true;const options=[],f=fixture(t,{applySettings:async(value,context)=>{options.push(context);if(context.source==='save'){if(result instanceof Error)throw result;return result;}return true;}});await f.files.ready;
  const path=await f.files.saveSound();await f.files.setAutoApply(false);const sound=editedWave();f.files.markSoundDirty(sound);
  const before=f.project.snapshot(),history=f.files.getUndoState();result=false;assert.equal(await f.files.saveCurrent(),false);assert.deepEqual(f.project.snapshot(),before);assert.deepEqual(f.files.getUndoState(),history);
  result=Error('native apply failed');await assert.rejects(f.files.saveCurrent(),/native apply failed/);assert.deepEqual(f.project.snapshot(),before);assert.deepEqual(f.files.getUndoState(),history);
  assert.equal(f.project.isFileModified(path),true);assert.deepEqual(f.project.settings,sound);assert.deepEqual(f.project.savedSettings,createDefaultPreset());
  result=true;assert.equal(await f.files.saveCurrent(),true);assert.deepEqual(f.project.savedSettings,sound);assert.equal(f.project.isFileModified(path),false);assert.equal(options.at(-1).source,'save');
});

test('DMG pending Save never publishes tentative acceptance through background persistence',async t=>{
  const gate=deferred();let saving=false,block=false;
  const f=fixture(t,{applySettings:async(value,context)=>{if(context.source==='save'&&block){saving=true;await gate.promise;return false;}return true;}});await f.files.ready;
  const path=await f.files.saveSound();await f.files.setAutoApply(false);f.files.markSoundDirty(editedWave());const before=f.project.snapshot();
  block=true;const save=f.files.saveAll();while(!saving)await Promise.resolve();await f.files.persistCode();
  assert.deepEqual(f.writes.at(-1).workspace.saved,before.workspace.saved);assert.deepEqual(f.writes.at(-1).savedSettings,before.savedSettings);assert.equal(f.project.isFileModified(path),true);
  gate.resolve();assert.equal(await save,false);assert.deepEqual(f.project.snapshot(),before);
});

test('DMG rejected Auto apply keeps manual preference, both layers, pending moves and accepted sound',async t=>{
  let result=true;const f=fixture(t,{applySettings:async(value,options)=>{if(options.source==='auto'&&options.applyAudio){if(result instanceof Error)throw result;return result;}return true;}});await f.files.ready;
  const path=await f.files.saveSound();await f.files.setAutoApply(false);f.files.markSoundDirty(editedWave());await f.files.move(path,'/presets/Still-pending.dmg.json');f.project.writeEditorText('/index.js','// pending auto source');
  const before=f.project.snapshot(),history=f.files.getUndoState();result=false;assert.equal(await f.files.setAutoApply(true),false);assert.deepEqual(f.project.snapshot(),before);assert.deepEqual(f.files.getUndoState(),history);assert.equal(f.doc.getElementById('dmgAutoApplyToggle').checked,false);
  result=Error('Auto apply native failure');await assert.rejects(f.files.setAutoApply(true),/Auto apply native failure/);assert.deepEqual(f.project.snapshot(),before);assert.deepEqual(f.files.getUndoState(),history);
  result=true;assert.equal(await f.files.setAutoApply(true),true);assert.equal(f.project.autoApply,true);assert.deepEqual(f.project.getDirtyPaths(),[]);assert.deepEqual(f.project.getPendingMoves(),[]);assert.deepEqual(f.project.savedSettings,editedWave());assert(!f.project.savedFs.has(path));
});

test('DMG pending Auto apply does not persist its tentative preference or accepted sound',async t=>{
  const gate=deferred();let pending=false;const f=fixture(t,{applySettings:async(value,options)=>{if(options.source==='auto'&&options.applyAudio){pending=true;await gate.promise;return false;}return true;}});await f.files.ready;
  await f.files.saveSound();await f.files.setAutoApply(false);f.files.markSoundDirty(editedWave());const before=f.project.snapshot();
  const toggling=f.files.setAutoApply(true);while(!pending)await Promise.resolve();await f.files.persistCode();assert.equal(f.writes.at(-1).workspace.autoSave,false);assert.deepEqual(f.writes.at(-1).workspace.saved,before.workspace.saved);assert.deepEqual(f.writes.at(-1).savedSettings,before.savedSettings);
  gate.resolve();assert.equal(await toggling,false);assert.deepEqual(f.project.snapshot(),before);
});

test('DMG explicit manual new sound Save publishes nothing when native acceptance fails or cancels',async t=>{
  let result=true;const f=fixture(t,{applySettings:async(value,options)=>{if(options.source==='save'){if(result instanceof Error)throw result;return result;}return true;}});await f.files.ready;
  const originalPath=await f.files.saveSound();await f.files.setAutoApply(false);f.files.markSoundDirty(editedWave());f.project.writeEditorText('/index.js','// pending source');
  const sound=editedWave();sound.name='Attempt';const before=f.project.snapshot(),history=f.files.getUndoState(),opened=f.opened.length;result=false;
  assert.equal(await f.files.saveSound({sound}),false);assert.deepEqual(f.project.snapshot(),before);assert.deepEqual(f.files.getUndoState(),history);assert.equal(f.opened.length,opened);assert.equal(f.project.activeSoundPath,originalPath);
  result=Error('New sound apply failed');await assert.rejects(f.files.saveSound({sound}),/New sound apply failed/);assert.deepEqual(f.project.snapshot(),before);assert(!f.project.fs.has('/presets/Attempt.dmg.json'));
  result=true;assert.equal(await f.files.saveSound({sound}),'/presets/Attempt.dmg.json');assert.equal(f.project.activeSoundPath,'/presets/Attempt.dmg.json');assert.deepEqual(f.project.settings,sound);assert.deepEqual(f.project.savedSettings,sound);assert(f.project.savedFs.has('/presets/Attempt.dmg.json'));assert.equal(f.project.fs.get(originalPath).data,before.filesystem.files.find(file=>file.path===originalPath).data);assert.equal(f.project.savedFs.get('/index.js').data,'// kept');
});

test('DMG pending new sound Save persists only the previous linked sound and its two versions',async t=>{
  const gate=deferred();let pending=false,block=false;const f=fixture(t,{applySettings:async(value,options)=>{if(options.source==='save'&&block){pending=true;await gate.promise;return false;}return true;}});await f.files.ready;
  await f.files.saveSound();await f.files.setAutoApply(false);f.files.markSoundDirty(editedWave());const before=f.project.snapshot(),sound=editedWave();sound.name='Uncommitted';
  block=true;const saving=f.files.saveSound({sound});while(!pending)await Promise.resolve();await f.files.persistCode();assert.equal(f.writes.at(-1).activeSoundPath,before.activeSoundPath);assert.deepEqual(f.writes.at(-1).workspace,before.workspace);assert.deepEqual(f.writes.at(-1).savedSettings,before.savedSettings);assert(!f.project.fs.has('/presets/Uncommitted.dmg.json'));
  gate.resolve();assert.equal(await saving,false);assert.deepEqual(f.project.snapshot(),before);
});

test('DMG explicit new instrument snapshots the selected channel and adopts it with Auto apply on',async t=>{
  const author=createDefaultPreset(),physical=editedWave();physical.name='Physical CH';const gate=deferred(),applied=[];let reads=0,block=true;
  const f=fixture(t,{getSettings:()=>author,getSaveSoundSettings:()=>{reads++;return physical;},applySettings:async(value,options)=>{applied.push({value:readPreset(value),...options});if(block)await gate.promise;return true;}});await f.files.ready;
  const saving=f.files.saveSound();while(!applied.length)await Promise.resolve();assert.equal(f.project.autoApply,true);assert.deepEqual(f.project.settings,author);assert.equal(f.project.activeSoundPath,null);assert(!f.project.fs.has('/presets/Physical CH.dmg.json'));
  gate.resolve();assert.equal(await saving,'/presets/Physical CH.dmg.json');assert.equal(reads,1);assert.deepEqual(JSON.parse(f.project.fs.get('/presets/Physical CH.dmg.json').data),physical);assert.deepEqual(f.project.settings,physical);assert.deepEqual(f.project.savedSettings,physical);
  assert.equal(applied[0].source,'save');assert.equal(applied[0].record,false);assert.equal(applied[0].load,false);assert.equal(applied[0].applyAudio,true);assert.deepEqual(applied[0].displayPreset,physical);assert.deepEqual(f.calls,[],'Adoption preserves the running owner and does not call the selection retirement hook');
  block=false;const provided=createDefaultPreset();provided.source='noise';provided.name='Provided';
  assert.equal(await f.files.saveSound({sound:provided}),'/presets/Provided.dmg.json');assert.equal(reads,1,'an explicit sound takes precedence over the selected-channel snapshot');assert.deepEqual(f.project.settings,provided);assert.deepEqual(applied.at(-1).value,provided);
  const active=f.project.activeSoundPath,before=f.project.settings,count=applied.length,detached=editedWave();detached.name='Detached';
  assert.equal(await f.files.saveSound({sound:detached,select:false}),'/presets/Detached.dmg.json');assert.equal(reads,1);assert.equal(applied.length,count,'detached saves do not adopt or apply');assert.equal(f.project.activeSoundPath,active);assert.deepEqual(f.project.settings,before);assert.deepEqual(f.project.savedSettings,before);assert(f.project.savedFs.has('/presets/Detached.dmg.json'));
});
