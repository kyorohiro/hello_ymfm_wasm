import {
  createVirtualFileSystem,
  transferVirtualFiles,
  isCheckpointPath,
  CHECKPOINT_ROOT,
} from '../js/tetorica_virtual_files/filesystem.js?v=working-saved-1';
import {createVirtualFileWorkspace} from '../js/tetorica_virtual_files/workspace.js?v=working-saved-1';
import { resolvePath, dirname } from '../js/tetorica_virtual_files/path.js';
import {
  createPlaygroundCassetteZip,
  loadPlaygroundCassette,
} from '../playground/playground_cassette.js';
import { parseTfi, createTfiFromPreset } from '../js/tfi.js';
import { parseVgi, createVgiFromPreset } from '../js/vgi.js';
import { readPresetImport } from './synth_preset_import.js?v=vgm-storage-1';
import {isPsgPreset,isPsgPresetPath,normalizePsgPreset,parsePsgPreset,serializePsgPreset} from './synth_psg_preset.js?v=psg-envelope-1';
export {isPsgPresetPath} from './synth_psg_preset.js?v=psg-envelope-1';
import {isPcmPreset,isPcmPresetPath,normalizePcmPreset,parsePcmPreset,serializePcmPreset} from './synth_pcm.js?v=pcm-live-draw-1';
export {isPcmPresetPath} from './synth_pcm.js?v=pcm-live-draw-1';

const TONE_EXTENSION = /\.(tfi|vgi|psg\.json|pcm\.json)$/i;
const METADATA_PATHS = new Set(['/metadata.json', '/cassette.metadata.js']);
const comparePaths = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const SYNTH_STATE_KIND = 'tetorica-fm2612-synth';
const jsonKind=path=>isPcmPresetPath(path)?'pcm':isPsgPresetPath(path)?'psg':null;
const isJsonTonePath=path=>jsonKind(path)!==null;
const parseJsonTone=(path,data)=>isPcmPresetPath(path)?parsePcmPreset(data):parsePsgPreset(data);
const serializeJsonTone=(path,preset)=>isPcmPresetPath(path)?serializePcmPreset(preset):serializePsgPreset(preset);

export const synthStatePath = path => resolvePath(path) + '.synth.json';
export const isSynthStatePath = path => /\.(?:tfi|vgi)\.synth\.json$/i.test(String(path));

function range(name,value,maximum) {
  if(!Number.isInteger(value)||value<0||value>maximum)throw Error(`${name} must be an integer in range 0..${maximum}`);
  return value;
}
function boolean(name,value) {if(typeof value!=='boolean')throw Error(`${name} must be a boolean`);return value;}
function capturedVoiceState(value) {
  const keyMask=range('capturedVoice.keyMask',value.keyMask,15);
  const specialMode=boolean('capturedVoice.specialMode',value.specialMode);
  if(!Array.isArray(value.specialFrequencies)||value.specialFrequencies.length!==(specialMode?4:0))throw Error('Invalid capturedVoice special frequencies');
  const specialFrequencies=value.specialFrequencies.map(pitch=>({block:range('capturedVoice.block',pitch.block,7),fnum:range('capturedVoice.fnum',pitch.fnum,2047)}));
  if(specialMode&&!specialFrequencies[3].fnum)throw Error('Captured CH3 requires an OP4 base pitch');
  return {keyMask,specialMode,specialFrequencies};
}
function extraState(preset,format) {
  const operators=preset.operators??{},offset=operators[0]===undefined?1:0;
  const state={version:1,kind:SYNTH_STATE_KIND,
    lfo:{enabled:boolean('lfo.enabled',preset.lfo?.enabled??false),frequency:range('lfo.frequency',preset.lfo?.frequency??0,7)},
    operatorAM:[0,1,2,3].map(index=>boolean('operator AM',operators[index+offset]?.am??false)),
  };
  if(preset.capturedVoice!==undefined)state.capturedVoice=capturedVoiceState(preset.capturedVoice);
  if(format==='tfi'){
    state.pan={left:boolean('pan.left',preset.pan?.left??true),right:boolean('pan.right',preset.pan?.right??true)};
    state.ams=range('ams',preset.ams??0,3);state.pms=range('pms',preset.pms??0,7);
    state.b4=(range('b4',preset.b4??0,255)&8)|(state.pan.left?128:0)|(state.pan.right?64:0)|(state.ams<<4)|state.pms;
  }
  return state;
}
function stateText(preset,format) {return JSON.stringify(extraState(preset,format),null,2)+'\n';}
function parseState(data,format) {
  let state;
  try{state=JSON.parse(typeof data==='string'?data:new TextDecoder('utf-8',{fatal:true}).decode(data));}
  catch(error){throw Error(`Invalid Synth state: ${error.message}`);}
  if(state?.version!==1||state.kind!==SYNTH_STATE_KIND||!state.lfo||!Array.isArray(state.operatorAM)||state.operatorAM.length!==4)throw Error('Unsupported Synth state format');
  const preset={lfo:state.lfo,operators:Object.fromEntries(state.operatorAM.map((am,index)=>[index+1,{am}]))};
  if(state.capturedVoice!==undefined)preset.capturedVoice=capturedVoiceState(state.capturedVoice);
  if(format==='tfi'){
    if(!state.pan||state.b4===undefined||state.ams===undefined||state.pms===undefined)throw Error('TFI Synth state must include pan, B4, AMS and PMS');
    Object.assign(preset,{pan:state.pan,b4:state.b4,ams:state.ams,pms:state.pms});
  }
  return extraState(preset,format);
}
function mergeState(preset,state) {
  const merged=structuredClone(preset);
  merged.lfo={...state.lfo};
  if(state.capturedVoice)merged.capturedVoice=structuredClone(state.capturedVoice);
  for(let op=1;op<=4;op++)merged.operators[op]={...merged.operators[op],am:state.operatorAM[op-1]};
  if(state.pan)Object.assign(merged,{pan:{...state.pan},b4:state.b4,ams:state.ams,pms:state.pms});
  return merged;
}
function validateToneStates(files) {
  const entries=new Map(files.map(file=>[resolvePath(file.path),file]));
  for(const [path,file] of entries){
    // PSG / PCM are complete JSON documents. Their optional checkpoint is the same
    // format, never an FM sidecar, and must also validate before replacement.
    if(isCheckpointPath(path))continue;
    if(isSynthTonePath(path)&&isJsonTonePath(path)){parseJsonTone(path,file.data);continue;}
    if(!isSynthTonePath(path))continue;
    const bytes=file.data;
    const format=bytes.byteLength===43?'vgi':'tfi';
    if(format==='vgi')parseVgi(bytes);else parseTfi(bytes);
    const state=entries.get(synthStatePath(path));
    if(state)parseState(state.data,format);
  }
}

