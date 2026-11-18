import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setupScspCodeFiles,isScspSsfFile} from './code_files.js';
import {createScspCodeProject,SCSP_PROJECT_FILE_BYTES} from './code_project.js';
import {createDefaultScspProjectSound,readScspProjectSound as readPreset} from './code_project.js';
const createDefaultPreset=()=>({...createDefaultScspProjectSound(),name:'Sine'});

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
const fixtureOwners=new WeakMap();
function fixture(t,options={}){
  const doc=new Element(null,'document');doc.ownerDocument=doc;doc.body=doc;doc.createElement=tag=>new Element(doc,tag);doc.getElementById=id=>walk(doc).find(node=>node.id===id);doc.defaultView=new Element(doc,'window');
  const main=new Element(doc);doc.append(main);doc.querySelector=selector=>selector==='.scsp-main'?main:null;
  for(const id of ['scspFilesPanel','scspFilesToggle','synthWorkspace','scspMenuProjectNew','scspMenuProjectImport']){const node=new Element(doc);node.id=id;node.hidden=id==='scspFilesPanel';doc.append(node);}
  const saveAs=new Element(doc,'button');saveAs.id='scspSaveSoundAs';doc.append(saveAs);
  const select=new Element(doc,'select');select.id='scspPresetSelect';doc.append(select);
  let owners=fixtureOwners.get(t);
  if(!owners){
    const previous=globalThis.document;owners=[];fixtureOwners.set(t,owners);
    t.after(async()=>{try{for(const item of owners.reverse()){globalThis.document=item.doc;await item.files.dispose();}}finally{globalThis.document=previous;}});
  }
  globalThis.document=doc;
  let settings=readPreset(options.settings??createDefaultPreset());const project=options.project??createScspCodeProject({settings,starterCode:'// kept'}),writes=[],calls=[],opened=[],statuses=[];
  const store=options.store??{read:async()=>null,write:async value=>{writes.push(structuredClone(value));return true;},close:async()=>{}};
  const files=setupScspCodeFiles({project,document:doc,store,getSettings:()=>settings,applySettings:async value=>{calls.push(['apply',value]);settings=readPreset(value);},onBeforeSoundApply:async()=>calls.push(['sound']),onBeforeWorkspaceReplace:async()=>calls.push(['before']),setStatus:message=>statuses.push(message),...options});
  files.setCodeControls({flush:async()=>true,openFile:async(path,options)=>{opened.push({path,options});return true;},setBusy(){}});
  owners.push({files,doc});return{files,project,doc,writes,calls,opened,statuses,setSettings(value){settings=readPreset(value);}};
}

test('SCSP saves named presets without applying, acquiring audio or changing Code mode',async t=>{
  const f=fixture(t);await f.files.ready;
  f.files.setCodeControls({activePath:'/index.js',executionPath:'/index.js',isCodeMode:()=>false,setBusy(){},flush:async()=>true,openFile:async(path,options)=>f.opened.push({path,options}),stop:()=>assert.fail('Save never stops'),workspaceReplaced:()=>assert.fail('Save never replaces')});
  const one=await f.files.saveSound();assert.equal(one,'/presets/Sine.scsp.json');assert.deepEqual(JSON.parse(f.project.fs.get(one).data),createDefaultPreset());
  f.project.fs.mkdir('/presets/SINE (2).scsp.json');const two=await f.files.saveSound();assert.equal(two,'/presets/Sine (3).scsp.json');
  assert.deepEqual(f.opened,[one,two].map(path=>({path,options:{show:false}})));assert.deepEqual(f.calls,[]);assert.equal(f.doc.getElementById('scspFilesPanel').hidden,false);
  assert.equal(f.doc.getElementById('scspPresetSelect').value,'');
});

test('an unavailable fresh sound read rejects sound saves while JavaScript and cached workspace export remain available',async t=>{
  const f=fixture(t,{getSoundSettings:async()=>{throw Error('Fresh sound read unavailable');}});
  await f.files.ready;const before=f.project.snapshot();
  await assert.rejects(f.files.saveSound(),/Fresh sound read/);
  assert.deepEqual(f.project.snapshot(),before,'no stale base sound is saved as a preset');
  await f.doc.getElementById('scspSaveSoundAs').fire('click');
  assert.match(f.statuses.at(-1),/Fresh sound read/);
  assert.deepEqual(f.project.snapshot(),before);
  const path=await f.files.saveCode({source:'// retained cycle setup',name:'cycle.js'});
  assert.equal(f.project.fs.get(path).data,'// retained cycle setup');
  const restored=createScspCodeProject();
  restored.restore(await restored.prepareImport(await f.files.exportProject()));
  assert.equal(restored.fs.get(path).data,'// retained cycle setup');
  assert.deepEqual(restored.settings,createDefaultPreset(),'workspace retains its portable base instrument');
  assert.match(f.statuses.at(-1),/last cached sound/);
});

