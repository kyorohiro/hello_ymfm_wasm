import test from 'node:test';
import assert from 'node:assert/strict';
import {setupSynthFiles} from './synth_files.js';
import {createSynthProject,isPsgPresetPath,isPcmPresetPath} from './synth_project.js';
import {createPsgPreset,isPsgPreset,normalizePsgPreset} from './synth_psg_preset.js';
import {createPcmBuiltinPreset,isPcmPreset,normalizePcmPreset,PCM_MAX_FRAMES} from './synth_pcm.js';

class Element {
  constructor(tag='div') {this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.style={};this.listeners=new Map();this.hidden=false;this.open=false;this.value='';
    const names=new Set();this.classList={add:(...values)=>values.forEach(value=>names.add(value)),remove:value=>names.delete(value),toggle:(value,on)=>{on??=!names.has(value);on?names.add(value):names.delete(value);return on;}};}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  appendChild(child){this.append(child);return child;}
  replaceChildren(...children){this.children=[];this.append(...children);}
  setAttribute(name,value){this.attributes[name]=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}
  addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);}
  removeEventListener(type,handler){this.listeners.get(type)?.delete(handler);}
  matches(selector){
    if(selector.includes(','))return selector.split(',').some(value=>this.matches(value));
    const attr=selector.match(/\[([^\]]+)\]/)?.[1],tag=selector.match(/^[a-z]+/i)?.[0],name=selector.match(/\.([a-z-]+)/i)?.[1];
    return (!tag||this.tagName===tag.toUpperCase())&&(!name||this.className?.split(' ').includes(name))&&(!attr||(attr==='open'?this.open:Object.hasOwn(this.attributes,attr)));
  }
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)??null;}
  fire(type,target=this){const event={target,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){},clientX:0,clientY:0};for(const handler of this.listeners.get(type)??[])handler(event);}
  click(){this.fire('click');}focus(){}blur(){}select(){}showModal(){this.open=true;}close(){this.open=false;}
}
const fm=()=>({algorithm:7,feedback:0,operators:Array.from({length:4},(_,i)=>({dt:0,multi:1,tl:i===3?16:127,rs:0,ar:31,am:false,d1r:0,d2r:0,sl:0,rr:15,ssg:0}))});
const tick=()=>new Promise(resolve=>queueMicrotask(resolve));

