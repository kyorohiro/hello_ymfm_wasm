// SID authoring files and project data. Importing/restoring never runs code.
import {createVirtualFileSystem,isCheckpointPath} from '../js/tetorica_virtual_files/filesystem.js';
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/path.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {createSynthCodeProject} from '../synth/synth_code_project.js';
import {createChannelSettings,readChannelSettings,applyChannelPreset} from './channel_settings.js';
import {readPreset} from './preset.js';

export const SID_PROJECT_FORMAT='tetorica-sid-code-project';
export const SID_PROJECT_MANIFEST='/sid-synth.project.json';
export const SID_PROJECT_STORAGE_KEY='tetorica-sid-synth-project-v1';
const MAX_TEXT=2*1024*1024;
const clone=value=>structuredClone(value);
export const isSidCodePath=path=>typeof path==='string'&&/\.m?js$/i.test(path)&&!path.split('/').some(part=>['.git','.tet.ss'].includes(part));
export const isSidTextPath=path=>/\.(?:m?js|json|txt|md|css|html|csv|ya?ml|glsl)$/i.test(path);
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const text=data=>typeof data==='string'?data:decoder.decode(data);
const name=value=>{if(typeof value!=='string'||!value.trim()||value.length>120||/[\u0000-\u001f/\\]/.test(value))throw Error('Project name must be 1–120 characters without slashes.');return value.trim();};
function codeState(value,fs){
  if(value==null)return{mode:'keyboard',path:null};
  if(!value||!['keyboard','code'].includes(value.mode)||value.path!==null&&(!isSidCodePath(value.path)||!fs.has(value.path)))throw Error('Invalid SID Code selection.');
  return{mode:value.mode,path:value.path};
}
function selectedPath(value,fs){if(value===null||value===undefined)return null;const path=normalizeVirtualPath(value);if(!fs.stat(path))throw Error('Selected project file is missing.');return path;}
function pathForUser(path){path=normalizeVirtualPath(path);if(path==='/'||path===SID_PROJECT_MANIFEST||isCheckpointPath(path))throw Error('That project path is reserved.');return path;}
/** Read either portable SID voice v1/v2 or channel setup v1/v2. Never mutates
 * the source document; old schemas remain byte-for-byte in Files. */
export function readSidProjectSound(data,current=createChannelSettings()){
  const value=typeof data==='string'||ArrayBuffer.isView(data)||data instanceof ArrayBuffer?JSON.parse(text(data)):data;
  if(value?.format==='tetorica-sid-channels')return readChannelSettings(value);
  if(value?.format==='tetorica-sid-voice')return applyChannelPreset(current,readPreset(value));
  return null;
}
function validateFiles(fs){
  for(const file of fs.list()){
    if(isCheckpointPath(file.path))continue;
    if(file.path===SID_PROJECT_MANIFEST)throw Error('SID project manifest is reserved.');
    if(isSidCodePath(file.path)&&(file.type!=='text'||file.data.length>MAX_TEXT))throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
    // User text may be an unfinished SID JSON edit. Keep it byte-for-byte;
    // only the authored settings manifest and explicit sound selection apply it.
  }
}

