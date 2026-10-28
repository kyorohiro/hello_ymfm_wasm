// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
// Validate exactly the four default itch artifacts, without rebuilding audio.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkItchPlaygroundZip, validateItchZipEntries} from './prepare_itch_playground_run.mjs';

export const ITCH_RELEASE_ARTIFACTS = Object.freeze([
  {id:'synth', stage:'itch_synth_dev', archive:'hello_ymfm_wasm_dev_itch_synth.zip', browserPlayable:true,
    required:['synth.js','synth_preset_import.js']},
  {id:'vgm-analyzer', stage:'itch_vgm_analyzer_dev', archive:'hello_ymfm_wasm_dev_itch_vgm_analyzer.zip', browserPlayable:true,
    required:['vgm_analyzer.js','playback_core.js']},
  {id:'playground-full', stage:'itch_playground_dev', archive:'hello_ymfm_wasm_dev_itch_playground.zip', browserPlayable:false,
    required:['playground.js','playground_vgm_import.js','sources/CDDA.json','sources/MSM5205.json']},
  {id:'playground-run', stage:'itch_playground_dev_for_run', archive:'hello_ymfm_wasm_dev_itch_playground_for_run.zip', browserPlayable:true,
    required:['playground.js','sources/browser-bundle.json','sources/browser-bundle-inputs.zip','sources/corresponding-source.zip','sources/README-for-run.md']},
].map(item=>Object.freeze({...item, required:Object.freeze(item.required)})));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const slash=value=>value.split(sep).join('/');
const safe=name=>typeof name==='string'&&name.length>0&&!name.includes('\\')&&!/[\0-\x1f\x7f]/.test(name)&&!name.startsWith('/')&&!/^[A-Za-z]:/.test(name)&&name.replace(/\/$/,'').split('/').every(part=>part!==''&&part!=='.'&&part!=='..');
const sourceCode=name=>/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|sh)$/i.test(name);
const sourceGuide=name=>! /^(?:LICENSE|COPYING|NOTICE|AUTHORS|UPSTREAM)(?:[.\-_]|$)/i.test(basename(name))&&(/^[^/]+\.md$/i.test(name)||/^native\/[^/]+\/README\.md$/.test(name));
const rootNotice=name=>!name.includes('/')&&/^(?:LICENSE|COPYING|NOTICE|THIRD_PARTY_LICENSES)(?:[.\-_]|$)/.test(name);
const record=bytes=>({bytes:bytes.length,sha256:hash(bytes)});
const metadata=entries=>new Map(entries.filter(entry=>!entry.directory).map(entry=>[entry.name,{bytes:entry.bytes,sha256:entry.sha256}]));
const same=(actual,expected,message)=>assert.deepEqual(actual,expected,message);
const archiveInspector=String.raw`
import hashlib,json,stat,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 result=[]
 for i in z.infolist():
  mode=stat.S_IFMT(i.external_attr>>16)
  if mode and mode not in (stat.S_IFREG,stat.S_IFDIR,stat.S_IFLNK):raise ValueError('Non-regular ZIP member: '+i.filename)
  # ZipInfo.filename truncates embedded NULs; audit the original central name.
  r={'name':i.orig_filename,'directory':i.is_dir(),'bytes':i.file_size,'symlink':stat.S_ISLNK(i.external_attr>>16)}
  data=z.read(i) # Verifies each local header, decompression and CRC, including directories.
  if not i.is_dir():r['sha256']=hashlib.sha256(data).hexdigest()
  result.append(r)
 print(json.dumps(result))
`;
function inspectArchive(file,{index=true}={}) {
  let entries;
  try { entries=JSON.parse(execFileSync(process.env.PYTHON||'python3',['-c',archiveInspector,file],{encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']})); }
  catch(error) { throw new Error(`Invalid ZIP / CRC (${basename(file)}): ${String(error.stderr||error.message).trim()}`); }
  const names=new Set();
  for(const entry of entries) {
    assert(safe(entry.name),'Unsafe ZIP path: '+JSON.stringify(entry.name));
    assert(!names.has(entry.name),'Duplicate ZIP entry: '+entry.name); names.add(entry.name);
    assert(!entry.symlink,'ZIP symlinks are not allowed: '+entry.name);
    assert(Number.isSafeInteger(entry.bytes)&&entry.bytes>=0,'Invalid ZIP size: '+entry.name);
  }
  if(index)assert(entries.some(item=>item.name==='index.html'&&!item.directory),'ZIP needs a regular index.html at its root');
  return entries;
}
async function stageFiles(stage) {
  const rootInfo=await lstat(stage);
  assert(rootInfo.isDirectory()&&!rootInfo.isSymbolicLink(),'Stage must be a real directory: '+basename(stage));
  const files=new Map(),directories=new Set();
  async function visit(prefix='') {
    for(const item of await readdir(join(stage,prefix),{withFileTypes:true})) {
      const name=prefix?prefix+'/'+item.name:item.name,info=await lstat(join(stage,name));
      assert(safe(name),'Unsafe stage path: '+name); assert(!info.isSymbolicLink(),'Stage symlinks are not allowed: '+name);
      if(info.isDirectory()){directories.add(name);await visit(name);}
      else {assert(info.isFile(),'Non-regular stage file: '+name);files.set(name,record(await readFile(join(stage,name))));}
    }
  }
  await visit(); return {files:new Map([...files].sort(([a],[b])=>a.localeCompare(b))),directories};
}
function exactFiles(actual,expected,label) {
  same([...actual.keys()].sort(),[...expected.keys()].sort(),label+': exact file set');
  for(const [name,value]of expected)same(actual.get(name),value,label+': file bytes '+name);
}
function requiredFiles(files,names,label) {for(const name of names)assert(files.has(name),label+': missing required file '+name);}
function checkedPaths(values,label,{rootJs=false}={}) {
  assert(Array.isArray(values),label+' must be an array'); const names=new Set();
  for(const name of values) {assert(safe(name)&&!name.endsWith('/'),label+': unsafe path '+JSON.stringify(name));assert(!names.has(name),label+': duplicate '+name);names.add(name);if(rootJs)assert(!name.includes('/')&&name.endsWith('.js'),label+': only root JavaScript inputs');}
  return names;
}
function guidePreface(name,archiveSha) {
  const link=slash(relative(dirname(name),'corresponding-source.zip'));
  return `> Browser upload source bundle: [Download the complete corresponding source](${link}) (SHA-256: \`${archiveSha}\`).\n> Extract that ZIP into a new directory before following the build instructions below. Its root contains \`native/\`, \`third_party/\`, \`wasm/\` and \`scripts/\` at their original paths. The ZIP preserves every original source, guide, license, notice and receipt byte. Hashes in receipts describe those extracted originals; this browser-facing guide has only this navigation preface.\n\n`;
}
async function checkPlaygroundRun(full,run) {
  const fullFiles=full.snapshot.files,runFiles=run.snapshot.files;
  const read=name=>readFile(join(run.stage,name));
  const receipt=JSON.parse(await read('sources/browser-bundle.json'));
  assert.equal(receipt.format,1,'Browser bundle receipt format');
  assert.equal(receipt.entry?.path,'playground.js','Browser bundle entry path');
  same(receipt.entry&&{bytes:receipt.entry.bytes,sha256:receipt.entry.sha256},runFiles.get('playground.js'),'Browser bundle entry bytes');
  const importURL='./playground.js?v=run-bundle-'+receipt.entry.sha256.slice(0,16);
  assert.equal(receipt.entry.importURL,importURL,'Content-derived browser bundle cache URL');
  const html=await read('index.html');
  assert.equal([...html.toString().matchAll(/\bimport\s*\(\s*['"]\.\/playground\.js(?:[?#][^'"]*)?['"]/g)].length,1,'One browser bundle startup import');
  assert(html.includes(Buffer.from(importURL)),'HTML imports the receipted browser bundle');
  assert.equal(receipt.builder?.format,'esm'); assert.equal(receipt.builder?.minify,true); assert.equal(receipt.builder?.keepNames,true);
  const inputs=checkedPaths(receipt.inputs?.map(item=>item.path),'Browser bundle inputs',{rootJs:true});
  assert(inputs.has('playground.js'),'Bundle archives the original entry source');
  for(const input of receipt.inputs)same({bytes:input.bytes,sha256:input.sha256},fullFiles.get(input.path),'Original UI receipt matches full distribution: '+input.path);
  const removed=checkedPaths(receipt.removed,'Removed browser modules',{rootJs:true});
  assert(!removed.has('playground.js'),'Bundle entry cannot be removed');
  for(const name of removed){assert(inputs.has(name),'Removed module is an archived input: '+name);assert(!runFiles.has(name),'Removed module is absent: '+name);}
  const retained=checkedPaths(receipt.retainedBundledInputs,'Retained bundled inputs',{rootJs:true});
  same([...retained].sort(),[...inputs].filter(name=>name!=='playground.js'&&!removed.has(name)).sort(),'Every unremoved UI input is retained');
  for(const name of retained)assert(runFiles.has(name),'Retained UI input exists: '+name);
  // The bundler conservatively scans URL literals without evaluating their
  // second argument. A literal './worklet.js' with a js/ base is therefore
  // also a root candidate; only paths present in the full stage are real roots.
  for(const name of checkedPaths(receipt.assetModuleRoots,'Worker/asset module roots'))if(fullFiles.has(name))assert(runFiles.has(name),'Retained Worker/asset module exists: '+name);
  for(const specifier of receipt.externalImports??[]){assert(typeof specifier==='string'&&specifier.startsWith('./'),'External import stays relative');const name=specifier.slice(2).split(/[?#]/)[0];assert(safe(name)&&runFiles.has(name),'External browser module exists: '+specifier);}
  assert.equal(receipt.sourceArchive?.path,'sources/browser-bundle-inputs.zip','UI source archive path');
  const uiArchive=await read(receipt.sourceArchive.path);
  same({bytes:receipt.sourceArchive.bytes,sha256:receipt.sourceArchive.sha256},record(uiArchive),'Original UI source archive digest');
  assert.equal(receipt.sourceArchive.allOriginalBytesVerified,true);
  const uiEntries=inspectArchive(join(run.stage,receipt.sourceArchive.path),{index:false}),uiFiles=metadata(uiEntries);
  assert(uiEntries.every(entry=>!entry.directory),'UI source archive has no directory records');
  const uiNames=[...inputs,...[...fullFiles.keys()].filter(rootNotice)].sort();
  exactFiles(uiFiles,new Map(uiNames.map(name=>[name,fullFiles.get(name)])),'Complete original UI source archive');
  assert.equal(receipt.sourceArchive.files,uiNames.length);
  const sourcePath='sources/corresponding-source.zip',sourceBytes=await read(sourcePath),sourceSha=hash(sourceBytes);
  const sources=inspectArchive(join(run.stage,sourcePath),{index:false});
  assert(sources.every(entry=>!entry.directory),'Corresponding source archive has no directory records');
  const fullSources=new Map([...fullFiles].filter(([name])=>name.startsWith('sources/')).map(([name,value])=>[name.slice(8),value]));
  assert(fullSources.size>0,'Complete Playground source tree is present');
  exactFiles(metadata(sources),fullSources,'Complete original audio/build/license source archive');
  const code=[...fullSources.keys()].filter(sourceCode);
  assert(code.length>0,'Corresponding compilation sources are present');
  for(const id of ['cdda','msm5205'])requiredFiles(fullSources,[`native/${id}/${id}_pcm.c`,`native/${id}/${id}_pcm.h`,`native/${id}/${id}_wasm.c`,`native/${id}/LICENSE`,`native/${id}/NOTICE.md`,`scripts/build_${id}_wasm.sh`],id+' source closure');
  const expected=new Set(fullFiles.keys());
  for(const name of code) {expected.delete('sources/'+name);assert(!runFiles.has('sources/'+name),'Compilation source is archived rather than duplicated: '+name);}
  for(const name of removed)expected.delete(name);
  const added=['sources/corresponding-source.zip','sources/README-for-run.md','sources/browser-bundle-inputs.zip','sources/browser-bundle.json'];
  for(const name of added)expected.add(name);
  if(runFiles.has('playground.js.LEGAL.txt'))expected.add('playground.js.LEGAL.txt');
  same([...runFiles.keys()].sort(),[...expected].sort(),'Only documented Run transformations change the file set');
  const changed=new Set(['index.html','playground.js',...removed,...code.map(name=>'sources/'+name)]);
  const guides=new Set([...fullSources.keys()].filter(name=>!sourceCode(name)&&sourceGuide(name)).map(name=>'sources/'+name));
  let unchanged=0,notices=0;
  for(const [name,value]of fullFiles) {
    if(changed.has(name))continue;
    if(guides.has(name)){const original=await readFile(join(full.stage,name));same(await read(name),Buffer.concat([Buffer.from(guidePreface(name.slice(8),sourceSha)),original]),'Only source download preface changed: '+name);}
    else {same(runFiles.get(name),value,'Unaltered runtime/audio/asset/source/notice: '+name);unchanged++;if(/(?:^|\/)(?:LICENSE|COPYING|NOTICE|AUTHORS|UPSTREAM)(?:[.\-_]|$)/i.test(name)||name==='THIRD_PARTY_LICENSES.txt')notices++;}
  }
  const sourceGuideText=(await read('sources/README-for-run.md')).toString();
  assert(sourceGuideText.includes(sourceSha)&&sourceGuideText.includes('corresponding-source.zip'),'Run source guide identifies the complete source archive');
  const entryText=(await read('playground.js')).toString();
  if(/playground\.js\.LEGAL\.txt/.test(entryText))assert(runFiles.has('playground.js.LEGAL.txt'),'Linked bundle legal comments are included');
  assert.equal(receipt.inputFileCount,fullFiles.size-code.length+2,'Bundle input file count');
  assert.equal(receipt.outputFileCount,runFiles.size,'Bundle output file count');
  assert.equal(receipt.originalFilesUnchanged,receipt.inputFileCount-removed.size-2,'Bundle preserves every other pre-bundle file');
  return {entry:receipt.entry,originalUI:{path:receipt.sourceArchive.path,files:uiFiles.size,...record(uiArchive)},
    correspondingSource:{path:sourcePath,files:fullSources.size,compilationFiles:code.length,...record(sourceBytes)},
    removedRootModules:removed.size,unalteredFiles:unchanged,preservedNotices:notices};
}
function sourceCommit(value) {
  if(value===null)return undefined;
  const candidate=value??process.env.GITHUB_SHA;
  if(candidate!==undefined){assert(/^[a-f0-9]{40}$/i.test(candidate),'sourceCommit must be a complete Git SHA');return candidate.toLowerCase();}
  try {const git=execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();if(/^[a-f0-9]{40}$/i.test(git))return git;}
  catch{} return undefined;
}
/** Pure validation. No files are written until all archives and stable inputs pass. */
export async function checkItchReleaseArchives({release='release',sourceCommit:commit}={}) {
  const releasePath=resolve(release),rootInfo=await lstat(releasePath);
  assert(rootInfo.isDirectory()&&!rootInfo.isSymbolicLink(),'Release must be a real directory');
  const root=await realpath(releasePath),checked=[];
  for(const definition of ITCH_RELEASE_ARTIFACTS) {
    const archive=join(root,definition.archive),info=await lstat(archive);
    assert(info.isFile()&&!info.isSymbolicLink(),'Release archive must be a regular file: '+definition.archive);
    const stage=join(root,definition.stage),snapshot=await stageFiles(stage);
    requiredFiles(snapshot.files,['index.html','LICENSE','THIRD_PARTY_LICENSES.txt','generated/ym2612_wasm.js','generated/ym2612_wasm.wasm',...definition.required],definition.id);
    const entries=inspectArchive(archive),zipFiles=metadata(entries);
    const zip=definition.browserPlayable?checkItchPlaygroundZip(archive):validateItchZipEntries(entries,{entries:Number.MAX_SAFE_INTEGER,pathCharacters:Number.MAX_SAFE_INTEGER,totalBytes:Number.MAX_SAFE_INTEGER,fileBytes:Number.MAX_SAFE_INTEGER});
    for(const entry of entries)if(entry.directory)assert(snapshot.directories.has(entry.name.slice(0,-1)),'ZIP directory exists in stage: '+entry.name);
    exactFiles(zipFiles,snapshot.files,definition.id+' archive/stage');
    const bytes=await readFile(archive);
    checked.push({definition,archive,stage,snapshot,artifact:{id:definition.id,archive:definition.archive,stage:definition.stage,browserPlayable:definition.browserPlayable,downloadOnly:!definition.browserPlayable,...record(bytes),
      zip:{crcVerified:true,stageBytesVerified:true,entries:entries.length,files:zipFiles.size,directories:entries.length-zipFiles.size,expandedBytes:zip.totalBytes},
      files:[...snapshot.files].map(([path,value])=>({path,...value}))}});
  }
  const playgroundRun=await checkPlaygroundRun(checked[2],checked[3]);
  // Refuse receipts for files changed while the read-only checks were running.
  for(const item of checked) {
    same(record(await readFile(item.archive)),{bytes:item.artifact.bytes,sha256:item.artifact.sha256},'Archive changed during validation: '+item.definition.archive);
    const current=await stageFiles(item.stage);exactFiles(current.files,item.snapshot.files,'Stage changed during validation: '+item.definition.stage);
    same([...current.directories].sort(),[...item.snapshot.directories].sort(),'Stage directories changed during validation');
  }
  const source=sourceCommit(commit);
  return {schemaVersion:1,kind:'itch-web-release',...(source?{sourceCommit:source}:{}),audioRebuilt:false,artifacts:checked.map(item=>item.artifact),playgroundRun};
}
export async function writeItchReleaseManifest({release='release',out=join(release,'itch-web-release.json'),checksums=join(release,'SHA256SUMS'),sourceCommit:commit}={}) {
  const destinations=[resolve(out),resolve(checksums)];assert.notEqual(...destinations,'Manifest and checksum paths must differ');
  const releasePath=resolve(release);
  for(const destination of destinations)for(const artifact of ITCH_RELEASE_ARTIFACTS) {
    const stage=join(releasePath,artifact.stage),rel=relative(stage,destination);
    assert(destination!==join(releasePath,artifact.archive)&&!(rel===''||!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)),'Outputs cannot overwrite validated inputs');
  }
  const result=await checkItchReleaseArchives({release,sourceCommit:commit});
  const contents=[JSON.stringify(result,null,2)+'\n',result.artifacts.map(item=>`${item.sha256}  ${item.archive}\n`).join('')];
  const temporaries=[];
  try {
    for(let i=0;i<destinations.length;i++){await mkdir(dirname(destinations[i]),{recursive:true});const temporary=await mkdtemp(join(dirname(destinations[i]),'.itch-release-'));temporaries.push(temporary);await writeFile(join(temporary,'result'),contents[i]);}
    for(let i=0;i<destinations.length;i++)await rename(join(temporaries[i],'result'),destinations[i]);
  } finally {for(const temporary of temporaries)await rm(temporary,{recursive:true,force:true});}
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const options={};
  for(const argument of process.argv.slice(2)){const match=argument.match(/^--(release|out|checksums)=(.+)$/);if(!match||Object.hasOwn(options,match[1]))throw Error('Usage: node scripts/check_itch_release_archives.mjs [--release=release] [--out=release/itch-web-release.json] [--checksums=release/SHA256SUMS]');options[match[1]]=match[2];}
  const result=await writeItchReleaseManifest(options);
  console.log(`Verified ${result.artifacts.length} itch archives; ${result.artifacts.filter(item=>item.browserPlayable).length} browser-playable, Playground full download checked without hosting limits.`);
}