test('async sound saves and project export capture current edited v11 Cycle instead of a stale portable cache',async t=>{
  const base=createDefaultPreset(),edited={...base,name:'Edited Cycle',version:11,mode:'fm2',fm:{...base.fm,algorithm:'cycle2',cycle2:{outputs:[0,1]},depths:[3,8,1,2,3,4]}};
  edited.operators=structuredClone(base.operators);
  edited.operators.carrier.pcm[3]=321;
  edited.operators.modulator.voice.totalLevel=31;
  let reads=0;
  const f=fixture(t,{getSoundSettings:async()=>{reads++;await Promise.resolve();return structuredClone(edited);}});
  await f.files.ready;
  const saved=await f.files.saveSound();
  assert.deepEqual(JSON.parse(f.project.fs.get(saved).data),edited);
  const restored=createScspCodeProject();
  restored.restore(await restored.prepareImport(await f.files.exportProject()));
  assert.deepEqual(restored.settings,edited);assert.equal(reads,2);
  await f.doc.getElementById('scspSaveSoundAs').fire('click');
  const dialog=f.doc.getElementById('scspFileNameDialog');assert.equal(dialog.open,true);
  f.doc.getElementById('scspFileNameInput').value='Snapshot at dialog';
  edited.transpose=12;
  await dialog.children[0].fire('submit');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(JSON.parse(f.project.fs.get('/presets/Snapshot at dialog.scsp.json').data).transpose,0);
});

test('SCSP saves generated DSP Code to unique Files without changing the sound, mode or running Code', async t => {
  const f = fixture(t);
  await f.files.ready;
  const settings = f.project.settings;
  let mode = false;
  f.files.setCodeControls({
    activePath: '/index.js', executionPath: '/index.js', isCodeMode: () => mode,
    setBusy() {}, flush: async () => true,
    openFile: async (path, options) => f.opened.push({path, options}),
    stop: () => assert.fail('Saving keeps Code running'),
    workspaceReplaced: () => assert.fail('Saving keeps the workspace'),
  });
  const source = 'globalThis.scspDspSaveMustNotRun = true;\n';
  const first = await f.files.saveCode({source});
  assert.equal(first, '/dsp/SCSP DSP setup.js');
  assert.equal(f.project.fs.get(first).data, source);
  assert.equal(f.project.selectedPath, first);
  assert.equal(mode, false);
  mode = true;
  f.project.fs.mkdir('/dsp/SCSP DSP SETUP (2).JS');
  const third = await f.files.saveCode({source: '// second snapshot'});
  assert.equal(third, '/dsp/SCSP DSP setup (3).js');
  assert.equal(f.project.fs.get(first).data, source);
  assert.equal(mode, true);
  assert.deepEqual(f.opened, [first, third].map(path => ({path, options: {show: false}})));
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.project.settings, settings);
  assert.equal(f.doc.getElementById('scspFilesPanel').hidden, false);
  assert.equal(globalThis.scspDspSaveMustNotRun, undefined);
  assert.match(f.statuses.at(-1), /Run this file to restore it/);
  const copy = createScspCodeProject();
  copy.restore(await copy.prepareImport(await f.files.exportProject()));
  assert.equal(copy.fs.get(first).data, source);
  assert.equal(copy.fs.get(third).data, '// second snapshot');
});

test('SCSP generated Code validates names and file budgets before changing Files', async t => {
  const f = fixture(t);
  await f.files.ready;
  const before = f.project.snapshot();
  for (const source of [undefined, null, {}, new String('text')])
    await assert.rejects(f.files.saveCode({source}), /must be text/);
  await assert.rejects(f.files.saveCode({source: '', name: ' '}), /file name/);
  await assert.rejects(f.files.saveCode({source: '', isCurrent: false}), /callback/);
  await assert.rejects(f.files.saveCode({source: 'x'.repeat(2 * 1024 * 1024 + 1)}), /2 MiB/);
  assert.deepEqual(f.project.snapshot(), before);
  assert.deepEqual(f.opened, []);
  const used = f.project.fs.list().reduce((sum, file) => sum +
    (file.type === 'text' ? new TextEncoder().encode(file.data).length : file.data.length), 0);
  f.project.importFiles([{path: '/padding.bin', type: 'binary',
    data: new Uint8Array(SCSP_PROJECT_FILE_BYTES - used - 5)}]);
  const full = f.project.snapshot();
  await assert.rejects(f.files.saveCode({source: '// too large'}), /12 MiB/);
  assert.deepEqual(f.project.snapshot(), full);
  assert.equal(f.doc.querySelector('.scsp-main').inert, false);
});

test('SCSP generated Code reuses a case-insensitive dsp folder and safely rejects a parent file collision', async t => {
  const f = fixture(t);
  await f.files.ready;
  f.project.fs.mkdir('/DSP');
  f.project.importFiles([{path: '/DSP/custom.js', data: 'kept'}]);
  const saved = await f.files.saveCode({source: '// generated', name: 'custom.js'});
  assert.equal(saved, '/DSP/custom (2).js');
  assert.equal(f.project.fs.get('/DSP/custom.js').data, 'kept');
  assert(!f.project.fs.listDirectories().includes('/dsp'));
  f.project.select(null);
  f.project.fs.remove('/DSP', {recursive: true});
  f.project.importFiles([{path: '/DsP', data: 'keep this file'}]);
  const before = f.project.snapshot();
  await assert.rejects(f.files.saveCode({source: '// generated'}), /folder name is already used/);
  assert.deepEqual(f.project.snapshot(), before);
});