export function isSynthTonePath(path) {
  path = String(path);
  // Git refs/objects are opaque project data even when a branch or object
  // happens to end in an instrument extension.
  return !path.split('/').includes('.git') && !isCheckpointPath(path) && TONE_EXTENSION.test(path);
}
export const isPsgTonePath=path=>isSynthTonePath(path)&&isPsgPresetPath(path);
export const isPcmTonePath=path=>isSynthTonePath(path)&&isPcmPresetPath(path);

/** Includes compound JSON extensions so file-tree suffixes keep their type. */
export const synthToneExtension=path=>String(path).match(TONE_EXTENSION)?.[0]??null;

function safeName(name, fallback = 'tone') {
  return String(name).replace(/[\\/\x00-\x1f:*?"<>|]/g, '_')
    .replace(/[. ]+$/g, '').trim() || fallback;
}

const WORKING_METADATA_KEY='tetoricaWorkingState';
const sameFile=(a,b)=>Boolean(a&&b&&a.type===b.type&&(typeof a.data==='string'?a.data===b.data:a.data.length===b.data.length&&a.data.every((value,index)=>value===b.data[index])));
function encodeFile(file){
  if(file.type==='text')return{path:file.path,type:'text',data:file.data};
  let text='';for(let start=0;start<file.data.length;start+=32768)text+=String.fromCharCode(...file.data.subarray(start,start+32768));
  return{path:file.path,type:'binary',data:btoa(text)};
}
function decodeFile(file){
  if(!file||typeof file.path!=='string'||resolvePath(file.path)!==file.path||!['text','binary'].includes(file.type)||typeof file.data!=='string')throw Error('Invalid Cassette working file.');
  if(file.type==='text')return{path:file.path,type:'text',data:file.data};
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data))throw Error('Invalid Cassette working binary encoding.');
  return{path:file.path,type:'binary',data:Uint8Array.from(atob(file.data),char=>char.charCodeAt(0))};
}
function workingDelta(workspace,pendingMoves){
  const state=workspace.snapshot(),saved=new Map(state.saved.files.map(file=>[file.path,file])),working=new Map(state.working.files.map(file=>[file.path,file]));
  return{version:1,autoSave:state.autoSave,files:state.working.files.filter(file=>!sameFile(file,saved.get(file.path))).map(encodeFile),
    deleted:state.saved.files.filter(file=>!working.has(file.path)).map(file=>file.path),
    directories:{created:state.working.directories.filter(path=>!state.saved.directories.includes(path)),deleted:state.saved.directories.filter(path=>!state.working.directories.includes(path))},
    metadataFiles:state.saved.files.filter(file=>METADATA_PATHS.has(file.path)).map(encodeFile),textPaths:state.saved.files.filter(file=>file.type==='text').map(file=>file.path),pendingMoves:[...pendingMoves]};
}
function applyWorkingDelta(files,directories,delta){
  if(!delta||delta.version!==1||typeof delta.autoSave!=='boolean'||!Array.isArray(delta.files)||!Array.isArray(delta.deleted)||!Array.isArray(delta.metadataFiles)||
    !delta.directories||!Array.isArray(delta.directories.created)||!Array.isArray(delta.directories.deleted))throw Error('Unsupported Cassette working state.');
  const originalMetadata=delta.metadataFiles.map(decodeFile);
  if(originalMetadata.some(file=>!METADATA_PATHS.has(file.path)))throw Error('Invalid original Cassette metadata path.');
  const textPaths=delta.textPaths??[];
  if(!Array.isArray(textPaths)||new Set(textPaths).size!==textPaths.length||textPaths.some(path=>typeof path!=='string'||resolvePath(path)!==path))throw Error('Invalid saved Cassette text paths.');
  const savedFiles=[...files.filter(file=>!METADATA_PATHS.has(file.path)),...originalMetadata];
  for(const path of textPaths){const file=savedFiles.find(file=>file.path===path);if(!file)throw Error('Missing saved Cassette text file.');if(typeof file.data!=='string'){file.data=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(file.data);file.type='text';}}
  const saved=createVirtualFileSystem();saved.replace(savedFiles,directories);
  const workingFiles=new Map(saved.list().map(file=>[file.path,file])),seen=new Set();
  for(const path of delta.deleted){if(typeof path!=='string'||resolvePath(path)!==path||seen.has(path))throw Error('Invalid Cassette working deletion.');seen.add(path);workingFiles.delete(path);}
  for(const file of delta.files.map(decodeFile)){if(seen.has(file.path))throw Error('Duplicate Cassette working path.');seen.add(file.path);workingFiles.set(file.path,file);}
  const dirs=new Set(saved.listDirectories());
  for(const path of delta.directories.deleted){if(typeof path!=='string'||resolvePath(path)!==path||path==='/')throw Error('Invalid Cassette working folder deletion.');dirs.delete(path);}
  for(const path of delta.directories.created){if(typeof path!=='string'||resolvePath(path)!==path)throw Error('Invalid Cassette working folder.');dirs.add(path);}
  const working=createVirtualFileSystem();working.replace([...workingFiles.values()],[...dirs]);
  return{version:1,working:working.snapshot(),saved:saved.snapshot(),autoSave:delta.autoSave};
}

