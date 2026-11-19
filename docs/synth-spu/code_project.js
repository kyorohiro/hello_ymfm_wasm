// SPU Code project data. Restoring Files never creates audio or runs Code.
import {createVirtualFileSystem,isCheckpointPath} from '../js/tetorica_virtual_files/filesystem.js';
import {createVirtualFileWorkspace} from '../js/tetorica_virtual_files/workspace.js';
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/path.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {createSynthCodeProject} from '../synth/synth_code_project.js?v=huc-working-saved-1';
import {createSynthProjectStore} from '../synth/synth_project_store.js?v=draft-reconnect-1';
import {createPs1InitSample} from '../js/ps1synth.js?v=ps1-oneshot-marker-1';
import {morphPcm} from './spu_synth_morph.js';
import {readSpuInstrument,writeSpuInstrument,INSTRUMENT_SCHEMA} from './spu_synth_instrument.js?v=spu-split-vab-1';
export const createSpuDefaultInstrument=()=>writeSpuInstrument('Sine',{
  sample:createPs1InitSample(),waveform:morphPcm({enabled:true}),morph:{enabled:true},
  preset:{volumeLeft:.75,volumeRight:.75,adsr1:15,adsr2:0,pitch:4096,reverb:false},
  reverb:{preset:'off',volumeLeft:.25,volumeRight:.25},noise:{enabled:false},pmon:{enabled:false},
});
const readPreset=value=>{if(value==null)return null;const sound=readSpuProjectSound(value);if(!sound)throw Error('Expected an SPU instrument.');return sound;};

export const SPU_PROJECT_FORMAT='tetorica-spu-code-project';
export const SPU_PROJECT_MANIFEST='/spu-synth.project.json';
export const SPU_PROJECT_STORAGE_KEY='tetorica-spu-synth-project-v1';
// Shared cassette ZIPs are bounded to 16 MiB, including their manifest.
export const SPU_PROJECT_FILE_BYTES=16*1024*1024-65536;
export const SPU_PROJECT_CODE_LENGTH=2*1024*1024;
const MAX_TEXT=SPU_PROJECT_CODE_LENGTH;
const clone=value=>structuredClone(value);
export const isSpuCodePath=path=>typeof path==='string'&&/\.m?js$/i.test(path)&&!path.split('/').some(part=>['.git','.tet.ss'].includes(part));
export const isSpuTextPath=path=>/\.(?:m?js|json|txt|md|css|html|csv|ya?ml|glsl)$/i.test(path);

const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const text=data=>typeof data==='string'?data:decoder.decode(data);
const name=value=>{if(typeof value!=='string'||!value.trim()||value.length>120||/[\u0000-\u001f/\\]/.test(value))throw Error('Project name must be 1–120 characters without slashes.');return value.trim();};
const editorPath=(path,fs)=>typeof path==='string'&&path.startsWith('/')&&!path.split('/').some(part=>['..','.git','.tet.ss'].includes(part))&&fs.get(path)?.type==='text';
function codeState(value,fs){
  if(value==null)return{mode:'keyboard',path:null};
  if(!value||!['keyboard','code'].includes(value.mode)||value.path!==null&&!editorPath(value.path,fs))throw Error('Invalid SPU Code selection.');
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
    if(/\.(?:vab|vh|vb|psf|minipsf|psflib)$/i.test(file.path)&&file.type!=='binary')throw Error('VAB / PSF sources must keep their original binary bytes.');
    if(isSpuCodePath(file.path)&&(file.type!=='text'||file.data.length>MAX_TEXT))throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
  }
  if(total>SPU_PROJECT_FILE_BYTES)throw Error('Code project files exceed the 16 MiB cassette limit. Use Save preset for a larger audio instrument.');
}