export function createSidCodeProject({settings=createChannelSettings(),snapshot,starterCode,getStarterCode}={}){
  const fs=createVirtualFileSystem(),listeners=new Set();
  let current=readChannelSettings(settings),selected=null,state={mode:'keyboard',path:null},projectName='Tetorica SID',restoring=false;
  const notify=()=>{if(!restoring)for(const listener of listeners)listener();};
  fs.onDidChange(notify);
  const project={fs,onDidChange(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    get settings(){return readChannelSettings(current);},get selectedPath(){return selected;},get cassetteName(){return projectName;},
    setSettings(value){const next=readChannelSettings(value);if(JSON.stringify(next)!==JSON.stringify(current)){current=next;notify();}return project.settings;},
    select(path){const next=selectedPath(path,fs);if(next!==selected){selected=next;notify();}return selected;},
    setCodeState(value){const next=codeState(value,fs);if(next.mode!==state.mode||next.path!==state.path){state=next;notify();}},getCodeState:()=>clone(state),
    snapshot(){return{format:SID_PROJECT_FORMAT,version:1,name:projectName,settings:project.settings,selectedPath:selected,codeState:clone(state),filesystem:fs.snapshot()};},
    restore(value){
      if(value?.format!==SID_PROJECT_FORMAT||value.version!==1)throw Error('Unsupported SID project format/version.');
      const candidate=createVirtualFileSystem();candidate.restore(value.filesystem);validateFiles(candidate);
      const nextSettings=readChannelSettings(value.settings),nextSelected=selectedPath(value.selectedPath,candidate),nextState=codeState(value.codeState,candidate),nextName=name(value.name);
      restoring=true;try{fs.restore(candidate.snapshot());current=nextSettings;selected=nextSelected;state=nextState;projectName=nextName;}finally{restoring=false;}notify();return project.snapshot();
    },
    importFiles(entries){
      const candidate=createVirtualFileSystem();candidate.restore(fs.snapshot());
      const normalized=entries.map(entry=>({path:pathForUser(entry.path),type:entry.type??(isSidTextPath(entry.path)?'text':'binary'),data:entry.data}));
      for(const entry of normalized)if(entry.type==='text'&&typeof entry.data!=='string')entry.data=text(entry.data);
      candidate.writeFiles(normalized);validateFiles(candidate);fs.restore(candidate.snapshot());return normalized.map(entry=>entry.path);
    },
    async prepareImport(bytes){
      const cassette=await loadPlaygroundCassette(bytes),files=[],manifest=cassette.files.get(SID_PROJECT_MANIFEST.slice(1));
      let metadata=null;if(manifest){try{metadata=JSON.parse(text(manifest));}catch{throw Error('Invalid SID project manifest JSON.');}}
      for(const [path,data]of cassette.files){if('/'+path===SID_PROJECT_MANIFEST)continue;files.push({path:'/'+path,type:isSidTextPath(path)?'text':'binary',data:isSidTextPath(path)?text(data):data});}
      const candidate=createSidCodeProject({settings:current});candidate.fs.writeFiles(files);
      for(const directory of cassette.directories)if(directory!=='/')candidate.fs.mkdir(directory,{recursive:true});
      const next=metadata??{format:SID_PROJECT_FORMAT,version:1,name:projectName,settings:project.settings,selectedPath:null,codeState:{mode:'keyboard',path:null}};
      candidate.restore({...next,filesystem:candidate.fs.snapshot()});return candidate.snapshot();
    },
    exportProject(){
      validateFiles(fs);const {filesystem,...manifest}=project.snapshot();
      return createPlaygroundCassetteZip([...fs.list(),{path:SID_PROJECT_MANIFEST,type:'text',data:JSON.stringify(manifest,null,2)+'\n'}],{directories:fs.listDirectories(),preserveMetadataFiles:true});
    },
  };
  Object.assign(project,createSynthCodeProject(project));
  if(starterCode===undefined&&!snapshot&&getStarterCode)starterCode=getStarterCode();
  if(starterCode!==undefined){if(typeof starterCode!=='string')throw TypeError('Starter code must be text.');fs.writeText('/index.js',starterCode);}
  if(snapshot)project.restore(snapshot);
  return project;
}

// Full structured snapshots use IndexedDB. Small environments without IDB use
// their own localStorage key and explicit binary encoding; quota errors surface.
function storageJson(snapshot){return JSON.stringify(snapshot,(_key,value)=>value instanceof Uint8Array?{$sidBytes:Array.from(value)}:value);}
function storageParse(source){return JSON.parse(source,(_key,value)=>value&&Array.isArray(value.$sidBytes)?Uint8Array.from(value.$sidBytes):value);}
export function createSidProjectStore({indexedDB=globalThis.indexedDB,storage=globalThis.localStorage}={}){
  let opened;
  const database=()=>opened??=new Promise((resolve,reject)=>{const request=indexedDB.open('tetorica-sid-synth-files',1);request.onupgradeneeded=()=>request.result.createObjectStore('projects');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  return{
    async read(){if(!indexedDB)return storage?.getItem(SID_PROJECT_STORAGE_KEY)?storageParse(storage.getItem(SID_PROJECT_STORAGE_KEY)):null;const db=await database();return new Promise((resolve,reject)=>{const request=db.transaction('projects','readonly').objectStore('projects').get('current');request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);});},
    async write(snapshot){if(!indexedDB){if(!storage)return false;storage.setItem(SID_PROJECT_STORAGE_KEY,storageJson(snapshot));return true;}const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put(snapshot,'current');tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('SID project storage cancelled.'));});},
    async close(){if(opened)(await opened).close();},
  };
}
