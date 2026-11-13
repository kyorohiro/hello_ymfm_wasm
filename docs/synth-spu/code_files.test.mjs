import test from 'node:test';
import assert from 'node:assert/strict';
import {setupSpuCodeFiles} from './code_files.js';
import {createSpuCodeProject,SPU_PROJECT_FILE_BYTES} from './code_project.js';
import {createVabFixture} from '../../test/helpers/spu_vab_fixture.mjs';
import {readVab} from './spu_synth_vab.js';

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
  const main=new Element(doc);main.id='test-main';doc.append(main);doc.querySelector=selector=>selector==='.spu-main'?main:null;
  for(const id of ['spuFilesPanel','spuFilesToggle','synthWorkspace']){const node=new Element(doc);node.id=id;node.hidden=id==='spuFilesPanel';doc.append(node);}
  if(options.presetPicker){const select=new Element(doc,'select');select.id='spuPresetSelect';doc.append(select);}
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

test('SPU writes wait for the initial read and never overwrite an unread or invalid project',async t=>{
  for(const unread of ['pending','failed','invalid'])await t.test(unread,async t=>{
    const read=deferred(),writes=[],store={read:()=>read.promise,write:async snapshot=>{writes.push(structuredClone(snapshot));return true;},close:async()=>{}};
    const f=fixture(t,{store});f.project.fs.writeText('/unsaved.txt','keep live edits');
    assert.equal(await f.files.persistCode(),false);assert.equal(writes.length,0);
    if(unread==='pending')read.resolve(null);
    else if(unread==='invalid')read.resolve({format:'unknown',version:1});
    else read.resolve(Promise.reject(Error('storage read failed')));
    await f.files.ready;
    if(unread==='pending'){
      assert.equal(await f.files.persistCode(),true);assert.equal(writes.length,1);
    }else{
      assert.equal(await f.files.persistCode(),false);assert.equal(writes.length,0);
      assert(f.statuses.some(text=>text.includes('Local project restore failed')));
    }
    const exported=await f.files.exportProject(),copy=createSpuCodeProject();copy.restore(await copy.prepareImport(exported));
    assert.equal(copy.fs.get('/unsaved.txt').data,'keep live edits');
    await f.files.dispose();if(unread!=='pending')assert.equal(writes.length,0,'dispose also retains unread durable data');
  });
});

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

