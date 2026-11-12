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
  const files=setupGameboyCodeFiles({project,document:doc,store,getSettings:()=>settings,applySettings:async value=>{calls.push(['apply',value]);settings=readPreset(value);},onBeforeWorkspaceReplace:async()=>calls.push(['before']),setStatus:message=>statuses.push(message),...options});
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
  assert(f.opened.every(entry=>entry.options.show===false));assert.deepEqual(f.calls.map(entry=>entry[0]),['before','apply']);assert.match(f.statuses.at(-1),/current sound kept/);
  mode=true;await f.files.selectFile('/notes.json');assert.equal(f.opened.at(-1).options.show,true);f.project.writeEditorText('/notes.json','{"unfinished":');await f.files.persistCode();assert.equal(f.calls.length,2);
});

test('DMG JSON selection cancels pending execution before waiting for flush',async t=>{
  const f=fixture(t);await f.files.ready;f.project.importFiles([{path:'/notes.json',data:'{}'}]);const gate=deferred(),events=[];
  f.files.setCodeControls({cancelPendingExecution(){events.push('cancel');},flush:async()=>{events.push('flush');await gate.promise;},openFile:async()=>events.push('open'),setBusy(){}});
  const pending=f.files.selectFile('/notes.json');assert.deepEqual(events,['cancel']);await Promise.resolve();assert.deepEqual(events,['cancel','flush']);gate.resolve();await pending;assert.deepEqual(events,['cancel','flush','open']);
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

test('DMG local Files restoration retains a preset edited while storage was pending',async t=>{
  const gate=deferred(),old=createGameboyCodeProject({starterCode:'restored code'}),f=fixture(t,{store:{read:()=>gate.promise,write:async()=>true,close:async()=>{}}});
  const edited=createDefaultPreset();edited.source='wave';edited.wave.samples[0]=3;f.setSettings(edited);f.files.markSoundDirty();gate.resolve(old.snapshot());await f.files.ready;
  assert.deepEqual(f.project.settings,edited);assert.deepEqual(f.calls.at(-1),['apply',edited]);assert.equal(f.project.fs.get('/index.js').data,'restored code');
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