function harness(store={saved:null,journal:new Map()}) {
  const globals=['document','window','indexedDB','localStorage','setTimeout','clearTimeout'],previous=new Map(globals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const elements=new Map(),body=new Element('body'),editor=new Element();editor.className='synth-editor';body.append(editor);
  const byId=id=>{if(!elements.has(id)){const item=new Element(id==='synthFileNameDialog'?'dialog':'div');item.id=id;elements.set(id,item);body.append(item);}return elements.get(id);};
  const dialog=byId('synthFileNameDialog');for(const attr of ['data-file-name-confirm','data-file-name-cancel']){const button=new Element('button');button.setAttribute(attr,'');dialog.append(button);}
  const document={body,activeElement:null,getElementById:byId,createElement:tag=>new Element(tag),querySelector:selector=>body.querySelector(selector),addEventListener(){}};
  const window=new Element();window.innerWidth=1240;window.innerHeight=900;
  let timerId=0;const timers=new Map();
  globalThis.document=document;globalThis.window=window;
  globalThis.localStorage={getItem:key=>store.journal.get(key)??null,setItem:(key,value)=>store.journal.set(key,String(value)),removeItem:key=>store.journal.delete(key)};
  globalThis.setTimeout=fn=>{timers.set(++timerId,fn);return timerId;};globalThis.clearTimeout=id=>timers.delete(id);
  const database={createObjectStore(){},transaction(){const transaction={};transaction.objectStore=()=>({
    put(value){store.saved=structuredClone(value);queueMicrotask(()=>transaction.oncomplete?.());},
    get(){const request={result:structuredClone(store.saved)};queueMicrotask(()=>request.onsuccess?.());return request;},
  });return transaction;}};
  globalThis.indexedDB={open(){const request={result:database};queueMicrotask(()=>{request.onupgradeneeded?.();request.onsuccess?.();});return request;}};
  const project=createSynthProject(),patches={fm:fm(),psg:createPsgPreset({}),pcm:createPcmBuiltinPreset('sine')},ids={fm:'one-op-basic',psg:'psg-default',pcm:'pcm-sine'},messages=[];
  let kind='fm';
  function applySnapshot(preset,id){kind=isPcmPreset(preset)?'pcm':isPsgPreset(preset)?'psg':'fm';patches[kind]=kind==='pcm'?normalizePcmPreset(preset):kind==='psg'?normalizePsgPreset(preset):structuredClone(preset);ids[kind]=id;}
  const files=setupSynthFiles({project,getEditorKind:()=>kind,setEditorKind:value=>{kind=value;},getDefaultPresetId:value=>value==='pcm'?'pcm-sine':value==='psg'?'psg-default':'one-op-basic',
    getPreset:()=>structuredClone(patches[kind]),getPresetId:()=>ids[kind],applySnapshot,
    applyPreset:id=>id.startsWith('vfs:')?applySnapshot(project.readTone(id.slice(4)).preset,id):applySnapshot(id==='pcm-sine'?createPcmBuiltinPreset('sine'):id==='psg-default'?createPsgPreset({}):fm(),id),
    onSaved:path=>{ids[isPcmPresetPath(path)?'pcm':isPsgPresetPath(path)?'psg':'fm']='vfs:'+path;},onListChanged(){},onWorkspaceReplaced(){},stopAllNotes(){},setStatus:message=>messages.push(message)});
  async function idle(){for(let i=0;i<50;i++){await tick();if(editor.attributes['aria-busy']==='false')return;}assert.fail('file operation stayed busy');}
  async function action(name,path){
    if(path){const target=new Element('button');target.setAttribute('data-file-path',path);byId('synthFilesTree').fire('contextmenu',target);}
    const button=new Element('button');button.setAttribute('data-file-action',name);byId('synthFileContextMenu').fire('click',button);
    await idle();
  }
  async function rename(path,name){
    const target=new Element('button');target.setAttribute('data-file-path',path);byId('synthFilesTree').fire('contextmenu',target);
    const button=new Element('button');button.setAttribute('data-file-action','rename');byId('synthFileContextMenu').fire('click',button);
    for(let i=0;i<50&&!dialog.open;i++)await tick();assert(dialog.open);
    byId('synthFileNameInput').value=name;dialog.querySelector('[data-file-name-confirm]').click();await idle();
  }
  return {store,project,patches,ids,files,messages,byId,action,rename,get kind(){return kind;},forceKind:value=>{kind=value;},
    cleanup(){for(const [name,descriptor]of previous)descriptor?Object.defineProperty(globalThis,name,descriptor):delete globalThis[name];}};
}

test('FM and PSG editor contexts keep independent files, patches and shared Sync/Revert checkpoints',async()=>{
  const h=harness();
  try {
    await h.files.ready;assert.equal(await h.files.createFromPreset(fm(),'Keep FM'),true);const fmPath=h.files.activeTonePath;
    const original=h.project.fs.get(fmPath).data.slice();
    assert.equal(await h.files.switchEditor('psg'),true);h.patches.psg.settings.attenuation=9;h.files.markDirty();
    const psgPath=h.files.activeTonePath;assert.match(psgPath,/\.psg\.json$/);assert.deepEqual(h.project.fs.get(fmPath).data,original);
    assert.equal(await h.files.switchEditor('fm'),true);assert.equal(h.files.activeTonePath,fmPath);
    h.patches.fm.feedback=4;h.files.markDirty();
    assert.equal(h.project.readTone(psgPath).preset.settings.attenuation,9);
    assert.equal(await h.files.switchEditor('psg'),true);assert.equal(h.files.activeTonePath,psgPath);assert.equal(h.patches.psg.settings.attenuation,9);
    await h.action('sync');assert.equal(h.project.isToneModified(psgPath),false);
    h.patches.psg.settings.attenuation=2;h.files.markDirty();assert.equal(h.project.isToneModified(psgPath),true);
    await h.action('revert');assert.equal(h.patches.psg.settings.attenuation,9);assert.equal(h.project.readTone(fmPath).preset.feedback,4);
    assert.equal(h.project.fs.has(psgPath+'.synth.json'),false,'PSG stays one typed document');
    assert.equal(h.byId('synthPsgSettings').inert,false);assert.equal(h.byId('synthPsgPresetSelect').disabled,false);
  } finally {h.cleanup();}
});

test('inactive editor paths follow rename and Undo, and deleted documents cannot retain stale save targets',async()=>{
  const h=harness();
  try {
    await h.files.ready;await h.files.createFromPreset(fm(),'Keep FM');const fmPath=h.files.activeTonePath;
    await h.files.createFromPreset(createPsgPreset({attenuation:8}),'Noise');const psgPath=h.files.activeTonePath;
    await h.rename(fmPath,'Renamed.vgi');assert.equal(h.kind,'psg');
    assert.equal(await h.files.switchEditor('fm'),true);assert.equal(h.files.activeTonePath,'/presets/Renamed.vgi');
    assert.equal(h.ids.fm,'vfs:/presets/Renamed.vgi');assert.equal(h.project.fs.has(fmPath),false);
    await h.action('delete',psgPath);assert.equal(h.project.fs.has(psgPath),false);
    await h.action('undo');assert.equal(h.project.fs.has(psgPath),true);
    assert.equal(await h.files.switchEditor('psg'),true);assert.equal(h.files.activeTonePath,psgPath);assert.equal(h.patches.psg.settings.attenuation,8);
    await h.action('delete',psgPath);assert.equal(h.kind,'psg');assert.equal(h.files.activeTonePath,null);assert.equal(h.ids.psg,'psg-default');
    assert.equal(h.project.fs.has('/presets/Renamed.vgi'),true);
  } finally {h.cleanup();}
});

test('draft reload restores both editor contexts and older records still restore their original FM instrument',async()=>{
  const store={saved:null,journal:new Map()};let h=harness(store);
  let fmPath,psgPath;
  try {
    await h.files.ready;await h.files.createFromPreset({...fm(),feedback:3},'FM');fmPath=h.files.activeTonePath;
    await h.files.createFromPreset(createPsgPreset({noiseType:'periodic',source:'noise'}),'PSG');psgPath=h.files.activeTonePath;
    assert.equal(store.saved.editorKind,'psg');assert.equal(store.saved.editorContexts.fm.activeTonePath,fmPath);
  } finally {h.cleanup();}
  h=harness(store);
  try {
    await h.files.ready;assert.equal(h.kind,'psg');assert.equal(h.files.activeTonePath,psgPath);
    assert.equal(h.patches.psg.settings.noiseType,'periodic');await h.files.switchEditor('fm');
    assert.equal(h.files.activeTonePath,fmPath);assert.equal(h.patches.fm.feedback,3);
    const legacy={project:h.project.snapshot(),activeTonePath:fmPath,workspaceId:'legacy-draft',generation:1,filesVisible:true};store.saved=legacy;store.journal.clear();
  } finally {h.cleanup();}
  h=harness(store);
  try {await h.files.ready;assert.equal(h.kind,'fm');assert.equal(h.files.activeTonePath,fmPath);assert.equal(h.patches.fm.feedback,3);}
  finally {h.cleanup();}
});

test('bad PSG documents and stale cross-kind callbacks never replace or overwrite the current FM instrument',async()=>{
  const h=harness();
  try {
    await h.files.ready;await h.files.createFromPreset(fm(),'Protected FM');const path=h.files.activeTonePath,bytes=h.project.fs.get(path).data.slice();
    const bad='/presets/Bad.psg.json';h.project.fs.writeFiles([{path:bad,type:'text',data:JSON.stringify({version:1,kind:'tetorica-sega-psg',settings:{source:'tone',attenuation:16,noiseType:'white',noiseRate:'medium'}})}]);
    assert.equal(await h.files.selectFile(bad),false);assert.equal(h.kind,'fm');assert.equal(h.files.activeTonePath,path);
    assert.deepEqual(h.project.fs.get(path).data,bytes);
    h.forceKind('psg');h.patches.psg.settings.attenuation=1;h.files.markDirty();
    assert.deepEqual(h.project.fs.get(path).data,bytes,'a delayed edit cannot write a PSG document into an FM file');
    assert(h.messages.some(message=>message.includes('editor and active file differ')));
  } finally {h.cleanup();}
});

test('the immediate PSG recovery journal restores the latest edit and keeps the other editor context',async()=>{
  const store={saved:null,journal:new Map()};let h=harness(store),fmPath,psgPath;
  try {
    await h.files.ready;await h.files.createFromPreset({...fm(),feedback:2},'Crash FM');fmPath=h.files.activeTonePath;
    await h.files.createFromPreset(createPsgPreset({attenuation:8}),'Crash PSG');psgPath=h.files.activeTonePath;
    h.patches.psg.settings.attenuation=12;h.files.markDirty();
    assert.equal(store.saved.editorContexts.psg.preset.settings.attenuation,8,'the debounced IndexedDB draft is still the earlier sound');
    assert(store.journal.has('tetorica-fm2612-synth-pending-tone'),'the latest single-file PSG edit has a synchronous journal');
  } finally {h.cleanup();}
  h=harness(store);
  try {
    await h.files.ready;assert.equal(h.kind,'psg');assert.equal(h.files.activeTonePath,psgPath);assert.equal(h.patches.psg.settings.attenuation,12);
    assert(h.messages.some(message=>message.includes('Recovered')));
    await h.files.switchEditor('fm');assert.equal(h.files.activeTonePath,fmPath);assert.equal(h.patches.fm.feedback,2);
  } finally {h.cleanup();}
});

test('awaiting a file or built-in selection makes its editor context durable before an immediate reload',async()=>{
  const store={saved:null,journal:new Map()};let h=harness(store),first,second;
  try {
    await h.files.ready;
    await h.files.createFromPreset(createPsgPreset({attenuation:8}),'First PSG');first=h.files.activeTonePath;
    await h.files.createFromPreset(createPsgPreset({attenuation:3}),'Second PSG');second=h.files.activeTonePath;
    assert.equal(store.saved.activeTonePath,second);
    assert.equal(await h.files.selectFile(first),true);
    assert.equal(store.saved.activeTonePath,first,'the completed file selection has already reached IndexedDB');
    assert.equal(store.saved.editorContexts.psg.activeTonePath,first);
  } finally {h.cleanup();}
  h=harness(store);
  try {
    await h.files.ready;assert.equal(h.kind,'psg');assert.equal(h.files.activeTonePath,first);assert.equal(h.patches.psg.settings.attenuation,8);
    assert.equal(await h.files.selectPreset('psg-default'),true);
    assert.equal(store.saved.activeTonePath,null);assert.equal(store.saved.editorContexts.psg.presetId,'psg-default');
  } finally {h.cleanup();}
  h=harness(store);
  try {await h.files.ready;assert.equal(h.kind,'psg');assert.equal(h.files.activeTonePath,null);assert.equal(h.ids.psg,'psg-default');}
  finally {h.cleanup();}
});

test('software envelope edits retain Sync/Revert and immediate recovery independently from FM',async()=>{
  const store={saved:null,journal:new Map()},savedEnvelope={enabled:true,attackMs:80,decayMs:270,sustain:40,releaseMs:900};
  let h=harness(store),fmPath,psgPath;
  try {
    await h.files.ready;await h.files.createFromPreset({...fm(),feedback:3},'Envelope FM');fmPath=h.files.activeTonePath;
    await h.files.createFromPreset(createPsgPreset({envelope:savedEnvelope}),'Envelope PSG');psgPath=h.files.activeTonePath;
    await h.action('sync');h.patches.psg.settings.envelope.releaseMs=1500;h.files.markDirty();
    assert.deepEqual(h.project.readTone(psgPath).preset.settings.envelope,{...savedEnvelope,releaseMs:1500});
    await h.files.switchEditor('fm');assert.equal(h.patches.fm.feedback,3);await h.files.switchEditor('psg');
    assert.equal(h.patches.psg.settings.envelope.releaseMs,1500);await h.action('revert');
    assert.deepEqual(h.patches.psg.settings.envelope,savedEnvelope);
    h.patches.psg.settings.envelope.sustain=12;h.files.markDirty();
  } finally {h.cleanup();}
  h=harness(store);
  try {
    await h.files.ready;assert.equal(h.files.activeTonePath,psgPath);
    assert.deepEqual(h.patches.psg.settings.envelope,{...savedEnvelope,sustain:12});
    await h.action('revert');assert.deepEqual(h.patches.psg.settings.envelope,savedEnvelope);
    await h.files.switchEditor('fm');assert.equal(h.files.activeTonePath,fmPath);assert.equal(h.patches.fm.feedback,3);
  } finally {h.cleanup();}
});

test('a legacy saved PSG editor context migrates to Envelope Off without rewriting its original file',async()=>{
  const store={saved:null,journal:new Map()},legacy={version:1,kind:'tetorica-sega-psg',settings:{source:'tone',attenuation:7,noiseType:'white',noiseRate:'medium'}};
  let h=harness(store),psgPath;
  try {
    await h.files.ready;await h.files.createFromPreset(fm(),'Legacy context FM');
    await h.files.createFromPreset(createPsgPreset(legacy.settings),'Legacy context PSG');psgPath=h.files.activeTonePath;
    await h.files.switchEditor('fm');
    const saved=store.saved;
    for(const file of saved.project.files)if(file.path===psgPath||file.path==='/.tet.ss'+psgPath)file.data=JSON.stringify(legacy)+'\n';
    saved.editorContexts.psg.preset=structuredClone(legacy);saved.editorContexts.psg.basePreset=structuredClone(legacy);
  } finally {h.cleanup();}
  h=harness(store);
  try {
    await h.files.ready;h.patches.psg.settings.envelope.enabled=true;
    assert.equal(await h.files.switchEditor('psg'),true);assert.equal(h.files.activeTonePath,psgPath);
    assert.equal(h.patches.psg.version,2);assert.equal(h.patches.psg.settings.envelope.enabled,false);
    assert.equal(JSON.parse(h.project.fs.get(psgPath).data).version,1,'restoring an old context does not auto-save a migration');
  } finally {h.cleanup();}
});

test('FM, PSG and PCM file contexts retain independent sounds, paths and inactive compound renames',async()=>{
  const store={saved:null,journal:new Map()};let h=harness(store),fmPath,psgPath,pcmPath;
  try {
    await h.files.ready;await h.files.createFromPreset({...fm(),feedback:5},'Three FM');fmPath=h.files.activeTonePath;
    await h.files.createFromPreset(createPsgPreset({source:'noise',attenuation:9}),'Three PSG');psgPath=h.files.activeTonePath;
    await h.files.switchEditor('pcm');assert.equal(h.kind,'pcm');assert.equal(h.ids.pcm,'pcm-sine');
    h.patches.pcm.settings.volume=91;h.files.markDirty();pcmPath=h.files.activeTonePath;
    assert.match(pcmPath,/\.pcm\.json$/);await h.action('sync');
    h.patches.pcm.settings.panRight=3;h.files.markDirty();
    await h.files.switchEditor('fm');assert.equal(h.files.activeTonePath,fmPath);assert.equal(h.patches.fm.feedback,5);
    await h.rename(pcmPath,'Sample Bank.pcm.json');pcmPath='/presets/Sample Bank.pcm.json';
    await h.files.switchEditor('pcm');assert.equal(h.files.activeTonePath,pcmPath);assert.equal(h.ids.pcm,'vfs:'+pcmPath);
    assert.equal(h.patches.pcm.settings.panRight,3);await h.action('revert');assert.equal(h.patches.pcm.settings.panRight,15);
    await h.files.switchEditor('psg');assert.equal(h.files.activeTonePath,psgPath);assert.equal(h.patches.psg.settings.attenuation,9);
  } finally {h.cleanup();}
  h=harness(store);
  try {
    await h.files.ready;assert.equal(h.kind,'psg');assert.equal(h.files.activeTonePath,psgPath);
    await h.files.switchEditor('pcm');assert.equal(h.files.activeTonePath,pcmPath);assert.equal(h.patches.pcm.settings.volume,91);
    assert.equal(h.patches.pcm.settings.panRight,15);await h.files.switchEditor('fm');assert.equal(h.files.activeTonePath,fmPath);
    assert.equal(h.patches.fm.feedback,5);
  } finally {h.cleanup();}
});

test('a full PCM sample and checkpoint recover the last edit without overwriting FM/PSG contexts',async()=>{
  const originalVolume=createPcmBuiltinPreset('sine').settings.volume;
  const store={saved:null,journal:new Map()};let h=harness(store),pcmPath,fmPath,psgPath;
  try {
    await h.files.ready;await h.files.createFromPreset({...fm(),feedback:6},'Recovery FM');fmPath=h.files.activeTonePath;
    await h.files.createFromPreset(createPsgPreset({attenuation:8}),'Recovery PSG');psgPath=h.files.activeTonePath;
    const full=createPcmBuiltinPreset('sine');full.sample.data=Buffer.alloc(PCM_MAX_FRAMES,128).toString('base64');full.settings.loopEnd=PCM_MAX_FRAMES;
    await h.files.createFromPreset(normalizePcmPreset(full),'Recovery PCM');pcmPath=h.files.activeTonePath;await h.action('sync');
    h.patches.pcm.settings.volume=115;h.files.markDirty();
    const journal=store.journal.get('tetorica-fm2612-synth-pending-tone');assert(Buffer.byteLength(journal)>128*1024);
    assert(Buffer.byteLength(journal)<384*1024);assert.equal(h.project.readTone(pcmPath).preset.settings.volume,115);
    assert.equal(store.saved.editorContexts.pcm.preset.settings.volume,originalVolume,'the saved context still predates the immediate journal');
  } finally {h.cleanup();}
  h=harness(store);
  try {
    await h.files.ready;assert.equal(h.kind,'pcm');assert.equal(h.files.activeTonePath,pcmPath);
    assert.equal(h.patches.pcm.settings.volume,115);assert.equal(h.patches.pcm.settings.loopEnd,PCM_MAX_FRAMES);
    await h.action('revert');assert.equal(h.patches.pcm.settings.volume,originalVolume);
    await h.files.switchEditor('fm');assert.equal(h.files.activeTonePath,fmPath);assert.equal(h.patches.fm.feedback,6);
    await h.files.switchEditor('psg');assert.equal(h.files.activeTonePath,psgPath);assert.equal(h.patches.psg.settings.attenuation,8);
    await h.files.selectPreset('pcm-sine');assert.equal(h.kind,'pcm');assert.equal(h.files.activeTonePath,null);
    assert.equal(store.saved.editorContexts.pcm.presetId,'pcm-sine');
  } finally {h.cleanup();}
});