const METADATA_PATHS=new Set(['/metadata.json','/cassette.metadata.js']);
const sameFile=(a,b)=>Boolean(a&&b&&a.type===b.type&&(typeof a.data==='string'?a.data===b.data:a.data.length===b.data.length&&a.data.every((value,index)=>value===b.data[index])));
const sameSnapshot=(a,b)=>a.files.length===b.files.length&&JSON.stringify([...a.directories].sort())===JSON.stringify([...b.directories].sort())&&a.files.every(file=>sameFile(file,b.files.find(other=>other.path===file.path)));
function canonicalDataPath(value){if(typeof value!=='string'||normalizeVirtualPath(value)!==value||value==='/'||value===SPU_PROJECT_MANIFEST)throw Error('Invalid SPU recovery path.');return value;}
function canonicalPath(value){return pathForUser(canonicalDataPath(value));}
function encodeFile(file){
  if(file.type==='text')return{path:file.path,type:'text',data:file.data};
  let source='';for(let offset=0;offset<file.data.length;offset+=32768)source+=String.fromCharCode(...file.data.subarray(offset,offset+32768));
  return{path:file.path,type:'binary',data:btoa(source)};
}
function decodeFile(file){
  if(!file||!['text','binary'].includes(file.type)||typeof file.data!=='string')throw Error('Invalid SPU working file.');
  const path=canonicalDataPath(file.path);
  if(file.type==='text')return{path,type:'text',data:file.data};
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data))throw Error('Invalid SPU working binary encoding.');
  return{path,type:'binary',data:Uint8Array.from(atob(file.data),character=>character.charCodeAt(0))};
}
function workingDelta(workspace){
  const state=workspace.snapshot(),saved=new Map(state.saved.files.map(file=>[file.path,file])),working=new Set(state.working.files.map(file=>file.path));
  return{version:1,autoSave:state.autoSave,files:state.working.files.filter(file=>!sameFile(file,saved.get(file.path))).map(encodeFile),
    deleted:state.saved.files.filter(file=>!working.has(file.path)).map(file=>file.path),
    directories:{created:state.working.directories.filter(path=>!state.saved.directories.includes(path)),deleted:state.saved.directories.filter(path=>!state.working.directories.includes(path))},
    savedTextPaths:state.saved.files.filter(file=>file.type==='text').map(file=>file.path),
    metadataPaths:state.saved.files.filter(file=>METADATA_PATHS.has(file.path)).map(file=>file.path)};
}
function restoreDelta(entries,directories,delta){
  if(!delta||delta.version!==1||typeof delta.autoSave!=='boolean'||!Array.isArray(delta.files)||!Array.isArray(delta.deleted)||!Array.isArray(delta.savedTextPaths)||!Array.isArray(delta.metadataPaths)||
    !delta.directories||!Array.isArray(delta.directories.created)||!Array.isArray(delta.directories.deleted))throw Error('Invalid SPU working recovery state.');
  const metadataPaths=new Set(delta.metadataPaths);
  if(metadataPaths.size!==delta.metadataPaths.length||[...metadataPaths].some(path=>!METADATA_PATHS.has(path)))throw Error('Invalid SPU metadata recovery paths.');
  const savedFiles=entries.filter(file=>!METADATA_PATHS.has(file.path)||metadataPaths.has(file.path));
  for(const path of metadataPaths)if(!savedFiles.some(file=>file.path===path))throw Error('Missing SPU original metadata file.');
  const textPaths=new Set(delta.savedTextPaths);
  if(textPaths.size!==delta.savedTextPaths.length)throw Error('Duplicate SPU saved text path.');
  for(const path of textPaths){canonicalDataPath(path);const file=savedFiles.find(file=>file.path===path);if(!file)throw Error('Missing SPU saved text file.');file.type='text';file.data=text(file.data);}
  const saved=createVirtualFileSystem();saved.replace(savedFiles,directories);
  const files=new Map(saved.list().map(file=>[file.path,file])),seen=new Set();
  for(const path of delta.deleted){canonicalDataPath(path);if(seen.has(path)||!files.has(path))throw Error('Invalid SPU working deletion.');seen.add(path);files.delete(path);}
  for(const file of delta.files.map(decodeFile)){if(seen.has(file.path))throw Error('Duplicate SPU working path.');seen.add(file.path);files.set(file.path,file);}
  const dirs=new Set(saved.listDirectories()),seenDirs=new Set();
  for(const path of delta.directories.deleted){canonicalDataPath(path);if(seenDirs.has(path)||!dirs.has(path))throw Error('Invalid SPU working folder deletion.');seenDirs.add(path);dirs.delete(path);}
  for(const path of delta.directories.created){canonicalDataPath(path);if(seenDirs.has(path)||dirs.has(path))throw Error('Invalid SPU working folder creation.');seenDirs.add(path);dirs.add(path);}
  const working=createVirtualFileSystem();working.replace([...files.values()],[...dirs]);
  return{version:1,working:working.snapshot(),saved:saved.snapshot(),autoSave:delta.autoSave};
}
function soundPath(value,working,saved){
  if(value==null)return null;const path=canonicalPath(value),file=working.get(path)??saved.get(path);
  if(file?.type!=='text'||!isSpuTextPath(path))throw Error('Active SPU sound document is missing or not text.');return path;
}
function pendingPaths(value){
  if(!Array.isArray(value))throw Error('Invalid SPU pending moves.');
  const sources=new Set(),targets=new Set();
  return value.map(pair=>{if(!Array.isArray(pair)||pair.length!==2)throw Error('Invalid SPU pending move.');const [source,target]=pair.map(canonicalPath);
    if(source===target||sources.has(source)||targets.has(target))throw Error('Duplicate SPU pending move.');sources.add(source);targets.add(target);return[source,target];});
}
// Keep unchanged portable sample payloads once in the Cassette manifest.
// The workspace itself also stores only differences from accepted files.
function compactManifestSettings(value){
  const result=clone(value);
  if(result.settings==null){delete result.settings;delete result.savedSettings;return result;}
  if(JSON.stringify(result.settings)===JSON.stringify(result.savedSettings)){
    delete result.savedSettings;result.savedSettingsSource='settings';
  }else if(result.savedSettings&&JSON.stringify(result.settings.sample)===JSON.stringify(result.savedSettings.sample)){
    delete result.savedSettings.sample;result.savedSampleSource='settings';
  }
  return result;
}
function expandManifestSettings(value){
  const result={...value};
  if(value.savedSettingsSource!==undefined){
    if(value.savedSettingsSource!=='settings'||value.savedSettings!==undefined||value.savedSampleSource!==undefined)throw Error('Invalid SPU accepted-settings alias.');
    result.savedSettings=readPreset(value.settings);
  }else if(value.savedSampleSource!==undefined){
    if(value.savedSampleSource!=='settings'||!value.savedSettings||value.savedSettings.sample!==undefined||!value.settings?.sample)throw Error('Invalid SPU accepted-sample alias.');
    result.savedSettings={...value.savedSettings,sample:clone(value.settings.sample)};
  }
  return result;
}
export function createSpuCodeProject({settings=null,snapshot,starterCode,getStarterCode,starterFiles={}}={}){
  const workspace=createVirtualFileWorkspace(),fs=workspace.working,savedFs=workspace.saved,listeners=new Set(),entryCache=new Map();
  let current=readPreset(settings),accepted=readPreset(settings),activeSound=null,moves=[],selected=null,state={mode:'keyboard',path:null},projectName='Tetorica SPU',restoring=false;
  const notify=()=>{if(!restoring)for(const listener of listeners)listener();};
  workspace.onDidChange(notify);
  const project={fs,savedFs,workspace,onDidChange(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    get autoApply(){return workspace.autoSave;},
    setAutoApply(enabled){restoring=true;try{workspace.setAutoSave(enabled);if(enabled)moves=[];}finally{restoring=false;}notify();return workspace.autoSave;},
    get settings(){return readPreset(current);},setSettings(value){const next=readPreset(value);if(JSON.stringify(next)!==JSON.stringify(current)){current=next;notify();}return project.settings;},
    get savedSettings(){return readPreset(accepted);},setSavedSettings(value){const next=readPreset(value);if(JSON.stringify(next)!==JSON.stringify(accepted)){accepted=next;notify();}return project.savedSettings;},
    get activeSoundPath(){return activeSound;},setActiveSoundPath(value){const next=soundPath(value,fs,savedFs);if(next!==activeSound){activeSound=next;notify();}return activeSound;},
    getPendingMoves:()=>clone(moves),setPendingMoves(value){const next=pendingPaths(value);if(JSON.stringify(next)!==JSON.stringify(moves)){moves=next;notify();}return clone(moves);},
    getDirtyPaths:()=>workspace.getDirtyPaths(),isFileModified:path=>workspace.isDirty(path),
    saveFiles(paths){validateFiles(fs);workspace.saveMany(paths);return [...paths];},
    discardFiles(paths){workspace.discardMany(paths);return [...paths];},
    saveAll(){validateFiles(fs);const paths=workspace.getDirtyPaths();restoring=true;try{workspace.saveAll();moves=[];}finally{restoring=false;}notify();return paths;},
    listEntries(){
      const entries=[],present=new Set();
      for(const directory of fs.listDirectories())for(const name of fs.readdir(directory)){
        const path=(directory==='/'?'':directory)+'/'+name,stat=fs.stat(path);if(stat.type!=='file')continue;present.add(path);
        let entry=entryCache.get(path);if(entry?.revision!==stat.revision){entry={path,...stat,fileType:fs.get(path).type};entryCache.set(path,entry);}entries.push({...entry});
      }
      for(const path of entryCache.keys())if(!present.has(path))entryCache.delete(path);return entries.sort((a,b)=>a.path.localeCompare(b.path));
    },
    get selectedPath(){return selected;},get cassetteName(){return projectName;},
    select(path){const next=selectedPath(path,fs);if(next!==selected){selected=next;notify();}return selected;},
    writeEditorText(path,source){
      path=pathForUser(path);if(typeof source!=='string')throw TypeError('Editor content must be text.');
      if(!editorPath(path,fs)&&!(isSpuCodePath(path)&&!fs.has(path)))throw Error('Choose a project text file.');
      if(isSpuCodePath(path)&&source.length>MAX_TEXT)throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
      const encoder=new TextEncoder();let total=encoder.encode(source).byteLength;
      for(const file of project.listEntries())if(file.path!==path)total+=file.size;
      if(total>SPU_PROJECT_FILE_BYTES)throw Error('Code project files exceed the 16 MiB cassette limit. Use Save preset for a larger audio instrument.');
      fs.writeText(path,source);
    },
    setCodeState(value){const next=codeState(value,fs);if(next.mode!==state.mode||next.path!==state.path){state=next;notify();}},getCodeState:()=>clone(state),
    prepareNew(){
      // Prepare defaults separately, using the original starter rather than edited Code.
      const fresh=createSpuCodeProject({settings:createSpuDefaultInstrument(),starterFiles,starterCode:getStarterCode?getStarterCode():starterCode??''});
      fresh.select('/index.js');fresh.setCodeState({mode:'keyboard',path:'/index.js'});
      fresh.setAutoApply(project.autoApply);
      return fresh.snapshot();
    },
    snapshot(){const layers=workspace.snapshot();return{format:SPU_PROJECT_FORMAT,version:2,name:projectName,...(current?{settings:project.settings,savedSettings:project.savedSettings}:{}),activeSoundPath:activeSound,pendingMoves:clone(moves),selectedPath:selected,codeState:clone(state),filesystem:layers.working,workspace:layers};},
    restore(value){
      if(value?.format!==SPU_PROJECT_FORMAT||![1,2].includes(value.version))throw Error('Unsupported SPU project format/version.');
      const candidate=createVirtualFileWorkspace();
      if(value.version===1){const legacy=createVirtualFileSystem();legacy.restore(value.filesystem);candidate.restore({version:1,working:legacy.snapshot(),saved:legacy.snapshot(),autoSave:true});}
      else{candidate.restore(value.workspace);if(value.filesystem!==undefined){const compatible=createVirtualFileSystem();compatible.restore(value.filesystem);if(!sameSnapshot(compatible.snapshot(),candidate.working.snapshot()))throw Error('Inconsistent SPU working filesystem snapshot.');}}
      validateFiles(candidate.working);validateFiles(candidate.saved);
      const nextSettings=readPreset(value.settings),nextAccepted=readPreset(value.version===1?value.settings:value.savedSettings),nextActive=soundPath(value.activeSoundPath,candidate.working,candidate.saved),nextMoves=pendingPaths(value.pendingMoves??[]);
      const nextSelected=selectedPath(value.selectedPath,candidate.working),nextState=codeState(value.codeState,candidate.working),nextName=name(value.name);
      restoring=true;try{workspace.restore(candidate.snapshot());current=nextSettings;accepted=nextAccepted;activeSound=nextActive;moves=nextMoves;selected=nextSelected;state=nextState;projectName=nextName;}finally{restoring=false;}notify();return project.snapshot();
    },
    importFiles(entries){
      const candidate=createVirtualFileSystem();candidate.restore(fs.snapshot());
      const normalized=entries.map(entry=>({path:pathForUser(entry.path),type:entry.type??(isSpuTextPath(entry.path)?'text':'binary'),data:entry.data}));
      for(const entry of normalized)if(entry.type==='text'&&typeof entry.data!=='string')entry.data=text(entry.data);
      candidate.writeFiles(normalized);validateFiles(candidate);fs.restore(candidate.snapshot());return normalized.map(entry=>entry.path);
    },
    async prepareImport(bytes,{isCurrent=()=>true}={}){
      const check=()=>{if(!isCurrent())throw new DOMException('SPU import cancelled','AbortError');};check();
      const cassette=await loadPlaygroundCassette(bytes),files=[],manifest=cassette.files.get(SPU_PROJECT_MANIFEST.slice(1));check();
      let metadata=null;if(manifest){try{metadata=JSON.parse(text(manifest));}catch{throw Error('Invalid SPU project manifest JSON.');}}
      if(metadata&&(metadata.format!==SPU_PROJECT_FORMAT||![1,2].includes(metadata.version)))throw Error('Unsupported SPU project format/version.');
      if(metadata?.version===2){
        for(const [path,data]of cassette.files){if('/'+path!==SPU_PROJECT_MANIFEST)files.push({path:'/'+path,type:'binary',data});}
        const layers=restoreDelta(files,cassette.directories,metadata.workingDelta),candidate=createSpuCodeProject({settings:current});
        candidate.restore({...expandManifestSettings(metadata),workspace:layers,filesystem:layers.working});check();return candidate.snapshot();
      }
      for(const [path,data]of cassette.files){if('/'+path===SPU_PROJECT_MANIFEST)continue;files.push({path:'/'+path,type:isSpuTextPath(path)?'text':'binary',data:isSpuTextPath(path)?text(data):data});}
      const candidate=createSpuCodeProject({settings:current});candidate.fs.writeFiles(files);
      for(const directory of cassette.directories)if(directory!=='/')candidate.fs.mkdir(directory,{recursive:true});
      const next=metadata??{format:SPU_PROJECT_FORMAT,version:1,name:projectName,settings:project.settings,selectedPath:null,codeState:{mode:'keyboard',path:null}};
      candidate.restore({...next,filesystem:candidate.fs.snapshot()});check();return candidate.snapshot();
    },
    exportProject(){
      validateFiles(fs);validateFiles(savedFs);const {filesystem,workspace:layers,...state}=project.snapshot();
      const manifest={...compactManifestSettings(state),workingDelta:workingDelta(workspace)};
      const metadata=JSON.stringify(manifest,null,2)+'\n';
      const total=new TextEncoder().encode(metadata).byteLength+savedFs.list().reduce((bytes,file)=>bytes+(file.type==='text'?new TextEncoder().encode(file.data).byteLength:file.data.byteLength),0);
      if(total>16*1024*1024)throw Error('Code project exceeds the 16 MiB expanded cassette limit. Use Save preset for a larger audio instrument.');
      return createPlaygroundCassetteZip([...savedFs.list(),{path:SPU_PROJECT_MANIFEST,type:'text',data:metadata}],{directories:savedFs.listDirectories(),preserveMetadataFiles:true});
    },
    recoverCode(path,{source,savedSource,autoSave}){
      path=canonicalPath(path);if(!isSpuTextPath(path)||typeof source!=='string'||savedSource!==null&&typeof savedSource!=='string'||typeof autoSave!=='boolean')throw Error('Invalid SPU Code recovery versions.');
      const working=createVirtualFileSystem(),saved=createVirtualFileSystem();working.restore(fs.snapshot());saved.restore(savedFs.snapshot());working.writeText(path,source);
      if(savedSource===null){if(saved.has(path))saved.remove(path);}else saved.writeText(path,savedSource);
      const candidate=createVirtualFileWorkspace();candidate.restore({version:1,working:working.snapshot(),saved:saved.snapshot(),autoSave});validateFiles(candidate.working);validateFiles(candidate.saved);workspace.restore(candidate.snapshot());
    },
  };
  Object.assign(project,createSynthCodeProject(project));
  const savedCode=createSynthCodeProject(project,{version:'saved'});project.readSavedFile=savedCode.readFile;project.prepareSavedSource=savedCode.prepareSource;
  if(starterCode===undefined&&!snapshot&&getStarterCode)starterCode=getStarterCode();
  if(starterCode!==undefined){if(typeof starterCode!=='string')throw TypeError('Starter code must be text.');fs.writeText('/index.js',starterCode);}
  if(!snapshot)for(const [path,text]of Object.entries(starterFiles))fs.writeText(path,text);
  if(snapshot)project.restore(snapshot);
  return project;
}

function storageJson(snapshot){return JSON.stringify(snapshot,(_key,value)=>value instanceof Uint8Array?{$spuBytes:Array.from(value)}:value);}
function storageParse(source){return JSON.parse(source,(_key,value)=>value&&Array.isArray(value.$spuBytes)?Uint8Array.from(value.$spuBytes):value);}
export function createSpuProjectStore({indexedDB=globalThis.indexedDB,storage=globalThis.localStorage}={}){
  return createSynthProjectStore({indexedDB,name:'tetorica-spu-synth-files',
    readFallback(){const source=storage?.getItem(SPU_PROJECT_STORAGE_KEY);return source?storageParse(source):null;},
    writeFallback(snapshot){if(!storage)return false;storage.setItem(SPU_PROJECT_STORAGE_KEY,storageJson(snapshot));return true;},
  });
}
