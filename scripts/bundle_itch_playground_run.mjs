// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
// Build-only optimization of a disposable itch browser stage, never source files.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstat,mkdir,readFile,readdir,realpath,unlink,writeFile} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build,version as esbuildVersion} from 'esbuild';
import {init,parse} from '../docs/playground/vendor/es-module-lexer.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const slash=name=>name.split(sep).join('/');
const clean=name=>name.replace(/[?#].*$/,'');
const within=(root,path)=>{const name=relative(root,path);return !isAbsolute(name)&&name!=='..'&&!name.startsWith('..'+sep);};
async function filesIn(root,prefix=''){
 const result=[];
 for(const item of await readdir(join(root,prefix),{withFileTypes:true})){
  const name=prefix?prefix+'/'+item.name:item.name,info=await lstat(join(root,name));
  if(info.isSymbolicLink())throw Error('Browser bundle stage must not contain symlinks: '+name);
  if(info.isDirectory())result.push(...await filesIn(root,name));
  else if(info.isFile())result.push(name);else throw Error('Unexpected stage file: '+name);
 }
 return result.sort();
}
function relativeTarget(name,specifier){
 if(!specifier.startsWith('.'))return null;
 const target=slash(relative('.',resolve(dirname(name),clean(specifier))));
 return target.startsWith('../')||isAbsolute(target)?null:target;
}
function moduleURLSource(source,name,suffix){
 const imports=parse(source)[0];let contents=source,count=0;
 for(const token of [...imports].reverse()){
  if(token.d!==-2)continue;
  const tail=source.slice(token.e).match(/^\s*\.\s*url\b/);
  if(!tail)throw Error('Unsupported import.meta use in root UI module: '+name);
  contents=contents.slice(0,token.s)+`new globalThis.URL(${JSON.stringify('./'+name+suffix)},import.meta.url).href`+contents.slice(token.e+tail[0].length);count++;
 }
 return {contents,count};
}
const archiveWriter=String.raw`
import json,sys,zipfile
from pathlib import Path
root=Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name in json.load(sys.stdin):
  i=zipfile.ZipInfo(name,(1980,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;i.create_system=3;i.external_attr=0o100644<<16
  z.writestr(i,(root/name).read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
`;
const archiveInspector=String.raw`
import hashlib,json,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 print(json.dumps([{ "path":i.filename,"bytes":i.file_size,"sha256":hashlib.sha256(z.read(i)).hexdigest()} for i in z.infolist()]))
`;

/** Bundle root page UI only. Audio, Worker, vendor and subdirectory modules stay original. */
export async function bundleItchPlaygroundRun(stage){
 const info=await lstat(resolve(stage));
 if(!info.isDirectory()||info.isSymbolicLink())throw Error('Browser bundle stage must be a real directory');
 const root=await realpath(resolve(stage)),names=await filesIn(root),original=new Map();
 if(!names.includes('index.html')||!names.includes('playground.js'))throw Error('Browser bundle needs root index.html and playground.js');
 for(const name of ['sources/browser-bundle-inputs.zip','sources/browser-bundle.json'])if(names.includes(name))throw Error('Browser stage is already bundled: '+name);
 for(const name of names){const bytes=await readFile(join(root,name));original.set(name,{bytes:bytes.length,sha256:hash(bytes)});}
 await init();const rebased=new Map();
 const result=await build({absWorkingDir:root,entryPoints:['playground.js'],outfile:'playground.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,keepNames:true,legalComments:'linked',metafile:true,write:false,logLevel:'silent',plugins:[{
  name:'retain-original-subdirectory-modules',setup(builder){
   builder.onResolve({filter:/.*/},args=>{
    if(args.kind==='entry-point')return;
    if(!args.path.startsWith('.'))return {path:args.path,external:true};
    const path=resolve(args.resolveDir,clean(args.path));
    if(dirname(path)!==root||!path.endsWith('.js'))return {path:args.path,external:true};
    return {path,suffix:args.path.slice(clean(args.path).length)};
   });
   builder.onLoad({filter:/\.js$/},async args=>{
    if(dirname(args.path)!==root)return;
    const source=await readFile(args.path,'utf8'),name=basename(args.path);
    // Keep the entry URL itself (including its cache query) unchanged. Other
    // real import.meta.url tokens retain their former module URL; strings do not change.
    const transformed=name==='playground.js'?{contents:source,count:0}:moduleURLSource(source,name,args.suffix||'');
    rebased.set(name+(args.suffix||''),transformed.count);return {contents:transformed.contents,loader:'js'};
   });
  }
 }]});
 const inputs=[...new Set(Object.keys(result.metafile.inputs).map(clean))].sort();
 for(const name of inputs)assert(!name.includes('/')&&name.endsWith('.js')&&original.has(name),'Only original root JavaScript may be bundled: '+name);
 const candidates=new Set(inputs.filter(name=>name!=='playground.js')),retained=new Set(),graph=new Map(),assetRoots=new Set(),nonliteral=[];
 // Only production modules can import retained UI inputs. Sample code and the
 // downloadable source archives are data, not application dependency roots.
 for(const name of names.filter(name=>name.endsWith('.js')&&!/^(?:sources|assets|examples)\//.test(name))){
  const source=await readFile(join(root,name),'utf8'),imports=parse(source)[0],dependencies=[];
  for(const token of imports){
   if(token.n){const target=relativeTarget(name,token.n);if(target)dependencies.push(target);}
   else if(token.d>=0&&!name.includes('/')){
    // This existing worker imports a Blob made from Virtual Files, never a
    // shipped root module. Unknown root dynamic imports disable pruning.
    const blobOnly=name==='playground_shell_worker.js'&&source.slice(token.s,token.e).trim()==='url'&&/const url=URL\.createObjectURL\(new Blob\(/.test(source);
    nonliteral.push({path:name,policy:blobOnly?'retained VFS Blob loader':'retain all bundled root inputs'});
    if(!blobOnly)for(const candidate of candidates)retained.add(candidate);
   }
  }
  graph.set(name,dependencies);
  // Worker/asset module URL strings are deliberately not esbuild import edges.
  for(const match of source.matchAll(/\bnew\s+(?:globalThis\.)?(?:URL|Worker|SharedWorker)\s*\(\s*(['"])([^'"\n]+\.js(?:[?#][^'"\n]*)?)\1/g)){
   const target=relativeTarget(name,match[2]);if(target)assetRoots.add(target);
  }
 }
 const html=await readFile(join(root,'index.html'),'utf8');
 for(const match of html.matchAll(/\bsrc\s*=\s*(['"])([^'"]+\.js(?:[?#][^'"]*)?)\1/g)){
  const target=relativeTarget('index.html',match[2].startsWith('.')?match[2]:'./'+match[2]);if(target&&target!=='playground.js')assetRoots.add(target);
 }
 const queue=[...graph.keys()].filter(name=>!inputs.includes(name));queue.push(...assetRoots,...retained);
 const visited=new Set();
 while(queue.length){const name=queue.pop();if(visited.has(name))continue;visited.add(name);if(candidates.has(name))retained.add(name);queue.push(...(graph.get(name)||[]));}
 const removed=[...candidates].filter(name=>!retained.has(name)).sort();
 const externalImports=[...new Set(Object.values(result.metafile.outputs).flatMap(output=>output.imports.filter(item=>item.external).map(item=>item.path)))].sort();
 for(const specifier of externalImports){
  if(!specifier.startsWith('.'))throw Error('Unexpected non-relative external import: '+specifier);
  const path=resolve(root,clean(specifier));if(!within(root,path)||!original.has(slash(relative(root,path))))throw Error('Missing external browser module: '+specifier);
 }
 for(const name of assetRoots)if(candidates.has(name))assert(!removed.includes(name),'Worker/URL module retained: '+name);
 await mkdir(join(root,'sources'),{recursive:true});
 const archivePath='sources/browser-bundle-inputs.zip',archiveNames=[...inputs,...names.filter(name=>!name.includes('/')&&/^(?:LICENSE|COPYING|NOTICE|THIRD_PARTY_LICENSES)(?:[.\-_]|$)/.test(name))].sort();
 execFileSync(process.env.PYTHON||'python3',['-c',archiveWriter,root,join(root,archivePath)],{input:JSON.stringify(archiveNames),encoding:'utf8'});
 const archived=JSON.parse(execFileSync(process.env.PYTHON||'python3',['-c',archiveInspector,join(root,archivePath)],{encoding:'utf8',maxBuffer:8*1024*1024}));
 assert.deepEqual(archived.map(item=>item.path).sort(),archiveNames,'All original UI inputs archived');
 for(const item of archived)assert.deepEqual({bytes:item.bytes,sha256:item.sha256},original.get(item.path),'Original archived UI source: '+item.path);
 const output=result.outputFiles.find(file=>basename(file.path)==='playground.js');assert(output,'Bundled root output exists');
 const outputSHA=hash(output.contents),importURL='./playground.js?v=run-bundle-'+outputSHA.slice(0,16);
 let entryMatches=0;
 const updatedHTML=html.replace(/(\bimport\s*\(\s*)(['"])(\.\/playground\.js(?:[?#][^'"]*)?)\2/g,(_all,prefix,quote)=>{entryMatches++;return prefix+quote+importURL+quote;});
 if(entryMatches!==1)throw Error('Expected exactly one root playground.js startup import; got '+entryMatches);
 for(const file of result.outputFiles){const name=slash(relative(root,file.path));assert(within(root,file.path)&&!name.includes('/'),'Only root bundle outputs allowed');await writeFile(file.path,file.contents);}
 await writeFile(join(root,'index.html'),updatedHTML);
 for(const name of removed)await unlink(join(root,name));
 const changed=new Set(['playground.js','index.html',...removed]);let unchangedFiles=0;
 for(const name of names){if(changed.has(name))continue;const bytes=await readFile(join(root,name));assert.deepEqual({bytes:bytes.length,sha256:hash(bytes)},original.get(name),'Retained original browser file: '+name);unchangedFiles++;}
 const archiveBytes=await readFile(join(root,archivePath));
 const receipt={format:1,scope:'Root page UI only; subdirectory modules, audio DSP, Worker/Worklet sources and vendor files retain original bytes',builder:{name:'esbuild',version:esbuildVersion,format:'esm',platform:'browser',target:'es2022',minify:true,keepNames:true,legalComments:'linked',sourceMap:false},entry:{path:'playground.js',bytes:output.contents.length,sha256:outputSHA,importURL},inputs:inputs.map(path=>({path,...original.get(path)})),removed,retainedBundledInputs:[...retained].sort(),assetModuleRoots:[...assetRoots].sort(),externalImports,nonliteralDynamicImports:nonliteral,importMetaURLReplacements:[...rebased].filter(([,count])=>count).map(([path,count])=>({path,count})),sourceArchive:{path:archivePath,files:archived.length,bytes:archiveBytes.length,sha256:hash(archiveBytes),allOriginalBytesVerified:true},originalFilesUnchanged:unchangedFiles,inputFileCount:names.length,outputFileCount:(await filesIn(root)).length+1,warnings:result.warnings.map(warning=>({text:warning.text,path:warning.location?.file,line:warning.location?.line}))};
 await writeFile(join(root,'sources/browser-bundle.json'),JSON.stringify(receipt,null,2)+'\n');
 return {passed:true,...receipt};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3)throw Error('Usage: node scripts/bundle_itch_playground_run.mjs <disposable-browser-stage>');
 console.log(JSON.stringify(await bundleItchPlaygroundRun(process.argv[2]),null,2));
}
