// Game Boy Code project data. Restoring Files never creates audio or runs Code.
import {createVirtualFileSystem,isCheckpointPath} from '../js/tetorica_virtual_files/filesystem.js';
import {createVirtualFileWorkspace} from '../js/tetorica_virtual_files/workspace.js';
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/path.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {createSynthCodeProject} from '../synth/synth_code_project.js?v=huc-working-saved-1';
import {createSynthProjectStore} from '../synth/synth_project_store.js?v=draft-reconnect-1';
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
  if(!value||!['keyboard','code'].includes(value.mode)||value.path!==null&&!editorPath(value.path,fs))throw Error('Invalid DMG Code selection.');
  return{mode:value.mode,path:value.path};
}
function selectedPath(value,fs){if(value===null||value===undefined)return null;const path=normalizeVirtualPath(value);if(!fs.stat(path))throw Error('Selected project file is missing.');return path;}
const isManifestPath=path=>path===GAMEBOY_PROJECT_MANIFEST||path.startsWith(GAMEBOY_PROJECT_MANIFEST+'/');
function pathForUser(path){path=normalizeVirtualPath(path);if(path==='/'||isManifestPath(path)||isCheckpointPath(path))throw Error('That project path is reserved.');return path;}
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
  for(const directory of fs.listDirectories())if(isManifestPath(directory))throw Error('DMG project manifest is reserved.');
  for(const file of fs.list()){
    const bytes=file.type==='text'?new TextEncoder().encode(file.data).byteLength:file.data.byteLength;total+=bytes;
    if(isCheckpointPath(file.path))continue;
    if(isManifestPath(file.path))throw Error('DMG project manifest is reserved.');
    if(isGameboySongPath(file.path)&&file.type!=='binary')throw Error('VGM / VGZ reference songs must keep their original binary bytes.');
    if(isGameboyCodePath(file.path)&&(file.type!=='text'||bytes>MAX_TEXT))throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
  }
  if(total>GAMEBOY_PROJECT_FILE_BYTES)throw Error('Code project files exceed the 16 MiB cassette limit. Use Save preset for a larger audio instrument.');
}