test('SCSP generated Code captures its input before readiness and drops stale or disposing saves', async t => {
  const ready = deferred(), writes = [];
  const f = fixture(t, {store: {read: () => ready.promise,
    write: async value => {writes.push(value); return true;}, close: async () => {}}});
  const request = {source: '// captured', name: 'Captured'};
  const pending = f.files.saveCode(request);
  request.source = '// changed'; request.name = 'Changed';
  ready.resolve(null);
  assert.equal(await pending, '/dsp/Captured.js');
  assert.equal(f.project.fs.get('/dsp/Captured.js').data, '// captured');
  const before = f.project.snapshot();
  assert.equal(await f.files.saveCode({source: '// stale', isCurrent: () => false}), false);
  assert.deepEqual(f.project.snapshot(), before);
  const flush = deferred();
  f.files.setCodeControls({setBusy() {}, flush: () => flush.promise});
  const disposal = f.files.dispose();
  assert.equal(await f.files.saveCode({source: '// disposed'}), false);
  assert.deepEqual(f.project.snapshot(), before);
  flush.resolve(); await disposal;
  assert.equal(await f.files.saveCode({source: '// closed'}), false);
});

test('SCSP generated Code remains available for project export when durable storage fails', async t => {
  const f = fixture(t, {store: {read: async () => null,
    write: async () => {throw Error('Injected storage failure');}, close: async () => {}}});
  await f.files.ready;
  const source = '// Keep this DSP setup';
  const path = await f.files.saveCode({source});
  assert.equal(f.project.fs.get(path).data, source);
  assert.match(f.statuses.at(-1), /Local save unavailable; export the project/);
  const restored = createScspCodeProject();
  restored.restore(await restored.prepareImport(await f.files.exportProject()));
  assert.equal(restored.fs.get(path).data, source);
});

test('SCSP committed DSP Code still reports success if audio changes while opening or persisting it', async t => {
  for (const phase of ['open', 'persist']) await t.test(phase, async t => {
    const started = deferred(), release = deferred();
    let currentAudio = true;
    const f = fixture(t, {store: {
      read: async () => null,
      write: async () => {
        if (phase === 'persist') {
          started.resolve();
          await release.promise;
        }
        return true;
      },
      close: async () => {},
    }});
    await f.files.ready;
    f.files.setCodeControls({setBusy() {}, flush: async () => true,
      openFile: async () => {
        if (phase === 'open') {
          started.resolve();
          await release.promise;
        }
      },
    });
    const source = '// Captured before the audio restart';
    const pending = f.files.saveCode({source, isCurrent: () => currentAudio});
    await started.promise;
    assert.equal(f.project.fs.get('/dsp/SCSP DSP setup.js').data, source);
    currentAudio = false;
    release.resolve();
    assert.equal(await pending, '/dsp/SCSP DSP setup.js');
    assert.match(f.statuses.at(-1), /DSP setup saved/);
    assert.equal(f.project.fs.get('/dsp/SCSP DSP setup.js').data, source);
  });
});

test('SCSP pending DSP Code save retires with its Files owner when a workspace is replaced', async t => {
  const opened = deferred(), release = deferred();
  const previous = fixture(t);
  await previous.files.ready;
  previous.files.setCodeControls({setBusy() {}, flush: async () => true,
    openFile: async () => {opened.resolve(); await release.promise;}});
  const pending = previous.files.saveCode({source: '// Previous workspace setup'});
  await opened.promise;
  await previous.files.dispose();
  const replacement = fixture(t, {project: createScspCodeProject({starterCode: '// Replacement'})});
  await replacement.files.ready;
  const before = replacement.project.snapshot();
  release.resolve();
  assert.equal(await pending, false);
  assert.deepEqual(replacement.project.snapshot(), before);
  assert.equal(replacement.project.fs.has('/dsp/SCSP DSP setup.js'), false);
  assert.equal(previous.statuses.some(message => /DSP setup saved/.test(message)), false);
});

test('SCSP JSON selection preserves Keyboard/Code mode and running Code while explicit preset selection applies',async t=>{
  const f=fixture(t);await f.files.ready;let mode=false;
  f.files.setCodeControls({flush:async()=>true,isCodeMode:()=>mode,openFile:async(path,options)=>f.opened.push({path,options}),setBusy(){},stop:()=>assert.fail('A preset selection preserves running Code'),workspaceReplaced:()=>assert.fail('A preset selection preserves its runtime')});
  f.project.importFiles([{path:'/notes.json',data:'{}'},{path:'/presets/Sine.scsp.json',data:JSON.stringify(createDefaultPreset())},{path:'/unfinished.json',data:'{unfinished'}]);
  for(const path of ['/index.js','/notes.json','/presets/Sine.scsp.json','/unfinished.json'])await f.files.selectFile(path);
  assert(f.opened.every(entry=>entry.options.show===false));assert.deepEqual(f.calls.map(entry=>entry[0]),['sound','apply']);assert.match(f.statuses.at(-1),/current sound kept/);
  mode=true;await f.files.selectFile('/presets/Sine.scsp.json');assert.equal(f.opened.at(-1).options.show,true);
  f.project.writeEditorText('/presets/Sine.scsp.json','{"unfinished":');await f.files.persistCode();assert.equal(f.calls.filter(call=>call[0]==='apply').length,2);
});

