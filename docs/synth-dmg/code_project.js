// Game Boy Code project data. Restoring Files never creates audio or runs Code.
import {createVirtualFileSystem,isCheckpointPath} from '../js/tetorica_virtual_files/filesystem.js';
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/path.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {createSynthCodeProject} from '../synth/synth_code_project.js?code-files-scope=2';
import {readPreset,createDefaultPreset} from './preset.js';

export const GAMEBOY_PROJECT_FORMAT='tetorica-dmg-code-project';
export const GAMEBOY_PROJECT_MANIFEST='/dmg-synth.project.json';
export const GAMEBOY_PROJECT_STORAGE_KEY='tetorica-dmg-synth-project-v1';
// Shared cassette ZIPs are bounded to 16 MiB, including their manifest.
export const GAMEBOY_PROJECT_FILE_BYTES=16*1024*1024-65536;
export const GAMEBOY_PROJECT_CODE_LENGTH=2*1024*1024;
const MAX_TEXT=GAMEBOY_PROJECT_CODE_LENGTH;
const clone=value=>structuredClone(value);
export const isGameboyCodePath=path=>typeof path==='string'&&/\.m?js$/i.test(path)&&!path.split('/').some(part=>['.git','.tet.ss'].includes(part));
export const isGameboyTextPath=path=>/\.(?:m?js|json|txt|md|css|html|csv|ya?ml|glsl)$/i.test(path);
export const isGameboySongFilename=name=>typeof name==='string'&&/\.(?:vgm|vgz)$/i.test(name);
export const isGameboySongPath=path=>typeof path==='string'&&path.startsWith('/vgm/')&&isGameboySongFilename(path);
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const text=data=>typeof data==='string'?data:decoder.decode(data);
const name=value=>{if(typeof value!=='string'||!value.trim()||value.length>120||/[\u0000-\u001f/\\]/.test(value))throw Error('Project name must be 1–120 characters without slashes.');return value.trim();};
const editorPath=(path,fs)=>typeof path==='string'&&path.startsWith('/')&&!path.split('/').some(part=>['..','.git','.tet.ss'].includes(part))&&fs.get(path)?.type==='text';
function codeState(value,fs){
  if(value==null)return{mode:'keyboard',path:null};
  if(!value||!['keyboard','code'].includes(value.mode)||value.path!==null&&!editorPath(value.path,fs))throw Error('Invalid Game Boy Code selection.');
  return{mode:value.mode,path:value.path};
}
function selectedPath(value,fs){if(value===null||value===undefined)return null;const path=normalizeVirtualPath(value);if(!fs.stat(path))throw Error('Selected project file is missing.');return path;}
function pathForUser(path){path=normalizeVirtualPath(path);if(path==='/'||path===GAMEBOY_PROJECT_MANIFEST||isCheckpointPath(path))throw Error('That project path is reserved.');return path;}
/** Keep original log bytes opaque. Parsing and audio are explicit Play actions. */
export function gameboySongSourceEntries(project,sources){
  if(!Array.isArray(sources))throw TypeError('Song sources must be an array.');
  const fold=path=>path.normalize('NFC').toLowerCase(),encoder=new TextEncoder();
  const used=new Set([...project.fs.list().map(file=>file.path),...project.fs.listDirectories()].map(fold));
  return sources.map(source=>{
    if(!source||typeof source.name!=='string'||!(source.bytes instanceof Uint8Array))throw TypeError('A VGM source needs a name and Uint8Array bytes.');
    let name=source.name.split(/[\\/]/).pop().normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"|?*\ud800-\udfff]/gu,'_').trim().replace(/^\.+|[. ]+$/g,'');
    if(!isGameboySongFilename(name))throw Error('Use a .vgm or .vgz song file name.');
    const extension=name.slice(-4);let stem=name.slice(0,-4),bounded='';
    for(const character of stem){if(encoder.encode(bounded+character).length>200)break;bounded+=character;}
    stem=bounded.replace(/[. ]+$/g,'')||'Untitled';if(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem.split('.')[0].trimEnd()))stem='_'+stem;
    let path=`/vgm/${stem}${extension}`,index=1;while(used.has(fold(path)))path=`/vgm/${stem}-${++index}${extension}`;used.add(fold(path));
    return {path,type:'binary',data:source.bytes};
  });
}
/** Validate a portable sound without rewriting the editable source document.
 * Only explicit sound selection applies this data to the current DMG. */
