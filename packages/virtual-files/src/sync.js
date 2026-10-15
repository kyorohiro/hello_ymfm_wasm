import {resolvePath, dirname} from './path.js';

/** @typedef {import('./filesystem.js').Snapshot} Snapshot */
/** @typedef {import('./filesystem.js').StoredFile} StoredFile */

/** Virtual sync does not interpret external storage addresses.
 * @param {string} path */
export function resolveSyncPath(path) {
  if(typeof path!=='string'||!path)throw Error('Sync requires a nonempty virtual path');
  if(/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)||path.includes('://'))throw Error(`Unsupported sync location: ${path}`);
  return resolvePath(path);
}

/** @param {string|Uint8Array|ArrayBuffer} data @param {boolean} [share] */
function copyData(data,share=false) {
  if(typeof data==='string')return data;
  if(data instanceof Uint8Array)return share?data:new Uint8Array(data);
  if(data instanceof ArrayBuffer)return new Uint8Array(data.slice(0));
  throw TypeError('Virtual file data must be text or binary bytes');
}

const inside=(path,root)=>root==='/'||path===root||path.startsWith(root+'/');
const same=(a,b)=>a.type===b.type&&(a.type==='text'?a.data===b.data:a.data.length===b.data.length&&a.data.every((value,index)=>value===b.data[index]));

/** Plan a one-way mirror between exact paths in one virtual snapshot.
 * Source may be a file or a directory, including an empty directory. Existing
 * destination-only descendants are removed; everything outside it is retained.
 * A directory is the target itself, never an implicit containing directory.
 * No filesystem is changed. Returned bytes are independent of the input and
 * of their source counterparts. Callers validate/publish the plan atomically.
 * Internal shareUnchanged mode retains validated backing bytes for unaffected
 * files. Its caller must own those bytes and never expose the returned storage
 * directly. Newly mirrored destination bytes are always copied in this mode.
 * @param {Snapshot} snapshot
 * @param {string} source
 * @param {string} destination
 * @param {{exclude?:string[],shareUnchanged?:boolean}} [options] Source exclusions and an internal storage-sharing optimization.
 * @returns {{snapshot:Snapshot,changed:boolean}} */
export function planVirtualFileSync(snapshot,source,destination,{exclude=[],shareUnchanged=false}={}) {
  source=resolveSyncPath(source);destination=resolveSyncPath(destination);
  if(!Array.isArray(exclude))throw TypeError('Sync exclude must be an array of virtual paths');
  if(typeof shareUnchanged!=='boolean')throw TypeError('Sync shareUnchanged must be a boolean');
  const excludedPaths=exclude.map(resolveSyncPath),excluded=path=>excludedPaths.some(root=>inside(path,root));
  if(!snapshot||snapshot.version!==1||!Array.isArray(snapshot.files)||!Array.isArray(snapshot.directories))throw Error('Unsupported filesystem snapshot');
  /** @type {Map<string,StoredFile>} */
  const files=new Map();
  const directories=new Set(['/']);
  function directory(path) {
    path=resolveSyncPath(path);
    if(files.has(path))throw Error(`File blocks directory: ${path}`);
    if(path!=='/')directory(dirname(path));
    directories.add(path);
  }
  for(const path of snapshot.directories)directory(path);
  for(const entry of snapshot.files){
    if(!entry||typeof entry!=='object')throw Error('Invalid virtual file entry');
    const path=resolveSyncPath(entry.path),data=copyData(entry.data,shareUnchanged);
    const type=typeof data==='string'?'text':'binary';
    if(entry.type!==undefined&&entry.type!==type)throw Error(`Virtual file type does not match its data: ${path}`);
    if(files.has(path)||directories.has(path))throw Error(`Conflicting virtual path: ${path}`);
    directory(dirname(path));
    files.set(path,{path,type,data});
  }
  const toSnapshot=(nextFiles,nextDirs)=>({version:/** @type {const} */(1),files:[...nextFiles.values()],directories:[...nextDirs].sort()});
  if(!files.has(source)&&!directories.has(source))throw Error(`Virtual path not found: ${source}`);
  if(source===destination)return {snapshot:toSnapshot(files,directories),changed:false};
  if(excluded(source))throw Error('Sync source cannot be excluded');
  if(inside(source,destination)||inside(destination,source)&&!excluded(destination))throw Error('Sync source and destination must not overlap unless the destination subtree is excluded');

  const sourceFiles=[...files.values()].filter(file=>inside(file.path,source)&&!excluded(file.path));
  const sourceDirectories=[...directories].filter(path=>inside(path,source)&&!excluded(path));
  const target=path=>destination+(source==='/'?(path==='/'?'':path):path.slice(source.length));
  for(const file of sourceFiles)if(directories.has(target(file.path)))throw Error(`Directory occupies sync file path: ${target(file.path)}`);
  for(const path of sourceDirectories)if(files.has(target(path)))throw Error(`File occupies sync directory path: ${target(path)}`);

  const nextFiles=new Map([...files].filter(([path])=>!inside(path,destination)));
  const nextDirs=new Set([...directories].filter(path=>!inside(path,destination)));
  function targetDirectory(path) {
    if(nextFiles.has(path))throw Error(`File blocks directory: ${path}`);
    if(path!=='/')targetDirectory(dirname(path));
    nextDirs.add(path);
  }
  for(const path of sourceDirectories)targetDirectory(target(path));
  for(const file of sourceFiles){
    const path=target(file.path);
    targetDirectory(dirname(path));
    nextFiles.set(path,{path,type:file.type,data:copyData(file.data)});
  }
  const changed=files.size!==nextFiles.size||directories.size!==nextDirs.size||[...files].some(([path,file])=>!nextFiles.has(path)||!same(file,nextFiles.get(path)))||[...directories].some(path=>!nextDirs.has(path));
  return {snapshot:toSnapshot(nextFiles,nextDirs),changed};
}