test('SCSP valid preset cancellation preserves current selection and persists the reconciled cached patch',async t=>{
  let settings=createDefaultPreset();const next={...settings,transpose:6};
  const f=fixture(t,{getSettings:()=>settings,applySettings:async()=>{settings=next;return false;}});await f.files.ready;
  f.project.importFiles([{path:'/Selected.scsp.json',data:JSON.stringify(next)}]);const selected=f.project.selectedPath;
  assert.equal(await f.files.selectFile('/Selected.scsp.json'),false);assert.deepEqual(f.project.settings,next);assert.equal(f.project.selectedPath,selected);
  assert.equal(f.doc.getElementById('scspPresetSelect').value,'');await f.files.persistCode();assert.deepEqual(f.writes.at(-1).settings,next);
});

test('SCSP opaque VGM/VGZ and audio imports use their future source paths without applying a patch',async t=>{
  const f=fixture(t,{onOpenSource:async(file,{path,isCurrent})=>{assert(isCurrent());f.calls.push(['source',path,file.data]);return true;}});await f.files.ready;
  const bytes=Uint8Array.of(0,255,17),input=name=>({name,size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer});
  assert.deepEqual(await f.files.importFiles([input('Song.vgm'),input('Compressed.vgz'),input('Sample.wav')]),['/vgm/Song.vgm','/vgm/Compressed.vgz','/audio/Sample.wav']);
  assert.deepEqual(f.calls,[]);await f.files.selectFile('/vgm/Song.vgm');assert.deepEqual(f.calls,[['source','/vgm/Song.vgm',bytes]]);assert.equal(f.project.selectedPath,'/vgm/Song.vgm');
  const copy=createScspCodeProject();copy.restore(await copy.prepareImport(await f.files.exportProject()));assert.deepEqual(copy.fs.get('/vgm/Compressed.vgz').data,bytes);
});

test('SCSP SSF folder import preserves nested libraries and same-named songs as original binary files', async t => {
  const f = fixture(t);
  await f.files.ready;
  const input = (name, bytes, webkitRelativePath = '') => ({
    name,
    webkitRelativePath,
    size: bytes.length,
    arrayBuffer: async () => bytes.slice().buffer,
  });
  const first = Uint8Array.of(0x50, 0x53, 0x46, 0x11, 255);
  const second = Uint8Array.of(0, 254, 17);
  const library = Uint8Array.of(1, 2, 3, 128);
  assert.deepEqual(await f.files.importFiles([
    input('Track.ssf', first, 'Saturn/Disc 1/Track.ssf'),
    input('Track.ssf', second, 'Saturn/Disc 2/Track.ssf'),
    input('Driver.ssflib', library, 'Saturn/lib/Driver.ssflib'),
    {name:'Readme.txt',size:100,arrayBuffer:()=>assert.fail('Folder import only reads SSF files')},
  ], {ssfOnly:true}), [
    '/ssf/Saturn/Disc 1/Track.ssf',
    '/ssf/Saturn/Disc 2/Track.ssf',
    '/ssf/Saturn/lib/Driver.ssflib',
  ]);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.project.fs.get('/ssf/Saturn/Disc 1/Track.ssf').data, first);
  assert.deepEqual(f.project.fs.get('/ssf/Saturn/Disc 2/Track.ssf').data, second);
  assert(!f.project.fs.has('/Readme.txt'));
  const restored = createScspCodeProject();
  restored.restore(await restored.prepareImport(await f.files.exportProject()));
  assert.deepEqual(restored.fs.get('/ssf/Saturn/lib/Driver.ssflib').data, library);
  assert.equal(restored.fs.get('/ssf/Saturn/lib/Driver.ssflib').type, 'binary');
  assert.deepEqual(await f.files.importFiles([input('Single.MINISSF', first)]), ['/ssf/Single.MINISSF']);
  assert(isScspSsfFile('Single.MINISSF'));
  assert(!isScspSsfFile('notes.txt'));
});

test('SCSP folder import validates paths, duplicates and byte budgets before reading or replacing Files', async t => {
  const f = fixture(t);
  await f.files.ready;
  const before = f.project.snapshot();
  const unread = (name, size = 1, webkitRelativePath = '') => ({
    name, size, webkitRelativePath,
    arrayBuffer: () => assert.fail('Invalid imports must fail before bytes are read'),
  });
  for (const relative of ['/Track.ssf', '../Track.ssf', 'Saturn/../Track.ssf',
    'Saturn/./Track.ssf', 'Saturn//Track.ssf', 'Saturn\\Track.ssf', 'Saturn/Other.ssf']) {
    await assert.rejects(f.files.importFiles([unread('Track.ssf', 1, relative)]), /Invalid SSF folder path/);
    assert.deepEqual(f.project.snapshot(), before);
  }
  await assert.rejects(f.files.importFiles([
    unread('Track.ssf', 1, 'Saturn/Track.ssf'),
    unread('Track.ssf', 1, 'Saturn/Track.ssf'),
  ]), /Duplicate imported file path/);
  await assert.rejects(f.files.importFiles([unread('Huge.ssflib', 16*1024*1024+1)]), /16 MiB/);
  await assert.rejects(f.files.importFiles([
    unread('One.ssflib', 7*1024*1024), unread('Two.ssflib', 7*1024*1024),
  ]), /12 MiB/);
  assert.deepEqual(f.project.snapshot(), before);
  assert.deepEqual(await f.files.importFiles([unread('Readme.txt')], {ssfOnly:true}), []);
  assert.deepEqual(f.calls, []);
});

