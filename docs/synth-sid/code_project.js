// SID Code project data. Restoring Files never creates audio or runs Code.
import {createVirtualFileSystem,isCheckpointPath} from '../js/tetorica_virtual_files/filesystem.js';
import {createVirtualFileWorkspace} from '../js/tetorica_virtual_files/workspace.js';
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/path.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {createSynthCodeProject} from '../synth/synth_code_project.js?v=huc-working-saved-1';
import {createSynthProjectStore} from '../synth/synth_project_store.js?v=draft-reconnect-1';
import {createChannelSettings,readChannelSettings,applyChannelPreset} from './channel_settings.js';
import {readPreset} from './preset.js';

export const SID_PROJECT_FORMAT='tetorica-sid-code-project';
export const SID_PROJECT_MANIFEST='/sid-synth.project.json';
export const SID_PROJECT_STORAGE_KEY='tetorica-sid-synth-project-v1';
// Shared cassette ZIPs are bounded to 16 MiB, including their manifest.
export const SID_PROJECT_FILE_BYTES=16*1024*1024-65536;
export const SID_PROJECT_CODE_LENGTH=2*1024*1024;
const MAX_TEXT=SID_PROJECT_CODE_LENGTH;
const clone=value=>structuredClone(value);
export const isSidCodePath=path=>typeof path==='string'&&/\.m?js$/i.test(path)&&!path.split('/').some(part=>['.git','.tet.ss'].includes(part));
export const isSidTextPath=path=>/\.(?:m?js|json|txt|md|css|html|csv|ya?ml|glsl)$/i.test(path);
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const text=data=>typeof data==='string'?data:decoder.decode(data);
const name=value=>{if(typeof value!=='string'||!value.trim()||value.length>120||/[\u0000-\u001f/\\]/.test(value))throw Error('Project name must be 1–120 characters without slashes.');return value.trim();};
const editorPath=(path,fs)=>typeof path==='string'&&path.startsWith('/')&&!path.split('/').some(part=>['..','.git','.tet.ss'].includes(part))&&fs.get(path)?.type==='text';
function codeState(value,fs){
  if(value==null)return{mode:'keyboard',path:null};
  if(!value||!['keyboard','code'].includes(value.mode)||value.path!==null&&!editorPath(value.path,fs))throw Error('Invalid SID Code selection.');
  return{mode:value.mode,path:value.path};
}
function selectedPath(value,fs){if(value===null||value===undefined)return null;const path=normalizeVirtualPath(value);if(!fs.stat(path))throw Error('Selected project file is missing.');return path;}
const isManifestPath=path=>path===SID_PROJECT_MANIFEST||path.startsWith(SID_PROJECT_MANIFEST+'/');
function pathForUser(path){path=normalizeVirtualPath(path);if(path==='/'||isManifestPath(path)||isCheckpointPath(path))throw Error('That project path is reserved.');return path;}
/** Read either portable SID voice v1/v2 or channel setup v1/v2. Never mutates
 * the source document; old schemas remain byte-for-byte in Files. */
export function readSidProjectSound(data,current=createChannelSettings()){
  const value=typeof data==='string'||ArrayBuffer.isView(data)||data instanceof ArrayBuffer?JSON.parse(text(data)):data;
  if(value?.format==='tetorica-sid-channels')return readChannelSettings(value);
  if(value?.format==='tetorica-sid-voice')return applyChannelPreset(current,readPreset(value));
  return null;
}
function validateFiles(fs){
  let total=0;
  for(const directory of fs.listDirectories())if(isManifestPath(directory))throw Error('SID project manifest is reserved.');
  for(const file of fs.list()){
    const bytes=file.type==='text'?new TextEncoder().encode(file.data).byteLength:file.data.byteLength;total+=bytes;
    if(isCheckpointPath(file.path))continue;
    if(isManifestPath(file.path))throw Error('SID project manifest is reserved.');
    if(isSidCodePath(file.path)&&(file.type!=='text'||bytes>MAX_TEXT))throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
  }
  if(total>SID_PROJECT_FILE_BYTES)throw Error('Code project files exceed the 16 MiB cassette limit. Export selected files separately.');
}

