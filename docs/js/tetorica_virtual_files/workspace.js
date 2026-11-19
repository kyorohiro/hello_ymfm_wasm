import {createVirtualFileSystem} from './filesystem.js';
import {fileStores,sameStoredFile,sameStoreState} from './filesystem_internal.js';
import {resolveSyncPath} from './sync.js';
import {dirname} from './path.js';

/** @typedef {import('./filesystem.js').Snapshot} Snapshot */
/** @typedef {import('./filesystem_internal.js').StoreState} StoreState */
/** @typedef {{version:1,working:Snapshot,saved:Snapshot,autoSave:boolean}} WorkspaceSnapshot */
const inside=(path,root)=>root==='/'||path===root||path.startsWith(root+'/');

/** An optional two-version memory workspace. Saved is an accepted-content
 * baseline, not evidence of a browser/database/disk write.
 * @param {Array<{path:string,data:string|Uint8Array|ArrayBuffer}>} [entries]
 * @param {{autoSave?:boolean}} [options] */
export function createVirtualFileWorkspace(entries=[],{autoSave=true}={}) {
  if(typeof autoSave!=='boolean')throw TypeError('autoSave must be a boolean');
  const working=createVirtualFileSystem(entries),savedStore=createVirtualFileSystem();
  const workingAccess=fileStores.get(working),savedAccess=fileStores.get(savedStore);
  if(!workingAccess||!savedAccess)throw Error('Workspace filesystem access is unavailable');
  savedAccess.publish(workingAccess.read(),false);
  let previousWorking=workingAccess.read(),internalWorkingNotification=false;
  const listeners=new Set();
  const notify=()=>{for(const listener of listeners)listener();};
  working.onDidChange(()=>{
    if(internalWorkingNotification){internalWorkingNotification=false;return;}
    const current=workingAccess.read(),changed=!sameStoreState(previousWorking,current);
    previousWorking=current;
    if(!changed)return;
    if(autoSave)savedAccess.publish(current);
    notify();
  });
  const saved=Object.freeze({
    has:savedStore.has,get:savedStore.get,list:savedStore.list,stat:savedStore.stat,
    getRevision:savedStore.getRevision,listDirectories:savedStore.listDirectories,readdir:savedStore.readdir,
    snapshot:savedStore.snapshot,onDidChange:savedStore.onDidChange,createFileReader:savedStore.createFileReader,
  });
  /** @param {StoreState} nextWorking @param {StoreState} nextSaved @param {boolean} [nextAuto] */
  function publish(nextWorking,nextSaved,nextAuto=autoSave) {
    const preferenceChanged=autoSave!==nextAuto;
    const workingChanged=workingAccess.publish(nextWorking,false),savedChanged=savedAccess.publish(nextSaved,false);
    autoSave=nextAuto;previousWorking=workingAccess.read();
    if(workingChanged){internalWorkingNotification=true;workingAccess.notify();}
    if(savedChanged)savedAccess.notify();
    const changed=workingChanged||savedChanged||preferenceChanged;
    if(changed)notify();
    return changed;
  }
  /** @param {string[]} paths @param {StoreState} source @param {StoreState} target */
  function pathsToMirror(paths,source,target) {
    if(!Array.isArray(paths)||!paths.length)throw TypeError('Workspace paths must be a nonempty array');
    const normalized=paths.map(resolveSyncPath);
    if(new Set(normalized).size!==normalized.length)throw Error('Workspace paths must be unique');
    for(const path of normalized)if(!source.files.has(path)&&!source.directories.has(path)&&!target.files.has(path)&&!target.directories.has(path))throw Error(`Virtual path not found in either version: ${path}`);
    return normalized.filter(path=>!normalized.some(parent=>parent!==path&&inside(path,parent)));
  }
  /** Exact subtree mirroring also handles deletion and file/directory changes.
   * Validate the whole candidate before either store or its revisions changes.
   * Immutable records may be shared because no public API exposes their bytes.
   * @param {StoreState} source @param {StoreState} target @param {string[]} paths */
  function mirror(source,target,paths) {
    const selected=pathsToMirror(paths,source,target),selectedPath=path=>selected.some(root=>inside(path,root));
    const files=new Map([...target.files].filter(([path])=>!selectedPath(path)));
    const directories=new Set([...target.directories].filter(path=>!selectedPath(path)));directories.add('/');
    for(const [path,file]of source.files)if(selectedPath(path))files.set(path,file);
    for(const path of source.directories)if(selectedPath(path))directories.add(path);
    function directory(path) {
      if(files.has(path))throw Error(`File blocks directory: ${path}`);
      if(path!=='/')directory(dirname(path));
      directories.add(path);
    }
    for(const path of [...directories])directory(path);
    for(const path of files.keys()) {
      if(directories.has(path))throw Error(`Directory occupies file path: ${path}`);
      directory(dirname(path));
    }
    return {files,directories};
  }
  /** @param {string[]} paths */
  function saveMany(paths) {
    const current=workingAccess.read();
    return publish(current,mirror(current,savedAccess.read(),paths));
  }
  /** @param {string[]} paths */
  function discardMany(paths) {
    const baseline=savedAccess.read();
    return publish(mirror(baseline,workingAccess.read(),paths),baseline);
  }
  function getDirtyPaths(path='/') {
    path=resolveSyncPath(path);
    const current=workingAccess.read(),baseline=savedAccess.read();
    const paths=new Set([...current.files.keys(),...baseline.files.keys(),...current.directories,...baseline.directories]);
    return [...paths].filter(candidate=>inside(candidate,path)&&(
      !sameStoredFile(current.files.get(candidate),baseline.files.get(candidate))||current.directories.has(candidate)!==baseline.directories.has(candidate))).sort();
  }
  /** @param {Snapshot} snapshot */
  function validateSnapshot(snapshot) {
    if(!snapshot||snapshot.version!==1||!Array.isArray(snapshot.files)||!Array.isArray(snapshot.directories))throw Error('Unsupported filesystem snapshot');
    for(const entry of snapshot.files)if(!entry||!['text','binary'].includes(entry.type)||entry.type!==(typeof entry.data==='string'?'text':'binary'))throw TypeError('Workspace snapshot file type does not match its data');
    const temporary=createVirtualFileSystem();temporary.restore(snapshot);
    const access=fileStores.get(temporary);
    if(!access)throw Error('Workspace snapshot access is unavailable');
    return access.read();
  }
  return {
    working,saved,
    get autoSave(){return autoSave;},
    /** Enabling Auto saves outstanding working changes immediately. @param {boolean} value */
    setAutoSave(value) {
      if(typeof value!=='boolean')throw TypeError('autoSave must be a boolean');
      const current=workingAccess.read();return publish(current,value?current:savedAccess.read(),value);
    },
    /** Save a file, directory subtree, or deletion into the saved baseline. @param {string} path */
    save(path){return saveMany([path]);},saveMany,
    saveAll(){return publish(workingAccess.read(),workingAccess.read());},
    /** Discard working edits, including creations/deletions, for this subtree. @param {string} path */
    discard(path){return discardMany([path]);},discardMany,
    isDirty(path='/'){return getDirtyPaths(path).length>0;},getDirtyPaths,
    /** Content-only snapshots contain both versions; revisions are session-local.
     * @returns {WorkspaceSnapshot} */
    snapshot(){return {version:1,working:working.snapshot(),saved:savedStore.snapshot(),autoSave};},
    /** Validate both versions before publishing either. @param {WorkspaceSnapshot} snapshot */
    restore(snapshot) {
      if(!snapshot||snapshot.version!==1||typeof snapshot.autoSave!=='boolean')throw Error('Unsupported workspace snapshot');
      const current=validateSnapshot(snapshot.working),baseline=validateSnapshot(snapshot.saved);
      if(snapshot.autoSave&&!sameStoreState(current,baseline))throw Error('Auto-save workspace snapshots must have matching working and saved contents');
      // Reunite equal immutable records once at load, keeping subsequent small
      // edits from rescanning/copying unchanged large binary files.
      for(const [path,file]of current.files)if(sameStoredFile(file,baseline.files.get(path)))baseline.files.set(path,file);
      return publish(current,baseline,snapshot.autoSave);
    },
    /** One event per meaningful workspace commit; no external storage is used.
     * @param {()=>void} listener */
    onDidChange(listener){if(typeof listener!=='function')throw TypeError('Workspace listener must be a function');listeners.add(listener);return()=>listeners.delete(listener);},
  };
}
