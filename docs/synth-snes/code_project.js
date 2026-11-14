// S-DSP Code project data. Restoring Files never creates audio or runs Code.
import {createVirtualFileSystem,isCheckpointPath} from '../js/tetorica_virtual_files/filesystem.js';
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/path.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {createSynthCodeProject} from '../synth/synth_code_project.js?code-files-scope=2';
import {createSynthProjectStore} from '../synth/synth_project_store.js?v=draft-reconnect-1';
import {readPreset,createDefaultPreset} from './preset.js';

export const SNES_PROJECT_FORMAT='tetorica-snes-code-project';
export const SNES_PROJECT_MANIFEST='/snes-synth.project.json';
export const SNES_PROJECT_STORAGE_KEY='tetorica-snes-synth-project-v1';
// Reserve 256 KiB for the full preset (including both BRR samples) and manifest.
export const SNES_PROJECT_FILE_BYTES=16*1024*1024-256*1024;
export const SNES_PROJECT_CODE_LENGTH=2*1024*1024;
const MAX_TEXT=SNES_PROJECT_CODE_LENGTH;
const clone=value=>structuredClone(value);
export const isSnesCodePath=path=>typeof path==='string'&&/\.m?js$/i.test(path)&&!path.split('/').some(part=>['.git','.tet.ss'].includes(part));
export const isSnesTextPath=path=>/\.(?:m?js|json|txt|md|css|html|csv|ya?ml|glsl)$/i.test(path);
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const text=data=>typeof data==='string'?data:decoder.decode(data);
const name=value=>{if(typeof value!=='string'||!value.trim()||value.length>120||/[\u0000-\u001f/\\]/.test(value))throw Error('Project name must be 1–120 characters without slashes.');return value.trim();};
const editorPath=(path,fs)=>typeof path==='string'&&path.startsWith('/')&&!path.split('/').some(part=>['..','.git','.tet.ss'].includes(part))&&fs.get(path)?.type==='text';
function codeState(value,fs){
  if(value==null)return{mode:'keyboard',path:null};
  if(!value||!['keyboard','code'].includes(value.mode)||value.path!==null&&!editorPath(value.path,fs))throw Error('Invalid S-DSP Code selection.');
  return{mode:value.mode,path:value.path};
}
function selectedPath(value,fs){if(value===null||value===undefined)return null;const path=normalizeVirtualPath(value);if(!fs.stat(path))throw Error('Selected project file is missing.');return path;}
function pathForUser(path){path=normalizeVirtualPath(path);if(path==='/'||path===SNES_PROJECT_MANIFEST||isCheckpointPath(path))throw Error('That project path is reserved.');return path;}
/** Validate a portable sound without rewriting the editable source document.
 * Only explicit sound selection applies this data to the current S-DSP. */