const METADATA_PATHS=new Set(['/metadata.json','/cassette.metadata.js']);
const sameFile=(a,b)=>Boolean(a&&b&&a.type===b.type&&(typeof a.data==='string'?a.data===b.data:a.data.length===b.data.length&&a.data.every((value,index)=>value===b.data[index])));
const sameSnapshot=(a,b)=>a.files.length===b.files.length&&JSON.stringify([...a.directories].sort())===JSON.stringify([...b.directories].sort())&&a.files.every(file=>sameFile(file,b.files.find(other=>other.path===file.path)));
function canonicalDataPath(value){if(typeof value!=='string'||normalizeVirtualPath(value)!==value||value==='/'||isManifestPath(value))throw Error('Invalid SID recovery path.');return value;}
function canonicalPath(value){return pathForUser(canonicalDataPath(value));}
function encodeFile(file){
  if(file.type==='text')return{path:file.path,type:'text',data:file.data};
  let source='';for(let offset=0;offset<file.data.length;offset+=32768)source+=String.fromCharCode(...file.data.subarray(offset,offset+32768));
  return{path:file.path,type:'binary',data:btoa(source)};
}
function decodeFile(file){
  if(!file||!['text','binary'].includes(file.type)||typeof file.data!=='string')throw Error('Invalid SID working file.');
  const path=canonicalDataPath(file.path);
  if(file.type==='text')return{path,type:'text',data:file.data};
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data))throw Error('Invalid SID working binary encoding.');
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
    !delta.directories||!Array.isArray(delta.directories.created)||!Array.isArray(delta.directories.deleted))throw Error('Invalid SID working recovery state.');
  const metadataPaths=new Set(delta.metadataPaths);
  if(metadataPaths.size!==delta.metadataPaths.length||[...metadataPaths].some(path=>!METADATA_PATHS.has(path)))throw Error('Invalid SID metadata recovery paths.');
  const savedFiles=entries.filter(file=>!METADATA_PATHS.has(file.path)||metadataPaths.has(file.path));
  for(const path of metadataPaths)if(!savedFiles.some(file=>file.path===path))throw Error('Missing SID original metadata file.');
  const textPaths=new Set(delta.savedTextPaths);
  if(textPaths.size!==delta.savedTextPaths.length)throw Error('Duplicate SID saved text path.');
  for(const path of textPaths){canonicalDataPath(path);const file=savedFiles.find(file=>file.path===path);if(!file)throw Error('Missing SID saved text file.');file.type='text';file.data=text(file.data);}
  const saved=createVirtualFileSystem();saved.replace(savedFiles,directories);
  const files=new Map(saved.list().map(file=>[file.path,file])),seen=new Set();
  for(const path of delta.deleted){canonicalDataPath(path);if(seen.has(path)||!files.has(path))throw Error('Invalid SID working deletion.');seen.add(path);files.delete(path);}
  for(const file of delta.files.map(decodeFile)){if(seen.has(file.path))throw Error('Duplicate SID working path.');seen.add(file.path);files.set(file.path,file);}
  const dirs=new Set(saved.listDirectories()),seenDirs=new Set();
  for(const path of delta.directories.deleted){canonicalDataPath(path);if(seenDirs.has(path)||!dirs.has(path))throw Error('Invalid SID working folder deletion.');seenDirs.add(path);dirs.delete(path);}
  for(const path of delta.directories.created){canonicalDataPath(path);if(seenDirs.has(path)||dirs.has(path))throw Error('Invalid SID working folder creation.');seenDirs.add(path);dirs.add(path);}
  const working=createVirtualFileSystem();working.replace([...files.values()],[...dirs]);
  return{version:1,working:working.snapshot(),saved:saved.snapshot(),autoSave:delta.autoSave};
}
function soundPath(value,working,saved){
  if(value==null)return null;const path=canonicalPath(value),file=working.get(path)??saved.get(path);
  if(file?.type!=='text'||!isSidTextPath(path))throw Error('Active SID sound document is missing or not text.');return path;
}
function pendingPaths(value){
  if(!Array.isArray(value))throw Error('Invalid SID pending moves.');
  const sources=new Set(),targets=new Set();
  return value.map(pair=>{if(!Array.isArray(pair)||pair.length!==2)throw Error('Invalid SID pending move.');const [source,target]=pair.map(canonicalPath);
    if(source===target||sources.has(source)||targets.has(target))throw Error('Duplicate SID pending move.');sources.add(source);targets.add(target);return[source,target];});
}
// ZIP recovery aliases equal sound caches without duplicating unchanged data.
function compactManifestSettings(value){
  const result=clone(value);
  if(JSON.stringify(result.settings)===JSON.stringify(result.savedSettings)){
    delete result.savedSettings;result.savedSettingsSource='settings';
  }
  return result;
}
function expandManifestSettings(value){
  const result={...value};
  if(value.savedSettingsSource!==undefined){
    if(value.savedSettingsSource!=='settings'||value.savedSettings!==undefined)throw Error('Invalid SID accepted-settings alias.');
    result.savedSettings=readChannelSettings(value.settings);
  }
  return result;
}
export function createSidCodeProject({settings=createChannelSettings(),snapshot,starterCode,getStarterCode,starterFiles={}}={}){
  const examples=Object.entries(starterFiles).map(([path,data])=>{
    path=pathForUser(path);if(!isSidCodePath(path)||typeof data!=='string')throw TypeError('Starter examples must be JavaScript text files.');
    return{path,type:'text',data};
  });
  const workspace=createVirtualFileWorkspace(),fs=workspace.working,savedFs=workspace.saved,listeners=new Set();let entryCache=null;
  let current=readChannelSettings(settings),accepted=readChannelSettings(settings),activeSound=null,moves=[],selected=null,state={mode:'keyboard',path:null},projectName='Tetorica SID',restoring=false;
  const notify=()=>{if(!restoring)for(const listener of listeners)listener();};
  workspace.onDidChange(()=>{entryCache=null;notify();});
  // Partial acceptance can combine a large old file and a large new file even
  // when each complete version fits. Validate that result before publishing.
  const validateMirror=(method,paths)=>{const candidate=createVirtualFileWorkspace();candidate.restore(workspace.snapshot());candidate[method](paths);validateFiles(candidate.working);validateFiles(candidate.saved);};
  const project={fs,savedFs,workspace,onDidChange(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    get autoApply(){return workspace.autoSave;},
    setAutoApply(enabled){if(enabled)validateFiles(fs);restoring=true;try{workspace.setAutoSave(enabled);if(enabled)moves=[];}finally{restoring=false;}notify();return workspace.autoSave;},
    get settings(){return readChannelSettings(current);},setSettings(value){const next=readChannelSettings(value);if(JSON.stringify(next)!==JSON.stringify(current)){current=next;notify();}return project.settings;},
    get savedSettings(){return readChannelSettings(accepted);},setSavedSettings(value){const next=readChannelSettings(value);if(JSON.stringify(next)!==JSON.stringify(accepted)){accepted=next;notify();}return project.savedSettings;},
    get activeSoundPath(){return activeSound;},setActiveSoundPath(value){const next=soundPath(value,fs,savedFs);if(next!==activeSound){activeSound=next;notify();}return activeSound;},
    getPendingMoves:()=>clone(moves),setPendingMoves(value){const next=pendingPaths(value);if(JSON.stringify(next)!==JSON.stringify(moves)){moves=next;notify();}return clone(moves);},
    getDirtyPaths:()=>workspace.getDirtyPaths(),isFileModified:path=>workspace.isDirty(path),
    saveFiles(paths){validateMirror('saveMany',paths);workspace.saveMany(paths);return [...paths];},
    discardFiles(paths){validateMirror('discardMany',paths);workspace.discardMany(paths);return [...paths];},
    saveAll(){validateFiles(fs);const paths=workspace.getDirtyPaths();restoring=true;try{workspace.saveAll();moves=[];}finally{restoring=false;}notify();return paths;},
    listEntries(){
      entryCache??=fs.list().map(file=>({path:file.path,revision:file.revision,type:'file',fileType:file.type,size:file.type==='text'?new TextEncoder().encode(file.data).byteLength:file.data.byteLength}));
      return entryCache.map(entry=>({...entry}));
    },
    get selectedPath(){return selected;},get cassetteName(){return projectName;},
    select(path){const next=selectedPath(path,fs);if(next!==selected){selected=next;notify();}return selected;},
    writeEditorText(path,source){
      path=pathForUser(path);if(typeof source!=='string')throw TypeError('Editor content must be text.');
      if(!editorPath(path,fs)&&!(isSidCodePath(path)&&!fs.has(path)))throw Error('Choose a project text file.');
      const encoder=new TextEncoder();let total=encoder.encode(source).byteLength;
      if(isSidCodePath(path)&&total>MAX_TEXT)throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
      for(const file of project.listEntries())if(file.path!==path)total+=file.size;
      if(total>SID_PROJECT_FILE_BYTES)throw Error('Code project files exceed the 16 MiB cassette limit. Export selected files separately.');
      fs.writeText(path,source);
    },
    setCodeState(value){const next=codeState(value,fs);if(next.mode!==state.mode||next.path!==state.path){state=next;notify();}},getCodeState:()=>clone(state),
    ensureStarterFiles(){
      const occupied=(target,path)=>target.has(path)||target.listDirectories().includes(path);
      const missing=examples.filter(file=>!occupied(fs,file.path)&&!occupied(savedFs,file.path));
      if(!missing.length)return[];
      const candidate=createSidCodeProject({snapshot:project.snapshot()});
      const paths=candidate.importFiles(missing);candidate.saveFiles(paths);
      project.restore(candidate.snapshot());return paths;
    },
    prepareNew(){
      // Prepare defaults separately, using the original starter rather than edited Code.
      const fresh=createSidCodeProject({starterCode:getStarterCode?getStarterCode():starterCode??'',starterFiles});
      fresh.select('/index.js');fresh.setCodeState({mode:'keyboard',path:'/index.js'});
      fresh.setAutoApply(project.autoApply);
      return fresh.snapshot();
    },
    snapshot(){const layers=workspace.snapshot();return{format:SID_PROJECT_FORMAT,version:2,name:projectName,settings:project.settings,savedSettings:project.savedSettings,activeSoundPath:activeSound,pendingMoves:clone(moves),selectedPath:selected,codeState:clone(state),filesystem:layers.working,workspace:layers};},
    restore(value){
      if(value?.format!==SID_PROJECT_FORMAT||![1,2].includes(value.version))throw Error('Unsupported SID project format/version.');
      const candidate=createVirtualFileWorkspace();
      if(value.version===1){const legacy=createVirtualFileSystem();legacy.restore(value.filesystem);candidate.restore({version:1,working:legacy.snapshot(),saved:legacy.snapshot(),autoSave:true});}
      else{candidate.restore(value.workspace);if(value.filesystem!==undefined){const compatible=createVirtualFileSystem();compatible.restore(value.filesystem);if(!sameSnapshot(compatible.snapshot(),candidate.working.snapshot()))throw Error('Inconsistent SID working filesystem snapshot.');}}
      validateFiles(candidate.working);validateFiles(candidate.saved);
      const nextSettings=readChannelSettings(value.settings),nextAccepted=readChannelSettings(value.version===1?value.settings:value.savedSettings),nextActive=soundPath(value.activeSoundPath,candidate.working,candidate.saved),nextMoves=pendingPaths(value.pendingMoves??[]);
      const nextSelected=selectedPath(value.selectedPath,candidate.working),nextState=codeState(value.codeState,candidate.working),nextName=name(value.name);
      restoring=true;try{workspace.restore(candidate.snapshot());current=nextSettings;accepted=nextAccepted;activeSound=nextActive;moves=nextMoves;selected=nextSelected;state=nextState;projectName=nextName;}finally{restoring=false;}notify();return project.snapshot();
    },
    importFiles(entries){
      const candidate=createVirtualFileSystem();candidate.restore(fs.snapshot());
      const normalized=entries.map(entry=>({path:pathForUser(entry.path),type:entry.type??(isSidTextPath(entry.path)?'text':'binary'),data:entry.data}));
      for(const entry of normalized)if(entry.type==='text'&&typeof entry.data!=='string')entry.data=text(entry.data);
      candidate.writeFiles(normalized);validateFiles(candidate);fs.restore(candidate.snapshot());return normalized.map(entry=>entry.path);
    },
    async prepareImport(bytes,{isCurrent=()=>true}={}){
      const check=()=>{if(!isCurrent())throw new DOMException('SID import cancelled','AbortError');};check();
      const cassette=await loadPlaygroundCassette(bytes),files=[],manifest=cassette.files.get(SID_PROJECT_MANIFEST.slice(1));check();
      let metadata=null;if(manifest){try{metadata=JSON.parse(text(manifest));}catch{throw Error('Invalid SID project manifest JSON.');}}
      if(metadata&&(metadata.format!==SID_PROJECT_FORMAT||![1,2].includes(metadata.version)))throw Error('Unsupported SID project format/version.');
      if(metadata?.version===2){
        for(const [path,data]of cassette.files){if('/'+path!==SID_PROJECT_MANIFEST)files.push({path:'/'+path,type:'binary',data});}
        const layers=restoreDelta(files,cassette.directories,metadata.workingDelta),candidate=createSidCodeProject({settings:current});
        candidate.restore({...expandManifestSettings(metadata),workspace:layers,filesystem:layers.working});check();return candidate.snapshot();
      }
      for(const [path,data]of cassette.files){if('/'+path===SID_PROJECT_MANIFEST)continue;files.push({path:'/'+path,type:isSidTextPath(path)?'text':'binary',data:isSidTextPath(path)?text(data):data});}
      const candidate=createSidCodeProject({settings:current});candidate.fs.writeFiles(files);
      for(const directory of cassette.directories)if(directory!=='/')candidate.fs.mkdir(directory,{recursive:true});
      const next=metadata??{format:SID_PROJECT_FORMAT,version:1,name:projectName,settings:project.settings,selectedPath:null,codeState:{mode:'keyboard',path:null}};
      candidate.restore({...next,filesystem:candidate.fs.snapshot()});check();return candidate.snapshot();
    },
    exportProject(){
      validateFiles(fs);validateFiles(savedFs);const {filesystem,workspace:layers,...state}=project.snapshot();
      const manifest={...compactManifestSettings(state),workingDelta:workingDelta(workspace)};
      const metadata=JSON.stringify(manifest,null,2)+'\n';
      const total=new TextEncoder().encode(metadata).byteLength+savedFs.list().reduce((bytes,file)=>bytes+(file.type==='text'?new TextEncoder().encode(file.data).byteLength:file.data.byteLength),0);
      if(total>16*1024*1024)throw Error('Code project exceeds the 16 MiB expanded cassette limit. Export selected files separately.');
      return createPlaygroundCassetteZip([...savedFs.list(),{path:SID_PROJECT_MANIFEST,type:'text',data:metadata}],{directories:savedFs.listDirectories(),preserveMetadataFiles:true});
    },
    recoverCode(path,{source,savedSource,autoSave}){
      path=canonicalPath(path);if(!isSidTextPath(path)||typeof source!=='string'||savedSource!==null&&typeof savedSource!=='string'||typeof autoSave!=='boolean')throw Error('Invalid SID Code recovery versions.');
      const working=createVirtualFileSystem(),saved=createVirtualFileSystem();working.restore(fs.snapshot());saved.restore(savedFs.snapshot());working.writeText(path,source);
      if(savedSource===null){if(saved.has(path))saved.remove(path);}else saved.writeText(path,savedSource);
      const candidate=createVirtualFileWorkspace();candidate.restore({version:1,working:working.snapshot(),saved:saved.snapshot(),autoSave});validateFiles(candidate.working);validateFiles(candidate.saved);workspace.restore(candidate.snapshot());
    },
  };
  Object.assign(project,createSynthCodeProject(project));
  const savedCode=createSynthCodeProject(project,{version:'saved'});project.readSavedFile=savedCode.readFile;project.prepareSavedSource=savedCode.prepareSource;
  if(starterCode===undefined&&!snapshot&&getStarterCode)starterCode=getStarterCode();
  if(starterCode!==undefined){if(typeof starterCode!=='string')throw TypeError('Starter code must be text.');fs.writeText('/index.js',starterCode);}
  if(snapshot)project.restore(snapshot);
  else project.ensureStarterFiles();
  return project;
}

function storageJson(snapshot){return JSON.stringify(snapshot,(_key,value)=>value instanceof Uint8Array?{$sidBytes:Array.from(value)}:value);}
function storageParse(source){return JSON.parse(source,(_key,value)=>value&&Array.isArray(value.$sidBytes)?Uint8Array.from(value.$sidBytes):value);}
export function createSidProjectStore({indexedDB=globalThis.indexedDB,storage=globalThis.localStorage}={}){
  return createSynthProjectStore({indexedDB,name:'tetorica-sid-synth-files',
    readFallback(){const source=storage?.getItem(SID_PROJECT_STORAGE_KEY);return source?storageParse(source):null;},
    writeFallback(snapshot){if(!storage)return false;storage.setItem(SID_PROJECT_STORAGE_KEY,storageJson(snapshot));return true;},
  });
}
