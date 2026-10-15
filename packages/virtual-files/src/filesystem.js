import {resolvePath, dirname} from './path.js';
import {createVirtualFileReader} from './reader.js';
import {planVirtualFileSync,resolveSyncPath} from './sync.js';
export const CHECKPOINT_ROOT = '/.tet.ss';
/** True only for the reserved root checkpoint tree. @param {string} path */
export function isCheckpointPath(path) {path=resolvePath(path);return path===CHECKPOINT_ROOT||path.startsWith(CHECKPOINT_ROOT+'/');}
const checkpointEligible=path=>!isCheckpointPath(path)&&!path.split('/').includes('.git');
const checkpointPath=path=>CHECKPOINT_ROOT+path;
/** @typedef {{path:string, revision:number, type:'text', data:string}|{path:string,revision:number,type:'binary',data:Uint8Array}} VirtualFile */
/** @typedef {{path:string,type:'text',data:string}|{path:string,type:'binary',data:Uint8Array}} StoredFile */
/** @typedef {{version:1, files:StoredFile[], directories:string[]}} Snapshot */
/** @typedef {{snapshot:Snapshot,revisions:Record<string,number>,scope:object}} FileCheckpoint */
/** @param {string|Uint8Array|ArrayBuffer} data */
function copy(data) {
  if (typeof data === 'string') return data;
  if (data instanceof Uint8Array) return new Uint8Array(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  throw TypeError('Virtual file data must be text or binary bytes');
}
/** Memory filesystem. Reads return copies; replace/restore validate before committing.
 * @param {Array<{path:string,data:string|Uint8Array|ArrayBuffer}>} [entries]
 * @param {{autoCheckpoint?:boolean}} [options] */
export function createVirtualFileSystem(entries = [], {autoCheckpoint = false} = {}) {
  if(typeof autoCheckpoint!=='boolean')throw TypeError('autoCheckpoint must be a boolean');
  /** @type {Map<string,StoredFile>} */
  let files = new Map();
  let directories = new Set(['/']);
  const listeners = new Set();
  // Tombstones keep deleted paths from reusing an earlier revision. Session-local only.
  const scope=Object.freeze({});
  const revisions = new Map([['/',1]]);let sequence=1;
  const same=(a,b)=>a===b?true:!a||!b?false:a.type===b.type&&(a.type==='text'?a.data===b.data:a.data.length===b.data.length&&a.data.every((v,i)=>v===b.data[i]));
  function updateRevisions(nextFiles,nextDirs){
    for(const path of new Set([...files.keys(),...nextFiles.keys(),...directories,...nextDirs]))
      if(!same(files.get(path),nextFiles.get(path))||directories.has(path)!==nextDirs.has(path))revisions.set(path,++sequence);
  }
  function expectRevision(path,expected){
    if(expected===undefined)return;
    if(!Number.isSafeInteger(expected)||expected<0)throw Error('Invalid expectedRevision');
    if(fs.getRevision(path)!==expected)throw Error(`Revision conflict: ${path}; read the file again`);
  }
  const notify = () => {for (const listener of listeners) listener();};
  function build(entries, dirs = []) {
    const nextFiles = new Map(), nextDirs = new Set(['/']);
    function directory(path) {
      path = resolvePath(path);
      if (nextFiles.has(path)) throw Error(`File blocks directory: ${path}`);
      if (path !== '/') directory(dirname(path));
      nextDirs.add(path);
    }
    for (const path of dirs) directory(path);
    for (const entry of entries) {
      const path = resolvePath(entry.path), data = copy(entry.data);
      if (nextFiles.has(path) || nextDirs.has(path)) throw Error(`Conflicting virtual path: ${path}`);
      directory(dirname(path));
      nextFiles.set(path, {path,type:typeof data === 'string' ? 'text' : 'binary',data});
    }
    return {files:nextFiles, directories:nextDirs};
  }
  function addFile(next,path,data) {
    if(next.directories.has(path))throw Error(`Directory occupies file path: ${path}`);
    for(let parent=dirname(path);parent!=='/';parent=dirname(parent)){
      if(next.files.has(parent))throw Error(`File blocks directory: ${parent}`);
      next.directories.add(parent);
    }
    next.files.set(path,{path,type:typeof data==='string'?'text':'binary',data:copy(data)});
  }
  function ignoredData(data) {
    let text;
    try{text=typeof data==='string'?data:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data);}
    catch{throw Error('Cannot add checkpoint ignore rule: /.gitignore is not valid UTF-8');}
    if(text.split(/\r?\n/).some(line=>line.trim()==='/.tet.ss/'))return copy(data);
    const newline=text.includes('\r\n')?'\r\n':'\n';
    text+=(text&&!text.endsWith('\n')?newline:'')+'/.tet.ss/'+newline;
    return typeof data==='string'?text:new TextEncoder().encode(text);
  }
  function ensureCheckpointIgnore(next) {
    const ignore=next.files.get('/.gitignore');
    addFile(next,'/.gitignore',ignoredData(ignore?.data??''));
  }
  function captureChanges(next) {
    // Bulk editing transactions remove the same paired checkpoints as remove().
    // Exact replacement and snapshot restore deliberately bypass this policy.
    for(const path of files.keys())if(checkpointEligible(path)&&!next.files.has(path)){
      const saved=checkpointPath(path),inside=p=>p===saved||p.startsWith(saved+'/');
      for(const candidate of next.files.keys())if(inside(candidate))next.files.delete(candidate);
      for(const candidate of next.directories)if(inside(candidate))next.directories.delete(candidate);
    }
    // Editing callers may supply only working files. An existing baseline is
    // retained for surviving files; exact replace() remains available to import.
    for(const path of files.keys())if(checkpointEligible(path)&&next.files.has(path)){
      const saved=checkpointPath(path);
      if(files.has(saved)&&!next.files.has(saved))addFile(next,saved,files.get(saved).data);
    }
    if(!autoCheckpoint)return;
    const captures=[];
    for(const [path,before] of files){
      const saved=checkpointPath(path);
      if(checkpointEligible(path)&&next.files.has(path)&&!same(before,next.files.get(path))&&!files.has(saved)&&!next.files.has(saved))captures.push(before);
    }
    if(!captures.length)return;
    ensureCheckpointIgnore(next);
    for(const before of captures)addFile(next,checkpointPath(before.path),before.path==='/.gitignore'?ignoredData(before.data):before.data);
  }
  function publish(next) {updateRevisions(next.files,next.directories);files=next.files;directories=next.directories;notify();}
  // Internal snapshots share immutable store bytes. They never leave this
  // closure; the planner copies destinations, while public reads still copy.
  const storedSnapshot=()=>({version:/** @type {const} */(1),files:[...files.values()],directories:[...directories]});
  /** Publish an already validated, privately owned sync plan. @param {Snapshot} snapshot */
  function publishSync(snapshot) {publish({files:new Map(snapshot.files.map(file=>[file.path,file])),directories:new Set(snapshot.directories)});}
  function commit(entries, dirs, {checkpointChanges=false}={}) {const next=build(entries, dirs);if(checkpointChanges)captureChanges(next);publish(next);}
  function ordinaryPath(path,{existing=false}={}) {
    path=resolvePath(path);
    if(!checkpointEligible(path))throw Error(`Checkpoint operations cannot target internal paths: ${path}`);
    if(directories.has(path))throw Error(`Checkpoint operations require a file: ${path}`);
    if(existing&&!files.has(path))throw Error(`Virtual file not found: ${path}`);
    return path;
  }
  const initial=build(entries);updateRevisions(initial.files,initial.directories);files=initial.files;directories=initial.directories;
  const fs = {
    /** One-way file/folder mirror, preserving the absolute source path under
     * syncRoot. The default root is /.tet.ss; arbitrary roots are ordinary
     * files, not automatically hidden or Git-ignored. Unlike checkpoint set,
     * sync does not manage .gitignore or trigger automatic checkpoint capture.
     * Root sync excludes its destination tree to prevent recursive backups.
     * Only virtual paths are supported; external storage URIs are reserved.
     * @param {string} sourcePath
     * @param {{syncRoot?:string}} [options]
     * @returns {Promise<{sourcePath:string,destinationPath:string,changed:boolean}>} */
    async sync(sourcePath,options={}) {
      if(!options||typeof options!=='object'||Array.isArray(options))throw TypeError('Sync options must be an object with syncRoot');
      const root=resolveSyncPath(options.syncRoot===undefined?CHECKPOINT_ROOT:options.syncRoot);
      sourcePath=resolveSyncPath(sourcePath);
      if(root!=='/'&&(sourcePath===root||sourcePath.startsWith(root+'/')))throw Error('Sync source cannot be inside syncRoot');
      const destinationPath=resolvePath(root==='/'?sourcePath:root+(sourcePath==='/'?'':sourcePath));
      const plan=planVirtualFileSync(storedSnapshot(),sourcePath,destinationPath,{exclude:sourcePath==='/'&&destinationPath!=='/'?[destinationPath]:[],shareUnchanged:true});
      if(plan.changed)publishSync(plan.snapshot);
      return {sourcePath,destinationPath,changed:plan.changed};
    },
    /** Persistent per-file checkpoints, separate from transactional checkpoint(). */
    checkpoints: {
      get auto() {return autoCheckpoint;},
      /** The setting belongs to this instance, not its snapshots. @param {boolean} enabled */
      setAuto(enabled) {if(typeof enabled!=='boolean')throw TypeError('autoCheckpoint must be a boolean');autoCheckpoint=enabled;},
      /** @param {string} path @returns {VirtualFile|null} */
      get(path) {return fs.get(checkpointPath(ordinaryPath(path)));},
      /** @param {string} path */
      has(path) {return files.has(checkpointPath(ordinaryPath(path)));},
      /** False when no checkpoint exists. @param {string} path */
      isModified(path) {path=ordinaryPath(path);const saved=files.get(checkpointPath(path));return Boolean(saved&&!same(saved,files.get(path)));},
      /** Set the single persistent checkpoint; storage sync and Undo are independent.
       * @param {string} path @param {{expectedRevision?:number}} [options] @returns {VirtualFile} */
      set(path,{expectedRevision}={}) {
        path=ordinaryPath(path,{existing:true});expectRevision(path,expectedRevision);
        return fs.checkpoints.setMany([path])[0];
      },
      /** Update multiple existing file checkpoints in one validated commit.
       * @param {string[]} paths @returns {VirtualFile[]} */
      setMany(paths) {
        if(!Array.isArray(paths)||!paths.length)throw Error('Checkpoint setMany requires at least one path');
        paths=paths.map(path=>ordinaryPath(path,{existing:true}));
        if(new Set(paths).size!==paths.length)throw Error('Checkpoint paths must be unique');
        const next={files:new Map(files),directories:new Set(directories)};
        ensureCheckpointIgnore(next);
        for(const path of paths)addFile(next,checkpointPath(path),next.files.get(path).data);
        publish(next);return paths.map(path=>/** @type {VirtualFile} */(fs.checkpoints.get(path)));
      },
      /** Restore current from its checkpoint without advancing that checkpoint.
       * @param {string} path @param {{expectedRevision?:number}} [options] @returns {VirtualFile} */
      revert(path,{expectedRevision}={}) {
        path=ordinaryPath(path,{existing:true});expectRevision(path,expectedRevision);
        const saved=files.get(checkpointPath(path));
        if(!saved)throw Error(`Checkpoint not found: ${path}`);
        const plan=planVirtualFileSync(storedSnapshot(),checkpointPath(path),path,{shareUnchanged:true});
        publishSync(plan.snapshot);return /** @type {VirtualFile} */ (fs.get(path));
      },
    },
    /** @param {()=>void} listener */
    onDidChange(listener) {listeners.add(listener);return () => listeners.delete(listener);},
    /** Files only, for compatibility. Use stat() to test directories. @param {string} path */
    has(path) {return files.has(resolvePath(path));},
    /** @param {string} path @returns {VirtualFile|null} */
    get(path) {const file=files.get(resolvePath(path));return file ? {...file,revision:fs.getRevision(file.path),data:copy(file.data)} : null;},
    /** @returns {VirtualFile[]} */
    list() {return [...files.values()].map(file => ({...file,revision:fs.getRevision(file.path),data:copy(file.data)}));},
    listDirectories() {return [...directories].sort();},
    /** Last revision, including deleted paths; zero means never present. @param {string} path */
    getRevision(path) {return revisions.get(resolvePath(path))??0;},
    /** @param {string} path @returns {{type:'file'|'directory',size:number,revision:number}} */
    stat(path) {
      path=resolvePath(path);const file=files.get(path);
      if (file) return {type:'file',revision:fs.getRevision(path),size:typeof file.data === 'string' ? new TextEncoder().encode(file.data).length : file.data.byteLength};
      if (directories.has(path)) return {type:'directory',size:0,revision:fs.getRevision(path)};
      throw Error(`Virtual path not found: ${path}`);
    },
    /** @param {string} [path] */
    readdir(path = '/') {
      path=resolvePath(path);if (fs.stat(path).type !== 'directory') throw Error(`Not a directory: ${path}`);
      return [...new Set([...directories,...files.keys()].filter(p => p !== path && dirname(p) === path).map(p => p.slice(p.lastIndexOf('/') + 1)))].sort();
    },
    /** @param {string} path @param {{recursive?:boolean}} [options] */
    mkdir(path, {recursive = false} = {}) {
      path=resolvePath(path);
      if (directories.has(path)) {if (recursive) return;throw Error(`Directory already exists: ${path}`);}
      if (!recursive && !directories.has(dirname(path))) throw Error('Parent directory does not exist');
      commit(fs.list(), [...directories,path]);
    },
    /** Exact replacement by default. Editing transactions opt into auto capture.
     * @param {Array<{path:string,data:string|Uint8Array|ArrayBuffer}>} entries @param {string[]} [dirs]
     * @param {{checkpointChanges?:boolean}} [options] */
    replace(entries, dirs = [], options={}) {commit(entries, dirs, options);},
    /** @returns {Snapshot} */
    snapshot() {return {version:1,files:fs.list().map(({revision,...file})=>file),directories:fs.listDirectories()};},
    /** In-memory checkpoint, bound to this store. @returns {FileCheckpoint} */
    checkpoint() {return {snapshot:fs.snapshot(),revisions:Object.fromEntries(revisions),scope};},
    /** @param {Snapshot} snapshot */
    restore(snapshot) {if (snapshot.version !== 1) throw Error('Unsupported filesystem snapshot');commit(snapshot.files,snapshot.directories);},
    /** @param {string} path @param {string|Uint8Array|ArrayBuffer} data @param {{expectedRevision?:number}} [options] */
    writeFile(path, data, {expectedRevision} = {}) {
      path=resolvePath(path);expectRevision(path,expectedRevision);
      const next={files:new Map(files),directories:new Set(directories)};
      addFile(next,path,data);
      // A single write cannot remove another file or its checkpoint. Avoid the
      // bulk-edit scans, especially for ordinary editor writes with Auto off.
      if(autoCheckpoint&&checkpointEligible(path)){
        const before=files.get(path),saved=checkpointPath(path);
        if(before&&!files.has(saved)&&!same(before,next.files.get(path))){
          ensureCheckpointIgnore(next);
          addFile(next,saved,path==='/.gitignore'?ignoredData(before.data):before.data);
        }
      }
      publish(next);
    },
    /** Write a group atomically without copying unrelated file data.
     * @param {Array<{path:string,data:string|Uint8Array|ArrayBuffer,expectedRevision?:number}>} entries
     * @param {{checkpointChanges?:boolean}} [options] */
    writeFiles(entries,{checkpointChanges=true}={}) {
      if(!Array.isArray(entries))throw TypeError('writeFiles entries must be an array');
      if(!entries.length)return;
      const next={files:new Map(files),directories:new Set(directories)},paths=new Set();
      for(const entry of entries){
        if(!entry||typeof entry!=='object')throw TypeError('Invalid writeFiles entry');
        const path=resolvePath(entry.path);
        if(paths.has(path))throw Error(`Duplicate writeFiles path: ${path}`);
        paths.add(path);expectRevision(path,entry.expectedRevision);addFile(next,path,entry.data);
      }
      if(checkpointChanges)captureChanges(next);
      publish(next);
    },
    /** @param {string} path @param {string} text @param {{expectedRevision?:number}} [options] */
    writeText(path,text,options) {fs.writeFile(path,String(text),options);},
    /** @param {string} path @param {Uint8Array|ArrayBuffer} bytes @param {{expectedRevision?:number}} [options] */
    writeBinary(path,bytes,options) {if (typeof bytes === 'string') throw TypeError('Expected binary bytes');fs.writeFile(path,bytes,options);},
    /** @param {string} path */
    delete(path) {
      path=resolvePath(path);if (!files.has(path)) return false;
      const saved=checkpointEligible(path)?checkpointPath(path):null;
      const removed=p=>p===path||saved&&(p===saved||p.startsWith(saved+'/'));
      commit(fs.list().filter(f=>!removed(f.path)),[...directories].filter(p=>!removed(p)));return true;
    },
    /** @param {string} path @param {{recursive?:boolean}} [options] */
    remove(path,{recursive = false} = {}) {
      path=resolvePath(path);if (path === '/') throw Error('Cannot remove filesystem root');fs.stat(path);
      const saved=checkpointEligible(path)?checkpointPath(path):null;
      const inside=p => p === path || p.startsWith(path + '/') || saved&&(p===saved||p.startsWith(saved+'/'));
      if (directories.has(path) && !recursive && fs.readdir(path).length) throw Error('Directory is not empty');
      commit(fs.list().filter(f => !inside(f.path)), [...directories].filter(p => !inside(p)));
    },
    /** @param {string} [currentPath] */
    createFileReader(currentPath = '/index.js') {return createVirtualFileReader(fs,currentPath);},
  };
  return fs;
}