test('only Save sound captures the authored sample; selecting valid JSON applies without replacing the Code workspace',async t=>{
  const f=fixture(t);await f.files.ready;await f.files.persistCode();assert.equal(f.calls.length,0);
  const path=await f.files.saveSound();assert.equal(path,'/presets/Saved PCM.spu.json');assert.deepEqual(f.calls.map(call=>call[0]),['capture']);
  assert.deepEqual(JSON.parse(f.project.fs.get(path).data),soundFixture());
  await f.files.selectFile(path);assert.deepEqual(f.calls.map(call=>call[0]),['capture','instrument']);assert.deepEqual(f.calls.at(-1)[1],soundFixture());
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

test('a cancelled sound or VAB application does not commit Files selection or claim a loaded preset',async t=>{
  const f=fixture(t,{presetPicker:true,applyInstrument:async()=>false,applyVabTone:async()=>false});await f.files.ready;
  f.project.importFiles([{path:'/presets/cancel.spu.json',data:JSON.stringify(soundFixture())},{path:'/presets/cancel.vab',type:'binary',data:createVabFixture().vab}]);
  const before=f.project.snapshot();
  assert.equal(await f.files.selectFile('/presets/cancel.spu.json'),false);assert.deepEqual(f.project.snapshot(),before);
  const picker=f.doc.getElementById('spuPresetSelect');picker.value='vab:'+encodeURIComponent('/presets/cancel.vab')+'#0';
  await picker.fire('change');await until(()=>!f.doc.querySelector('.spu-main').inert);
  assert.deepEqual(f.project.snapshot(),before);assert.equal(picker.value,'');assert.deepEqual(f.calls,[],'sound selection never uses workspace Stop');
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

test('file selection updates the editor without changing Keyboard or Code mode',async t=>{
  const f=fixture(t);await f.files.ready;let mode='keyboard';const opened=[];
  f.files.setCodeControls({flush:async()=>true,isCodeMode:()=>mode==='code',setBusy(){},openFile:async(path,options)=>opened.push({path,...options})});
  f.project.importFiles([{path:'/notes.json',data:'{}'},{path:'/presets/test.spu.json',data:JSON.stringify(soundFixture())}]);
  for(const path of ['/index.js','/notes.json','/presets/test.spu.json'])await f.files.selectFile(path);
  assert(opened.every(value=>value.show===false));assert.equal(mode,'keyboard');assert.equal(f.calls.filter(value=>value[0]==='instrument').length,1);
  mode='code';await f.files.selectFile('/notes.json');assert.deepEqual(opened.at(-1),{path:'/notes.json',show:true});assert.equal(mode,'code');
});

test('Duplicate preserves data, empty folders, executing JS and mode without applying a sound',async t=>{
  const f=fixture(t);await f.files.ready;const opened=[];
  f.files.setCodeControls({activePath:'/index.js',executionPath:'/index.js',flush:async()=>true,isCodeMode:()=>false,setBusy(){},openFile:async(path,options)=>opened.push({path,...options}),stop(){assert.fail('Copying never stops executing JS');},workspaceReplaced(){assert.fail('Copying never replaces the runtime');}});
  f.project.importFiles([{path:'/set/nested/sound.spu.json',data:JSON.stringify(soundFixture())},{path:'/set/nested/data.bin',type:'binary',data:Uint8Array.of(0,128,255)}]);f.project.fs.mkdir('/set/empty');
  assert.equal(await f.files.duplicate('/index.js'),'/index-copy.js');assert.equal(f.project.fs.get('/index-copy.js').data,'kept');assert.deepEqual(opened.at(-1),{path:'/index-copy.js',show:false});
  assert.equal(await f.files.duplicate('/set'),'/set-copy');assert.equal(f.project.fs.stat('/set-copy/empty').type,'directory');assert.deepEqual(f.project.fs.get('/set-copy/nested/data.bin').data,Uint8Array.of(0,128,255));
  assert.equal(await f.files.duplicate('/set/nested/sound.spu.json'),'/set/nested/sound-copy.spu.json');
  f.project.fs.mkdir('/INDEX-COPY-2.JS');assert.equal(await f.files.duplicate('/index.js'),'/index-copy-3.js');
  assert.equal(f.calls.length,0);assert.equal(f.project.selectedPath,'/index-copy-3.js');
  const restored=createSpuCodeProject({snapshot:f.project.snapshot()});assert.equal(restored.fs.stat('/set-copy/empty').type,'directory');
});

test('copy size failures are atomic and keep the source, selection and sound',async t=>{
  const f=fixture(t);await f.files.ready;f.project.importFiles([{path:'/large.bin',type:'binary',data:new Uint8Array(9*1024*1024)}]);f.project.select('/index.js');const before=f.project.snapshot();
  await assert.rejects(f.files.duplicate('/large.bin'),/16 MiB cassette limit/);assert.deepEqual(f.project.snapshot(),before);assert.equal(f.calls.length,0);
});

test('new instrument creates a named copy without applying it or overwriting files and folders',async t=>{
  const authored=soundFixture(),f=fixture(t,{getInstrument:async()=>authored});await f.files.ready;
  const path=await f.files.saveSound({path:'/presets/custom/New voice.spu.json'});assert.equal(path,'/presets/custom/New voice.spu.json');assert.equal(JSON.parse(f.project.fs.get(path).data).name,'New voice');assert.equal(authored.name,'Saved PCM');assert.equal(f.calls.length,0);
  assert.deepEqual(f.opened.at(-1),{path,options:{show:false}});
  const before=f.project.snapshot();await assert.rejects(f.files.saveSound({path:'/PRESETS/custom/new VOICE.spu.json'}),/already exists/);assert.deepEqual(f.project.snapshot(),before);
  f.project.fs.mkdir('/presets/folder.spu.json');await assert.rejects(f.files.saveSound({path:'/presets/folder.spu.json'}),/already exists/);
  await assert.rejects(f.files.saveSound({path:'/presets/not-js.js'}),/\.spu\.json/);
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

const pickerOptions=f=>walk(f.doc.getElementById('spuPresetSelect')).filter(node=>node.tagName==='OPTION'&&node.value);
async function until(predicate){for(let i=0;i<200;i++){if(predicate())return;await Promise.resolve();}throw Error('Files fixture did not settle');}

test('bank saves atomically retain exact VAB and JSON, flush uncommitted Code and persist once without audio or mode changes',async t=>{
  const f=fixture(t,{presetPicker:true,getInstrument(){assert.fail('Bank saving must not inspect audio');},applyInstrument(){assert.fail('Bank saving must not apply audio');},applyVabTone(){assert.fail('Bank saving must not apply a VAB Tone');},onBeforeWorkspaceReplace(){assert.fail('Bank saving must not stop a workspace');}});await f.files.ready;
  const code={activePath:'/index.js',executionPath:'/index.js',isCodeMode:()=>true,setBusy(){},
    async flush(){if(code.activePath==='/index.js')f.project.fs.writeText('/index.js','unflushed authored Code');await f.files.persistCode();return true;},
    async openFile(path,options){assert.deepEqual(options,{show:false});await code.flush();code.activePath=path;f.files.rememberCodeState({mode:'code',path});return true;},
    stop(){assert.fail('No Code Stop');},workspaceReplaced(){assert.fail('No runtime reset');}};
  f.files.setCodeControls(code);f.project.setCodeState({mode:'code',path:'/index.js'});
  const docs=[{...soundFixture(),name:'Bank P3 T0'},{...soundFixture(),name:'Bank P3 T1',preset:{...soundFixture().preset,adsr1:1234}}],before=structuredClone(docs),vab=createVabFixture().vab,original=vab.slice();
  const paths=await f.files.saveInstruments(docs,{assets:[{name:'Bank',data:vab}]});
  assert.deepEqual(paths,['/presets/Bank P3 T0.spu.json','/presets/Bank P3 T1.spu.json']);
  assert.deepEqual(f.project.fs.get('/presets/Bank.vab').data,original);assert.equal(readVab(f.project.fs.get('/presets/Bank.vab').data).tones.length,3);
  assert.deepEqual(paths.map(path=>JSON.parse(f.project.fs.get(path).data)),before);assert.deepEqual(docs,before);assert.deepEqual(vab,original);
  assert.equal(f.project.fs.get('/index.js').data,'unflushed authored Code');assert.equal(f.writes.length,1);assert.equal(f.writes[0].filesystem.files.find(file=>file.path==='/index.js').data,'unflushed authored Code');
  assert.deepEqual(f.project.getCodeState(),{mode:'code',path:paths[0]});assert.equal(code.executionPath,'/index.js');
  assert.equal(f.doc.getElementById('spuPresetSelect').value,'','saved docs were not loaded');assert.equal(f.doc.getElementById('spuFilesPanel').hidden,false);
  assert.equal(f.doc.querySelector('.spu-main').inert,false);assert.deepEqual(f.calls,[]);assert.match(f.statuses.at(-1),/1 VAB bank and 2 JSON presets/);
});

test('batch collisions include existing folders, NFC casefold names and all earlier JSON or VAB entries in the batch',async t=>{
  const f=fixture(t);await f.files.ready;const vab=createVabFixture().vab;
  f.project.fs.mkdir('/presets');f.project.fs.mkdir('/presets/Café.spu.json');f.project.fs.mkdir('/presets/Bank.vab');
  f.project.importFiles([{path:'/presets/CAFÉ (2).spu.json',data:'kept user text'},{path:'/presets/BANK (2).vab',type:'binary',data:vab}]);
  const paths=await f.files.saveInstruments([{...soundFixture(),name:'Cafe\u0301'},{...soundFixture(),name:'café'}],{assets:[{name:'Bank.vab',data:vab},{name:'BANK',data:vab}]});
  assert.deepEqual(paths,['/presets/Café (3).spu.json','/presets/café (4).spu.json']);
  assert(f.project.fs.has('/presets/Bank (3).vab'));assert(f.project.fs.has('/presets/BANK (4).vab'));
  assert.equal(f.project.fs.stat('/presets/Bank.vab').type,'directory');assert.equal(f.project.fs.get('/presets/CAFÉ (2).spu.json').data,'kept user text');assert.deepEqual(f.calls,[]);
});

test('combined VAB and JSON capacity and document errors leave all preset files and selection unchanged',async t=>{
  const f=fixture(t,{presetPicker:true});await f.files.ready;const first={...soundFixture(),name:'First'},second={...soundFixture(),name:'Second'},vab=createVabFixture().vab;
  const size=doc=>new TextEncoder().encode(JSON.stringify(doc,null,2)+'\n').length;
  const free=size(first)+vab.length+Math.floor(size(second)/2);
  f.project.importFiles([{path:'/padding.bin',type:'binary',data:new Uint8Array(SPU_PROJECT_FILE_BYTES-4-free)}]);f.project.select('/index.js');const before=f.project.snapshot();
  await assert.rejects(f.files.saveInstruments([first,second],{assets:[{name:'Bank',data:vab}]}),/16 MiB cassette limit/);
  assert.deepEqual(f.project.snapshot(),before);assert.equal(f.project.fs.has('/presets/First.spu.json'),false);assert.equal(f.project.fs.has('/presets/Bank.vab'),false);
  await assert.rejects(f.files.saveInstruments([first,{schema:'invalid'}],{assets:[{name:'Bank',data:vab}]}),/Expected an SPU instrument/);
  await assert.rejects(f.files.saveInstruments([first],{assets:[{name:'Bad',data:Uint8Array.of(1,2,3)}]}),/VAB/);
  assert.deepEqual(f.project.snapshot(),before);assert.equal(f.doc.getElementById('spuFilesPanel').hidden,true);assert.deepEqual(f.calls,[]);
});

test('VAB-only saves retain an all-unavailable standard bank without creating or applying an instrument',async t=>{
  const f=fixture(t,{presetPicker:true});await f.files.ready;const vab=createVabFixture().vab,view=new DataView(vab.buffer,vab.byteOffset,vab.byteLength);
  for(const at of [0x820+22,0x820+32+22,0x820+0x200+22])view.setUint16(at,255,true);
  assert.equal(readVab(vab).tones.length,3);const paths=await f.files.saveInstruments([],{assets:[{name:'Noise only',data:vab}]});
  assert.deepEqual(paths,[]);assert.deepEqual(f.project.fs.get('/presets/Noise only.vab').data,vab);assert.equal(f.project.selectedPath,'/presets/Noise only.vab');
  assert.deepEqual(f.opened,[]);assert.deepEqual(f.calls,[]);assert.equal(pickerOptions(f).length,0);
  const select=f.doc.getElementById('spuPresetSelect');assert.equal(select.disabled,true);assert.match(select.children[0].textContent,/No playable presets/);
});

test('stale or disposed bank saves cannot add a late batch after flushing',async t=>{
  for(const action of ['stale','dispose']) {
    const f=fixture(t),gate=deferred();await f.files.ready;let entered=false,current=true;
    f.files.setCodeControls({setBusy(){},flush:async()=>{entered=true;await gate.promise;return true;},openFile(){assert.fail('No stale editor open');}});
    const before=f.project.snapshot(),pending=f.files.saveInstruments([soundFixture()],{isCurrent:()=>current});await until(()=>entered);
    let disposing;if(action==='stale')current=false;else disposing=f.files.dispose();gate.resolve();assert.equal(await pending,false);if(disposing)await disposing;
    assert.deepEqual(f.project.snapshot(),before);assert.deepEqual(f.calls,[]);
  }
});

test('preset picker lists valid recursive JSON and VAB Tones, applies only explicit selection, and keeps a prior loaded sound during bank saving',async t=>{
  const applied=[],f=fixture(t,{presetPicker:true,applyVabTone:async(payload,options)=>{assert.equal(options.isCurrent(),true);applied.push(payload);}});await f.files.ready;
  const bankPath='/presets/sub/Bank #1%.vab',jsonPath='/presets/Json.spu.json';
  f.project.importFiles([{path:bankPath,type:'binary',data:createVabFixture().vab},{path:jsonPath,data:JSON.stringify(soundFixture())},
    {path:'/presets/bad.json',data:'{"unfinished":'},{path:'/presets/plain.json',data:'{"not":"an instrument"}'},{path:'/outside.json',data:JSON.stringify(soundFixture())}]);
  const select=f.doc.getElementById('spuPresetSelect'),options=pickerOptions(f);assert.equal(options.length,4);
  assert.equal(select.children[1].label,'VAB · Program / Tone');assert.equal(select.children[2].label,'SPU JSON');assert.equal(select.value,'');assert.equal(applied.length,0);assert.deepEqual(f.calls,[]);
  const value=`vab:${encodeURIComponent(bankPath)}#1`;assert(options.some(option=>option.value===value&&/Program 3 · Tone 1/.test(option.textContent)));
  select.value=value;select.focus();await select.fire('change');assert.notEqual(f.doc.activeElement,select);await until(()=>applied.length===1&&select.value===value);
  assert.equal(applied[0].path,bankPath);assert.equal(applied[0].toneNumber,1);assert.equal(applied[0].bank.tones[1].program,3);
  assert.deepEqual(f.opened,[],'binary Tone selection does not replace the Code document');assert.equal(f.project.selectedPath,bankPath);
  await f.files.saveInstruments([{...soundFixture(),name:'Another'}],{assets:[{name:'Another bank',data:createVabFixture().vab}]});
  assert.equal(select.value,value,'a saved but unapplied preset is not presented as loaded');assert.equal(applied.length,1);
  await f.files.move(bankPath,'/presets/sub/Moved.vab');assert.equal(select.value,`vab:${encodeURIComponent('/presets/sub/Moved.vab')}#1`);
  await f.files.remove('/presets/sub/Moved.vab');assert.equal(select.value,'');assert(!pickerOptions(f).some(option=>option.value===value));
  select.value=jsonPath;await select.fire('change');await until(()=>f.calls.some(call=>call[0]==='instrument')&&select.value===jsonPath);
  f.project.writeEditorText(jsonPath,JSON.stringify({...soundFixture(),name:'Edited but not applied'}));assert.equal(select.value,'');
  await f.files.selectFile(jsonPath);assert.equal(select.value,jsonPath);f.files.markSoundDirty();assert.equal(select.value,'');
});

test('picker validity is cached for unchanged JSON and reacts to invalid edits, replacement and project restoration without auto loading',async t=>{
  const f=fixture(t,{presetPicker:true});await f.files.ready;const path='/presets/cache.spu.json',data=JSON.stringify(soundFixture()),originalParse=JSON.parse;let parses=0;
  JSON.parse=(value,...args)=>{if(value===data)parses++;return originalParse(value,...args);};
  try {
    f.project.importFiles([{path,data}]);assert.equal(parses,1);
    for(let i=0;i<10;i++)f.project.select(i%2?path:'/index.js');assert.equal(parses,1,'selection redraws do not reparse large sample JSON');
  }finally{JSON.parse=originalParse;}
  assert.equal(pickerOptions(f).length,1);f.project.writeEditorText(path,'{"broken":');assert.equal(pickerOptions(f).length,0);
  f.project.writeEditorText(path,data);assert.equal(pickerOptions(f).length,1);await f.files.selectFile(path);assert.equal(f.doc.getElementById('spuPresetSelect').value,path);
  const incoming=createSpuCodeProject({snapshot:f.project.snapshot()});await f.files.importProject(incoming.exportProject());
  assert.equal(pickerOptions(f).length,1);assert.equal(f.doc.getElementById('spuPresetSelect').value,'','restoration lists presets but does not claim to load them');
});

test('VAB revisions and same-path file replacement refresh Tone options and failed Tone loads keep the old picker selection',async t=>{
  let reject=false;
  const f=fixture(t,{presetPicker:true,applyVabTone:async()=>{if(reject)throw Error('Tone load rejected');}});await f.files.ready;
  const path='/presets/bank.vab',vab=createVabFixture().vab;
  f.project.importFiles([{path,type:'binary',data:vab}]);await f.files.selectVabTone(path,0);const selected=f.doc.getElementById('spuPresetSelect').value;
  reject=true;await assert.rejects(f.files.selectVabTone(path,1),/Tone load rejected/);assert.equal(f.doc.getElementById('spuPresetSelect').value,selected);
  const changed=vab.slice();new DataView(changed.buffer).setUint16(0x820+22,255,true);
  await f.files.importFiles([{name:'bank.vab',size:changed.length,arrayBuffer:async()=>changed.buffer}]);
  // Generic Add files uses /bank.vab; replacing the actual preset path is an
  // ordinary FS write, whose changed revision must invalidate the VAB cache.
  f.project.fs.writeFile(path,changed);assert.equal(pickerOptions(f).filter(option=>option.value.startsWith('vab:'+encodeURIComponent(path)+'#')).length,2);
  assert.equal(f.doc.getElementById('spuPresetSelect').value,'');
});
