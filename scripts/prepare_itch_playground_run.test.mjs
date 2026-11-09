// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,access,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {checkItchPlaygroundZip,prepareItchPlaygroundRun,validateItchZipEntries} from './prepare_itch_playground_run.mjs';
const file=(name,bytes=0)=>({name,bytes,directory:false,symlink:false});

test('1000 means all ZIP entries, including directory records',()=>{
 const entries=[file('index.html'),...Array.from({length:999},(_,i)=>({...file(`dir${i}/`),directory:true}))];
 assert.equal(validateItchZipEntries(entries).entryCount,1000);
 assert.throws(()=>validateItchZipEntries([...entries,file('extra.js')]),/1001 > 1000/);
});
test('expanded size and path boundaries are checked without extracting',()=>{
 assert.equal(validateItchZipEntries([file('index.html',200_000_000),file('b',200_000_000),file('c',100_000_000)]).totalBytes,500_000_000);
 assert.throws(()=>validateItchZipEntries([file('index.html',200_000_001)]),/file exceeds/);
 assert.throws(()=>validateItchZipEntries([file('index.html',200_000_000),file('b',200_000_000),file('c',100_000_001)]),/total expanded/);
 assert.doesNotThrow(()=>validateItchZipEntries([file('index.html'),file('a'.repeat(236)+'.txt')]));
 assert.throws(()=>validateItchZipEntries([file('index.html'),file('a'.repeat(237)+'.txt')]),/240 characters/);
});
test('missing entry point, duplicates, unsafe paths and symlinks are rejected',()=>{
 assert.throws(()=>validateItchZipEntries([file('nested/index.html')]),/root/);
 for(const name of ['../outside','/outside','C:/outside','a\\b','a//b'])assert.throws(()=>validateItchZipEntries([file('index.html'),file(name)]),/Unsafe ZIP path/);
 assert.throws(()=>validateItchZipEntries([file('index.html'),file('index.html')]),/Duplicate/);
 assert.throws(()=>validateItchZipEntries([file('index.html'),{...file('link'),symlink:true}]),/symlinks/);
});
test('actual ZIP guard counts directory entries, not just files',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'itch-directory-count-'));
 try{
  const zip=join(scratch,'actual.zip');
  const make=count=>execFileSync(process.env.PYTHON||'python3',['-c',
   'import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n z.writestr("index.html","ok")\n for i in range(int(sys.argv[2])):z.writestr("dir%d/"%i,"")',zip,String(count)]);
  make(999);assert.equal(checkItchPlaygroundZip(zip).directories,999);
  make(1000);assert.throws(()=>checkItchPlaygroundZip(zip),/1001 > 1000/);
 }finally{await rm(scratch,{recursive:true,force:true});}
});
test('browser stage keeps complete source ZIP and original runtime/licenses/receipts',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'itch-source-bundle-')),full=join(scratch,'full stage'),run=join(scratch,'run stage');
 const payload={
  'index.html':'<script src="js/app.js"></script>','LICENSE':'Original root license\n','js/app.js':'export const ok=true;\n','generated/audio.wasm':Buffer.from([0,97,115,109,1,0,0,0]),
  'licenses/chip/NOTICE.md':'Original notice\n','sources/Chip.md':'# Chip\nRun scripts/build.sh\n',
  'sources/native/chip/README.md':'# Native chip\n','sources/native/chip/NOTICE.md':'Original native notice\n',
  'sources/native/chip/LICENSE':'Original chip license\n','sources/NOTICE.md':'Root source notice\n','sources/Chip.json':'{"sourceHash":"original"}\n',
  'sources/native/chip/core.c':'int core(void){return 1;}\n','sources/native/chip/core.h':'int core(void);\n','sources/scripts/build.sh':'#!/bin/sh\ncc native/chip/core.c\n',
  'sources/sdk/scripts/record_wasm_build.mjs':'// Original build-only receipt tool\n',
  'js/sid.js':'export const readableSid=true;\n',
  'sources/sid/README.md':'# SID source kit\nBuild from this directory after extraction.\n',
  'sources/sid/tetorica_src/runtime/sid.js':'export const readableSid=true;\n',
  'sources/sid/tetorica_src/runtime/sidsynth.d.ts':'export declare class SidSynth {}\n',
  'sources/sid/scripts/prepare_sid_core.py':'# Original preparation script\n',
  'sources/sid/scripts/sid_artifacts.mjs':'// Original source receipt verifier\n',
 };
 try{
  for(const[name,value]of Object.entries(payload)){await mkdir(dirname(join(full,name)),{recursive:true});await writeFile(join(full,name),value);}
  const result=await prepareItchPlaygroundRun(full,run);assert(result.passed&&result.fullStageUnchanged);assert.equal(result.removedCompilationFiles.length,8);assert.equal(result.sourceArchive.files,15);
  for(const name of ['index.html','LICENSE','js/app.js','js/sid.js','generated/audio.wasm','licenses/chip/NOTICE.md','sources/NOTICE.md','sources/native/chip/NOTICE.md','sources/native/chip/LICENSE','sources/Chip.json'])assert.deepEqual(await readFile(join(run,name)),await readFile(join(full,name)),name);
  for(const name of result.removedCompilationFiles)await assert.rejects(access(join(run,name)),{code:'ENOENT'});
  const guide=await readFile(join(run,'sources/Chip.md'),'utf8');assert(guide.endsWith(payload['sources/Chip.md']));assert.match(guide,/\]\(corresponding-source\.zip\)/);
  const nested=await readFile(join(run,'sources/native/chip/README.md'),'utf8');assert(nested.endsWith(payload['sources/native/chip/README.md']));assert.match(nested,/\]\(\.\.\/\.\.\/corresponding-source\.zip\)/);
  const sidGuide=await readFile(join(run,'sources/sid/README.md'),'utf8');assert(sidGuide.endsWith(payload['sources/sid/README.md']));assert.match(sidGuide,/\]\(\.\.\/corresponding-source\.zip\)/);
  const restored=join(scratch,'restored');
  execFileSync(process.env.PYTHON||'python3',['-c','import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:z.extractall(sys.argv[2])',join(run,'sources/corresponding-source.zip'),restored]);
  for(const[name,value]of Object.entries(payload)){assert.deepEqual(await readFile(join(full,name)),Buffer.from(value),'Full stage unchanged '+name);if(name.startsWith('sources/'))assert.deepEqual(await readFile(join(restored,name.slice(8))),Buffer.from(value),'Complete original archive '+name);}
 }finally{await rm(scratch,{recursive:true,force:true});}
});
test('1102-entry distribution archives the entire matching 8580 kit and retains readable audio assets and download guides',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'itch-8580-source-bundle-')),full=join(scratch,'full'),run=join(scratch,'run'),kit='sources/sid8580-machine/';
 const digest=value=>{const bytes=Buffer.from(value);return{bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};};
 const payload={
  'index.html':'<script type="module" src="js/app.js"></script>',
  'LICENSE':'Original root license\n',
  'js/app.js':"import {Sid8580Core} from './sid8580.js';\n// Readable browser module\n",
  'js/sid8580.js':'// Original CPU-free adapter\nexport class Sid8580Core {}\n',
  'js/sid8580.d.ts':'export declare class Sid8580Core {}\n',
  'generated/sid8580-machine/sid8580-endpoint.wasm':Buffer.from([0,97,115,109,1,0,0,0]),
  'generated/sid8580-machine/sid8580-machine.wasm':Buffer.from([0,97,115,109,1,0,0,0]),
  'sources/SID8580.md':'# CPU-free SID 8580 Preview\nNative sources: [matching kit](sid8580-machine/README.md).\n',
  [kit+'README.md']:'# Matching native source kit\nRun sh scripts/build_sid8580_machine.sh build/rebuild from this directory.\n',
 };
 const compiled={
  'tetorica_src/wasm/sid8580-machine/endpoint.rs':'// Original Rust batch endpoint\n',
  'tetorica_src/wasm/sid8580-probe/lib.rs':'// Original Rust adapter\n',
  'tetorica_src/wasm/sid8580-machine/machine_wasm.cpp':'// Original native wrapper\n',
  'tetorica_src/wasm/sid8580-machine/machine.c':'/* Original C host */\n',
  'tetorica_src/wasm/sid8580-machine/generated/sid8580_machine_core.h':'/* Original generated host */\n',
  'third_party/sidera/upstream/Cargo.toml':'[package]\nname="sidera"\n',
  'third_party/sidera/upstream/Cargo.lock':'# Original Cargo dependency lock\n',
  'third_party/sidera/upstream/.cargo_vcs_info.json':'{"git":{"sha1":"original"}}\n',
  'third_party/sidera/LICENSE':'MIT License\n',
  'third_party/chips-c64/LICENSE':'Original zlib notice\n',
  'scripts/build_sid8580_machine.sh':'#!/bin/sh\n# Original native build recipe\n',
  'scripts/sid8580_machine_artifacts.mjs':'// Original hash verifier\n',
 };
 for(let i=Object.keys(compiled).length;i<99;i++)compiled[`third_party/sidera/upstream/src/module-${i}.rs`]=`// Original Rust source ${i}\n`;
 for(const[name,value]of Object.entries(compiled))payload[kit+name]=value;
 for(const root of ['third_party/sidera/toolchain-notices','third_party/sid8580-machine-toolchain-notices']){
  payload[kit+root+'/LICENSE-MIT']='Original MIT toolchain license\n';
  payload[kit+root+'/LICENSE-APACHE']='Original Apache toolchain notice\n';
  payload[kit+root+'/README.md']='Original toolchain provenance guide\n';
  payload[kit+root+'/SOURCES.json']='{"copiedUnmodified":true}\n';
 }
 // Match the real source kit's entry pressure. Unknown notice extensions and
 // metadata also belong in the complete kit, beyond C/C++/Rust source suffixes.
 for(let i=0;Object.keys(payload).filter(name=>name.startsWith(kit)).length<147;i++)payload[kit+`third_party/sidera/toolchain-notices/component-${i}.txt`]=`Original standard-library notice ${i}\n`;
 const compiledInputs=Object.fromEntries(Object.entries(compiled).map(([name,value])=>[name,digest(value)]));
 const receipt=JSON.stringify({model:'8580',inputs:compiledInputs,outputs:{'sid8580-endpoint.wasm':digest(payload['generated/sid8580-machine/sid8580-endpoint.wasm'])}})+'\n';
 payload[kit+'sid8580-machine-build.json']=receipt;payload['generated/sid8580-machine/sid8580-machine-build.json']=receipt;
 payload[kit+'source-kit.json']=JSON.stringify({compiledInputCount:99,compiledInputs,buildReceipt:{path:'sid8580-machine-build.json',...digest(receipt)}})+'\n';
 for(let i=0;Object.keys(payload).length<1102;i++)payload[`data/asset-${i}.txt`]=`Original browser asset ${i}\n`;
 try{
  for(const[name,value]of Object.entries(payload)){await mkdir(dirname(join(full,name)),{recursive:true});await writeFile(join(full,name),value);}
  assert.throws(()=>validateItchZipEntries(Object.entries(payload).map(([name,value])=>file(name,Buffer.byteLength(value)))),/1102 > 1000/);
  const result=await prepareItchPlaygroundRun(full,run);assert.equal(result.inputFiles,1102);assert.equal(result.predictedZip.entryCount,956);assert.equal(result.fullStageUnchanged,true);
  const kitNames=Object.keys(payload).filter(name=>name.startsWith(kit));assert.equal(kitNames.length,149);
  assert.deepEqual(result.removedCompilationFiles.sort(),kitNames.filter(name=>name!==kit+'README.md').sort());
  for(const name of result.removedCompilationFiles)await assert.rejects(access(join(run,name)),{code:'ENOENT'});
  for(const[name,value]of Object.entries(payload)){
   assert.deepEqual(await readFile(join(full,name)),Buffer.from(value),'Full download unchanged: '+name);
   if(!name.startsWith('sources/'))assert.deepEqual(await readFile(join(run,name)),Buffer.from(value),'Readable browser asset unchanged: '+name);
  }
  for(const[name,link]of [[kit+'README.md','../corresponding-source.zip'],['sources/SID8580.md','corresponding-source.zip']]){
   const guide=await readFile(join(run,name),'utf8');assert(guide.endsWith(payload[name]));assert(guide.includes(`](${link})`));assert(guide.includes(result.sourceArchive.sha256));assert(result.prefacedGuides.includes(name));
  }
  const explanation=await readFile(join(run,'sources/README-for-run.md'),'utf8');assert.match(explanation,/complete `sid8580-machine\/` native source kit/);assert.match(explanation,/Rust\/Cargo/);assert.match(explanation,/toolchain licenses\/notices/);
  const restored=join(scratch,'restored');
  execFileSync(process.env.PYTHON||'python3',['-c','import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:z.extractall(sys.argv[2])',join(run,'sources/corresponding-source.zip'),restored]);
  for(const[name,value]of Object.entries(payload))if(name.startsWith('sources/'))assert.deepEqual(await readFile(join(restored,name.slice(8))),Buffer.from(value),'Complete byte-exact archived source/license/receipt: '+name);
  const restoredKit=JSON.parse(await readFile(join(restored,'sid8580-machine/source-kit.json'))),restoredReceipt=JSON.parse(await readFile(join(restored,'sid8580-machine/sid8580-machine-build.json')));
  assert.equal(Object.keys(restoredReceipt.inputs).length,99);assert.deepEqual(restoredKit.compiledInputs,restoredReceipt.inputs);
  for(const[name,expected]of Object.entries(restoredReceipt.inputs))assert.deepEqual(digest(await readFile(join(restored,'sid8580-machine',name))),expected,name);
 }finally{await rm(scratch,{recursive:true,force:true});}
});
test('overlap, existing destinations and symlink inputs cannot overwrite files',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'itch-source-paths-')),full=join(scratch,'full'),run=join(scratch,'run');
 try{
  await mkdir(full);await mkdir(run);await writeFile(join(run,'keep'),'keep');
  await assert.rejects(prepareItchPlaygroundRun(full,run),/already exists/);assert.equal(await readFile(join(run,'keep'),'utf8'),'keep');
  await assert.rejects(prepareItchPlaygroundRun(full,join(full,'nested')),/overlap/);
  await symlink(full,join(scratch,'link'));await assert.rejects(prepareItchPlaygroundRun(join(scratch,'link'),join(scratch,'unused')),/real directory/);
 }finally{await rm(scratch,{recursive:true,force:true});}
});

