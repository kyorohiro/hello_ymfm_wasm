import test from 'node:test';
import assert from 'node:assert/strict';
import {setupSnesCodeFiles} from './code_files.js';
import {createSnesCodeProject,SNES_PROJECT_FILE_BYTES} from './code_project.js';
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
  const main=new Element(doc);doc.append(main);doc.querySelector=selector=>selector==='.snes-main'?main:null;
  for(const id of ['snesFilesPanel','snesFilesToggle','synthWorkspace']){const node=new Element(doc);node.id=id;node.hidden=id==='snesFilesPanel';doc.append(node);}
  const select=new Element(doc,'select');select.id='snesPresetSelect';doc.append(select);
  const previous=globalThis.document;globalThis.document=doc;t.after(()=>{globalThis.document=previous;});
  let settings=readPreset(options.settings??createDefaultPreset());const project=options.project??createSnesCodeProject({settings,starterCode:'// kept'}),writes=[],calls=[],opened=[],statuses=[];
  const store=options.store??{read:async()=>null,write:async value=>{writes.push(structuredClone(value));return true;},close:async()=>{}};
  const files=setupSnesCodeFiles({project,document:doc,store,getSettings:()=>settings,applySettings:async value=>{calls.push(['apply',value]);settings=readPreset(value);},onBeforeSoundApply:async()=>calls.push(['sound']),onBeforeWorkspaceReplace:async()=>calls.push(['before']),setStatus:message=>statuses.push(message),...options});
  files.setCodeControls({flush:async()=>true,openFile:async(path,options)=>{opened.push({path,options});return true;},setBusy(){}});
  t.after(()=>files.dispose());return{files,project,doc,writes,calls,opened,statuses,setSettings(value){settings=readPreset(value);}};
}

test('S-DSP saves named presets without acquiring audio, applying or changing Code mode/focus',async t=>{
  const f=fixture(t);await f.files.ready;let flushes=0;
  f.files.setCodeControls({activePath:'/index.js',executionPath:'/index.js',isCodeMode:()=>false,setBusy(){},flush:async()=>{flushes++;return true;},openFile:async(path,options)=>f.opened.push({path,options}),stop:()=>assert.fail('Save never stops'),workspaceReplaced:()=>assert.fail('Save never replaces')});
  const one=await f.files.saveSound();assert.equal(one,'/presets/Sine.sdsp.json');assert.deepEqual(JSON.parse(f.project.fs.get(one).data),createDefaultPreset());
  f.project.fs.mkdir('/presets/SINE (2).sdsp.json');const two=await f.files.saveSound();assert.equal(two,'/presets/Sine (3).sdsp.json');
  assert.deepEqual(f.opened,[one,two].map(path=>({path,options:{show:false}})));assert.deepEqual(f.calls,[]);assert.equal(f.doc.getElementById('snesFilesPanel').hidden,false);
  assert.equal(f.doc.getElementById('snesFileTextEditor'),undefined);assert.equal(f.doc.getElementById('snesPresetSelect').value,'','Saving does not imply a preset was loaded');
});

test('S-DSP file selection preserves mode, text edits do not apply, explicit valid preset selection does',async t=>{
  const f=fixture(t);await f.files.ready;let mode=false;
  f.files.setCodeControls({flush:async()=>true,isCodeMode:()=>mode,openFile:async(path,options)=>f.opened.push({path,options}),setBusy(){}});
  f.project.importFiles([{path:'/notes.json',data:'{}'},{path:'/presets/Sine.sdsp.json',data:JSON.stringify(createDefaultPreset())},{path:'/unfinished.json',data:'{unfinished'}]);
  for(const path of ['/index.js','/notes.json','/presets/Sine.sdsp.json','/unfinished.json'])await f.files.selectFile(path);
  assert(f.opened.every(entry=>entry.options.show===false));assert.deepEqual(f.calls.map(entry=>entry[0]),['sound','apply']);assert.match(f.statuses.at(-1),/current sound kept/);
  mode=true;await f.files.selectFile('/notes.json');assert.equal(f.opened.at(-1).options.show,true);f.project.writeEditorText('/notes.json','{"unfinished":');await f.files.persistCode();assert.equal(f.calls.length,2);
});

test('S-DSP JSON selection cancels pending execution before waiting for flush',async t=>{
  const f=fixture(t);await f.files.ready;f.project.importFiles([{path:'/notes.json',data:'{}'}]);const gate=deferred(),events=[];
  f.files.setCodeControls({cancelPendingExecution(){events.push('cancel');},flush:async()=>{events.push('flush');await gate.promise;},openFile:async()=>events.push('open'),setBusy(){}});
  const pending=f.files.selectFile('/notes.json');assert.deepEqual(events,['cancel']);await Promise.resolve();assert.deepEqual(events,['cancel','flush']);gate.resolve();await pending;assert.deepEqual(events,['cancel','flush','open']);
});

