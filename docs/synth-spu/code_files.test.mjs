import test from 'node:test';
import assert from 'node:assert/strict';
import {setupSpuCodeFiles} from './code_files.js';
import {createSpuCodeProject} from './code_project.js';

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
  const project=options.project??createSpuCodeProject({starterCode:'kept'}),writes=[],calls=[],statuses=[];
  const store=options.store??{read:async()=>null,write:async value=>{writes.push(structuredClone(value));return true;},close:async()=>{}};
  const files=setupSpuCodeFiles({project,document:doc,store,getInstrument:async()=>{calls.push(['capture']);return soundFixture();},applyInstrument:async value=>calls.push(['instrument',value]),onBeforeWorkspaceReplace:async()=>calls.push(['before']),setStatus:text=>statuses.push(text),...options});
  t.after(()=>files.dispose());return{files,project,doc,writes,calls,statuses};
}

function soundFixture(){return {schema:'tetorica-spu-synth.instrument',version:1,name:'Saved PCM',
  preset:{volumeLeft:.75,volumeRight:.75,adsr1:15,adsr2:0,pitch:4096,reverb:false},
  sample:{adpcm:[12,1,...Array(14).fill(0)],baseFrequencyHz:440},reverb:{preset:'off',volumeLeft:.25,volumeRight:.25}};}

test('SPU Files selection, autosave and rename/delete share the Code controls without inspecting audio',async t=>{
  const f=fixture(t);await f.files.ready;const opened=[],changed=[];
  f.files.setCodeControls({activePath:null,flush:async()=>true,openFile:async path=>opened.push(path),pathChanged:(...args)=>changed.push(args),setBusy(){}});
  await f.files.createFile('/lib/notes.js');assert.deepEqual(opened,['/lib/notes.js']);
  f.project.importFiles([{path:'/data/note.json',data:'{"note":"A4"}'}]);await f.files.selectFile('/data/note.json');
  const editor=f.doc.getElementById('spuFileTextEditor');editor.value='{"note":"E4"}';await editor.fire('input');await f.files.persistCode();
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
  const path=await f.files.saveSound();assert.equal(path,'/presets/current.spu.json');assert.deepEqual(f.calls.map(call=>call[0]),['capture']);
  assert.deepEqual(JSON.parse(f.project.fs.get(path).data),soundFixture());
  await f.files.selectFile(path);assert.deepEqual(f.calls.map(call=>call[0]),['capture','before','instrument']);assert.deepEqual(f.calls.at(-1)[1],soundFixture());
  const count=f.calls.length;f.project.importFiles([{path:'/presets/unfinished.spu.json',data:'{"preset":'}]);await f.files.selectFile('/presets/unfinished.spu.json');
  assert.equal(f.calls.length,count);assert.equal(f.doc.getElementById('spuFileTextEditor').value,'{"preset":');assert.match(f.statuses.at(-1),/current sound kept/);
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

test('disposing during a delayed workspace Stop cannot replace a later project',async t=>{
  const f=fixture(t);await f.files.ready;const gate=deferred();let stopping=false;
  f.files.setCodeControls({flush:async()=>true,setBusy(){},workspaceReplaced:async()=>{stopping=true;await gate.promise;return true;}});
  const incoming=createSpuCodeProject({starterCode:'replacement'}),before=f.project.snapshot(),pending=f.files.importProject(incoming.exportProject());
  for(let count=0;count<100&&!stopping;count++)await new Promise(resolve=>setTimeout(resolve,5));assert(stopping);await f.files.dispose();gate.resolve();
  assert.equal(await pending,false);assert.deepEqual(f.project.snapshot(),before);assert.equal(f.calls.length,0);
});