const METADATA_PATHS=new Set(['/metadata.json','/cassette.metadata.js']);
const sameFile=(a,b)=>Boolean(a&&b&&a.type===b.type&&(typeof a.data==='string'?a.data===b.data:a.data.length===b.data.length&&a.data.every((value,index)=>value===b.data[index])));
const sameSnapshot=(a,b)=>a.files.length===b.files.length&&JSON.stringify([...a.directories].sort())===JSON.stringify([...b.directories].sort())&&a.files.every(file=>sameFile(file,b.files.find(other=>other.path===file.path)));
function canonicalDataPath(value){if(typeof value!=='string'||normalizeVirtualPath(value)!==value||value==='/'||isManifestPath(value))throw Error('Invalid DMG recovery path.');return value;}
function canonicalPath(value){return pathForUser(canonicalDataPath(value));}
function encodeFile(file){
  if(file.type==='text')return{path:file.path,type:'text',data:file.data};
  let source='';for(let offset=0;offset<file.data.length;offset+=32768)source+=String.fromCharCode(...file.data.subarray(offset,offset+32768));
  return{path:file.path,type:'binary',data:btoa(source)};
}
function decodeFile(file){
  if(!file||!['text','binary'].includes(file.type)||typeof file.data!=='string')throw Error('Invalid DMG working file.');
  const path=canonicalDataPath(file.path);
  if(file.type==='text')return{path,type:'text',data:file.data};
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data))throw Error('Invalid DMG working binary encoding.');
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
    !delta.directories||!Array.isArray(delta.directories.created)||!Array.isArray(delta.directories.deleted))throw Error('Invalid DMG working recovery state.');
  const metadataPaths=new Set(delta.metadataPaths);
  if(metadataPaths.size!==delta.metadataPaths.length||[...metadataPaths].some(path=>!METADATA_PATHS.has(path)))throw Error('Invalid DMG metadata recovery paths.');
  const savedFiles=entries.filter(file=>!METADATA_PATHS.has(file.path)||metadataPaths.has(file.path));
  for(const path of metadataPaths)if(!savedFiles.some(file=>file.path===path))throw Error('Missing DMG original metadata file.');
  const textPaths=new Set(delta.savedTextPaths);
  if(textPaths.size!==delta.savedTextPaths.length)throw Error('Duplicate DMG saved text path.');
  for(const path of textPaths){canonicalDataPath(path);const file=savedFiles.find(file=>file.path===path);if(!file)throw Error('Missing DMG saved text file.');file.type='text';file.data=text(file.data);}
  const saved=createVirtualFileSystem();saved.replace(savedFiles,directories);
  const files=new Map(saved.list().map(file=>[file.path,file])),seen=new Set();
  for(const path of delta.deleted){canonicalDataPath(path);if(seen.has(path)||!files.has(path))throw Error('Invalid DMG working deletion.');seen.add(path);files.delete(path);}
  for(const file of delta.files.map(decodeFile)){if(seen.has(file.path))throw Error('Duplicate DMG working path.');seen.add(file.path);files.set(file.path,file);}
  const dirs=new Set(saved.listDirectories()),seenDirs=new Set();
  for(const path of delta.directories.deleted){canonicalDataPath(path);if(seenDirs.has(path)||!dirs.has(path))throw Error('Invalid DMG working folder deletion.');seenDirs.add(path);dirs.delete(path);}
  for(const path of delta.directories.created){canonicalDataPath(path);if(seenDirs.has(path)||dirs.has(path))throw Error('Invalid DMG working folder creation.');seenDirs.add(path);dirs.add(path);}
  const working=createVirtualFileSystem();working.replace([...files.values()],[...dirs]);
  return{version:1,working:working.snapshot(),saved:saved.snapshot(),autoSave:delta.autoSave};
}
function soundPath(value,working,saved){
  if(value==null)return null;const path=canonicalPath(value),file=working.get(path)??saved.get(path);
  if(file?.type!=='text'||!isGameboyTextPath(path))throw Error('Active DMG sound document is missing or not text.');return path;
}
function pendingPaths(value){
  if(!Array.isArray(value))throw Error('Invalid DMG pending moves.');
  const sources=new Set(),targets=new Set();
  return value.map(pair=>{if(!Array.isArray(pair)||pair.length!==2)throw Error('Invalid DMG pending move.');const [source,target]=pair.map(canonicalPath);
    if(source===target||sources.has(source)||targets.has(target))throw Error('Duplicate DMG pending move.');sources.add(source);targets.add(target);return[source,target];});
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
    if(value.savedSettingsSource!=='settings'||value.savedSettings!==undefined)throw Error('Invalid DMG accepted-settings alias.');
    result.savedSettings=readPreset(value.settings);
  }
  return result;
}
export function createGameboyCodeProject({settings=createDefaultPreset(),snapshot,starterCode,getStarterCode,starterFiles={}}={}){
  const examples=Object.entries(starterFiles).map(([path,data])=>{
    path=pathForUser(path);if(!isGameboyCodePath(path)||typeof data!=='string')throw TypeError('Starter examples must be JavaScript text files.');
    return{path,type:'text',data};
  });
  const workspace=createVirtualFileWorkspace(),fs=workspace.working,savedFs=workspace.saved,listeners=new Set();let entryCache=null;
  let current=readPreset(settings),accepted=readPreset(settings),activeSound=null,moves=[],selected=null,state={mode:'keyboard',path:null},projectName='Tetorica DMG',restoring=false;
  const notify=()=>{if(!restoring)for(const listener of listeners)listener();};
  workspace.onDidChange(()=>{entryCache=null;notify();});
  // Partial acceptance can combine a large old file and a large new file even
  // when each complete version fits. Validate that result before publishing.
  const validateMirror=(method,paths)=>{const candidate=createVirtualFileWorkspace();candidate.restore(workspace.snapshot());candidate[method](paths);validateFiles(candidate.working);validateFiles(candidate.saved);};
  const project={fs,savedFs,workspace,onDidChange(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    get autoApply(){return workspace.autoSave;},
    setAutoApply(enabled){if(enabled)validateFiles(fs);restoring=true;try{workspace.setAutoSave(enabled);if(enabled)moves=[];}finally{restoring=false;}notify();return workspace.autoSave;},
    get settings(){return readPreset(current);},setSettings(value){const next=readPreset(value);if(JSON.stringify(next)!==JSON.stringify(current)){current=next;notify();}return project.settings;},
    get savedSettings(){return readPreset(accepted);},setSavedSettings(value){const next=readPreset(value);if(JSON.stringify(next)!==JSON.stringify(accepted)){accepted=next;notify();}return project.savedSettings;},
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
      if(!editorPath(path,fs)&&!(isGameboyCodePath(path)&&!fs.has(path)))throw Error('Choose a project text file.');
      const encoder=new TextEncoder();let total=encoder.encode(source).byteLength;
      if(isGameboyCodePath(path)&&total>MAX_TEXT)throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
      for(const file of project.listEntries())if(file.path!==path)total+=file.size;
      if(total>GAMEBOY_PROJECT_FILE_BYTES)throw Error('Code project files exceed the 16 MiB cassette limit. Use Save preset for a larger audio instrument.');
      fs.writeText(path,source);
    },
    setCodeState(value){const next=codeState(value,fs);if(next.mode!==state.mode||next.path!==state.path){state=next;notify();}},getCodeState:()=>clone(state),
    ensureStarterFiles(){
      const occupied=(target,path)=>target.has(path)||target.listDirectories().includes(path);
      const missing=examples.filter(file=>!occupied(fs,file.path)&&!occupied(savedFs,file.path));
      if(!missing.length)return[];
      const candidate=createGameboyCodeProject({snapshot:project.snapshot()});
      const paths=candidate.importFiles(missing);candidate.saveFiles(paths);
      project.restore(candidate.snapshot());return paths;
    },
    prepareNew(){
      // Prepare defaults separately, using the original starter rather than edited Code.
      const fresh=createGameboyCodeProject({starterCode:getStarterCode?getStarterCode():starterCode??'',starterFiles});
      fresh.select('/index.js');fresh.setCodeState({mode:'keyboard',path:'/index.js'});
      fresh.setAutoApply(project.autoApply);
      return fresh.snapshot();
    },
    snapshot(){const layers=workspace.snapshot();return{format:GAMEBOY_PROJECT_FORMAT,version:2,name:projectName,settings:project.settings,savedSettings:project.savedSettings,activeSoundPath:activeSound,pendingMoves:clone(moves),selectedPath:selected,codeState:clone(state),filesystem:layers.working,workspace:layers};},
    restore(value){
      if(value?.format!==GAMEBOY_PROJECT_FORMAT||![1,2].includes(value.version))throw Error('Unsupported DMG project format/version.');
      const candidate=createVirtualFileWorkspace();
      if(value.version===1){const legacy=createVirtualFileSystem();legacy.restore(value.filesystem);candidate.restore({version:1,working:legacy.snapshot(),saved:legacy.snapshot(),autoSave:true});}
      else{candidate.restore(value.workspace);if(value.filesystem!==undefined){const compatible=createVirtualFileSystem();compatible.restore(value.filesystem);if(!sameSnapshot(compatible.snapshot(),candidate.working.snapshot()))throw Error('Inconsistent DMG working filesystem snapshot.');}}
      validateFiles(candidate.working);validateFiles(candidate.saved);
      const nextSettings=readPreset(value.settings),nextAccepted=readPreset(value.version===1?value.settings:value.savedSettings),nextActive=soundPath(value.activeSoundPath,candidate.working,candidate.saved),nextMoves=pendingPaths(value.pendingMoves??[]);
      const nextSelected=selectedPath(value.selectedPath,candidate.working),nextState=codeState(value.codeState,candidate.working),nextName=name(value.name);
      restoring=true;try{workspace.restore(candidate.snapshot());current=nextSettings;accepted=nextAccepted;activeSound=nextActive;moves=nextMoves;selected=nextSelected;state=nextState;projectName=nextName;}finally{restoring=false;}notify();return project.snapshot();
    },
    importFiles(entries){
      const candidate=createVirtualFileSystem();candidate.restore(fs.snapshot());
      const normalized=entries.map(entry=>({path:pathForUser(entry.path),type:entry.type??(isGameboyTextPath(entry.path)?'text':'binary'),data:entry.data}));
      for(const entry of normalized)if(entry.type==='text'&&typeof entry.data!=='string')entry.data=text(entry.data);
      candidate.writeFiles(normalized);validateFiles(candidate);fs.restore(candidate.snapshot());return normalized.map(entry=>entry.path);
    },
    async prepareImport(bytes,{isCurrent=()=>true}={}){
      const check=()=>{if(!isCurrent())throw new DOMException('DMG import cancelled','AbortError');};check();
      const cassette=await loadPlaygroundCassette(bytes),files=[],manifest=cassette.files.get(GAMEBOY_PROJECT_MANIFEST.slice(1));check();
      let metadata=null;if(manifest){try{metadata=JSON.parse(text(manifest));}catch{throw Error('Invalid DMG project manifest JSON.');}}
      if(metadata&&(metadata.format!==GAMEBOY_PROJECT_FORMAT||![1,2].includes(metadata.version)))throw Error('Unsupported DMG project format/version.');
      if(metadata?.version===2){
        for(const [path,data]of cassette.files){if('/'+path!==GAMEBOY_PROJECT_MANIFEST)files.push({path:'/'+path,type:'binary',data});}
        const layers=restoreDelta(files,cassette.directories,metadata.workingDelta),candidate=createGameboyCodeProject({settings:current});
        candidate.restore({...expandManifestSettings(metadata),workspace:layers,filesystem:layers.working});check();return candidate.snapshot();
      }
      for(const [path,data]of cassette.files){if('/'+path===GAMEBOY_PROJECT_MANIFEST)continue;files.push({path:'/'+path,type:isGameboyTextPath(path)?'text':'binary',data:isGameboyTextPath(path)?text(data):data});}
      const candidate=createGameboyCodeProject({settings:current});candidate.fs.writeFiles(files);
      for(const directory of cassette.directories)if(directory!=='/')candidate.fs.mkdir(directory,{recursive:true});
      const next=metadata??{format:GAMEBOY_PROJECT_FORMAT,version:1,name:projectName,settings:project.settings,selectedPath:null,codeState:{mode:'keyboard',path:null}};
      candidate.restore({...next,filesystem:candidate.fs.snapshot()});check();return candidate.snapshot();
    },
    exportProject(){
      validateFiles(fs);validateFiles(savedFs);const {filesystem,workspace:layers,...state}=project.snapshot();
      const manifest={...compactManifestSettings(state),workingDelta:workingDelta(workspace)};
      const metadata=JSON.stringify(manifest,null,2)+'\n';
      const total=new TextEncoder().encode(metadata).byteLength+savedFs.list().reduce((bytes,file)=>bytes+(file.type==='text'?new TextEncoder().encode(file.data).byteLength:file.data.byteLength),0);
      if(total>16*1024*1024)throw Error('Code project exceeds the 16 MiB expanded cassette limit. Use Save preset for a larger audio instrument.');
      return createPlaygroundCassetteZip([...savedFs.list(),{path:GAMEBOY_PROJECT_MANIFEST,type:'text',data:metadata}],{directories:savedFs.listDirectories(),preserveMetadataFiles:true});
    },
    recoverCode(path,{source,savedSource,autoSave}){
      path=canonicalPath(path);if(!isGameboyTextPath(path)||typeof source!=='string'||savedSource!==null&&typeof savedSource!=='string'||typeof autoSave!=='boolean')throw Error('Invalid DMG Code recovery versions.');
      const working=createVirtualFileSystem(),saved=createVirtualFileSystem();working.restore(fs.snapshot());saved.restore(savedFs.snapshot());working.writeText(path,source);
      if(savedSource===null){if(saved.has(path))saved.remove(path);}else saved.writeText(path,savedSource);
      const candidate=createVirtualFileWorkspace();candidate.restore({version:1,working:working.snapshot(),saved:saved.snapshot(),autoSave});validateFiles(candidate.working);validateFiles(candidate.saved);workspace.restore(candidate.snapshot());
    },
  };
  project.importSongSources=sources=>project.importFiles(gameboySongSourceEntries(project,sources));
  Object.assign(project,createSynthCodeProject(project));
  const savedCode=createSynthCodeProject(project,{version:'saved'});project.readSavedFile=savedCode.readFile;project.prepareSavedSource=savedCode.prepareSource;
  if(starterCode===undefined&&!snapshot&&getStarterCode)starterCode=getStarterCode();
  if(starterCode!==undefined){if(typeof starterCode!=='string')throw TypeError('Starter code must be text.');fs.writeText('/index.js',starterCode);}
  if(snapshot)project.restore(snapshot);
  else project.ensureStarterFiles();
  return project;
}

function storageJson(snapshot){return JSON.stringify(snapshot,(_key,value)=>value instanceof Uint8Array?{$dmgBytes:Array.from(value)}:value);}
function storageParse(source){return JSON.parse(source,(_key,value)=>value&&Array.isArray(value.$dmgBytes)?Uint8Array.from(value.$dmgBytes):value);}
export function createGameboyProjectStore({indexedDB=globalThis.indexedDB,storage=globalThis.localStorage}={}){
  return createSynthProjectStore({indexedDB,name:'tetorica-dmg-synth-files',
    readFallback(){const source=storage?.getItem(GAMEBOY_PROJECT_STORAGE_KEY);return source?storageParse(source):null;},
    writeFallback(snapshot){if(!storage)return false;storage.setItem(GAMEBOY_PROJECT_STORAGE_KEY,storageJson(snapshot));return true;},
  });
}