export function readSnesProjectSound(data){
  const value=typeof data==='string'||ArrayBuffer.isView(data)||data instanceof ArrayBuffer?JSON.parse(text(data)):data;
  if(value?.format!=='tetorica-sdsp-voice')return null;
  return readPreset(value);
}
function validateFiles(fs){
  let total=0;
  for(const file of fs.list()){
    total+=file.type==='text'?new TextEncoder().encode(file.data).byteLength:file.data.byteLength;
    if(isCheckpointPath(file.path))continue;
    if(file.path===SNES_PROJECT_MANIFEST)throw Error('S-DSP project manifest is reserved.');
    if(isSnesCodePath(file.path)&&(file.type!=='text'||file.data.length>MAX_TEXT))throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
  }
  if(total>SNES_PROJECT_FILE_BYTES)throw Error('Code project files exceed the 16 MiB cassette limit. Use Save preset for a larger audio instrument.');
}
export function createSnesCodeProject({settings=createDefaultPreset(),snapshot,starterCode,getStarterCode}={}){
  const fs=createVirtualFileSystem(),listeners=new Set();
  let current=readPreset(settings),selected=null,state={mode:'keyboard',path:null},projectName='Tetorica S-DSP',restoring=false,entryCache=null;
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
      if(!editorPath(path,fs)&&!(isSnesCodePath(path)&&!fs.has(path)))throw Error('Choose a project text file.');
      if(isSnesCodePath(path)&&source.length>MAX_TEXT)throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
      const encoder=new TextEncoder();let total=encoder.encode(source).byteLength;
      for(const file of fs.list())if(file.path!==path)total+=file.type==='text'?encoder.encode(file.data).byteLength:file.data.byteLength;
      if(total>SNES_PROJECT_FILE_BYTES)throw Error('Code project files exceed the 16 MiB cassette limit. Use Save preset for a larger audio instrument.');
      fs.writeText(path,source);
    },
    setCodeState(value){const next=codeState(value,fs);if(next.mode!==state.mode||next.path!==state.path){state=next;notify();}},getCodeState:()=>clone(state),
    snapshot(){return{format:SNES_PROJECT_FORMAT,version:1,name:projectName,settings:project.settings,selectedPath:selected,codeState:clone(state),filesystem:fs.snapshot()};},
    restore(value){
      if(value?.format!==SNES_PROJECT_FORMAT||value.version!==1)throw Error('Unsupported S-DSP project format/version.');
      const candidate=createVirtualFileSystem();candidate.restore(value.filesystem);validateFiles(candidate);
      const nextSettings=readPreset(value.settings),nextSelected=selectedPath(value.selectedPath,candidate),nextState=codeState(value.codeState,candidate),nextName=name(value.name);
      restoring=true;try{fs.restore(candidate.snapshot());current=nextSettings;selected=nextSelected;state=nextState;projectName=nextName;}finally{restoring=false;}notify();return project.snapshot();
    },
    importFiles(entries){
      const candidate=createVirtualFileSystem();candidate.restore(fs.snapshot());
      const normalized=entries.map(entry=>({path:pathForUser(entry.path),type:entry.type??(isSnesTextPath(entry.path)?'text':'binary'),data:entry.data}));
      for(const entry of normalized)if(entry.type==='text'&&typeof entry.data!=='string')entry.data=text(entry.data);
      candidate.writeFiles(normalized);validateFiles(candidate);fs.restore(candidate.snapshot());return normalized.map(entry=>entry.path);
    },
    async prepareImport(bytes){
      const cassette=await loadPlaygroundCassette(bytes),files=[],manifest=cassette.files.get(SNES_PROJECT_MANIFEST.slice(1));
      let metadata=null;if(manifest){try{metadata=JSON.parse(text(manifest));}catch{throw Error('Invalid S-DSP project manifest JSON.');}}
      for(const [path,data]of cassette.files){if('/'+path===SNES_PROJECT_MANIFEST)continue;files.push({path:'/'+path,type:isSnesTextPath(path)?'text':'binary',data:isSnesTextPath(path)?text(data):data});}
      const candidate=createSnesCodeProject({settings:current});candidate.fs.writeFiles(files);
      for(const directory of cassette.directories)if(directory!=='/')candidate.fs.mkdir(directory,{recursive:true});
      const next=metadata??{format:SNES_PROJECT_FORMAT,version:1,name:projectName,settings:project.settings,selectedPath:null,codeState:{mode:'keyboard',path:null}};
      candidate.restore({...next,filesystem:candidate.fs.snapshot()});return candidate.snapshot();
    },
    exportProject(){
      validateFiles(fs);const {filesystem,...manifest}=project.snapshot();
      return createPlaygroundCassetteZip([...fs.list(),{path:SNES_PROJECT_MANIFEST,type:'text',data:JSON.stringify(manifest,null,2)+'\n'}],{directories:fs.listDirectories(),preserveMetadataFiles:true});
    },
  };
  Object.assign(project,createSynthCodeProject(project));
  if(starterCode===undefined&&!snapshot&&getStarterCode)starterCode=getStarterCode();
  if(starterCode!==undefined){if(typeof starterCode!=='string')throw TypeError('Starter code must be text.');fs.writeText('/index.js',starterCode);}
  if(snapshot)project.restore(snapshot);
  return project;
}

function storageJson(snapshot){return JSON.stringify(snapshot,(_key,value)=>value instanceof Uint8Array?{$snesBytes:Array.from(value)}:value);}
function storageParse(source){return JSON.parse(source,(_key,value)=>value&&Array.isArray(value.$snesBytes)?Uint8Array.from(value.$snesBytes):value);}
export function createSnesProjectStore({indexedDB=globalThis.indexedDB,storage=globalThis.localStorage}={}){
  return createSynthProjectStore({indexedDB,name:'tetorica-snes-synth-files',
    readFallback(){const source=storage?.getItem(SNES_PROJECT_STORAGE_KEY);return source?storageParse(source):null;},
    writeFallback(snapshot){if(!storage)return false;storage.setItem(SNES_PROJECT_STORAGE_KEY,storageJson(snapshot));return true;},
  });
}
