import {
  createVirtualFileSystem,
  transferVirtualFiles,
  isCheckpointPath,
  CHECKPOINT_ROOT,
} from '../js/tetorica_virtual_files/filesystem.js';
import { resolvePath, dirname } from '../js/tetorica_virtual_files/path.js';
import {
  createPlaygroundCassetteZip,
  loadPlaygroundCassette,
} from '../playground/playground_cassette.js';
import { parseTfi, createTfiFromPreset } from '../js/tfi.js';
import { parseVgi, createVgiFromPreset } from '../js/vgi.js';
import { readPresetFile } from './synth_preset_import.js';

const TONE_EXTENSION = /\.(tfi|vgi)$/i;
const METADATA_PATHS = new Set(['/metadata.json', '/cassette.metadata.js']);
const comparePaths = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const SYNTH_STATE_KIND = 'tetorica-fm2612-synth';

export const synthStatePath = path => resolvePath(path) + '.synth.json';
export const isSynthStatePath = path => /\.(?:tfi|vgi)\.synth\.json$/i.test(String(path));

function range(name,value,maximum) {
  if(!Number.isInteger(value)||value<0||value>maximum)throw Error(`${name} must be an integer in range 0..${maximum}`);
  return value;
}
function boolean(name,value) {if(typeof value!=='boolean')throw Error(`${name} must be a boolean`);return value;}
function extraState(preset,format) {
  const operators=preset.operators??{},offset=operators[0]===undefined?1:0;
  const state={version:1,kind:SYNTH_STATE_KIND,
    lfo:{enabled:boolean('lfo.enabled',preset.lfo?.enabled??false),frequency:range('lfo.frequency',preset.lfo?.frequency??0,7)},
    operatorAM:[0,1,2,3].map(index=>boolean('operator AM',operators[index+offset]?.am??false)),
  };
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
  if(format==='tfi'){
    if(!state.pan||state.b4===undefined||state.ams===undefined||state.pms===undefined)throw Error('TFI Synth state must include pan, B4, AMS and PMS');
    Object.assign(preset,{pan:state.pan,b4:state.b4,ams:state.ams,pms:state.pms});
  }
  return extraState(preset,format);
}
function mergeState(preset,state) {
  const merged=structuredClone(preset);
  merged.lfo={...state.lfo};
  for(let op=1;op<=4;op++)merged.operators[op]={...merged.operators[op],am:state.operatorAM[op-1]};
  if(state.pan)Object.assign(merged,{pan:{...state.pan},b4:state.b4,ams:state.ams,pms:state.pms});
  return merged;
}
function validateToneStates(files) {
  const entries=new Map(files.map(file=>[resolvePath(file.path),file]));
  for(const [path,file] of entries)if(isSynthTonePath(path)){
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

function safeName(name, fallback = 'tone') {
  return String(name).replace(/[\\/\x00-\x1f:*?"<>|]/g, '_')
    .replace(/[. ]+$/g, '').trim() || fallback;
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
  const fs = createVirtualFileSystem([], {autoCheckpoint:true});
  const listeners = new Set();
  let selectedPath = null;
  let cassetteName = 'cassette';
  let cassetteMetadata = null;
  let importSequence = 0;
  let mutationDepth = 0;
  let pendingChange = false;

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
  fs.onDidChange(changed);

  function uniquePath(path, occupied = new Set(project.listEntries().map(entry => entry.path))) {
    path = resolvePath(path);
    const baseName = path.slice(path.lastIndexOf('/') + 1);
    const extensionAt = baseName.lastIndexOf('.');
    const extension = extensionAt > 0 ? baseName.slice(extensionAt) : '';
    const stem = extension ? path.slice(0, -extension.length) : path;
    let candidate = path, suffix = 2;
    while (occupied.has(candidate)) candidate = `${stem}-${suffix++}${extension}`;
    return candidate;
  }
  function transferTone(path,destination,copy) {
    const pairs=[[path,destination]];
    if(fs.has(path)&&isSynthTonePath(path)){
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
  }

  const project = {
    fs,
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
    readTone(path) {
      path = resolvePath(path);
      const file = fs.get(path);
      if (!file) throw new Error(`Instrument not found: ${path}`);
      if (!isSynthTonePath(path)) throw new Error('Choose a TFI or VGI instrument file.');
      if (file.type !== 'binary') throw new Error('Instrument files must contain binary TFI/VGI data.');
      const bytes = file.data;
      // Historical Synth imports accepted renamed TFI/VGI files by byte size.
      const format = bytes.byteLength === 43 ? 'vgi' : 'tfi';
      let preset = format === 'vgi' ? parseVgi(bytes) : parseTfi(bytes);
      const state=fs.get(synthStatePath(path));
      if(state)preset=mergeState(preset,parseState(state.data,format));
      else preset=mergeState(preset,extraState(preset,format));
      return { path, format, preset, bytes };
    },
    writeTone(path, preset, { format, overwrite = true, expectedRevision, baselinePreset } = {}) {
      path = resolvePath(path);
      if (!isSynthTonePath(path)) throw new Error('Instrument file names must end in .tfi or .vgi.');
      const previous = fs.get(path);
      if (previous && !overwrite) throw new Error(`Instrument already exists: ${path}`);
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
      const currentState=fs.get(sidecar);
      // Validate before materializing a legacy instrument's missing metadata.
      if(expectedRevision!==undefined&&fs.getRevision(path)!==expectedRevision)throw Error(`Revision conflict: ${path}; read the file again`);
      const baseline=previousTone?stateText(baselinePreset??previousTone.preset,format):null;
      mutate(() => {
        if(previous&&!currentState)fs.writeText(sidecar,baseline);
        const changed=!previous||previous.data.length!==bytes.length||previous.data.some((value,index)=>value!==bytes[index])||fs.get(sidecar)?.data!==text;
        if(previous&&changed&&fs.checkpoints.auto){
          const missing=[path,sidecar].filter(candidate=>!fs.checkpoints.has(candidate));
          // Legacy Cassettes can have a binary baseline without its sidecar.
          // Its unknown extras use deterministic format defaults, never today's
          // edited LFO/AM state. Existing checkpoints are never advanced here.
          const legacy=missing.includes(sidecar)&&fs.checkpoints.has(path)?fs.checkpoints.get(path):null;
          let legacyText=null;
          if(legacy){
            const oldFormat=legacy.data.length===43?'vgi':'tfi';
            legacyText=stateText(oldFormat==='vgi'?parseVgi(legacy.data):parseTfi(legacy.data),oldFormat);
          }
          if(missing.length)fs.checkpoints.setMany(missing);
          if(legacyText!==null)fs.writeText(CHECKPOINT_ROOT+sidecar,legacyText);
        }
        fs.writeFiles([{path,data:bytes,expectedRevision},{path:sidecar,data:text}],{checkpointChanges:false});
        selectedPath = path;
      });
      return project.readTone(path);
    },
    syncTone(path) {
      const tone=project.readTone(path),sidecar=synthStatePath(tone.path);
      mutate(()=>{
        if(!fs.has(sidecar))fs.writeText(sidecar,stateText(tone.preset,tone.format));
        fs.checkpoints.setMany([tone.path,sidecar]);
      });
      return project.readTone(tone.path);
    },
    revertTone(path) {
      path=resolvePath(path);
      if(!isSynthTonePath(path)||fs.get(path)?.type!=='binary')throw Error('Choose a TFI or VGI instrument file.');
      const sidecar=synthStatePath(path);
      const saved=fs.checkpoints.get(path),savedState=fs.checkpoints.get(sidecar);
      if(!saved||saved.type!=='binary')throw Error(`Instrument checkpoint not found: ${path}`);
      const format=saved.data.length===43?'vgi':'tfi';
      const preset=format==='vgi'?parseVgi(saved.data):parseTfi(saved.data);
      const state=savedState?parseState(savedState.data,format):extraState(preset,format);
      // Validate the full pair before changing either current file.
      mergeState(preset,state);
      const text=JSON.stringify(state,null,2)+'\n';
      const entries=[{path,data:saved.data},{path:sidecar,data:text}];
      // Complete legacy binary-only checkpoints with their deterministic extra
      // defaults so future recovery always has a complete, valid saved pair.
      if(!savedState)entries.push({path:CHECKPOINT_ROOT+sidecar,data:text});
      fs.writeFiles(entries,{checkpointChanges:false});
      return project.readTone(path);
    },
    isToneModified(path) {
      path=resolvePath(path);
      if(!isSynthTonePath(path)||!fs.has(path))return false;
      return fs.checkpoints.isModified(path)||fs.checkpoints.isModified(synthStatePath(path));
    },
    /**
     * Valid input files are appended in one filesystem commit. A bad file does
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
          const entries = await readPresetFile(bytes, name);
          if (entries.length) batches.push({ name, entries });
          else failures.push(`${name}: no supported FM instrument snapshots were found.`);
        } catch (error) {
          failures.push(`${name}: ${error.message}`);
        }
        if (!current()) return { paths: [], failures: [], notices: [], cancelled: true };
      }
      batches.sort((a, b) => comparePaths(a.name, b.name));
      const occupied = new Set(project.listEntries().map(entry => entry.path));
      const addedFiles = [], addedDirectories = [], notices = new Set();
      for (const batch of batches) {
        let source = safeName(batch.name.replace(/\.(vgm|vgz|s98|tfi|vgi)$/i, ''), 'instrument');
        if (source === '.git') source = '.git-instruments';
        const directTone = directory !== undefined && TONE_EXTENSION.test(batch.name);
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
          const filename = safeName(entry.label.replace(TONE_EXTENSION, ''), 'tone') + `.${format}`;
          const path = uniquePath(`${targetDirectory}/${filename}`, occupied);
          occupied.add(path);
          addedFiles.push({ path, data: fileBytes(entry.bytes ?? createTfiFromPreset(entry.preset)) });
          if (entry.notice) notices.add(entry.notice);
        }
      }
      if (addedFiles.length) mutate(() => {
        fs.replace([...fs.list(), ...addedFiles], [...fs.listDirectories(), ...addedDirectories]);
        selectedPath = addedFiles[0].path;
      });
      return { paths: addedFiles.map(file => file.path), failures, notices: [...notices] };
    },
    duplicate(path, destination) {
      path = resolvePath(path);
      if (destination == null) {
        const filename = path.slice(path.lastIndexOf('/') + 1);
        const extensionAt = filename.lastIndexOf('.');
        const extension = fs.stat(path).type === 'file' && extensionAt > 0 ? filename.slice(extensionAt) : '';
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
      const originalExtension = fs.has(path) ? path.match(TONE_EXTENSION)?.[0] : null;
      if (originalExtension && !newName.includes('.')) newName += originalExtension;
      return project.move(path, `${dirname(path)}/${newName}`);
    },
    delete(path, { recursive = false } = {}) {
      path=resolvePath(path);
      const sidecar=fs.has(path)&&isSynthTonePath(path)?synthStatePath(path):null;
      if(sidecar&&fs.listDirectories().includes(sidecar))throw Error(`Synth state path is a folder: ${sidecar}`);
      mutate(()=>{fs.remove(path,{recursive});if(sidecar&&fs.has(sidecar))fs.remove(sidecar);});
    },
    mkdir(path) {
      fs.mkdir(resolvePath(path), { recursive: true });
    },
    snapshot() {
      return {
        ...fs.snapshot(),
        selectedPath,
        cassetteName,
        cassetteMetadata: cassetteMetadata == null ? null : structuredClone(cassetteMetadata),
      };
    },
    restore(snapshot) {
      if (snapshot?.version !== 1) throw new Error('Unsupported Synth project snapshot.');
      // The VFS validates every path and conflict before replacing anything.
      const candidate = createVirtualFileSystem();
      candidate.restore(snapshot);
      validateToneStates(snapshot.files);
      const selection = snapshot.selectedPath == null ? null : resolvePath(snapshot.selectedPath);
      if (selection) candidate.stat(selection);
      const nextName = String(snapshot.cassetteName ?? 'cassette');
      const nextMetadata = snapshot.cassetteMetadata == null ? null : structuredClone(snapshot.cassetteMetadata);
      importSequence++;
      mutate(() => {
        fs.restore(snapshot);
        selectedPath = selection;
        cassetteName = nextName;
        cassetteMetadata = nextMetadata;
      });
    },
    exportCassette(options = {}) {
      const files = fs.list();
      const hasMetadata = files.some(file => METADATA_PATHS.has(file.path));
      const metadataPath = options.metadataFileName === 'cassette.metadata.js' ? '/cassette.metadata.js' : '/metadata.json';
      if (!hasMetadata && fs.listDirectories().includes(metadataPath)) {
        throw new Error(`Cassette metadata path ${metadataPath} is a folder. Rename it before exporting.`);
      }
      const metadata = options.metadata ?? cassetteMetadata ?? {};
      return createPlaygroundCassetteZip(files, {
        ...options,
        directories: fs.listDirectories(),
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
      const files = Array.from(cassette.files, ([path, data]) => ({ path: `/${path}`, data }));
      for (const file of files.filter(file => isSynthTonePath(file.path))) {
        try {
          if (file.data.byteLength === 43) parseVgi(file.data);
          else parseTfi(file.data);
        } catch (error) {
          throw new Error(`Invalid instrument ${file.path}: ${error.message}`);
        }
      }
      validateToneStates(files);
      // Validate known instruments, but preserve their original bytes. All
      // other files remain opaque, avoiding JavaScript/metadata re-encoding.
      mutate(() => {
        fs.replace(files, cassette.directories);
        selectedPath = files.filter(file => isSynthTonePath(file.path)).sort((a, b) => comparePaths(a.path, b.path))[0]?.path ?? null;
        cassetteName = cassette.id;
        cassetteMetadata = cassette.metadata;
      });
      return cassette;
    },
  };
  if (initialSnapshot) project.restore(initialSnapshot);
  else fs.mkdir('/presets');
  return project;
}