test('S-DSP sound selection has a separate hook and failed/cancelled apply never marks a preset loaded',async t=>{
  let result=false,settings=createDefaultPreset();
  const f=fixture(t,{getSettings:()=>settings,applySettings:async value=>{if(result instanceof Error)throw result;if(result)settings=value;return result;},onBeforeWorkspaceReplace:()=>assert.fail('A sound is not a workspace replacement')});
  await f.files.ready;const next=createDefaultPreset();next.name='Selected';
  f.project.importFiles([{path:'/Selected.sdsp.json',data:JSON.stringify(next)}]);const previous=f.project.settings;
  const initialSelection=f.project.selectedPath;
  assert.equal(await f.files.selectFile('/Selected.sdsp.json'),false);assert.deepEqual(f.project.settings,previous);assert.equal(f.project.selectedPath,initialSelection);
  result=Error('upload failed');await assert.rejects(f.files.selectFile('/Selected.sdsp.json'),/upload failed/);assert.deepEqual(f.project.settings,previous);
  assert.equal(f.doc.getElementById('snesPresetSelect').value,'');assert.deepEqual(f.calls.map(call=>call[0]),['sound','sound']);
  result=true;assert.equal(await f.files.selectFile('/Selected.sdsp.json'),true);assert.deepEqual(f.project.settings,next);
});

test('a Stop after sound commit persists the reconciled host sound without marking the cancelled selection applied',async t=>{
  let settings=createDefaultPreset();const next=structuredClone(settings);next.source='noise';
  const f=fixture(t,{getSettings:()=>settings,applySettings:async()=>{settings=next;return false;}});await f.files.ready;
  f.project.importFiles([{path:'/Selected.sdsp.json',data:JSON.stringify(next)}]);const selected=f.project.selectedPath;
  assert.equal(await f.files.selectFile('/Selected.sdsp.json'),false);
  assert.deepEqual(f.project.settings,next);assert.equal(f.project.selectedPath,selected);assert.equal(f.doc.getElementById('snesPresetSelect').value,'');
  await f.files.persistCode();assert.deepEqual(f.writes.at(-1).settings,next);
});

test('S-DSP duplicate/rename/delete preserve binary data and stop only the executed JS path',async t=>{
  const f=fixture(t);await f.files.ready;f.project.importFiles([{path:'/folder/code.js',data:'kept'},{path:'/folder/raw.bin',type:'binary',data:Uint8Array.of(0,255)}]);
  let stops=0;const changes=[];f.files.setCodeControls({activePath:'/notes.json',executionPath:'/folder/code.js',flush:async()=>true,isCodeMode:()=>false,openFile:async()=>true,pathChanged:(...args)=>changes.push(args),stop:async()=>{stops++;},setBusy(){}});
  const copy=await f.files.duplicate('/folder');assert.equal(copy,'/folder-copy');assert.deepEqual(f.project.fs.get('/folder-copy/raw.bin').data,Uint8Array.of(0,255));assert.equal(stops,0);
  await f.files.move('/folder-copy/code.js','/folder-copy/code.json');assert.equal(stops,0);await f.files.remove('/folder-copy');assert.equal(stops,0);
  await f.files.move('/folder/code.js','/folder/code.json');assert.equal(stops,1);assert.deepEqual(changes.at(-1),['/folder/code.js','/folder/code.json']);
});

test('S-DSP malformed imports and capacity failure leave Files atomic',async t=>{
  const gate=deferred();const f=fixture(t,{store:{read:async()=>{await gate.promise;return null;},write:async()=>true,close:async()=>{}}});
  gate.resolve();await f.files.ready;const before=f.project.snapshot();await assert.rejects(f.files.importProject(Uint8Array.of(1,2,3)));assert.deepEqual(f.project.snapshot(),before);
  f.project.importFiles([{path:'/padding.bin',type:'binary',data:new Uint8Array(SNES_PROJECT_FILE_BYTES-100)}]);const full=f.project.snapshot();await assert.rejects(f.files.saveSound(),/16 MiB/);assert.deepEqual(f.project.snapshot(),full);assert.equal(f.doc.querySelector('.snes-main').inert,false);
});

test('late S-DSP file reads cannot overwrite a newer edit or a disposed workspace',async t=>{
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
    {name:'superseded.sdsp.json',size:2,arrayBuffer:()=>gate.promise},
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
  assert.equal(f.doc.querySelector('.snes-main').inert,false);
});

test('S-DSP unread or invalid initial drafts cannot be overwritten by later edits, Files operations or disposal',async t=>{
  for(const failure of ['read','invalid'])await t.test(failure,async t=>{
    const writes=[],durable=createSnesCodeProject({starterCode:'// stored source'}).snapshot();
    const f=fixture(t,{store:{read:async()=>{if(failure==='read')throw new DOMException('Injected backend read error','UnknownError');return{...durable,format:'invalid'};},write:async value=>{writes.push(value);return true;},close:async()=>{}}});
    await f.files.ready;assert.match(f.statuses.at(-1),/Local project restore failed/);
    const edited=createDefaultPreset();edited.source='noise';f.setSettings(edited);f.files.markSoundDirty();
    f.project.writeEditorText('/index.js','// unsaved current edit');assert.equal(await f.files.persistCode(),false);
    await f.files.createFile('/notes.txt');assert.equal(writes.length,0);
    const exported=await f.files.exportProject(),copy=createSnesCodeProject();copy.restore(await copy.prepareImport(exported));
    assert.equal(copy.fs.get('/index.js').data,'// unsaved current edit');assert.deepEqual(copy.settings,edited);
    await f.files.dispose();assert.equal(writes.length,0,'shutdown must not save defaults over an unread draft');
  });
});
