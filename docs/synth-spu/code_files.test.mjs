import test from 'node:test';
import assert from 'node:assert/strict';
import {setupSpuCodeFiles} from './code_files.js';
import {createSpuCodeProject,SPU_PROJECT_FILE_BYTES} from './code_project.js';

class Element{
  constructor(doc,tag='div'){Object.assign(this,{ownerDocument:doc,tagName:tag.toUpperCase(),children:[],listeners:new Map(),attributes:{},dataset:{},hidden:false,value:'',disabled:false});const names=new Set();this.classList={toggle:(name,on)=>on?names.add(name):names.delete(name),contains:name=>names.has(name),add:name=>names.add(name),remove:name=>names.delete(name)};}
  append(...nodes){this.children.push(...nodes);}appendChild(node){this.append(node);return node;}replaceChildren(...nodes){this.children=nodes;}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  querySelectorAll(selector){return walk(this).filter(node=>selector==='button'&&node.tagName==='BUTTON');}
  focus(){this.ownerDocument.activeElement=this;}blur(){if(this.ownerDocument.activeElement===this)this.ownerDocument.activeElement=null;}select(){}showModal(){this.open=true;}close(){this.open=false;}
  async fire(type,extra={}){const event={target:this,preventDefault(){},stopPropagation(){},...extra};for(const fn of this.listeners.get(type)??[])await fn(event);}
}
const walk=node=>[node,...node.children.flatMap(walk)],deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(t,options={}){
  const doc=new Element(null,'document');doc.ownerDocument=doc;doc.createElement=tag=>new Element(doc,tag);doc.getElementById=id=>walk(doc).find(node=>node.id===id);doc.defaultView=new Element(doc,'window');
  const main=new Element(doc);main.id='test-main';doc.append(main);doc.querySelector=selector=>selector==='.spu-main'?main:null;
  for(const id of ['spuFilesPanel','spuFilesToggle','synthWorkspace']){const node=new Element(doc);node.id=id;node.hidden=id==='spuFilesPanel';doc.append(node);}
  const previous=globalThis.document;globalThis.document=doc;t.after(()=>{globalThis.document=previous;});
  const project=options.project??createSpuCodeProject({starterCode:'kept'}),writes=[],calls=[],statuses=[],opened=[];
  const store=options.store??{read:async()=>null,write:async value=>{writes.push(structuredClone(value));return true;},close:async()=>{}};
  const files=setupSpuCodeFiles({project,document:doc,store,getInstrument:async()=>{calls.push(['capture']);return soundFixture();},applyInstrument:async value=>calls.push(['instrument',value]),onBeforeWorkspaceReplace:async()=>calls.push(['before']),setStatus:text=>statuses.push(text),...options});
  files.setCodeControls({flush:async()=>true,openFile:async(path,options)=>{opened.push({path,options});return true;},setBusy(){}});
  t.after(()=>files.dispose());return{files,project,doc,writes,calls,statuses,opened};
}

function soundFixture(){return {schema:'tetorica-spu-synth.instrument',version:1,name:'Saved PCM',
  preset:{volumeLeft:.75,volumeRight:.75,adsr1:15,adsr2:0,pitch:4096,reverb:false},
  sample:{adpcm:[12,1,...Array(14).fill(0)],baseFrequencyHz:440},reverb:{preset:'off',volumeLeft:.25,volumeRight:.25}};}