export function readGameboyProjectSound(data){
  const value=typeof data==='string'||ArrayBuffer.isView(data)||data instanceof ArrayBuffer?JSON.parse(text(data)):data;
  if(value?.format!=='tetorica-gameboy-voice')return null;
  return readPreset(value);
}
function validateFiles(fs){
  let total=0;
  for(const file of fs.list()){
    total+=file.type==='text'?new TextEncoder().encode(file.data).byteLength:file.data.byteLength;
    if(isCheckpointPath(file.path))continue;
    if(file.path===GAMEBOY_PROJECT_MANIFEST)throw Error('DMG project manifest is reserved.');
    if(isGameboyCodePath(file.path)&&(file.type!=='text'||file.data.length>MAX_TEXT))throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
  }
  if(total>GAMEBOY_PROJECT_FILE_BYTES)throw Error('Code project files exceed the 16 MiB cassette limit. Use Save preset for a larger audio instrument.');
}
export function createGameboyCodeProject({settings=createDefaultPreset(),snapshot,starterCode,getStarterCode}={}){
  const fs=createVirtualFileSystem(),listeners=new Set();
  let current=readPreset(settings),selected=null,state={mode:'keyboard',path:null},projectName='Tetorica DMG',restoring=false,entryCache=null;
  const notify=()=>{if(!restoring)for(const listener of listeners)listener();};
  fs.onDidChange(()=>{entryCache=null;notify();});
  const project={fs,onDidChange(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    get settings(){return readPreset(current);},setSettings(value){const next=readPreset(value);if(JSON.stringify(next)!==JSON.stringify(current)){current=next;notify();}return project.settings;},
    listEntries(){
      entryCache??=fs.list().map(file=>({path:file.path,revision:file.revision,type:'file',fileType:file.type,size:file.type==='text'?new TextEncoder().encode(file.data).byteLength:file.data.byteLength}));
      return entryCache.map(entry=>({...entry}));
    },
    get selectedPath(){return selected;},get cassetteName(){return projectName;},
    select(path){const next=selectedPath(path,fs);if(next!==selected){selected=next;notify();}return selected;},
    writeEditorText(path,source){
      path=pathForUser(path);if(typeof source!=='string')throw TypeError('Editor content must be text.');
      if(!editorPath(path,fs)&&!(isGameboyCodePath(path)&&!fs.has(path)))throw Error('Choose a project text file.');
      if(isGameboyCodePath(path)&&source.length>MAX_TEXT)throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
      const encoder=new TextEncoder();let total=encoder.encode(source).byteLength;
      for(const file of fs.list())if(file.path!==path)total+=file.type==='text'?encoder.encode(file.data).byteLength:file.data.byteLength;
      if(total>GAMEBOY_PROJECT_FILE_BYTES)throw Error('Code project files exceed the 16 MiB cassette limit. Use Save preset for a larger audio instrument.');
      fs.writeText(path,source);
    },
    setCodeState(value){const next=codeState(value,fs);if(next.mode!==state.mode||next.path!==state.path){state=next;notify();}},getCodeState:()=>clone(state),
    snapshot(){return{format:GAMEBOY_PROJECT_FORMAT,version:1,name:projectName,settings:project.settings,selectedPath:selected,codeState:clone(state),filesystem:fs.snapshot()};},
    restore(value){
      if(value?.format!==GAMEBOY_PROJECT_FORMAT||value.version!==1)throw Error('Unsupported DMG project format/version.');
      const candidate=createVirtualFileSystem();candidate.restore(value.filesystem);validateFiles(candidate);
      const nextSettings=readPreset(value.settings),nextSelected=selectedPath(value.selectedPath,candidate),nextState=codeState(value.codeState,candidate),nextName=name(value.name);
      restoring=true;try{fs.restore(candidate.snapshot());current=nextSettings;selected=nextSelected;state=nextState;projectName=nextName;}finally{restoring=false;}notify();return project.snapshot();
    },
    importFiles(entries){
      const candidate=createVirtualFileSystem();candidate.restore(fs.snapshot());
      const normalized=entries.map(entry=>({path:pathForUser(entry.path),type:entry.type??(isGameboyTextPath(entry.path)?'text':'binary'),data:entry.data}));
      for(const entry of normalized)if(entry.type==='text'&&typeof entry.data!=='string')entry.data=text(entry.data);
      candidate.writeFiles(normalized);validateFiles(candidate);fs.restore(candidate.snapshot());return normalized.map(entry=>entry.path);
    },
    importSongSources(sources){return project.importFiles(gameboySongSourceEntries(project,sources));},
    async prepareImport(bytes){
      const cassette=await loadPlaygroundCassette(bytes),files=[],manifest=cassette.files.get(GAMEBOY_PROJECT_MANIFEST.slice(1));
      let metadata=null;if(manifest){try{metadata=JSON.parse(text(manifest));}catch{throw Error('Invalid DMG project manifest JSON.');}}
      for(const [path,data]of cassette.files){if('/'+path===GAMEBOY_PROJECT_MANIFEST)continue;files.push({path:'/'+path,type:isGameboyTextPath(path)?'text':'binary',data:isGameboyTextPath(path)?text(data):data});}
      const candidate=createGameboyCodeProject({settings:current});candidate.fs.writeFiles(files);
      for(const directory of cassette.directories)if(directory!=='/')candidate.fs.mkdir(directory,{recursive:true});
      const next=metadata??{format:GAMEBOY_PROJECT_FORMAT,version:1,name:projectName,settings:project.settings,selectedPath:null,codeState:{mode:'keyboard',path:null}};
      candidate.restore({...next,filesystem:candidate.fs.snapshot()});return candidate.snapshot();
    },
    exportProject(){
      validateFiles(fs);const {filesystem,...manifest}=project.snapshot();
      return createPlaygroundCassetteZip([...fs.list(),{path:GAMEBOY_PROJECT_MANIFEST,type:'text',data:JSON.stringify(manifest,null,2)+'\n'}],{directories:fs.listDirectories(),preserveMetadataFiles:true});
    },
  };
  Object.assign(project,createSynthCodeProject(project));
  if(starterCode===undefined&&!snapshot&&getStarterCode)starterCode=getStarterCode();
  if(starterCode!==undefined){if(typeof starterCode!=='string')throw TypeError('Starter code must be text.');fs.writeText('/index.js',starterCode);}
  if(snapshot)project.restore(snapshot);
  return project;
}

function storageJson(snapshot){return JSON.stringify(snapshot,(_key,value)=>value instanceof Uint8Array?{$dmgBytes:Array.from(value)}:value);}
function storageParse(source){return JSON.parse(source,(_key,value)=>value&&Array.isArray(value.$dmgBytes)?Uint8Array.from(value.$dmgBytes):value);}
export function createGameboyProjectStore({indexedDB=globalThis.indexedDB,storage=globalThis.localStorage}={}){
  let opened;
  const database=()=>opened??=new Promise((resolve,reject)=>{const request=indexedDB.open('tetorica-dmg-synth-files',1);request.onupgradeneeded=()=>request.result.createObjectStore('projects');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  return{
    async read(){if(!indexedDB)return storage?.getItem(GAMEBOY_PROJECT_STORAGE_KEY)?storageParse(storage.getItem(GAMEBOY_PROJECT_STORAGE_KEY)):null;const db=await database();return new Promise((resolve,reject)=>{const request=db.transaction('projects','readonly').objectStore('projects').get('current');request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);});},
    async write(snapshot){if(!indexedDB){if(!storage)return false;storage.setItem(GAMEBOY_PROJECT_STORAGE_KEY,storageJson(snapshot));return true;}const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put(snapshot,'current');tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('DMG project storage cancelled.'));});},
    async close(){if(opened)(await opened).close();},
  };
}