test('SCSP malformed projects and oversized sound saves preserve the workspace atomically',async t=>{
  const f=fixture(t);await f.files.ready;const before=f.project.snapshot();await assert.rejects(f.files.importProject(Uint8Array.of(1,2,3)));assert.deepEqual(f.project.snapshot(),before);
  const used=f.project.fs.list().reduce((sum,file)=>sum+(file.type==='text'?new TextEncoder().encode(file.data).byteLength:file.data.byteLength),0);
  f.project.importFiles([{path:'/padding.bin',type:'binary',data:new Uint8Array(SCSP_PROJECT_FILE_BYTES-used-100)}]);const full=f.project.snapshot();await assert.rejects(f.files.saveSound(),/12 MiB/);assert.deepEqual(f.project.snapshot(),full);assert.equal(f.doc.querySelector('.scsp-main').inert,false);
});

test('SCSP cancelled workspace patch application leaves the current Files intact',async t=>{
  const f=fixture(t,{applySettings:async()=>false});await f.files.ready;const before=f.project.snapshot();
  const imported=createScspCodeProject({starterCode:'// imported'});imported.importFiles([{path:'/imported.txt',data:'new'}]);
  assert.equal(await f.files.importProject(imported.exportProject()),false);assert.deepEqual(f.project.snapshot(),before);
});

test('SCSP duplicate/rename/delete preserve opaque data and retire only the executing source',async t=>{
  const f=fixture(t);await f.files.ready;f.project.importFiles([{path:'/folder/code.js',data:'kept'},{path:'/folder/raw.bin',type:'binary',data:Uint8Array.of(0,255)}]);
  let stops=0;const changes=[];f.files.setCodeControls({activePath:'/notes.json',executionPath:'/folder/code.js',flush:async()=>true,isCodeMode:()=>false,openFile:async()=>true,pathChanged:(...args)=>changes.push(args),stop:async()=>{stops++;},setBusy(){}});
  const copy=await f.files.duplicate('/folder');assert.equal(copy,'/folder-copy');assert.deepEqual(f.project.fs.get('/folder-copy/raw.bin').data,Uint8Array.of(0,255));assert.equal(stops,0);
  await f.files.move('/folder-copy/code.js','/folder-copy/code.json');await f.files.remove('/folder-copy');assert.equal(stops,0);
  await f.files.move('/folder/code.js','/folder/code.json');assert.equal(stops,1);assert.deepEqual(changes.at(-1),['/folder/code.js','/folder/code.json']);
});

test('SCSP delayed file reads cannot overwrite newer Files changes or disposed workspaces',async t=>{
  const f=fixture(t);await f.files.ready;const gate=deferred();
  const pending=f.files.importFiles([{name:'stale.vgm',size:4,arrayBuffer:()=>gate.promise}]);
  await f.files.createFile('/new.js');f.project.writeEditorText('/new.js','latest unflushed text');gate.resolve(new TextEncoder().encode('late').buffer);
  assert.deepEqual(await pending,[]);assert(!f.project.fs.has('/vgm/stale.vgm'));assert.equal(f.project.fs.get('/new.js').data,'latest unflushed text');
  const disposedRead=deferred(),late=f.files.importFiles([{name:'after-close.txt',size:4,arrayBuffer:()=>disposedRead.promise}]);
  await f.files.dispose();disposedRead.resolve(new TextEncoder().encode('late').buffer);assert.deepEqual(await late,[]);assert(!f.project.fs.has('/after-close.txt'));
});

test('SCSP unread or invalid durable drafts remain untouched by later edits and shutdown',async t=>{
  for(const failure of ['read','invalid'])await t.test(failure,async t=>{
    const writes=[],f=fixture(t,{store:{read:async()=>{if(failure==='read')throw Error('Injected read failure');return{format:'invalid'};},write:async value=>{writes.push(value);return true;},close:async()=>{}}});
    await f.files.ready;assert.match(f.statuses.at(-1),/Local project restore failed/);
    const edited=createDefaultPreset();edited.transpose=9;f.setSettings(edited);f.files.markSoundDirty();f.project.writeEditorText('/index.js','// unsaved');
    assert.equal(await f.files.persistCode(),false);await f.files.createFile('/notes.txt');assert.equal(writes.length,0);
    const copy=createScspCodeProject();copy.restore(await copy.prepareImport(await f.files.exportProject()));assert.deepEqual(copy.settings,edited);assert.equal(copy.fs.get('/index.js').data,'// unsaved');
    await f.files.dispose();assert.equal(writes.length,0);
  });
});