/** Atomic copy/move, including empty directories; application policies are external.
 * @param {ReturnType<typeof createVirtualFileSystem>} fs @param {string} source @param {string} destination @param {{copy?:boolean}} [options] */
export function transferVirtualFiles(fs,source,destination,{copy = false} = {}) {
  source=resolvePath(source);destination=resolvePath(destination);
  if (source === destination) return [];
  if (source === '/' || destination.startsWith(source + '/')) throw Error('Cannot move root or place a folder inside itself');
  fs.stat(source);
  if (fs.listDirectories().includes(destination) || fs.has(destination)) throw Error(`Destination already exists: ${destination}`);
  const inside=p => p === source || p.startsWith(source + '/');
  const allFiles=fs.list(),allDirs=fs.listDirectories();
  const selected=allFiles.filter(f => inside(f.path));
  const dirs=allDirs.filter(inside);
  const moved=selected.map(f => ({...f,path:destination + f.path.slice(source.length)}));
  let pairedFiles=[],pairedDirs=[],insideSaved=()=>false;
  if(checkpointEligible(source)&&checkpointEligible(destination)){
    const sourceSaved=checkpointPath(source),destinationSaved=checkpointPath(destination);
    insideSaved=p=>p===sourceSaved||p.startsWith(sourceSaved+'/');
    if(allFiles.some(f=>f.path===destinationSaved||f.path.startsWith(destinationSaved+'/'))||allDirs.some(p=>p===destinationSaved||p.startsWith(destinationSaved+'/')))throw Error(`Checkpoint destination already exists: ${destination}`);
    pairedFiles=allFiles.filter(f=>insideSaved(f.path)).map(f=>({...f,path:destinationSaved+f.path.slice(sourceSaved.length)}));
    pairedDirs=allDirs.filter(insideSaved).map(p=>destinationSaved+p.slice(sourceSaved.length));
  }else if(checkpointEligible(source)&&allFiles.some(f=>f.path===checkpointPath(source)||f.path.startsWith(checkpointPath(source)+'/'))){
    throw Error('Cannot transfer checkpoint-managed files into an internal path');
  }
  const removed=p=>inside(p)||insideSaved(p);
  fs.replace([...allFiles.filter(f => copy || !removed(f.path)),...moved,...pairedFiles],
    [...allDirs.filter(p => copy || !removed(p)),...dirs.map(p => destination + p.slice(source.length)),...pairedDirs]);
  return selected.map(f => ({from:f.path,to:destination + f.path.slice(source.length)}));
}
