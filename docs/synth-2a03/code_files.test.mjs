import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {setupNesCodeFiles} from './code_files.js';
import {createNesCodeProject,NES_PROJECT_FILE_BYTES,readNesProjectSound} from './code_project.js';
import {createDefaultPreset,readPreset} from './preset.js';

class Element {
  constructor(document,tag='div') {
    Object.assign(this,{ownerDocument:document,tagName:tag.toUpperCase(),children:[],listeners:new Map(),
      attributes:{},dataset:{},style:{},parentNode:null,hidden:false,value:'',disabled:false});
    const names=new Set();
    this.classList={toggle:(name,on)=>on?names.add(name):names.delete(name),contains:name=>names.has(name),
      add:name=>names.add(name),remove:name=>names.delete(name)};
  }
  append(...nodes) {for(const node of nodes){node.parentNode=this;this.children.push(node);}}
  appendChild(node) {this.append(node);return node;}
  replaceChildren(...nodes) {for(const node of this.children)node.parentNode=null;this.children=[];this.append(...nodes);}
  remove() {if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  setAttribute(key,value) {this.attributes[key]=String(value);}
  getAttribute(key) {return this.attributes[key]??null;}
  addEventListener(type,fn) {if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn) {this.listeners.get(type)?.delete(fn);}
  querySelectorAll(selector) {return walk(this).filter(node=>selector==='button'&&node.tagName==='BUTTON');}
  focus() {this.ownerDocument.activeElement=this;}
  blur() {if(this.ownerDocument.activeElement===this)this.ownerDocument.activeElement=null;}
  select() {}
  showModal() {this.open=true;}
  close() {this.open=false;}
}
const walk=node=>[node,...node.children.flatMap(walk)];
const deferred=()=>{let resolve;const promise=new Promise(value=>resolve=value);return {promise,resolve};};
const file=(name,bytes)=>({name,size:bytes.byteLength,arrayBuffer:async()=>bytes.slice().buffer});

function fixture(t,{store,apply=(value)=>value}={}) {
  const document=new Element(null,'document');
  document.ownerDocument=document;document.body=document;
  document.createElement=tag=>new Element(document,tag);
  document.getElementById=id=>walk(document).find(node=>node.id===id);
  document.defaultView=new Element(document,'window');
  const main=new Element(document);document.append(main);
  document.querySelector=selector=>selector==='.nes-main'?main:null;
  for(const id of ['nesFilesPanel','nesFilesToggle','synthWorkspace','nesPresetSelect']) {
    const node=new Element(document,id==='nesPresetSelect'?'select':'div');
    node.id=id;node.hidden=id==='nesFilesPanel';document.append(node);
  }
  const previous=globalThis.document;globalThis.document=document;
  t.after(()=>{globalThis.document=previous;});
  let settings=createDefaultPreset();
  const project=createNesCodeProject({settings,starterCode:'// kept'});
  const calls=[],opened=[],writes=[],statuses=[];
  const files=setupNesCodeFiles({project,document,getSettings:()=>settings,
    applySettings:async(value,options)=>{calls.push({value,options});settings=readPreset(await apply(value,options,settings));},
    onBeforeSoundApply:async()=>{},setStatus:value=>statuses.push(value),
    store:store??{read:async()=>null,write:async(value)=>{writes.push(value);return true;},close:async()=>{}}});
  files.setCodeControls({activePath:'/index.js',executionPath:'/index.js',isCodeMode:()=>true,
    flush:async()=>true,openFile:async(path,options)=>opened.push({path,options}),setBusy(){},
    stop:()=>assert.fail('Import must preserve running Code'),workspaceReplaced:()=>assert.fail('Import must preserve the active Code file')});
  t.after(()=>files.dispose());
  return {files,project,document,calls,opened,writes,statuses,setSettings(value){settings=readPreset(value);}};
}

function song() {
  const commands=[0xb4,0x15,1,0xb4,0,0xbf,0xb4,1,0,0xb4,2,0xfd,0xb4,3,0x08,0x61,0x44,0xac,0x66];
  const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);
  bytes.set([0x56,0x67,0x6d,0x20]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x34,256-0x34,true);view.setUint32(0x84,1789773,true);bytes.set(commands,256);
  return bytes;
}

test('song imports save original VGZ and playable presets without changing the instrument or running Code',async t=>{
  const f=fixture(t);await f.files.ready;
  f.project.select('/index.js');f.project.setCodeState({mode:'code',path:'/index.js'});
  const selection=f.project.selectedPath,code=f.project.getCodeState(),settings=f.project.settings;
  const raw=new Uint8Array(gzipSync(song()));
  const paths=await f.files.importFiles([file('Library.vgz',raw)]);
  assert.equal(paths[0],'/vgm/Library.vgz');assert.deepEqual(f.project.fs.get(paths[0]).data,raw);
  const presets=paths.filter(path=>path.startsWith('/presets/Library/'));
  assert(presets.length>=1,'Pulse instruments are saved');
  const values=presets.map(path=>JSON.parse(f.project.fs.get(path).data));
  assert(values.every(value=>readNesProjectSound(value)));
  assert(values.every(value=>value.source==='pulse'));
  assert(values.every(value=>!Object.hasOwn(value,'vgmSource')),'Portable presets retain their strict format');
  assert.deepEqual(f.project.settings,settings);assert.equal(f.project.selectedPath,selection);
  assert.deepEqual(f.project.getCodeState(),code);assert.deepEqual(f.calls,[]);assert.deepEqual(f.opened,[]);
  assert.equal(f.document.getElementById('nesFilesPanel').hidden,false);
  assert.equal(f.document.getElementById('nesPresetSelect').children.length,presets.length+1);
  const restored=createNesCodeProject();restored.restore(await restored.prepareImport(await f.files.exportProject()));
  assert.deepEqual(restored.fs.get(paths[0]).data,raw);
  for(const path of presets)assert.equal(restored.fs.get(path).data,f.project.fs.get(path).data);
});