function fileBytes(file) {
  if (file instanceof Uint8Array) return new Uint8Array(file);
  if (file instanceof ArrayBuffer) return new Uint8Array(file.slice(0));
  throw new TypeError('Instrument data must be an ArrayBuffer or Uint8Array.');
}

/**
 * Synth's editable project uses the same virtual filesystem and Cassette ZIP
 * codec as FM Playground. Unknown files, empty directories and .git stay in
 * the project without interpretation. Reading an instrument never rewrites it.
 *
 * @param {{snapshot?: object}} [options]
 */
export function createSynthProject({ snapshot: initialSnapshot } = {}) {
  const workspace=createVirtualFileWorkspace();
  const fs=workspace.working,savedFs=workspace.saved;
  const listeners = new Set();
  let selectedPath = null;
  let cassetteName = 'cassette';
  let cassetteMetadata = null;
  let importSequence = 0;
  let mutationDepth = 0;
  let pendingChange = false;
  const pendingMoves=new Map();

  const exists = path => fs.has(path) || fs.listDirectories().includes(path);
  function emitChange() {
    if (selectedPath && !exists(selectedPath)) selectedPath = null;
    for (const listener of listeners) listener(project);
  }
  function changed() {
    if (mutationDepth) pendingChange = true;
    else emitChange();
  }
  function mutate(callback) {
    mutationDepth++;
    try { return callback(); }
    finally {
      mutationDepth--;
      if (!mutationDepth && pendingChange) {
        pendingChange = false;
        emitChange();
      }
    }
  }
  workspace.onDidChange(changed);

  function uniquePath(path, occupied = new Set(project.listEntries().map(entry => entry.path))) {
    path = resolvePath(path);
    const baseName = path.slice(path.lastIndexOf('/') + 1);
    const extensionAt = baseName.lastIndexOf('.');
    const extension = synthToneExtension(baseName)??(extensionAt > 0 ? baseName.slice(extensionAt) : '');
    const stem = extension ? path.slice(0, -extension.length) : path;
    let candidate = path, suffix = 2;
    while (occupied.has(candidate)) candidate = `${stem}-${suffix++}${extension}`;
    return candidate;
  }
  function transferTone(path,destination,copy) {
    const pairs=[[path,destination]];
    if(fs.has(path)&&isSynthTonePath(path)&&isSynthTonePath(destination)&&jsonKind(path)!==jsonKind(destination))throw Error('Keep the instrument type when moving an FM, PSG or PCM preset.');
    if(fs.has(path)&&isSynthTonePath(path)&&!isJsonTonePath(path)){
      const state=synthStatePath(path),target=synthStatePath(destination);
      if(exists(target)||exists(CHECKPOINT_ROOT+target))throw Error(`Synth state destination already exists: ${target}`);
      if(fs.has(state))pairs.push([state,target]);
      else if(fs.listDirectories().includes(state))throw Error(`Synth state path is a folder: ${state}`);
    }
    // Preview path conflicts using metadata only, never copying sample/pack bytes.
    const preview=createVirtualFileSystem();
    preview.replace(project.listEntries().filter(entry=>entry.type==='file').map(entry=>({path:entry.path,data:''})),fs.listDirectories());
    for(const [source,target] of pairs)transferVirtualFiles(preview,source,target,{copy});
    for(const [source,target] of pairs)transferVirtualFiles(fs,source,target,{copy});
    if(!copy)for(const [source,target]of pairs){
      const inside=(path,root)=>path===root||path.startsWith(root+'/');
      for(const [original,current]of [...pendingMoves])if(inside(current,source))pendingMoves.set(original,target+current.slice(source.length));
      for(const file of savedFs.list())if(inside(file.path,source)&&!pendingMoves.has(file.path)&&workspace.isDirty(file.path))pendingMoves.set(file.path,target+file.path.slice(source.length));
    }
  }

  const toneFiles=path=>{path=resolvePath(path);if(isSynthStatePath(path))path=path.slice(0,-'.synth.json'.length);return isSynthTonePath(path)&&!isJsonTonePath(path)?[path,synthStatePath(path)].filter(value=>fs.has(value)||savedFs.has(value)):[path];};
  function expandFiles(paths){
    const targets=new Set(paths.flatMap(toneFiles));
    for(const [source,target]of pendingMoves)if([...targets].some(path=>source===path||target===path||source.startsWith(path+'/')||target.startsWith(path+'/'))){
      for(const path of [...toneFiles(source),...toneFiles(target)])targets.add(path);
    }
    return [...targets];
  }
  function clearMoves(paths){for(const [source,target]of pendingMoves)if(paths.some(path=>source===path||target===path||source.startsWith(path+'/')||target.startsWith(path+'/')))pendingMoves.delete(source);}
  const project = {
    fs,savedFs,workspace,
    get autoApply(){return workspace.autoSave;},
    setAutoApply(enabled){mutate(()=>{workspace.setAutoSave(enabled);if(enabled)pendingMoves.clear();});return workspace.autoSave;},
    saveFiles(paths){
      const targets=expandFiles(paths);for(const path of targets)if(isSynthTonePath(path)&&fs.has(path))project.readTone(path);
      mutate(()=>{workspace.saveMany(targets);clearMoves(targets);});return targets;
    },
    discardFiles(paths){
      const targets=expandFiles(paths);for(const path of targets)if(isSynthTonePath(path)&&savedFs.has(path))project.readTone(path,{version:'saved'});
      mutate(()=>{workspace.discardMany(targets);clearMoves(targets);});return targets;
    },
    saveAll(){const paths=workspace.getDirtyPaths();validateToneStates(fs.snapshot().files);mutate(()=>{workspace.saveAll();pendingMoves.clear();});return paths;},
    isFileModified:path=>isSynthTonePath(path)?project.isToneModified(path):workspace.isDirty(path),
    getDirtyPaths:()=>workspace.getDirtyPaths(),
    getSavedPath(path){return [...pendingMoves].find(([,current])=>current===path)?.[0]??path;},
    recoverCode(path,{source,savedSource,autoSave}){
      path=resolvePath(path);if(path==='/'||path.split('/').some(part=>part==='.git'||part==='.tet.ss')||typeof source!=='string'||savedSource!==null&&typeof savedSource!=='string'||typeof autoSave!=='boolean')throw Error('Invalid Code recovery versions.');
      const working=createVirtualFileSystem(),saved=createVirtualFileSystem();working.restore(fs.snapshot());saved.restore(savedFs.snapshot());
      working.writeText(path,source);if(savedSource===null){if(saved.has(path))saved.remove(path);}else saved.writeText(path,savedSource);
      const candidate=createVirtualFileWorkspace();candidate.restore({version:1,working:working.snapshot(),saved:saved.snapshot(),autoSave});validateToneStates(candidate.working.snapshot().files);validateToneStates(candidate.saved.snapshot().files);workspace.restore(candidate.snapshot());
    },
    get selectedPath() { return selectedPath; },
    get cassetteName() { return cassetteName; },
    get cassetteMetadata() { return cassetteMetadata == null ? null : structuredClone(cassetteMetadata); },
    onDidChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    select(path) {
      if (path != null) {
        path = resolvePath(path);
        fs.stat(path);
      }
      if (selectedPath !== path) {
        selectedPath = path;
        changed();
      }
      return selectedPath;
    },
    uniquePath,
    /** Append an editable copy without replacing an existing tone or sidecar. */
    createTone(preset, name='Captured', {select=true}={}) {
      const psg=isPsgPreset(preset),pcm=isPcmPreset(preset),json=psg||pcm;
      if(psg)normalizePsgPreset(preset);
      else if(pcm)normalizePcmPreset(preset);
      else if(preset?.kind!==undefined)throw Error('Unsupported instrument preset kind');
      const extension=pcm?'.pcm.json':psg?'.psg.json':'.vgi';
      const stem=safeName(String(name).replace(TONE_EXTENSION,''),'Captured');
      const occupied=new Set(project.listEntries().map(entry=>entry.path));
      let path=`/presets/${stem}${extension}`,suffix=2;
      const candidates=()=>json?[path,CHECKPOINT_ROOT+path]:[path,synthStatePath(path),CHECKPOINT_ROOT+path,CHECKPOINT_ROOT+synthStatePath(path)];
      while(candidates().some(candidate=>occupied.has(candidate)))path=`/presets/${stem}-${suffix++}${extension}`;
      return project.writeTone(path,preset,{overwrite:false,select});
    },
    /** File-tree metadata without copying binary samples or Git objects. */
    listEntries() {
      const directories = fs.listDirectories();
      const directorySet = new Set(directories);
      const entries = directories.map(path => ({ path, ...fs.stat(path) }));
      for (const directory of directories) {
        for (const name of fs.readdir(directory)) {
          const path = `${directory === '/' ? '' : directory}/${name}`;
          if (!directorySet.has(path)) entries.push({ path, ...fs.stat(path) });
        }
      }
      return entries.sort((a, b) => comparePaths(a.path, b.path));
    },
    listTones() {
      return project.listEntries().filter(entry => entry.type === 'file' && isSynthTonePath(entry.path)).map(entry => fs.get(entry.path));
    },
    readTone(path,{version='working'}={}) {
      if(!['working','saved'].includes(version))throw Error('Instrument version must be working or saved.');
      const store=version==='saved'?savedFs:fs;
      path = resolvePath(path);
      const file = store.get(path);
      if (!file) throw new Error(`Instrument not found: ${path}`);
      if (!isSynthTonePath(path)) throw new Error('Choose a TFI or VGI instrument file, or a .psg.json / .pcm.json preset.');
      if(isJsonTonePath(path))return {path,format:jsonKind(path),preset:parseJsonTone(path,file.data),
        bytes:typeof file.data==='string'?new TextEncoder().encode(file.data):new Uint8Array(file.data)};
      if (file.type !== 'binary') throw new Error('Instrument files must contain binary TFI/VGI data.');
      const bytes = file.data;
      // Historical Synth imports accepted renamed TFI/VGI files by byte size.
      const format = bytes.byteLength === 43 ? 'vgi' : 'tfi';
      let preset = format === 'vgi' ? parseVgi(bytes) : parseTfi(bytes);
      const state=store.get(synthStatePath(path));
      if(state)preset=mergeState(preset,parseState(state.data,format));
      else preset=mergeState(preset,extraState(preset,format));
      return { path, format, preset, bytes };
    },
    writeTone(path, preset, { format, overwrite = true, expectedRevision, baselinePreset, select=true } = {}) {
      path = resolvePath(path);
      if (!isSynthTonePath(path)) throw new Error('Instrument file names must end in .tfi or .vgi, .psg.json or .pcm.json.');
      const previous = fs.get(path);
      if (previous && !overwrite) throw new Error(`Instrument already exists: ${path}`);
      if(isJsonTonePath(path)){
        const kind=jsonKind(path);
        if(format!==undefined&&format!==kind)throw Error(`A .${kind}.json instrument requires ${kind.toUpperCase()} format.`);
        const text=serializeJsonTone(path,preset);
        if(previous)project.readTone(path);
        mutate(()=>{fs.writeFiles([{path,data:text,expectedRevision}]);if(select)selectedPath=path;});
        return project.readTone(path);
      }
      if(isPsgPreset(preset)||isPcmPreset(preset)||preset?.kind!==undefined)throw Error('PSG / PCM presets must use their .psg.json / .pcm.json file type.');
      // Preserve the real format of an existing renamed file when saving.
      format ??= previous ? project.readTone(path).format : path.match(TONE_EXTENSION)[1].toLowerCase();
      if (format !== 'tfi' && format !== 'vgi') throw new Error('Instrument format must be tfi or vgi.');
      for (const [name, maximum] of [['ams', 3], ['pms', 7]]) {
        if (preset[name] !== undefined && (!Number.isInteger(preset[name]) || preset[name] < 0 || preset[name] > maximum)) {
          throw new Error(`${name} must be an integer in range 0..${maximum}`);
        }
      }
      const previousTone = previous ? project.readTone(path) : null;
      let vgiPreset = preset;
      if (format === 'vgi' && preset.b4 === undefined && previousTone?.format === 'vgi') {
        const old = previousTone.preset;
        const pan = preset.pan ?? old.pan;
        // B4's reserved bit 3 has no Synth control. Keep it, and retain pan or
        // modulation values when the editor only supplies the other fields.
        const b4 = (old.b4 & 0x08)
          | ((pan.left ?? old.pan.left) ? 0x80 : 0)
          | ((pan.right ?? old.pan.right) ? 0x40 : 0)
          | ((preset.ams ?? old.ams) << 4)
          | (preset.pms ?? old.pms);
        vgiPreset = { ...preset, b4 };
      }
      const bytes = format === 'vgi' ? createVgiFromPreset(vgiPreset) : createTfiFromPreset(preset);
      const metadataPreset={...previousTone?.preset,...preset};
      metadataPreset.operators={...previousTone?.preset.operators,...preset.operators};
      const sidecar=synthStatePath(path),text=stateText(metadataPreset,format);
      mutate(() => {
        fs.writeFiles([{path,data:bytes,expectedRevision},{path:sidecar,data:text}],{checkpointChanges:false});
        if(select)selectedPath = path;
      });
      return project.readTone(path);
    },
    saveTone(path){project.readTone(path);project.saveFiles([path]);return project.readTone(path,{version:'saved'});},
    discardTone(path){project.discardFiles([path]);return fs.has(path)?project.readTone(path):null;},
    syncTone(path){return project.saveTone(path);},
    revertTone(path){return project.discardTone(path);},
    isToneModified(path){return toneFiles(path).some(value=>workspace.isDirty(value));},
    /**
     * Valid input files and original VGM/VGZ recordings are appended in one
     * filesystem commit. `paths` contains tones; `sourcePaths` contains originals.
     * A bad file does
     * not replace prior imports. Another import/restore cancels an older load.
     * @param {Iterable<{name:string,arrayBuffer?:Function,data?:Uint8Array|ArrayBuffer}>} files
     * @param {{isCurrent?:Function,directory?:string}} [options]
     */
    async importInstrumentFiles(files, { isCurrent = () => true, directory } = {}) {
      if (directory !== undefined) {
        directory = resolvePath(directory);
        if (directory.split('/').includes('.git')) throw new Error('Instrument imports cannot target a .git folder.');
        if (isCheckpointPath(directory)) throw new Error('Instrument imports cannot target the /.tet.ss folder.');
        if (fs.stat(directory).type !== 'directory') throw new Error(`Not a folder: ${directory}`);
      }
      const sequence = ++importSequence;
      const current = () => sequence === importSequence && isCurrent();
      const failures = [], batches = [];
      for (const file of files) {
        const name = String(file.name ?? 'instrument.tfi');
        try {
          const bytes = fileBytes(typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : file.data);
          const { entries, source } = isJsonTonePath(name)?{entries:[{label:name,format:jsonKind(name),preset:parseJsonTone(name,bytes),bytes}],source:null}:await readPresetImport(bytes, name);
          if (source && fs.has('/vgm')) throw new Error('Cannot save the original VGM: /vgm is a file. Rename it or move it before importing.');
          if (entries.length || source) batches.push({ name, entries, source });
          else failures.push(`${name}: no supported FM instrument snapshots were found.`);
        } catch (error) {
          failures.push(`${name}: ${error.message}`);
        }
        if (!current()) return { paths: [], sourcePaths: [], failures: [], notices: [], cancelled: true };
      }
      batches.sort((a, b) => comparePaths(a.name, b.name));
      const occupied = new Set(project.listEntries().map(entry => entry.path));
      const addedFiles = [], addedDirectories = [], tonePaths = [], sourcePaths = [], notices = new Set();
      for (const batch of batches) {
        if (batch.source) {
          const extension = batch.source.extension;
          let filename = safeName(batch.name, `recording.${extension}`);
          if (!filename.toLowerCase().endsWith(`.${extension}`)) {
            filename = filename.replace(/\.(?:vgm|vgz|tfi|vgi)$/i, '') + `.${extension}`;
          }
          const path = uniquePath(`/vgm/${filename}`, occupied);
          occupied.add('/vgm'); occupied.add(path);
          addedDirectories.push('/vgm');
          addedFiles.push({path, data:fileBytes(batch.source.data)});
          sourcePaths.push(path);
          if (!batch.entries.length) notices.add(`${batch.name}: no supported FM instrument snapshots were found. The original VGM was saved.`);
        }
        if (!batch.entries.length) continue;
        let source = safeName(batch.name.replace(/\.(vgm|vgz|s98|tfi|vgi|psg\.json|pcm\.json)$/i, ''), 'instrument');
        if (source === '.git') source = '.git-instruments';
        const directTone = !batch.source && directory !== undefined && TONE_EXTENSION.test(batch.name);
        const base = `${directory ?? '/presets'}/${source}`.replace(/^\/\//, '/');
        let targetDirectory = directTone ? directory : base, suffix = 2;
        while (!directTone && (occupied.has(targetDirectory) || [...occupied].some(path => path.startsWith(`${targetDirectory}/`)))) {
          targetDirectory = `${base}-${suffix++}`;
        }
        occupied.add(targetDirectory);
        addedDirectories.push(targetDirectory);
        batch.entries.sort((a, b) => comparePaths(a.label, b.label));
        for (const entry of batch.entries) {
          const format = entry.format ?? 'tfi';
          const json=['psg','pcm'].includes(format);
          const filename = safeName(entry.label.replace(TONE_EXTENSION, ''), 'tone') + (json?`.${format}.json`:`.${format}`);
          const path = uniquePath(`${targetDirectory}/${filename}`, occupied);
          occupied.add(path);
          addedFiles.push({ path, data:json?new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(entry.bytes):fileBytes(entry.bytes ?? createTfiFromPreset(entry.preset)) });
          tonePaths.push(path);
          if (entry.notice) notices.add(entry.notice);
        }
      }
      if (addedFiles.length) mutate(() => {
        fs.replace([...fs.list(), ...addedFiles], [...fs.listDirectories(), ...addedDirectories]);
        selectedPath = tonePaths[0] ?? sourcePaths[0];
      });
      return { paths: tonePaths, sourcePaths, failures, notices: [...notices] };
    },
    duplicate(path, destination) {
      path = resolvePath(path);
      if (destination == null) {
        const filename = path.slice(path.lastIndexOf('/') + 1);
        const extensionAt = filename.lastIndexOf('.');
        const extension = fs.stat(path).type === 'file' ? synthToneExtension(filename)??(extensionAt > 0 ? filename.slice(extensionAt) : '') : '';
        const stem = extension ? path.slice(0, -extension.length) : path;
        destination = uniquePath(`${stem} copy${extension}`);
      } else destination = resolvePath(destination);
      mutate(() => {
        transferTone(path,destination,true);
        selectedPath = destination;
      });
      return destination;
    },
    move(path, destination) {
      path = resolvePath(path);
      destination = resolvePath(destination);
      const selection = selectedPath;
      mutate(() => {
        transferTone(path,destination,false);
        if (selection === path || selection?.startsWith(`${path}/`)) {
          selectedPath = destination + selection.slice(path.length);
        }
      });
      return destination;
    },
    rename(path, newName) {
      path = resolvePath(path);
      if (typeof newName !== 'string' || !newName.trim() || newName.includes('/') || newName.includes('\\') || /[\x00-\x1f]/.test(newName)) {
        throw new Error('Enter a file or folder name without path separators.');
      }
      newName = newName.trim();
      if (newName === '.' || newName === '..') throw new Error('Invalid file or folder name.');
      const originalExtension = fs.has(path) ? synthToneExtension(path) : null;
      if (originalExtension && !newName.includes('.')) newName += originalExtension;
      return project.move(path, `${dirname(path)}/${newName}`);
    },
    delete(path, { recursive = false } = {}) {
      path=resolvePath(path);
      const sidecar=fs.has(path)&&isSynthTonePath(path)&&!isJsonTonePath(path)?synthStatePath(path):null;
      if(sidecar&&fs.listDirectories().includes(sidecar))throw Error(`Synth state path is a folder: ${sidecar}`);
      mutate(()=>{fs.remove(path,{recursive});if(sidecar&&fs.has(sidecar))fs.remove(sidecar);});
    },
    mkdir(path) {
      fs.mkdir(resolvePath(path), { recursive: true });
    },
    snapshot() {
      const state=workspace.snapshot();
      return {...state.working,version:2,workspace:state,selectedPath,cassetteName,
        cassetteMetadata:cassetteMetadata==null?null:structuredClone(cassetteMetadata),pendingMoves:[...pendingMoves]};
    },
    restore(snapshot) {
      if(![1,2].includes(snapshot?.version))throw Error('Unsupported Synth project snapshot.');
      const legacy=createVirtualFileSystem();if(snapshot.files)legacy.restore({...snapshot,version:1});
      const state=snapshot.version===2?snapshot.workspace:{version:1,working:legacy.snapshot(),saved:legacy.snapshot(),autoSave:true};
      if(snapshot.version===2&&snapshot.files){const top=legacy.snapshot(),inner=state?.working;if(!inner||top.files.length!==inner.files.length||top.files.some(file=>!sameFile(file,inner.files.find(value=>value.path===file.path)))||top.directories.join('\n')!==[...inner.directories].sort().join('\n'))throw Error('Synth working snapshot fields differ.');}
      const candidate=createVirtualFileWorkspace();candidate.restore(state);
      validateToneStates(candidate.working.snapshot().files);validateToneStates(candidate.saved.snapshot().files);
      const selection=snapshot.selectedPath==null?null:resolvePath(snapshot.selectedPath);
      if(selection)candidate.working.stat(selection);
      const nextName=String(snapshot.cassetteName??'cassette'),nextMetadata=snapshot.cassetteMetadata==null?null:structuredClone(snapshot.cassetteMetadata);
      const moves=snapshot.pendingMoves??[];
      if(!Array.isArray(moves)||moves.some(pair=>!Array.isArray(pair)||pair.length!==2||pair.some(path=>typeof path!=='string'||resolvePath(path)!==path)))throw Error('Invalid pending Synth file moves.');
      importSequence++;
      mutate(()=>{pendingMoves.clear();for(const [source,target]of moves)pendingMoves.set(source,target);workspace.restore(candidate.snapshot());selectedPath=selection;cassetteName=nextName;cassetteMetadata=nextMetadata;});
    },
    exportCassette(options = {}) {
      if(options.includeWorkingState){
        const delta=workingDelta(workspace,pendingMoves),files=savedFs.list(),metadataEntries=files.filter(file=>METADATA_PATHS.has(file.path));
        if(options.savedEditorPresets)delta.savedEditorPresets=structuredClone(options.savedEditorPresets);
        const metadata={...(options.metadata??cassetteMetadata??{})};delete metadata[WORKING_METADATA_KEY];metadata[WORKING_METADATA_KEY]=delta;
        const primary=metadataEntries.at(-1)?.path;
        const encoded=files.map(file=>{
          if(!METADATA_PATHS.has(file.path))return file;
          const text=typeof file.data==='string'?file.data:new TextDecoder('utf-8',{fatal:true}).decode(file.data);
          const match=file.path.endsWith('.js')?text.match(/export\s+default\s+([\s\S]*?)\s*;?\s*$/):null;
          if(file.path.endsWith('.js')&&!match)throw Error('Invalid cassette metadata module.');
          const value=JSON.parse(match?match[1]:text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid Cassette metadata object.');
          delete value[WORKING_METADATA_KEY];if(file.path===primary)value[WORKING_METADATA_KEY]=delta;
          return{path:file.path,type:'text',data:file.path.endsWith('.js')?`export default ${JSON.stringify(value,null,2)};\n`:JSON.stringify(value,null,2)+'\n'};
        });
        return createPlaygroundCassetteZip(encoded,{...options,directories:savedFs.listDirectories(),metadata,
          workType:options.workType??metadata.workType,license:options.license??metadata.license,licenseName:options.licenseName??metadata.licenseName,preserveMetadataFiles:Boolean(primary)});
      }
      const store=options.version==='saved'?savedFs:fs;
      const files = store.list();
      const hasMetadata = files.some(file => METADATA_PATHS.has(file.path));
      const metadataPath = options.metadataFileName === 'cassette.metadata.js' ? '/cassette.metadata.js' : '/metadata.json';
      if (!hasMetadata && store.listDirectories().includes(metadataPath)) {
        throw new Error(`Cassette metadata path ${metadataPath} is a folder. Rename it before exporting.`);
      }
      const metadata = options.metadata ?? cassetteMetadata ?? {};
      return createPlaygroundCassetteZip(files, {
        ...options,
        directories: store.listDirectories(),
        metadata,
        workType: options.workType ?? metadata.workType,
        license: options.license ?? metadata.license,
        licenseName: options.licenseName ?? metadata.licenseName,
        preserveMetadataFiles: hasMetadata,
      });
    },
    async importCassette(bytes, { name, isCurrent = () => true } = {}) {
      const sequence = ++importSequence;
      const cassette = await loadPlaygroundCassette(bytes, { name });
      if (sequence !== importSequence || !isCurrent()) return { cancelled: true };
      const files = Array.from(cassette.files, ([path, data]) => ({ path: `/${path}`,type:'binary', data }));
      for (const file of files.filter(file => isSynthTonePath(file.path))) {
        try {
          if(isJsonTonePath(file.path))parseJsonTone(file.path,file.data);
          else if (file.data.byteLength === 43) parseVgi(file.data);
          else parseTfi(file.data);
        } catch (error) {
          throw new Error(`Invalid instrument ${file.path}: ${error.message}`);
        }
      }
      validateToneStates(files);
      const delta=cassette.metadata?.[WORKING_METADATA_KEY];
      const base=createVirtualFileSystem();base.replace(files,cassette.directories);
      const state=delta?applyWorkingDelta(files,cassette.directories,delta):{version:1,working:base.snapshot(),saved:base.snapshot(),autoSave:workspace.autoSave};
      const candidate=createSynthProject();candidate.restore({version:2,workspace:state,selectedPath:null,pendingMoves:delta?.pendingMoves??[]});
      if(delta?.savedEditorPresets){
        if(typeof delta.savedEditorPresets!=='object'||Array.isArray(delta.savedEditorPresets))throw Error('Invalid saved editor presets in Cassette.');
        for(const [kind,preset]of Object.entries(delta.savedEditorPresets)){if(!['fm','psg','pcm'].includes(kind)||(isPcmPreset(preset)?'pcm':isPsgPreset(preset)?'psg':'fm')!==kind)throw Error('Invalid saved editor preset kind.');createSynthProject().createTone(preset,'Saved editor validation');}
      }
      const metadata=structuredClone(cassette.metadata);if(metadata)delete metadata[WORKING_METADATA_KEY];
      // Validate known instruments, but preserve their original bytes. All
      // other files remain opaque, avoiding JavaScript/metadata re-encoding.
      mutate(() => {
        pendingMoves.clear();for(const [source,target]of candidate.snapshot().pendingMoves)pendingMoves.set(source,target);workspace.restore(candidate.workspace.snapshot());
        selectedPath = fs.list().filter(file => isSynthTonePath(file.path)).sort((a, b) => comparePaths(a.path, b.path))[0]?.path ?? null;
        cassetteName = cassette.id;
        cassetteMetadata = metadata;
      });
      return {...cassette,savedEditorPresets:delta?.savedEditorPresets??null};
    },
  };
  if (initialSnapshot) project.restore(initialSnapshot);
  else fs.mkdir('/presets');
  return project;
}