test('SPU Files selection, autosave and rename/delete share the Code controls without inspecting audio',async t=>{
  const f=fixture(t);await f.files.ready;const opened=[],changed=[];
  f.files.setCodeControls({activePath:null,flush:async()=>true,openFile:async path=>opened.push(path),pathChanged:(...args)=>changed.push(args),setBusy(){}});
  await f.files.createFile('/lib/notes.js');assert.deepEqual(opened,['/lib/notes.js']);
  f.project.importFiles([{path:'/data/note.json',data:'{"note":"A4"}'}]);await f.files.selectFile('/data/note.json');
  assert.equal(f.doc.getElementById('spuFileTextEditor'),undefined);assert.equal(opened.at(-1),'/data/note.json');
  f.project.writeEditorText('/data/note.json','{"note":"E4"}');await f.files.persistCode();
  assert.equal(f.project.fs.get('/data/note.json').data,'{"note":"E4"}');assert(f.writes.length);assert.equal(f.calls.length,0);
  await f.files.move('/lib/notes.js','/lib/melody.js');assert(f.project.fs.has('/lib/melody.js'));assert.deepEqual(changed.at(-1),['/lib/notes.js','/lib/melody.js']);
  await f.files.remove('/lib/melody.js');assert(!f.project.fs.has('/lib/melody.js'));assert.deepEqual(changed.at(-1),['/lib/melody.js',null]);
  f.files.setVisible(true);assert(f.doc.getElementById('synthWorkspace').classList.contains('has-files'));assert.equal(f.doc.getElementById('spuFilesToggle').getAttribute('aria-expanded'),'true');
});