test('repeated song names preserve existing sources, folders and presets with case-folded collision suffixes',async t=>{
  const f=fixture(t);await f.files.ready;
  f.project.importFiles([{path:'/vgm/SONG.VGM',type:'binary',data:Uint8Array.of(7)},
    {path:'/presets/SONG',type:'text',data:'user file'}]);
  const first=await f.files.importFiles([file('Song.vgm',song())]);
  const second=await f.files.importFiles([file('song.vgm',song())]);
  assert.equal(first[0],'/vgm/Song (2).vgm');assert.equal(second[0],'/vgm/song (3).vgm');
  assert(first.some(path=>path.startsWith('/presets/Song (2)/')));
  assert(second.some(path=>path.startsWith('/presets/song (3)/')));
  assert.deepEqual(f.project.fs.get('/vgm/SONG.VGM').data,Uint8Array.of(7));
  assert.equal(f.project.fs.get('/presets/SONG').data,'user file');
});

test('invalid and oversized import batches leave no partial source or preset files',async t=>{
  const f=fixture(t);await f.files.ready;const before=f.project.snapshot();
  await assert.rejects(f.files.importFiles([file('Valid.vgm',song()),file('Broken.vgm',Uint8Array.of(1,2,3))]),/header|VGM/i);
  assert.deepEqual(f.project.snapshot(),before);
  f.project.importFiles([{path:'/padding.bin',type:'binary',data:new Uint8Array(NES_PROJECT_FILE_BYTES-100-f.project.fs.list().filter(f=>f.type==='text').reduce((sum,f)=>sum+new TextEncoder().encode(f.data).length,0))}]);
  const full=f.project.snapshot();
  await assert.rejects(f.files.importFiles([file('Full.vgm',song())]),/16 MiB/);
  assert.deepEqual(f.project.snapshot(),full);
});

test('a newer Files operation supersedes an import waiting for file bytes',async t=>{
  const f=fixture(t);await f.files.ready;const gate=deferred();
  const pending=f.files.importFiles([{name:'Late.vgm',size:100,arrayBuffer:()=>gate.promise}]);
  await new Promise(resolve=>setImmediate(resolve));
  await f.files.createFile('/new.js');
  gate.resolve(song().buffer);
  assert.deepEqual(await pending,[]);
  assert(f.project.fs.has('/new.js'));assert(!f.project.fs.has('/vgm/Late.vgm'));
});

test('selecting extracted presets keeps running Code and leaves Keyboard mode hidden',async t=>{
  const f=fixture(t);await f.files.ready;
  f.files.setCodeControls({flush:async()=>true,openFile:async(path,options)=>f.opened.push({path,options}),isCodeMode:()=>false,setBusy(){},
    stop:()=>assert.fail('Preset selection must preserve Code')});
  const paths=await f.files.importFiles([file('Selection.vgm',song())]);
  const selected=paths.find(path=>path.startsWith('/presets/'));
  assert(selected);await f.files.selectFile(selected);
  assert.equal(f.calls.at(-1).value.source,'pulse');
  assert.deepEqual(f.opened.at(-1),{path:selected,options:{show:false}});
  assert.equal(f.project.getCodeState().mode,'keyboard');
});

test('malformed sound JSON keeps the current instrument available for Code repair',async t=>{
  const f=fixture(t);await f.files.ready;
  const bad={...createDefaultPreset(),fds:{}};
  f.project.importFiles([{path:'/presets/bad.nes.json',type:'text',data:JSON.stringify(bad)}]);
  await f.files.selectFile('/presets/bad.nes.json');
  assert.deepEqual(f.calls,[]);assert.match(f.statuses.at(-1),/JSON was not applied/);
  assert.equal(f.project.selectedPath,'/presets/bad.nes.json');
});

test('a pre-extracted VGM is saved without changing the selected sound or Code document',async t=>{
  const f=fixture(t);await f.files.ready;
  const raw=song(),preset={...createDefaultPreset(),name:'Captured Noise',source:'noise'};
  const paths=await f.files.importVgm({name:'Known.vgm',bytes:raw,result:{voices:[{preset}],warnings:['Original counters are not replayed.']}});
  raw.fill(0);
  assert.equal(paths[0],'/vgm/Known.vgm');
  assert.equal(f.project.fs.get(paths[0]).data[0],0x56);
  assert.equal(readNesProjectSound(f.project.fs.get(paths[1]).data).source,'noise');
  assert.deepEqual(f.calls,[]);assert.deepEqual(f.opened,[]);
  const details=f.document.getElementById('nesImportDetails');
  assert.equal(details.hidden,false);assert.equal(details.open,false);
  assert.equal(f.document.getElementById('nesImportNotes').children[0].textContent,'Original counters are not replayed.');
});

test('durable storage failure retains import files for project export and reports the failure',async t=>{
  const f=fixture(t,{store:{read:async()=>null,write:async()=>{throw Error('quota');},close:async()=>{}}});
  await f.files.ready;
  const paths=await f.files.importFiles([file('Retained.vgm',song())]);
  assert(paths.length>1);assert.match(f.statuses.at(-1),/Local save unavailable.*export/);
  const restored=createNesCodeProject();restored.restore(await restored.prepareImport(await f.files.exportProject()));
  for(const path of paths)assert(restored.fs.has(path));
});
