import {transferVirtualFiles} from '../js/tetorica_virtual_files/index.js';

export function sameShellFile(a,b){
  if(!a||!b)return a===b;if(a.type!==b.type)return false;
  if(a.type==='text')return a.data===b.data;
  return a.data.length===b.data.length&&a.data.every((byte,index)=>byte===b.data[index]);
}

/** Live access with per-run observations. All host mutations are synchronous and guarded. */
export function createShellFileSession({fs,context,isCurrent=()=>true,sync=()=>{},onChange=()=>{}}){
  const observed=new Map(fs.list().map(file=>[file.path,file]));
  const observedDirs=new Set(fs.listDirectories());
  const pathOf=path=>{if(typeof path!=='string')throw TypeError('File path must be a string');return context.resolve(path);};
  function guard(){context.assertActive();if(!isCurrent())throw Error('Shell project changed');sync();}
  function writable(paths,operation){
    for(const path of paths){
      if(path==='/sys'||path.startsWith('/sys/'))throw Error('/sys is read-only');
      if(['remove','delete','rename'].includes(operation)&&(path==='/'||path==='/index.js'))throw Error('/index.js is the project entry point');
    }
  }
  function unchanged(path){
    if(!sameShellFile(observed.get(path)??null,fs.get(path)))throw Error(`File changed during script execution: ${path}; read it again before writing`);
  }
  const inside=(path,root)=>path===root||path.startsWith(root+'/');
  function unchangedTree(path){
    const paths=new Set([...observed.keys(),...fs.list().map(file=>file.path)]);
    for(const file of paths)if(inside(file,path))unchanged(file);
    const current=new Set(fs.listDirectories().filter(dir=>inside(dir,path)));
    const previous=new Set([...observedDirs].filter(dir=>inside(dir,path)));
    if(current.size!==previous.size||[...current].some(dir=>!previous.has(dir)))throw Error(`Directory changed during script execution: ${path}`);
  }
  function mutate(paths,operation,action,tree=false){
    guard();writable(paths,operation);for(const path of paths)tree?unchangedTree(path):unchanged(path);
    const beforeDirs=new Set(fs.listDirectories());
    const result=action();
    for(const path of [...observed.keys()])if(paths.some(root=>inside(path,root)))observed.delete(path);
    for(const file of fs.list())if(paths.some(root=>inside(file.path,root)))observed.set(file.path,file);
    const afterDirs=new Set(fs.listDirectories());
    for(const dir of beforeDirs)if(!afterDirs.has(dir))observedDirs.delete(dir);
    for(const dir of afterDirs)if(!beforeDirs.has(dir))observedDirs.add(dir);
    onChange();return result;
  }
  const facade={
    get(path){guard();path=pathOf(path);const file=fs.get(path);observed.set(path,file);return file;},
    has(path){guard();return fs.has(pathOf(path));},
    stat(path){guard();return fs.stat(pathOf(path));},
    readdir(path='.'){guard();return fs.readdir(pathOf(path));},
    list(){guard();const files=fs.list();for(const file of files)observed.set(file.path,file);return files;},
    listDirectories(){guard();return fs.listDirectories();},
    snapshot(){guard();const snapshot=fs.snapshot();for(const file of snapshot.files)observed.set(file.path,file);return snapshot;},
    writeText(path,text){path=pathOf(path);if(typeof text!=='string')throw TypeError('Expected text');return mutate([path],'write',()=>fs.writeText(path,text));},
    writeBinary(path,bytes){path=pathOf(path);return mutate([path],'write',()=>fs.writeBinary(path,bytes));},
    writeFile(path,data){path=pathOf(path);return mutate([path],'write',()=>fs.writeFile(path,data));},
    mkdir(path,options={}){path=pathOf(path);return mutate([path],'mkdir',()=>fs.mkdir(path,options));},
    delete(path){path=pathOf(path);return mutate([path],'delete',()=>fs.delete(path));},
    remove(path,options={}){path=pathOf(path);return mutate([path],'remove',()=>fs.remove(path,options),true);},
    rename(from,to){from=pathOf(from);to=pathOf(to);writable([from],'rename');return mutate([from,to],'rename',()=>transferVirtualFiles(fs,from,to),true);},
    copy(from,to){from=pathOf(from);to=pathOf(to);return mutate([to],'copy',()=>transferVirtualFiles(fs,from,to,{copy:true}),true);},
    replace(entries,dirs=[]){
      guard();const current=fs.list(),next=new Map(entries.map(file=>[file.path,file]));
      const changed=[...new Set([...current.map(file=>file.path),...next.keys()])].filter(path=>!sameShellFile(fs.get(path),next.get(path)??null));
      const changedDirs=[...new Set([...fs.listDirectories(),...dirs])].filter(path=>fs.listDirectories().includes(path)!==dirs.includes(path));
      writable([...changed,...changedDirs],'replace');
      if(!next.has('/index.js')&&fs.has('/index.js'))throw Error('/index.js is the project entry point');
      return mutate(changed,'replace',()=>fs.replace(entries,dirs));
    },
    createFileReader(){return (path,options)=>facade.readFile(path,options);},
    readFile(path,{type='text'}={}){
      const file=facade.get(path);if(!file)throw Error(`File not found: ${path}`);
      const bytes=file.type==='text'?new TextEncoder().encode(file.data):file.data;
      if(type==='text')return file.type==='text'?file.data:new TextDecoder().decode(bytes);
      if(type==='json')return JSON.parse(new TextDecoder().decode(bytes));
      if(type==='binary')return bytes;
      if(type==='arrayBuffer')return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
      throw Error(`Unsupported read type: ${type}`);
    },
  };
  // Whole-store replacement is used only by trusted built-in copy/move, never exposed over RPC.
  const exposed=['get','has','stat','readdir','list','listDirectories','snapshot','readFile','writeFile','writeText','writeBinary','mkdir','delete','remove','rename','copy'];
  return {facade,guard,invoke(method,args){if(!exposed.includes(method))throw Error('Unsupported filesystem operation');return facade[method](...args);}};
}
