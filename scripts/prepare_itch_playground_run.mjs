// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
// Preserve the complete distribution while preparing an itch browser upload.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, unlink, writeFile} from 'node:fs/promises';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ITCH_ZIP_LIMITS=Object.freeze({entries:1000,pathCharacters:240,totalBytes:500_000_000,fileBytes:200_000_000});
const archiveName='corresponding-source.zip';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const slash=value=>value.split(sep).join('/');
const inside=(parent,child)=>{const rel=relative(parent,child);return rel===''||!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel);};
const safeName=name=>typeof name==='string'&&name.length>0&&!name.includes('\\')&&!name.includes('\0')&&!name.startsWith('/')&&!/^[A-Za-z]:/.test(name)&&!name.split('/').some(part=>part==='..'||part==='.')&&name.replace(/\/$/,'').split('/').every(Boolean);
const codeFile=name=>/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|sh)$/i.test(name);
const guideFile=name=>! /^(?:LICENSE|COPYING|NOTICE|AUTHORS|UPSTREAM)(?:[.\-_]|$)/i.test(basename(name))&&(/^[^/]+\.md$/i.test(name)||/^native\/[^/]+\/README\.md$/.test(name));

/** Count every central-directory entry, including directory records. */
export function validateItchZipEntries(entries,limits=ITCH_ZIP_LIMITS){
 if(!Array.isArray(entries))throw Error('ZIP entries must be an array');
 if(entries.length>limits.entries)throw Error(`Too many files in zip (${entries.length} > ${limits.entries}); directory entries count too`);
 const names=new Set();let files=0,directories=0,totalBytes=0,maxFileBytes=0,maxPathCharacters=0;
 for(const entry of entries){
  if(!safeName(entry.name))throw Error('Unsafe ZIP path: '+JSON.stringify(entry.name));
  if(names.has(entry.name))throw Error('Duplicate ZIP entry: '+entry.name);names.add(entry.name);
  if(entry.symlink)throw Error('ZIP symlinks are not allowed: '+entry.name);
  const length=Array.from(entry.name).length;maxPathCharacters=Math.max(maxPathCharacters,length);
  if(length>limits.pathCharacters)throw Error('ZIP path exceeds '+limits.pathCharacters+' characters: '+entry.name);
  if(!Number.isSafeInteger(entry.bytes)||entry.bytes<0)throw Error('Invalid expanded ZIP size: '+entry.name);
  if(entry.directory){directories++;continue;}files++;totalBytes+=entry.bytes;maxFileBytes=Math.max(maxFileBytes,entry.bytes);
  if(entry.bytes>limits.fileBytes)throw Error('ZIP file exceeds '+limits.fileBytes+' expanded bytes: '+entry.name);
 }
 if(totalBytes>limits.totalBytes)throw Error('ZIP exceeds '+limits.totalBytes+' total expanded bytes');
 if(!entries.some(entry=>entry.name==='index.html'&&!entry.directory&&!entry.symlink))throw Error('ZIP needs a regular index.html at its root');
 return {entryCount:entries.length,files,directories,totalBytes,maxFileBytes,maxPathCharacters,limits};
}

const zipInspector=String.raw`
import hashlib,json,stat,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    result=[]
    for i in z.infolist():
        r={"name":i.filename,"directory":i.is_dir(),"bytes":i.file_size,"symlink":stat.S_ISLNK(i.external_attr>>16)}
        if sys.argv[2]=="hash" and not i.is_dir():r["sha256"]=hashlib.sha256(z.read(i)).hexdigest()
        result.append(r)
    print(json.dumps(result))
`;
function zipEntries(file,hash=false){
 return JSON.parse(execFileSync(process.env.PYTHON||'python3',['-c',zipInspector,resolve(file),hash?'hash':'directory'],{encoding:'utf8',maxBuffer:16*1024*1024}));
}
export function checkItchPlaygroundZip(file){
 return {archive:resolve(file),...validateItchZipEntries(zipEntries(file))};
}