test('project replacement waits for Code cleanup but never captures or applies an instrument',async t=>{
  const f=fixture(t);await f.files.ready;const gate=deferred(),events=[];
  f.files.setCodeControls({flush:async()=>true,setBusy(){},workspaceReplaced:async()=>{events.push('stop');await gate.promise;events.push('stopped');return true;},restoreState:async state=>events.push(['restore',state])});
  const incoming=createSpuCodeProject({starterCode:'throw Error("never auto-run")'});incoming.setCodeState({mode:'code',path:'/index.js'});
  const before=f.project.snapshot(),pending=f.files.importProject(incoming.exportProject());
  for(let count=0;count<100&&!events.length;count++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.deepEqual(f.project.snapshot(),before);assert.deepEqual(events,['stop']);assert.equal(f.calls.length,0);assert.equal(f.doc.querySelector('.spu-main').inert,true);
  gate.resolve();assert.equal(await pending,true);assert.equal(f.project.fs.get('/index.js').data,'throw Error("never auto-run")');
  assert.deepEqual(f.calls.map(call=>call[0]),['before']);assert.deepEqual(events,['stop','stopped',['restore',{mode:'code',path:'/index.js'}]]);assert.equal(f.doc.querySelector('.spu-main').inert,false);
});

test('local restoration retains Files and Code mode without an audio capture or preset application',async t=>{
  const saved=createSpuCodeProject({starterCode:'restored'});saved.select('/index.js');saved.setCodeState({mode:'code',path:'/index.js'});
  const f=fixture(t,{store:{read:async()=>({...saved.snapshot(),workspaceId:'saved-spu',filesVisible:true}),write:async()=>true,close:async()=>{}}});
  await f.files.ready;assert.equal(f.files.workspaceId,'saved-spu');assert.equal(f.project.fs.get('/index.js').data,'restored');
  assert.deepEqual(f.files.getCodeState(),{mode:'code',path:'/index.js'});assert.equal(f.doc.getElementById('spuFilesPanel').hidden,false);assert.deepEqual(f.calls.map(call=>call[0]),['before']);
});

test('only Save sound captures the authored sample; selecting valid JSON applies it after stopping Code',async t=>{
  const f=fixture(t);await f.files.ready;await f.files.persistCode();assert.equal(f.calls.length,0);
  const path=await f.files.saveSound();assert.equal(path,'/presets/Saved PCM.spu.json');assert.deepEqual(f.calls.map(call=>call[0]),['capture']);
  assert.deepEqual(JSON.parse(f.project.fs.get(path).data),soundFixture());
  await f.files.selectFile(path);assert.deepEqual(f.calls.map(call=>call[0]),['capture','before','instrument']);assert.deepEqual(f.calls.at(-1)[1],soundFixture());
  const count=f.calls.length;f.project.importFiles([{path:'/presets/unfinished.spu.json',data:'{"preset":'}]);await f.files.selectFile('/presets/unfinished.spu.json');
  assert.equal(f.calls.length,count);assert.equal(f.opened.at(-1).path,'/presets/unfinished.spu.json');assert.match(f.statuses.at(-1),/current sound kept/);
});

test('named saves retain multiple instruments, reveal presets and do not stop or apply audio',async t=>{
  let instrument={...soundFixture(),name:'Piano'};
  const f=fixture(t,{getInstrument:async()=>instrument});await f.files.ready;
  const opened=[];
  f.files.setCodeControls({flush:async()=>true,setBusy(){},openFile:async(path,options)=>opened.push({path,options}),stop(){assert.fail('Saving must not stop Code');},workspaceReplaced(){assert.fail('Saving must not replace the Code workspace');}});
  const first=await f.files.saveSound(),firstBytes=f.project.fs.get(first).data;
  const folder=walk(f.doc).find(node=>node.tagName==='DETAILS'&&node.children[0]?.getAttribute('data-file-path')==='/presets');
  folder.open=false;await folder.fire('toggle');f.files.setVisible(false);
  instrument={...soundFixture(),name:'Flute',preset:{...soundFixture().preset,adsr1:0x1234}};
  const second=await f.files.saveSound();
  instrument={...soundFixture(),name:'Piano',preset:{...soundFixture().preset,adsr1:0x5678}};
  const third=await f.files.saveSound();
  assert.deepEqual([first,second,third],['/presets/Piano.spu.json','/presets/Flute.spu.json','/presets/Piano (2).spu.json']);
  assert.equal(f.project.fs.get(first).data,firstBytes,'a later save never overwrites the earlier Piano');
  assert.equal(JSON.parse(f.project.fs.get(second).data).preset.adsr1,0x1234);
  assert.equal(JSON.parse(f.project.fs.get(third).data).preset.adsr1,0x5678);
  assert.equal(f.project.selectedPath,third);assert.deepEqual(opened,[first,second,third].map(path=>({path,options:{show:false}})));
  assert.equal(f.doc.getElementById('spuFilesPanel').hidden,false);
  assert(walk(f.doc).find(node=>node.tagName==='DETAILS'&&node.children[0]?.getAttribute('data-file-path')==='/presets').open);
  assert.equal(f.writes.at(-1).filesVisible,true);assert.equal(f.writes.at(-1).selectedPath,third);
  assert.deepEqual(f.calls,[]);
});

test('preset filenames keep Unicode while escaping path characters and preserving files or directories',async t=>{
  let instrument={...soundFixture(),name:'音色 / flute\\piano:1?'};
  const f=fixture(t,{getInstrument:async()=>instrument});await f.files.ready;
  const path=await f.files.saveSound();assert.equal(path,'/presets/音色 _ flute_piano_1_.spu.json');
  assert.equal(JSON.parse(f.project.fs.get(path).data).name,instrument.name,'the authored instrument name is retained inside the preset');
  f.project.fs.mkdir('/presets/Clav.spu.json');
  f.project.importFiles([{path:'/presets/CLAV (2).spu.json',data:'existing user text'}]);
  instrument={...soundFixture(),name:'clav'};
  assert.equal(await f.files.saveSound(),'/presets/clav (3).spu.json');
  assert.equal(f.project.fs.stat('/presets/Clav.spu.json').type,'directory');
  assert.equal(f.project.fs.get('/presets/CLAV (2).spu.json').data,'existing user text');
  f.project.importFiles([{path:'/presets/Café.spu.json',data:'existing Unicode filename'}]);
  instrument={...soundFixture(),name:'Cafe\u0301'};assert.equal(await f.files.saveSound(),'/presets/Café (2).spu.json');
  assert.equal(f.project.fs.get('/presets/Café.spu.json').data,'existing Unicode filename');
  instrument={...soundFixture(),name:'../..\\escape\u0000'};
  const escaped=await f.files.saveSound();assert.match(escaped,/^\/presets\/[^/\\\u0000]+\.spu\.json$/);assert(!escaped.includes('/../'));
  instrument={...soundFixture(),name:'CON'};assert.equal(await f.files.saveSound(),'/presets/_CON.spu.json');
  instrument={...soundFixture(),name:'CON .tone'};assert.equal(await f.files.saveSound(),'/presets/_CON .tone.spu.json');
  instrument={...soundFixture(),name:'...'};assert.equal(await f.files.saveSound(),'/presets/Untitled.spu.json');
  instrument={...soundFixture(),name:'波'.repeat(80)};
  const bounded=await f.files.saveSound();assert(new TextEncoder().encode(bounded.split('/').pop()).length<=180);
});

test('capture errors and project size limits do not add a preset or change Files selection',async t=>{
  let fail=true;
  const f=fixture(t,{getInstrument:async()=>{if(fail)throw Error('Capture failed');return soundFixture();}});await f.files.ready;
  f.project.select('/index.js');const initial=f.project.snapshot();
  await assert.rejects(f.files.saveSound(),/Capture failed/);assert.deepEqual(f.project.snapshot(),initial);
  assert.equal(f.doc.getElementById('spuFilesPanel').hidden,true);assert.equal(f.doc.querySelector('.spu-main').inert,false);
  fail=false;f.project.importFiles([{path:'/data/filled.bin',type:'binary',data:new Uint8Array(SPU_PROJECT_FILE_BYTES-64)}]);
  const before=f.project.snapshot();
  await assert.rejects(f.files.saveSound(),/16 MiB cassette limit/);
  assert.deepEqual(f.project.snapshot(),before);assert.equal(f.project.selectedPath,'/index.js');
  assert.equal(f.doc.getElementById('spuFilesPanel').hidden,true);assert.equal(f.doc.querySelector('.spu-main').inert,false);
});

test('named presets survive Project ZIP and local snapshot restoration without applying audio',async t=>{
  let instrument={...soundFixture(),name:'First',preset:{...soundFixture().preset,adsr1:123}};
  const f=fixture(t,{getInstrument:async()=>instrument});await f.files.ready;
  const first=await f.files.saveSound(),firstSound=JSON.parse(f.project.fs.get(first).data);
  instrument={...soundFixture(),name:'Second',preset:{...soundFixture().preset,adsr1:456}};
  const second=await f.files.saveSound(),secondSound=JSON.parse(f.project.fs.get(second).data);
  const local=createSpuCodeProject({snapshot:f.writes.at(-1)});
  assert.equal(local.selectedPath,second);assert.deepEqual(JSON.parse(local.fs.get(first).data),firstSound);assert.deepEqual(JSON.parse(local.fs.get(second).data),secondSound);
  const zip=await f.files.exportProject();await f.files.remove(first);await f.files.remove(second);
  assert.equal(await f.files.importProject(zip),true);assert.deepEqual(f.calls.map(call=>call[0]),['before']);
  await f.files.selectFile(first);assert.deepEqual(f.calls.at(-1),['instrument',firstSound]);
  await f.files.selectFile(second);assert.deepEqual(f.calls.at(-1),['instrument',secondSound]);
});

test('disposing during capture cannot create a late named preset',async t=>{
  const gate=deferred();let capturing=false;
  const f=fixture(t,{getInstrument:async()=>{capturing=true;return gate.promise;}});await f.files.ready;
  const before=f.project.snapshot(),pending=f.files.saveSound();assert(capturing);
  await f.files.dispose();gate.resolve(soundFixture());assert.equal(await pending,false);
  assert.deepEqual(f.project.snapshot(),before);assert.equal(f.doc.querySelector('.spu-main').inert,false);
});

test('a persistence failure keeps the named preset available for Project export and explains recovery',async t=>{
  const f=fixture(t,{store:{read:async()=>null,write:async()=>{throw Error('quota exceeded');},close:async()=>{}}});await f.files.ready;
  const path=await f.files.saveSound();assert(f.project.fs.has(path));
  assert.match(f.statuses.at(-1),/Local save unavailable; export the project/);
  const bytes=await f.files.exportProject(),restored=createSpuCodeProject();restored.restore(await restored.prepareImport(bytes));
  assert.deepEqual(JSON.parse(restored.fs.get(path).data),soundFixture());
});

test('failed sound application and malformed project imports retain Files and the current instrument',async t=>{
  const f=fixture(t,{applyInstrument:async()=>{throw Error('Host rejected instrument');}});await f.files.ready;
  f.project.importFiles([{path:'/presets/sound.spu.json',data:JSON.stringify(soundFixture())}]);const before=f.project.snapshot();
  await assert.rejects(f.files.selectFile('/presets/sound.spu.json'),/Host rejected/);assert.deepEqual(f.project.snapshot(),before);
  await assert.rejects(f.files.importProject(Uint8Array.of(1,2,3)));assert.deepEqual(f.project.snapshot(),before);
});

test('moving a code folder preserves the active JavaScript file without stopping the performance',async t=>{
  const f=fixture(t);await f.files.ready;f.project.importFiles([{path:'/lib/notes.js',data:'kept module'}]);f.project.select('/lib/notes.js');f.project.setCodeState({mode:'code',path:'/lib/notes.js'});
  const code={activePath:'/lib/notes.js',flush:async()=>true,setBusy(){},workspaceReplaced:async()=>{assert.fail('Renaming a code folder must not stop it');},pathChanged(source,destination){code.activePath=destination+code.activePath.slice(source.length);f.project.setCodeState({mode:'code',path:code.activePath});}};
  f.files.setCodeControls(code);assert.equal(await f.files.move('/lib','/modules'),true);assert.equal(code.activePath,'/modules/notes.js');assert.equal(f.project.selectedPath,code.activePath);
  assert.equal(f.project.fs.get(code.activePath).data,'kept module');assert.deepEqual(f.files.getCodeState(),{mode:'code',path:code.activePath});
});

test('a file selection cancels pending execution before waiting for editor persistence',async t=>{
  const f=fixture(t);await f.files.ready;f.project.importFiles([{path:'/inspection.json',data:'{}'}]);
  const gate=deferred(),events=[];
  f.files.setCodeControls({cancelPendingExecution(){events.push('cancel');},flush:async()=>{events.push('flush');await gate.promise;},openFile:async()=>events.push('open'),setBusy(){}});
  const pending=f.files.selectFile('/inspection.json');assert.deepEqual(events,['cancel']);
  await Promise.resolve();assert.deepEqual(events,['cancel','flush']);gate.resolve();await pending;assert.deepEqual(events,['cancel','flush','open']);
});

test('renaming large JSON or binary data to JavaScript fails before changing the project',async t=>{
  const f=fixture(t);await f.files.ready;
  f.project.importFiles([{path:'/large.json',data:' '.repeat(2*1024*1024+1)},{path:'/sample.bin',type:'binary',data:Uint8Array.of(0,255)}]);
  for(const path of ['/large.json','/sample.bin']){
    const before=f.project.snapshot();await assert.rejects(f.files.move(path,'/renamed.js'),/UTF-8 text no larger than 2 MiB/);assert.deepEqual(f.project.snapshot(),before);
  }
});

test('disposing during a delayed workspace Stop cannot replace a later project',async t=>{
  const f=fixture(t);await f.files.ready;const gate=deferred();let stopping=false;
  f.files.setCodeControls({flush:async()=>true,setBusy(){},workspaceReplaced:async()=>{stopping=true;await gate.promise;return true;}});
  const incoming=createSpuCodeProject({starterCode:'replacement'}),before=f.project.snapshot(),pending=f.files.importProject(incoming.exportProject());
  for(let count=0;count<100&&!stopping;count++)await new Promise(resolve=>setTimeout(resolve,5));assert(stopping);await f.files.dispose();gate.resolve();
  assert.equal(await pending,false);assert.deepEqual(f.project.snapshot(),before);assert.equal(f.calls.length,0);
});
