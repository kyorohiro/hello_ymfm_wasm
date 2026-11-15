import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {setupFm2608CodeFiles} from './code_files.js';
import {createFm2608CodeProject,FM2608_PROJECT_FILE_BYTES,readFm2608ProjectSound} from './code_project.js';
import {createDefaultPreset,readPreset,FM_PRESETS,readFmPreset} from './preset.js';
import {YM2608Synth} from '../js/ym2608synth.js';

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
  document.querySelector=selector=>selector==='.opna-main'?main:null;
  for(const id of ['opnaFilesPanel','opnaFilesToggle','synthWorkspace','opnaPresetSelect']) {
    const node=new Element(document,id==='opnaPresetSelect'?'select':'div');
    node.id=id;node.hidden=id==='opnaFilesPanel';document.append(node);
  }
  const previous=globalThis.document;globalThis.document=document;
  t.after(()=>{globalThis.document=previous;});
  let settings=createDefaultPreset();
  const project=createFm2608CodeProject({settings,starterCode:'// kept'});
  const calls=[],opened=[],writes=[],statuses=[];
  const files=setupFm2608CodeFiles({project,document,getSettings:()=>settings,
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
  const writes=[];
  const chip=new YM2608Synth({transport:{write:(port,register,value)=>writes.push([0x56+port,register,value])}});
  chip.setPreset(0,readFmPreset(FM_PRESETS.sine));chip.noteOn(0,'C4');
  chip.ssg.tone(0,{frequency:220,volume:9});
  const commands=[...writes.flat(),0x61,0x44,0xac,0x66];
  const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);
  bytes.set([0x56,0x67,0x6d,0x20]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x34,256-0x34,true);view.setUint32(0x48,8000000,true);bytes.set(commands,256);
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
  assert(presets.length>=2,'FM and SSG instruments are saved');
  const values=presets.map(path=>JSON.parse(f.project.fs.get(path).data));
  assert(values.every(value=>readFm2608ProjectSound(value)));
  assert(values.some(value=>value.importedVoice.section==='fm'));
  assert(values.some(value=>value.importedVoice.section==='ssg'));
  assert(values.every(value=>value.vgmSource.file===paths[0]));
  assert.deepEqual(f.project.settings,settings);assert.equal(f.project.selectedPath,selection);
  assert.deepEqual(f.project.getCodeState(),code);assert.deepEqual(f.calls,[]);assert.deepEqual(f.opened,[]);
  assert.equal(f.document.getElementById('opnaFilesPanel').hidden,false);
  assert.equal(f.document.getElementById('opnaPresetSelect').children.length,presets.length+1);
  const restored=createFm2608CodeProject();restored.restore(await restored.prepareImport(await f.files.exportProject()));
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
  f.project.importFiles([{path:'/padding.bin',type:'binary',data:new Uint8Array(FM2608_PROJECT_FILE_BYTES-100)}]);
  const full=f.project.snapshot();
  await assert.rejects(f.files.importFiles([file('Full.vgm',song())]),/12 MiB/);
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

test('selecting generated presets passes validated section metadata and keeps Keyboard mode hidden',async t=>{
  const f=fixture(t);await f.files.ready;
  f.files.setCodeControls({flush:async()=>true,openFile:async(path,options)=>f.opened.push({path,options}),isCodeMode:()=>false,setBusy(){}});
  const paths=await f.files.importFiles([file('Selection.vgm',song())]);
  const selected=paths.find(path=>JSON.parse(f.project.fs.get(path)?.type==='text'?f.project.fs.get(path).data:'null')?.importedVoice?.section==='ssg');
  assert(selected);await f.files.selectFile(selected);
  assert.deepEqual(f.calls.at(-1).options.selection,{section:'ssg',channel:'auto'});
  assert.deepEqual(f.opened.at(-1),{path:selected,options:{show:false}});
  assert.equal(f.project.getCodeState().mode,'keyboard');
});

test('invalid imported voice metadata keeps the current sound available for JSON repair',async t=>{
  const f=fixture(t);await f.files.ready;
  const bad={...createDefaultPreset(),importedVoice:{section:'adpcm',channel:'auto'}};
  f.project.importFiles([{path:'/presets/bad.opna.json',type:'text',data:JSON.stringify(bad)}]);
  await f.files.selectFile('/presets/bad.opna.json');
  assert.deepEqual(f.calls,[]);assert.match(f.statuses.at(-1),/Invalid imported voice section or channel/);
  assert.equal(f.project.selectedPath,'/presets/bad.opna.json');
});

test('saved selection preserves the actual merged instrument accepted by the host',async t=>{
  const f=fixture(t,{apply:(value,options,current)=>options.selection?.section==='ssg'?{...current,ssg:value.ssg}:value});
  await f.files.ready;
  const current=createDefaultPreset();current.fm[0].feedback=6;f.setSettings(current);f.project.setSettings(current);
  const paths=await f.files.importFiles([file('Merged.vgm',song())]);
  const selected=paths.find(path=>f.project.fs.get(path).type==='text'&&JSON.parse(f.project.fs.get(path).data).importedVoice.section==='ssg');
  await f.files.selectFile(selected);
  assert.equal(f.project.settings.fm[0].feedback,6);
  assert.equal(f.project.settings.ssg.channels[0].volume,9);
});

test('import notes remain collapsed and retain the complete omission reason outside the success status',async t=>{
  const f=fixture(t);await f.files.ready;
  const raw=song(),commands=[...raw.subarray(256,-1),0x57,0,0xa0,0x61,20,0,0x66];
  const bytes=new Uint8Array(256+commands.length);bytes.set(raw.subarray(0,256));bytes.set(commands,256);
  new DataView(bytes.buffer).setUint32(4,bytes.length-4,true);
  await f.files.importFiles([file('Notes.vgm',bytes)]);
  const details=f.document.getElementById('opnaImportDetails');
  assert.equal(details.hidden,false);assert.equal(details.open,false);
  const notes=f.document.getElementById('opnaImportNotes').children.map(node=>node.textContent);
  assert(notes.some(note=>/ADPCM/i.test(note)));
  assert(notes.some(note=>/capture|memory|recorded|sample/i.test(note)));
  assert(!f.statuses.at(-1).includes(notes[0]));
  assert.match(f.statuses.at(-1),/import note/);
});

test('durable storage failure retains import files for project export and reports the failure',async t=>{
  const f=fixture(t,{store:{read:async()=>null,write:async()=>{throw Error('quota');},close:async()=>{}}});
  await f.files.ready;
  const paths=await f.files.importFiles([file('Retained.vgm',song())]);
  assert(paths.length>1);assert.match(f.statuses.at(-1),/Local save unavailable.*export/);
  const restored=createFm2608CodeProject();restored.restore(await restored.prepareImport(await f.files.exportProject()));
  for(const path of paths)assert(restored.fs.has(path));
});