async function walk(directory,prefix=''){
 const files=[];
 for(const item of await readdir(join(directory,prefix),{withFileTypes:true})){
  const name=prefix?prefix+'/'+item.name:item.name,info=await lstat(join(directory,name));
  if(!safeName(name))throw Error('Unsafe stage path: '+name);
  if(info.isSymbolicLink())throw Error('Stage symlinks are not allowed: '+name);
  if(info.isDirectory())files.push(...await walk(directory,name));
  else if(info.isFile())files.push(name);else throw Error('Stage contains a non-regular file: '+name);
 }
 return files.sort();
}
function preface(name,archiveSha){
 const link=slash(relative(dirname(name),archiveName));
 return `> Browser upload source bundle: [Download the complete corresponding source](${link}) (SHA-256: \`${archiveSha}\`).\n> Extract that ZIP into a new directory before following the build instructions below. Its root contains \`native/\`, \`third_party/\`, \`wasm/\` and \`scripts/\` at their original paths. The ZIP preserves every original source, guide, license, notice and receipt byte. Hashes in receipts describe those extracted originals; this browser-facing guide has only this navigation preface.\n\n`;
}

export async function prepareItchPlaygroundRun(fullStage,runStage,{bundle=false}={}){
 const input=resolve(fullStage),requested=resolve(runStage),sourceInfo=await lstat(input);
 if(!sourceInfo.isDirectory()||sourceInfo.isSymbolicLink())throw Error('Full stage must be a real directory');
 const full=await realpath(input),parent=await realpath(dirname(requested)),run=join(parent,basename(requested));
 if(inside(full,run)||inside(run,full))throw Error('Full and browser stages must not overlap');
 try{await lstat(run);throw Error('Browser stage already exists; choose an empty destination: '+run);}catch(error){if(error.code!=='ENOENT')throw error;}
 const inputFiles=await walk(full);
 if(!inputFiles.includes('index.html')||!inputFiles.includes('LICENSE'))throw Error('Full stage needs index.html and LICENSE');
 const sourceNames=inputFiles.filter(name=>name.startsWith('sources/')).map(name=>name.slice(8));
 if(!sourceNames.length||sourceNames.includes(archiveName)||sourceNames.includes('README-for-run.md'))throw Error('Expected an original, unpacked sources/ tree');
 const removed=sourceNames.filter(codeFile);if(!removed.length)throw Error('No corresponding compilation sources found');
 const temporary=await mkdtemp(join(parent,'.itch-run-prepare-')),original=new Map();
 let committed=false;
 try{
  for(const name of inputFiles){const bytes=await readFile(join(full,name));original.set(name,{bytes:bytes.length,sha256:sha(bytes)});await mkdir(dirname(join(temporary,name)),{recursive:true});await writeFile(join(temporary,name),bytes);}
  const sourceArchive=join(temporary,'sources',archiveName);
  const buildZip=String.raw`
import json,sys,zipfile
from pathlib import Path
root=Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name in json.load(sys.stdin):
        i=zipfile.ZipInfo(name,(1980,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;i.create_system=3;i.external_attr=0o100644<<16
        z.writestr(i,(root/name).read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
`;
  execFileSync(process.env.PYTHON||'python3',['-c',buildZip,join(temporary,'sources'),sourceArchive],{input:JSON.stringify(sourceNames),encoding:'utf8'});
  const inner=zipEntries(sourceArchive,true);assert.equal(inner.length,sourceNames.length,'Complete source archive entry count');
  assert.deepEqual(inner.map(entry=>entry.name).sort(),sourceNames,'Complete original source path set');
  for(const entry of inner){assert(!entry.directory&&!entry.symlink,'Only regular source files');assert.deepEqual({bytes:entry.bytes,sha256:entry.sha256},original.get('sources/'+entry.name),'Archived original source bytes: '+entry.name);}
  const archiveBytes=await readFile(sourceArchive),archiveSha=sha(archiveBytes);
  for(const name of removed)await unlink(join(temporary,'sources',name));
  const guides=sourceNames.filter(name=>!codeFile(name)&&guideFile(name));
  for(const name of guides){const file=join(temporary,'sources',name);await writeFile(file,preface(name,archiveSha)+await readFile(file,'utf8'));}
  await writeFile(join(temporary,'sources/README-for-run.md'),`# Corresponding source for this browser upload\n\n[Download all corresponding sources](${archiveName}) (SHA-256: \`${archiveSha}\`). The ZIP contains all ${sourceNames.length} original source files, standalone build recipes, licenses, notices, provenance and receipts, without changes. Extract into a new directory and follow the included chip guides. The extracted source root retains every original relative path; with Emscripten installed, for example, run \`sh scripts/build_cdda_wasm.sh ../generated\`.\n\nThe complete downloadable Playground distribution also retains the expanded source tree. This browser upload keeps user-facing source guides, license/notice/provenance files and receipts accessible, and moves only C/C++/header/shell build files into the source ZIP to stay within [itch.io HTML upload limits](https://itch.io/docs/creators/html5#zip-file-requirements). Audio modules, WASM, samples, examples and declarations retain their original files. ${bundle?'Page UI modules are bundled and minified; the bundle receipt and original UI inputs are included separately under sources/.':'Page UI modules also retain their original files.'} Guide copies have a download preface; receipt hashes refer to the unmodified files inside the source ZIP.\n`);
  const guidePaths=new Set(guides.map(name=>'sources/'+name)),removedPaths=new Set(removed.map(name=>'sources/'+name));
  let unchanged=0;
  for(const name of inputFiles){
   // The full stage is never changed, even when the browser guides are adapted.
   const originalBytes=await readFile(join(full,name));assert.deepEqual({bytes:originalBytes.length,sha256:sha(originalBytes)},original.get(name),'Full stage remained unchanged: '+name);
   if(removedPaths.has(name)||guidePaths.has(name))continue;
   const bytes=await readFile(join(temporary,name));assert.deepEqual({bytes:bytes.length,sha256:sha(bytes)},original.get(name),'Unchanged browser asset/license/notice/receipt: '+name);unchanged++;
  }
  // Bundle only the copied browser stage. Check the hosting limit afterwards,
  // so a larger full distribution can shrink below the limit in this step.
  const bundled=bundle?await (await import('./bundle_itch_playground_run.mjs')).bundleItchPlaygroundRun(temporary):null;
  const outputFiles=await walk(temporary);
  const outputEntries=await Promise.all(outputFiles.map(async name=>({name,directory:false,symlink:false,bytes:(await lstat(join(temporary,name))).size})));
  const predicted=validateItchZipEntries(outputEntries);
  await rename(temporary,run);committed=true;
  return {passed:true,fullStage:full,runStage:run,inputFiles:inputFiles.length,sourceArchive:{path:'sources/'+archiveName,files:inner.length,bytes:archiveBytes.length,sha256:archiveSha,allOriginalSourceBytesVerified:true,directoryEntries:0},removedCompilationFiles:removed.map(name=>'sources/'+name),prefacedGuides:[...guidePaths],unchangedFilesVerifiedBeforeBundle:unchanged,fullStageUnchanged:true,bundle:bundled,predictedZip:predicted,note:'Create the outer ZIP with no directory records (zip -D), then use --check-zip to validate the actual archive including directory entries.'};
 }finally{if(!committed)await rm(temporary,{recursive:true,force:true});}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args[0]==='--check-zip'&&args.length===2)console.log(JSON.stringify({passed:true,...checkItchPlaygroundZip(args[1])},null,2));
 else {
  const bundle=args.includes('--bundle'),paths=args.filter(arg=>arg!=='--bundle');
  if(paths.length!==2||paths.some(arg=>arg.startsWith('--'))||args.length!==paths.length+Number(bundle))throw Error('Usage: node scripts/prepare_itch_playground_run.mjs <full-stage> <run-stage> [--bundle] | --check-zip <browser.zip>');
  console.log(JSON.stringify(await prepareItchPlaygroundRun(...paths,{bundle}),null,2));
 }
}
