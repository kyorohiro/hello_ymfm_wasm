// SPU Code project data. Restoring Files never creates audio or runs Code.
import {createVirtualFileSystem,isCheckpointPath} from '../js/tetorica_virtual_files/filesystem.js';
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/path.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {createSynthCodeProject} from '../synth/synth_code_project.js?code-files-scope=2';
import {readSpuInstrument,INSTRUMENT_SCHEMA} from './spu_synth_instrument.js?v=spu-split-vab-1';

export const SPU_PROJECT_FORMAT='tetorica-spu-code-project';
export const SPU_PROJECT_MANIFEST='/spu-synth.project.json';
export const SPU_PROJECT_STORAGE_KEY='tetorica-spu-synth-project-v1';
// Shared cassette ZIPs are bounded to 16 MiB, including their manifest.
export const SPU_PROJECT_FILE_BYTES=16*1024*1024-65536;
const MAX_TEXT=2*1024*1024;
const clone=value=>structuredClone(value);
export const isSpuCodePath=path=>typeof path==='string'&&/\.m?js$/i.test(path)&&!path.split('/').some(part=>['.git','.tet.ss'].includes(part));
export const isSpuTextPath=path=>/\.(?:m?js|json|txt|md|css|html|csv|ya?ml|glsl)$/i.test(path);
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const text=data=>typeof data==='string'?data:decoder.decode(data);
const name=value=>{if(typeof value!=='string'||!value.trim()||value.length>120||/[\u0000-\u001f/\\]/.test(value))throw Error('Project name must be 1–120 characters without slashes.');return value.trim();};
function codeState(value,fs){
  if(value==null)return{mode:'keyboard',path:null};
  if(!value||!['keyboard','code'].includes(value.mode)||value.path!==null&&(!isSpuCodePath(value.path)||!fs.has(value.path)))throw Error('Invalid SPU Code selection.');
  return{mode:value.mode,path:value.path};
}
function selectedPath(value,fs){if(value===null||value===undefined)return null;const path=normalizeVirtualPath(value);if(!fs.stat(path))throw Error('Selected project file is missing.');return path;}
function pathForUser(path){path=normalizeVirtualPath(path);if(path==='/'||path===SPU_PROJECT_MANIFEST||isCheckpointPath(path))throw Error('That project path is reserved.');return path;}
/** Validate a portable sound without rewriting the editable source document.
 * Only explicit sound selection applies this data to the current SPU. */
