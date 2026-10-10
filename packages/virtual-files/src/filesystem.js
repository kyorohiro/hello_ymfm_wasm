import {resolvePath, dirname} from './path.js';
import {createVirtualFileReader} from './reader.js';
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
 * @param {Array<{path:string,data:string|Uint8Array|ArrayBuffer}>} [entries] */
export function createVirtualFileSystem(entries = []) {
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
  function commit(entries, dirs) {const next=build(entries, dirs);updateRevisions(next.files,next.directories);files=next.files;directories=next.directories;notify();}
  const initial=build(entries);updateRevisions(initial.files,initial.directories);files=initial.files;directories=initial.directories;
  const fs = {
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
    /** @param {Array<{path:string,data:string|Uint8Array|ArrayBuffer}>} entries @param {string[]} [dirs] */
    replace(entries, dirs = []) {commit(entries, dirs);},
    /** @returns {Snapshot} */
    snapshot() {return {version:1,files:fs.list().map(({revision,...file})=>file),directories:fs.listDirectories()};},
    /** In-memory checkpoint, bound to this store. @returns {FileCheckpoint} */
    checkpoint() {return {snapshot:fs.snapshot(),revisions:Object.fromEntries(revisions),scope};},
    /** @param {Snapshot} snapshot */
    restore(snapshot) {if (snapshot.version !== 1) throw Error('Unsupported filesystem snapshot');commit(snapshot.files,snapshot.directories);},
    /** @param {string} path @param {string|Uint8Array|ArrayBuffer} data @param {{expectedRevision?:number}} [options] */
    writeFile(path, data, {expectedRevision} = {}) {
      path=resolvePath(path);data=copy(data);expectRevision(path,expectedRevision);
      if(directories.has(path))throw Error(`Directory occupies file path: ${path}`);
      const nextDirs=new Set(directories);
      for(let parent=dirname(path);parent!=='/';parent=dirname(parent)){
        if(files.has(parent))throw Error(`File blocks directory: ${parent}`);
        nextDirs.add(parent);
      }
      const nextFiles=new Map(files);nextFiles.set(path,{path,type:typeof data==='string'?'text':'binary',data});
      updateRevisions(nextFiles,nextDirs);files=nextFiles;directories=nextDirs;notify();
    },
    /** @param {string} path @param {string} text @param {{expectedRevision?:number}} [options] */
    writeText(path,text,options) {fs.writeFile(path,String(text),options);},
    /** @param {string} path @param {Uint8Array|ArrayBuffer} bytes @param {{expectedRevision?:number}} [options] */
    writeBinary(path,bytes,options) {if (typeof bytes === 'string') throw TypeError('Expected binary bytes');fs.writeFile(path,bytes,options);},
    /** @param {string} path */
    delete(path) {path=resolvePath(path);if (!files.has(path)) return false;commit(fs.list().filter(f => f.path !== path), [...directories]);return true;},
    /** @param {string} path @param {{recursive?:boolean}} [options] */
    remove(path,{recursive = false} = {}) {
      path=resolvePath(path);if (path === '/') throw Error('Cannot remove filesystem root');fs.stat(path);
      const inside=p => p === path || p.startsWith(path + '/');
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
  const selected=fs.list().filter(f => inside(f.path));
  const dirs=fs.listDirectories().filter(inside);
  const moved=selected.map(f => ({...f,path:destination + f.path.slice(source.length)}));
  fs.replace([...fs.list().filter(f => copy || !inside(f.path)),...moved],
    [...fs.listDirectories().filter(p => copy || !inside(p)),...dirs.map(p => destination + p.slice(source.length))]);
  return selected.map(f => ({from:f.path,to:destination + f.path.slice(source.length)}));
}