test('SCSP Save sound as captures its source at dialog open and Cancel leaves Files unchanged',async t=>{
  const f=fixture(t);await f.files.ready;const before=f.project.fs.snapshot(),button=f.doc.getElementById('scspSaveSoundAs');await button.fire('click');const dialog=f.doc.getElementById('scspFileNameDialog'),input=f.doc.getElementById('scspFileNameInput');assert.equal(dialog.open,true);assert.equal(input.value,'Sine');
  await f.doc.getElementById('scspFileNameCancel').fire('click');assert.deepEqual(f.project.fs.snapshot(),before);
  await button.fire('click');const changed=createDefaultPreset();changed.transpose=12;f.setSettings(changed);f.files.markSoundDirty();input.value='Captured before edit';await dialog.children[0].fire('submit');await new Promise(r=>setImmediate(r));
  assert.equal(JSON.parse(f.project.fs.get('/presets/Captured before edit.scsp.json').data).transpose,0);assert.deepEqual(f.project.settings,changed);assert.deepEqual(f.calls,[]);
});

test('SCSP Menu places New Cassette before Import and cancellation keeps the current project and performance',async t=>{
  const source=await readFile(new URL('./index.html',import.meta.url),'utf8');
  assert(source.indexOf('<h2>New</h2>')<source.indexOf('<h2>Import</h2>'));
  assert.match(source,/id="scspMenuProjectNew"/);assert.match(source,/id="scspMenuProjectImport"/);
  const f=fixture(t);await f.files.ready;
  f.files.setCodeControls({setBusy(){},flush:()=>assert.fail('Cancel must not flush'),workspaceReplaced:()=>assert.fail('Cancel must not stop Code')});
  const before=f.project.snapshot(),identity=f.files.workspaceId;
  const button=f.doc.getElementById('scspProjectNewButton'),dialog=f.doc.getElementById('scspNewCassetteDialog');
  assert.equal(button.parentNode.id,'scspMenuProjectNew');assert.equal(button.textContent,'Cassette…');
  assert.equal(f.doc.getElementById('scspProjectImportButton').parentNode.id,'scspMenuProjectImport');
  await button.fire('click');assert.equal(dialog.open,true);assert.equal(f.doc.activeElement.id,'scspNewCassetteCancel');
  await f.doc.getElementById('scspNewCassetteCancel').fire('click');assert.equal(dialog.open,false);
  await button.fire('click');await dialog.fire('cancel');assert.equal(dialog.open,false);
  assert.deepEqual(f.project.snapshot(),before);assert.equal(f.files.workspaceId,identity);assert.deepEqual(f.calls,[]);assert.equal(f.writes.length,0);
  f.files.setCodeControls({setBusy(){},flush:async()=>true});
});

test('SCSP New Cassette creates default sound, original starter/examples and fresh identity without running Code',async t=>{
  const settings=createDefaultPreset();settings.transpose=12;
  const f=fixture(t,{settings});await f.files.ready;
  f.project.writeEditorText('/index.js','globalThis.scspNewCassetteMustNotRun=true;');
  f.project.importFiles([{path:'/old.txt',data:'old project'},{path:'/ssf/song.ssf',type:'binary',data:Uint8Array.of(1,2,3)}]);
  f.project.select('/old.txt');f.project.setCodeState({mode:'code',path:'/index.js'});
  const identity=f.files.workspaceId,restored=[];
  f.files.setCodeControls({setBusy(){},flush:async()=>true,captureState:()=>({mode:'code',path:'/index.js'}),
    workspaceReplaced:async()=>f.calls.push(['retire']),restoreState:async state=>restored.push(state),run:()=>assert.fail('New never runs')});
  assert.equal(await f.files.newProject(),true);
  assert.equal(f.project.fs.get('/index.js').data,'// kept');assert(!f.project.fs.has('/old.txt'));assert(!f.project.fs.has('/ssf/song.ssf'));
  assert(f.project.fs.has('/examples/cycle2.js'));assert.deepEqual(f.project.settings,createDefaultScspProjectSound());
  assert.equal(f.project.selectedPath,'/index.js');assert.deepEqual(restored,[{mode:'keyboard',path:'/index.js'}]);
  assert.notEqual(f.files.workspaceId,identity);assert.equal(f.writes.at(-1).workspaceId,f.files.workspaceId);
  assert.deepEqual(f.writes.at(-1).settings,createDefaultScspProjectSound());
  assert.deepEqual(f.calls.map(call=>call[0]),['retire','before','apply']);assert.match(f.statuses.at(-1),/created.*not run.*Saved locally/);
  assert.equal(globalThis.scspNewCassetteMustNotRun,undefined);
});

