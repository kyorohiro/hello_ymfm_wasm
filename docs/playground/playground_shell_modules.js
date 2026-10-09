import {parse} from './vendor/es-module-lexer.js';
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/index.js';

/** Parse actual imports, leaving strings, comments and regular expressions untouched. */
export function rewriteShellImports(source,path) {
  const [imports]=parse(source,path);
  const replacements=[];
  for(const entry of imports){
    if(entry.d===-2)continue; // import.meta keeps the native module meaning.
    if(entry.t!==2||entry.d<0)throw Error(`${path}: static imports/re-exports are not supported; use await import(...)`);
    if(typeof entry.n!=='string'||entry.a>=0)throw Error(`${path}: import requires a string literal without attributes`);
    if(entry.n!=='tetorica:shell'&&!entry.n.startsWith('./')&&!entry.n.startsWith('../'))throw Error(`${path}: unsupported import ${entry.n}`);
    const original=source.slice(entry.ss,entry.se);
    replacements.push({start:entry.ss,end:entry.se,text:`globalThis.__tetoricaShellImport(${JSON.stringify(entry.n)},${JSON.stringify(path)})`+'\n'.repeat((original.match(/\n/g)??[]).length)});
  }
  for(const edit of replacements.reverse())source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
  return source;
}

/** Each run gets its own graph; reject dynamic cycles rather than waiting on itself. */
export function createShellModuleLoader(readFile) {
  const edges=new Map(),sources=new Map();
  function reachable(from,to,seen=new Set()){
    if(from===to)return true;if(seen.has(from))return false;seen.add(from);
    return [...(edges.get(from)??[])].some(path=>reachable(path,to,seen));
  }
  return (specifier,referrer)=>{
    const path=referrer?normalizeVirtualPath(specifier,referrer):normalizeVirtualPath(specifier);
    if(referrer){
      if(reachable(path,referrer))throw Error(`Circular shell import: ${referrer} -> ${path}`);
      if(!edges.has(referrer))edges.set(referrer,new Set());edges.get(referrer).add(path);
    }
    if(sources.has(path))return sources.get(path);
    const file=readFile(path);
    if(!file||file.type!=='text')throw Error(`JavaScript file not found: ${path}`);
    const module={path,source:rewriteShellImports(file.data,path)};sources.set(path,module);return module;
  };
}