test('Run bundle is generated before enforcing the final hosting entry limit',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'itch-bundle-limit-')),full=join(scratch,'full'),run=join(scratch,'run');
 try{
  await mkdir(join(full,'sources'),{recursive:true});await mkdir(join(full,'js'));await mkdir(join(full,'data'));
  await writeFile(join(full,'index.html'),"<script type=\"module\">import('./playground.js?v=original')</script>");
  await writeFile(join(full,'LICENSE'),'Original license\n');
  await writeFile(join(full,'js/audio.js'),'globalThis.audioModuleIsSeparate=true;');
  await writeFile(join(full,'sources/core.c'),'int sound(void){return 0;}\n');
  await writeFile(join(full,'sources/Chip.md'),'# Original source guide\n');
  const imports=[];
  for(let i=0;i<20;i++){
   await writeFile(join(full,`page${i}.js`),`export const value${i}=${i};`);
   imports.push(`import {value${i}} from './page${i}.js';`);
  }
  await writeFile(join(full,'playground.js'),"import './js/audio.js';\n"+imports.join('\n')+'\nglobalThis.values=['+Array.from({length:20},(_,i)=>`value${i}`).join(',')+'];');
  await Promise.all(Array.from({length:979},(_,i)=>writeFile(join(full,'data',`${i}.txt`),'asset')));
  // The full stage has 1,005 files, and source packing alone still exceeds
  // 1,000. Bundling first makes this a valid, smaller browser distribution.
  const result=await prepareItchPlaygroundRun(full,run,{bundle:true});
  assert.equal(result.inputFiles,1005);assert(result.bundle.passed);
  assert(result.predictedZip.entryCount<1000);assert.equal(result.bundle.removed.length,20);
  assert.match(await readFile(join(run,'index.html'),'utf8'),/run-bundle-[a-f0-9]{16}/);
  assert.deepEqual(await readFile(join(run,'js/audio.js')),await readFile(join(full,'js/audio.js')));
  assert.equal(await readFile(join(full,'page0.js'),'utf8'),'export const value0=0;');
  await assert.rejects(access(join(run,'page0.js')),{code:'ENOENT'});
  await access(join(run,'sources/browser-bundle-inputs.zip'));
  await access(join(run,'sources/corresponding-source.zip'));
 }finally{await rm(scratch,{recursive:true,force:true});}
});