test('SCSP New Cassette exports the old workspace before creation and export cancellation/failure preserves it',async t=>{
  for(const outcome of ['success','cancel','throw'])await t.test(outcome,async t=>{
    const downloads=[];
    const f=fixture(t,{downloadFile:async(bytes,name,type)=>{downloads.push({bytes,name,type});if(outcome==='throw')throw Error('Download unavailable');return outcome!=='cancel';}});
    await f.files.ready;f.project.importFiles([{path:'/keep.txt',data:'exported old file'}]);
    const before=f.project.snapshot(),identity=f.files.workspaceId;
    if(outcome==='throw')await assert.rejects(f.files.newProject({exportCurrent:true}),/Download unavailable/);
    else assert.equal(await f.files.newProject({exportCurrent:true}),outcome==='success');
    assert.equal(downloads.length,1);assert.equal(downloads[0].name,'Tetorica SCSP.cassette.zip');assert.equal(downloads[0].type,'application/zip');
    const exported=createScspCodeProject();exported.restore(await exported.prepareImport(downloads[0].bytes));assert.equal(exported.fs.get('/keep.txt').data,'exported old file');
    if(outcome!=='success'){assert.deepEqual(f.project.snapshot(),before);assert.equal(f.files.workspaceId,identity);assert.deepEqual(f.calls,[]);assert.equal(f.writes.length,0);}
  });
});

test('SCSP New Cassette backup reads current async v11 Code edits once, including when download cancels or fails',async t=>{
  for(const outcome of ['success','cancel','throw'])await t.test(outcome,async t=>{
    const cached=createDefaultPreset(),edited={...cached,name:'Live edited Cycle',version:11,mode:'fm2',
      fm:{...cached.fm,algorithm:'cycle2',cycle2:{outputs:[0,1]},depths:[3,8,1,2,3,4]},operators:structuredClone(cached.operators)};
    edited.operators.carrier.pcm[3]=321;edited.operators.modulator.voice.totalLevel=31;
    let reads=0;const downloads=[];
    const f=fixture(t,{settings:cached,getSoundSettings:async()=>{reads++;await Promise.resolve();return structuredClone(edited);},
      downloadFile:async bytes=>{downloads.push(bytes);if(outcome==='throw')throw Error('Backup failed');return outcome!=='cancel';}});
    await f.files.ready;f.project.writeEditorText('/index.js','// Current user Code');f.project.importFiles([{path:'/keep.txt',data:'keep in backup'}]);
    const before=f.project.snapshot(),identity=f.files.workspaceId;
    if(outcome==='throw')await assert.rejects(f.files.newProject({exportCurrent:true}),/Backup failed/);
    else assert.equal(await f.files.newProject({exportCurrent:true}),outcome==='success');
    assert.equal(reads,1);assert.equal(downloads.length,1);
    const backup=createScspCodeProject();backup.restore(await backup.prepareImport(downloads[0]));
    assert.deepEqual(backup.settings,edited);assert.equal(backup.fs.get('/index.js').data,'// Current user Code');assert.equal(backup.fs.get('/keep.txt').data,'keep in backup');
    if(outcome!=='success'){assert.deepEqual(f.project.snapshot(),before);assert.equal(f.files.workspaceId,identity);assert.deepEqual(f.calls,[]);}
  });
});

test('SCSP cancelling during the fresh sound read prevents backup and owner retirement',async t=>{
  const started=deferred(),release=deferred();let reads=0;
  const f=fixture(t,{getSoundSettings:async()=>{reads++;started.resolve();await release.promise;return createDefaultPreset();},downloadFile:()=>assert.fail('Cancelled read must not download')});
  await f.files.ready;const before=f.project.snapshot(),identity=f.files.workspaceId;
  f.files.setCodeControls({setBusy(){},flush:async()=>true,workspaceReplaced:()=>assert.fail('Cancelled read must not stop Code')});
  await f.doc.getElementById('scspProjectNewButton').fire('click');
  const pending=f.files.newProject({exportCurrent:true});await started.promise;
  await f.doc.getElementById('scspNewCassetteCancel').fire('click');release.resolve();
  assert.equal(await pending,false);assert.equal(reads,1);assert.deepEqual(f.project.snapshot(),before);assert.equal(f.files.workspaceId,identity);assert.deepEqual(f.calls,[]);
});

test('SCSP New Cassette backup retains cached-sound fallback when a fresh read is unavailable',async t=>{
  let reads=0;const downloads=[];
  const f=fixture(t,{getSoundSettings:async()=>{reads++;throw Error('Fresh read unavailable');},downloadFile:async bytes=>{downloads.push(bytes);return false;}});
  await f.files.ready;f.project.importFiles([{path:'/keep.txt',data:'keep'}]);const before=f.project.snapshot();
  assert.equal(await f.files.newProject({exportCurrent:true}),false);assert.equal(reads,1);assert.equal(downloads.length,1);
  const backup=createScspCodeProject();backup.restore(await backup.prepareImport(downloads[0]));
  assert.deepEqual(backup.settings,createDefaultPreset());assert.equal(backup.fs.get('/keep.txt').data,'keep');
  assert(f.statuses.some(message=>/Fresh read unavailable.*last cached sound/.test(message)));
  assert.deepEqual(f.project.snapshot(),before);assert.deepEqual(f.calls,[]);
});