export function readSpuProjectSound(data){
  const value=typeof data==='string'||ArrayBuffer.isView(data)||data instanceof ArrayBuffer?JSON.parse(text(data)):data;
  if(value?.schema!==INSTRUMENT_SCHEMA)return null;
  readSpuInstrument(value);return clone(value);
}
function validateFiles(fs){
  let total=0;
  for(const file of fs.list()){
    total+=file.type==='text'?new TextEncoder().encode(file.data).byteLength:file.data.byteLength;
    if(isCheckpointPath(file.path))continue;
    if(file.path===SPU_PROJECT_MANIFEST)throw Error('SPU project manifest is reserved.');
    if(isSpuCodePath(file.path)&&(file.type!=='text'||file.data.length>MAX_TEXT))throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
  }
  if(total>SPU_PROJECT_FILE_BYTES)throw Error('Code project files exceed the 16 MiB cassette limit. Use Save preset for a larger audio instrument.');
}
export function createSpuCodeProject({snapshot,starterCode,getStarterCode}={}){
  const fs=createVirtualFileSystem(),listeners=new Set();
  let selected=null,state={mode:'keyboard',path:null},projectName='Tetorica SPU',restoring=false;
  const notify=()=>{if(!restoring)for(const listener of listeners)listener();};
  fs.onDidChange(notify);
  const project={fs,onDidChange(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    get selectedPath(){return selected;},get cassetteName(){return projectName;},
    select(path){const next=selectedPath(path,fs);if(next!==selected){selected=next;notify();}return selected;},
    setCodeState(value){const next=codeState(value,fs);if(next.mode!==state.mode||next.path!==state.path){state=next;notify();}},getCodeState:()=>clone(state),
    snapshot(){return{format:SPU_PROJECT_FORMAT,version:1,name:projectName,selectedPath:selected,codeState:clone(state),filesystem:fs.snapshot()};},
    restore(value){
      if(value?.format!==SPU_PROJECT_FORMAT||value.version!==1)throw Error('Unsupported SPU project format/version.');
      const candidate=createVirtualFileSystem();candidate.restore(value.filesystem);validateFiles(candidate);
      const nextSelected=selectedPath(value.selectedPath,candidate),nextState=codeState(value.codeState,candidate),nextName=name(value.name);
      restoring=true;try{fs.restore(candidate.snapshot());selected=nextSelected;state=nextState;projectName=nextName;}finally{restoring=false;}notify();return project.snapshot();
    },
    importFiles(entries){
      const candidate=createVirtualFileSystem();candidate.restore(fs.snapshot());
      const normalized=entries.map(entry=>({path:pathForUser(entry.path),type:entry.type??(isSpuTextPath(entry.path)?'text':'binary'),data:entry.data}));
      for(const entry of normalized)if(entry.type==='text'&&typeof entry.data!=='string')entry.data=text(entry.data);
      candidate.writeFiles(normalized);validateFiles(candidate);fs.restore(candidate.snapshot());return normalized.map(entry=>entry.path);
    },
    async prepareImport(bytes){
      const cassette=await loadPlaygroundCassette(bytes),files=[],manifest=cassette.files.get(SPU_PROJECT_MANIFEST.slice(1));
      let metadata=null;if(manifest){try{metadata=JSON.parse(text(manifest));}catch{throw Error('Invalid SPU project manifest JSON.');}}
      for(const [path,data]of cassette.files){if('/'+path===SPU_PROJECT_MANIFEST)continue;files.push({path:'/'+path,type:isSpuTextPath(path)?'text':'binary',data:isSpuTextPath(path)?text(data):data});}
      const candidate=createSpuCodeProject();candidate.fs.writeFiles(files);
      for(const directory of cassette.directories)if(directory!=='/')candidate.fs.mkdir(directory,{recursive:true});
      const next=metadata??{format:SPU_PROJECT_FORMAT,version:1,name:projectName,selectedPath:null,codeState:{mode:'keyboard',path:null}};
      candidate.restore({...next,filesystem:candidate.fs.snapshot()});return candidate.snapshot();
    },
    exportProject(){
      validateFiles(fs);const {filesystem,...manifest}=project.snapshot();
      return createPlaygroundCassetteZip([...fs.list(),{path:SPU_PROJECT_MANIFEST,type:'text',data:JSON.stringify(manifest,null,2)+'\n'}],{directories:fs.listDirectories(),preserveMetadataFiles:true});
    },
  };
  Object.assign(project,createSynthCodeProject(project));
  if(starterCode===undefined&&!snapshot&&getStarterCode)starterCode=getStarterCode();
  if(starterCode!==undefined){if(typeof starterCode!=='string')throw TypeError('Starter code must be text.');fs.writeText('/index.js',starterCode);}
  if(snapshot)project.restore(snapshot);
  return project;
}

function storageJson(snapshot){return JSON.stringify(snapshot,(_key,value)=>value instanceof Uint8Array?{$spuBytes:Array.from(value)}:value);}
function storageParse(source){return JSON.parse(source,(_key,value)=>value&&Array.isArray(value.$spuBytes)?Uint8Array.from(value.$spuBytes):value);}
export function createSpuProjectStore({indexedDB=globalThis.indexedDB,storage=globalThis.localStorage}={}){
  let opened;
  const database=()=>opened??=new Promise((resolve,reject)=>{const request=indexedDB.open('tetorica-spu-synth-files',1);request.onupgradeneeded=()=>request.result.createObjectStore('projects');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  return{
    async read(){if(!indexedDB)return storage?.getItem(SPU_PROJECT_STORAGE_KEY)?storageParse(storage.getItem(SPU_PROJECT_STORAGE_KEY)):null;const db=await database();return new Promise((resolve,reject)=>{const request=db.transaction('projects','readonly').objectStore('projects').get('current');request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);});},
    async write(snapshot){if(!indexedDB){if(!storage)return false;storage.setItem(SPU_PROJECT_STORAGE_KEY,storageJson(snapshot));return true;}const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put(snapshot,'current');tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('SPU project storage cancelled.'));});},
    async close(){if(opened)(await opened).close();},
  };
}