test('SCSP failed New Cassette without a backup restores fresh Code-edited sound using the same single read',async t=>{
  const cached=createDefaultPreset(),edited={...cached,name:'Live rollback Cycle',version:11,mode:'fm2',
    fm:{...cached.fm,algorithm:'cycle2',cycle2:{outputs:[0,1]},depths:[2,7,3,4,5,6]}};
  let reads=0;const applied=[];
  const f=fixture(t,{settings:cached,getSoundSettings:async()=>{reads++;await Promise.resolve();return structuredClone(edited);},
    applySettings:async value=>{applied.push(structuredClone(value));f.setSettings(value);return applied.length!==1;}});
  await f.files.ready;f.project.importFiles([{path:'/keep.txt',data:'keep'}]);f.project.select('/keep.txt');const identity=f.files.workspaceId,beforeFiles=f.project.fs.snapshot();
  assert.equal(await f.files.newProject(),false);assert.equal(reads,1);assert.equal(applied.length,2);
  assert.deepEqual(applied.at(-1),edited);assert.deepEqual(f.project.settings,edited);assert.deepEqual(f.project.fs.snapshot(),beforeFiles);
  assert.equal(f.project.selectedPath,'/keep.txt');assert.equal(f.files.workspaceId,identity);
});

test('SCSP New Cassette rejects failed preparation and cancelled flush before retiring any owner',async t=>{
  const f=fixture(t);await f.files.ready;const before=f.project.snapshot();
  const prepare=f.project.prepareNew;f.project.prepareNew=()=>{throw Error('Fresh project unavailable');};
  await assert.rejects(f.files.newProject(),/Fresh project unavailable/);assert.deepEqual(f.project.snapshot(),before);assert.deepEqual(f.calls,[]);
  f.project.prepareNew=prepare;
  f.files.setCodeControls({setBusy(){},flush:async()=>false,workspaceReplaced:()=>assert.fail('Cancelled flush must not retire Code')});
  assert.equal(await f.files.newProject(),false);assert.deepEqual(f.project.snapshot(),before);assert.deepEqual(f.calls,[]);
  f.files.setCodeControls({setBusy(){},flush:async()=>true});
  await assert.rejects(f.files.newProject({exportCurrent:'yes'}),TypeError);
});

test('SCSP failed or cancelled New Cassette application restores the old project, sound, editor and identity',async t=>{
  for(const phase of ['apply-false','apply-throw','editor-false','editor-throw'])await t.test(phase,async t=>{
    let applications=0,restores=0;const applied=[];
    const f=fixture(t,{applySettings:async value=>{applications++;applied.push(value);if(applications===1){if(phase==='apply-false')return false;if(phase==='apply-throw')throw Error('Apply failed');}}});
    await f.files.ready;f.project.importFiles([{path:'/keep.txt',data:'keep'}]);f.project.select('/keep.txt');f.project.setCodeState({mode:'code',path:'/index.js'});
    const before=f.project.snapshot(),identity=f.files.workspaceId,states=[];
    f.files.setCodeControls({setBusy(){},flush:async()=>true,workspaceReplaced:async()=>true,
      restoreState:async state=>{states.push(state);restores++;if(restores===1){if(phase==='editor-false')return false;if(phase==='editor-throw')throw Error('Editor failed');}}});
    if(phase.endsWith('throw'))await assert.rejects(f.files.newProject(),/failed/);else assert.equal(await f.files.newProject(),false);
    assert.deepEqual(f.project.snapshot(),before);assert.equal(f.files.workspaceId,identity);
    assert.deepEqual(applied.at(-1),before.settings);assert.equal(applications,2);
    assert.deepEqual(states.at(-1),before.codeState);assert(!f.writes.some(value=>!value.filesystem.files.some(file=>file.path==='/keep.txt')));
    assert.equal(f.doc.querySelector('.scsp-main').inert,false);
  });
});

test('SCSP cancelling New Cassette while Apply is pending restores the old project after the stale Apply resolves',async t=>{
  const started=deferred(),release=deferred();let applications=0;
  const f=fixture(t,{applySettings:async()=>{if(++applications===1){started.resolve();await release.promise;}}});
  await f.files.ready;f.project.importFiles([{path:'/keep.txt',data:'keep'}]);const before=f.project.snapshot(),identity=f.files.workspaceId;
  await f.doc.getElementById('scspProjectNewButton').fire('click');
  const pending=f.files.newProject();await started.promise;
  await f.doc.getElementById('scspNewCassetteCancel').fire('click');release.resolve();
  assert.equal(await pending,false);assert.deepEqual(f.project.snapshot(),before);assert.equal(f.files.workspaceId,identity);assert.equal(applications,2);
  assert.equal(f.doc.getElementById('scspNewCassetteDialog').open,false);assert.equal(f.doc.querySelector('.scsp-main').inert,false);
});

test('SCSP successful New Cassette remains exportable when local persistence fails and dialog cleans up on disposal',async t=>{
  const f=fixture(t,{store:{read:async()=>null,write:async()=>{throw Error('Storage unavailable');},close:async()=>{}}});
  await f.files.ready;assert.equal(await f.files.newProject(),true);assert.match(f.statuses.at(-1),/Local save unavailable/);
  const copy=createScspCodeProject();copy.restore(await copy.prepareImport(await f.files.exportProject()));assert.equal(copy.fs.get('/index.js').data,'// kept');assert(copy.fs.has('/examples/cycle2.js'));
  await f.files.dispose();assert.equal(f.doc.getElementById('scspNewCassetteDialog'),undefined);assert.equal(await f.files.newProject(),false);
});

