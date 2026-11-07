#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Readable, exclusive research application + matching source kit. No bundling.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {lstat,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkSid8580MachineBuild,machineRoot,machineDigest} from './sid8580_machine_artifacts.mjs';
import {sid8580MachineFixtures} from '../test/helpers/sid8580_machine_fixtures.mjs';

const APP_FILES=['index.html','lab.css','player.js','core.js','parser.js','psid_structure.js','audio.js','processor.js','preflight.js','README.md'];
const SHARED=['docs/js/sid_rsid.js','docs/sid-player/roms.js','tetorica_src/runtime/sid_psid.js','tetorica_src/runtime/sid_rsid.js'];
const EXTRAS=['scripts/package_sid8580_machine.mjs','scripts/prepare_sid8580_parser.mjs',
  'scripts/check_sid8580_machine.mjs','scripts/check_sid8580_machine_browser.mjs','.github/workflows/sid8580-machine.yml',
  'test/helpers/sid8580_machine_fixtures.mjs','test/helpers/psid_vbi_machine_fixtures.mjs',
  'test/helpers/psid_cia_fixtures.mjs','test/helpers/rsid_fixtures.mjs',
  'test/sid8580_machine_parser.test.mjs','test/sid8580_machine_preflight.test.mjs',
  'docs/issues/sid8580_machine_design_01.md'];
const DEMOS=[['vbi.sid','psid-vbi'],['cia.sid','psid-cia'],['irq.sid','rsid-raster-irq']];
const NOTICE_ROOT='third_party/sidera/toolchain-notices';
const MACHINE_NOTICES='third_party/sid8580-machine-toolchain-notices';
function safePath(path){
  assert(typeof path==='string'&&path&&!isAbsolute(path)&&!path.includes('\\')&&!/[\x00-\x1f\x7f]/.test(path));
  assert(path.split('/').every(p=>p&&p!=='.'&&p!=='..'));return path;
}
async function bytesAt(root,path){
  let at=root;const parts=safePath(path).split('/');
  for(let i=0;i<parts.length;i++){
    at=join(at,parts[i]);const s=await lstat(at);
    assert(!s.isSymbolicLink()&&(i===parts.length-1?s.isFile():s.isDirectory()),`Not a regular package input: ${path}`);
  }
  return readFile(at);
}
async function inventory(root,prefix=''){
  const names=[];
  for(const e of await readdir(join(root,prefix),{withFileTypes:true})){
    const name=prefix+e.name;
    if(e.isDirectory())names.push(...await inventory(root,name+'/'));
    else {assert(e.isFile(),`Unsupported package entry ${name}`);names.push(name);}
  }
  return names.sort();
}
async function absent(path){try{await lstat(path);}catch(e){if(e.code==='ENOENT')return;throw e;}throw Error('Refusing to overwrite '+path);}
function sourceAllowed(name){
  safePath(name);
  assert(!/sid8580_(?:quality_)?reference\.cpp$|prepare_sid8580_(?:quality_)?reference\.mjs$/.test(name),'GPL SID oracle excluded');
  assert(!name.startsWith('build/')&&!name.startsWith('ww/')&&!name.startsWith('third_party/sid-reference/'));
  assert(!/\.(?:a|o|rlib|rom|bin|pcm|f32le|wav)$/i.test(name),`User data/build binary excluded: ${name}`);
  if(/\.(?:sid|psid|rsid)$/i.test(name))assert(DEMOS.some(([file])=>name==='docs/sid8580-lab/demos/'+file),'Only authored verified SID demos may be included');
}
async function checkRuntimeClosure(sources){
  const rootUrl='https://package.invalid/';
  const resolveLocal=(from,value)=>{
    const url=new URL(value,new URL(from,rootUrl));assert.equal(url.origin,new URL(rootUrl).origin,`External runtime dependency: ${from}: ${value}`);
    const path=decodeURIComponent(url.pathname.slice(1));assert(Object.hasOwn(sources,path),`Missing runtime dependency: ${from}: ${value}`);
  };
  for(const name of APP_FILES.filter(n=>n.endsWith('.js')).map(n=>'docs/sid8580-lab/'+n).concat(SHARED.filter(n=>n.startsWith('docs/')))){
    const text=await bytesAt(machineRoot,name),code=text.toString();assert(!/\b(?:from\s*|import\s*\(|require\s*\()\s*['"]node:/.test(code),'Node import in browser runtime');
    for(const m of code.matchAll(/\b(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g))resolveLocal(name,m[1]);
    for(const m of code.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g))resolveLocal(name,m[1]);
  }
  const html=(await bytesAt(machineRoot,'docs/sid8580-lab/index.html')).toString();
  for(const m of html.matchAll(/<(?:script|img)\b[^>]*\bsrc=['"]([^'"]+)['"]/gi))resolveLocal('docs/sid8580-lab/index.html',m[1]);
  for(const m of html.matchAll(/<link\b[^>]*\bhref=['"]([^'"]+)['"]/gi))resolveLocal('docs/sid8580-lab/index.html',m[1]);
}
export async function planSid8580MachinePackage({buildDir=join(machineRoot,'build/sid8580-machine')}={}){
  buildDir=resolve(buildDir);const receipt=await checkSid8580MachineBuild({directory:buildDir}),sources={};
  const add=async(name,expected)=>{
    sourceAllowed(name);const value=machineDigest(await bytesAt(machineRoot,name));
    if(expected)assert.deepEqual(value,expected,`Package source changed: ${name}`);sources[name]=value;
  };
  for(const [name,value]of Object.entries(receipt.inputs))await add(name,value);
  for(const name of [...EXTRAS,...SHARED,...APP_FILES.map(n=>'docs/sid8580-lab/'+n)])await add(name);
  // Include only new research unit-test sources; no corpus/ROM/data directory.
  for(const name of await readdir(join(machineRoot,'test')))if(/^sid8580_machine_[A-Za-z0-9_]+\.test\.mjs$/.test(name))await add('test/'+name);
  await add('scripts/prepare_sid8580_parser.mjs');
  execFileSync(process.execPath,['scripts/prepare_sid8580_parser.mjs','--check'],{cwd:machineRoot,stdio:'pipe'});
  assert.deepEqual(await bytesAt(machineRoot,'docs/js/sid_rsid.js'),await bytesAt(machineRoot,'tetorica_src/runtime/sid_rsid.js'));
  const notices=JSON.parse(await bytesAt(machineRoot,NOTICE_ROOT+'/SOURCES.json'));
  assert.equal(notices.format,'tetorica-rust-toolchain-notices');assert.equal(notices.rustVersion,'1.91.1');
  assert.deepEqual(await inventory(join(machineRoot,NOTICE_ROOT)),[...Object.keys(notices.files),'README.md','SOURCES.json'].sort());
  for(const name of ['README.md','SOURCES.json'])await add(NOTICE_ROOT+'/'+name);
  for(const [name,expected]of Object.entries(notices.files))await add(NOTICE_ROOT+'/'+safePath(name),expected);
  const machineNotices=JSON.parse(await bytesAt(machineRoot,MACHINE_NOTICES+'/SOURCES.json'));
  assert.equal(machineNotices.format,'tetorica-emscripten-toolchain-notices');assert.equal(machineNotices.copiedUnmodified,true);
  assert.deepEqual(await inventory(join(machineRoot,MACHINE_NOTICES)),[...Object.keys(machineNotices.files),'README.md','SOURCES.json'].sort());
  for(const name of ['README.md','SOURCES.json'])await add(MACHINE_NOTICES+'/'+name);
  for(const [name,{bytes,sha256}]of Object.entries(machineNotices.files))await add(MACHINE_NOTICES+'/'+safePath(name),{bytes,sha256});
  const demoRoot='docs/sid8580-lab/demos/',provenance=JSON.parse(await bytesAt(machineRoot,demoRoot+'provenance.json'));
  assert.equal(provenance.format,'tetorica-sid8580-machine-demo-provenance');assert.equal(provenance.version,1);assert.equal(provenance.license,'BSD-3-Clause');
  assert.equal(provenance.containsThirdPartyMusic,false);assert.equal(provenance.containsRomDump,false);
  assert.equal(provenance.generator.path,'test/helpers/sid8580_machine_fixtures.mjs');
  assert.deepEqual(sources[provenance.generator.path],{bytes:provenance.generator.bytes,sha256:provenance.generator.sha256});
  assert.deepEqual(provenance.outputs.map(({file,profile})=>[file,profile]),DEMOS);
  const fixtures=sid8580MachineFixtures();
  for(const {file,profile,bytes,sha256,startSong}of provenance.outputs){
    const fixture=fixtures.find(f=>f.profile===profile),expected=fixture.bytes.slice();
    // This one original demo should open its CIA subtune by default. Only its
    // authored startSong metadata changes; imported user files are never patched.
    if(file==='cia.sid')new DataView(expected.buffer,expected.byteOffset,expected.byteLength).setUint16(16,fixture.subtune);
    const data=await bytesAt(machineRoot,demoRoot+file);assert.deepEqual(data,Buffer.from(expected));
    if(startSong!==undefined)assert.equal(new DataView(expected.buffer,expected.byteOffset,expected.byteLength).getUint16(16),startSong);
    await add(demoRoot+file,{bytes,sha256});
  }
  for(const name of ['provenance.json','LICENSE.txt'])await add(demoRoot+name);
  const artifacts={};
  for(const name of ['sid8580-endpoint.wasm','sid8580-machine.wasm','sid8580-machine-build.json']){
    const data=await bytesAt(buildDir,name),target='docs/generated/sid8580-machine/'+name;
    if(name.endsWith('.wasm'))assert.deepEqual(machineDigest(data),receipt.outputs[name]);
    else assert.deepEqual(JSON.parse(data),receipt);
    assert.deepEqual(await bytesAt(machineRoot,target),data,`Stale staged research asset: ${target}`);artifacts[target]=machineDigest(data);
  }
  await checkRuntimeClosure({...sources,...artifacts});
  return {receipt,buildDir,sources:Object.fromEntries(Object.entries(sources).sort(([a],[b])=>a.localeCompare(b))),artifacts};
}
const README=`# SID8580 isolated research machine

Open docs/sid8580-lab/index.html using a local HTTP server or HTTPS host.
This is a research C64/AudioWorklet experiment, not production Player/Synth/SDK
8580 support. The authored browser modules are copied without minification.
Read docs/sid8580-lab/README.md for supported input and approximation limits.

Sources are repo-relative. Node.js22+, Rust1.91.1 with wasm32-unknown-unknown,
C11/C++17 Clang, Emscripten and Python3 are needed for a full rebuild:

    sh scripts/build_sid8580_machine.sh
    node scripts/prepare_sid8580_parser.mjs --check
    node --test test/sid8580_machine_parser.test.mjs test/sid8580_machine_preflight.test.mjs
    node scripts/check_sid8580_machine.mjs --work-dir build/sid8580-machine
    node scripts/sid8580_machine_artifacts.mjs --check build/sid8580-machine

The machine imports the Rust SID's WASM export functions directly, with separate
linear memories and no JavaScript callback for each emulated cycle. SID reads
are returned to the real CPU. Both research calibration flags default OFF.
The existing 12Hz software DC blocker follows the candidate output. The exact
source inventory, compiler/link recipe, outputs and imports are in the receipt.
Matching compiler profiles allow byte-identical output comparison; different
platform toolchains are verified functionally rather than assumed byte-identical.

The marked research host is generated from unchanged original BSD host and
pristine zlib C64 devices. The SID includes pinned MIT sidera sources/marked
adaptations and separate Rust standard-library notices. No GPL SID oracle,
Native binary, firmware dump, game music or PCM is included. Three original BSD
SID test programs are included with provenance. Optional user ROMs are never
written to the kit. C64 device/audio approximations remain; successful port and
Worklet execution do not prove real-hardware fidelity or listening correctness.
Unmodified Emscripten C/C++ runtime notices and their installed provenance are
included separately from Rust notices; the conservative inventory does not
assert that every optional library is linked.
The optional scripts/check_sid8580_machine_browser.mjs needs separately installed
Playwright/browser binaries. The default source-kit verification uses only
built-in Node modules and local compilers, with no GPL SID reference engine.
`;
async function verify(stage,original){
  const work='build/sourcekit-rebuild',checks=[];
  const run=(name,command,args)=>{execFileSync(command,args,{cwd:stage,stdio:'pipe',timeout:300000,maxBuffer:16*1024*1024});checks.push({name,passed:true});};
  run('independent-build','sh',['scripts/build_sid8580_machine.sh',work]);
  run('parser-view','node',['scripts/prepare_sid8580_parser.mjs','--check']);
  const tests=(await readdir(join(stage,'test'))).filter(n=>/^sid8580_machine_[A-Za-z0-9_]+\.test\.mjs$/.test(n)).sort().map(n=>'test/'+n);
  run('research-unit-tests','node',['--test',...tests]);
  run('actual-machine-native-wasm','node',['scripts/check_sid8580_machine.mjs','--work-dir',work]);
  run('fresh-receipt','node',['scripts/sid8580_machine_artifacts.mjs','--check',work]);
  const bytes=await bytesAt(stage,work+'/sid8580-machine-build.json'),rebuilt=JSON.parse(bytes);
  assert.deepEqual(rebuilt.inputs,original.inputs,'Independent source closure differs');
  assert.deepEqual(rebuilt.wasmInterface,original.wasmInterface);
  const sameCompiler=JSON.stringify({compilers:rebuilt.compilers,buildProfile:rebuilt.buildProfile})===JSON.stringify({compilers:original.compilers,buildProfile:original.buildProfile}),sameOutputs=JSON.stringify(rebuilt.outputs)===JSON.stringify(original.outputs);
  const sameReceipt=bytes.equals(await bytesAt(stage,'docs/generated/sid8580-machine/sid8580-machine-build.json'));
  if(sameCompiler){assert(sameOutputs,'Matching-compiler research outputs differ');assert(sameReceipt,'Matching-compiler research receipt differs');}
  return {passed:true,checks,sameCompilerProfile:sameCompiler,allOutputsByteIdentical:sameOutputs,receiptByteIdentical:sameReceipt,parentSourceFallback:false,referenceUsed:false};
}
function zip(stage,archive,names){
  execFileSync('python3',['-c',String.raw`
import json,sys,zipfile
from pathlib import Path
root=Path(sys.argv[1]);names=json.load(sys.stdin)
with zipfile.ZipFile(sys.argv[2],'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name in names:
  p=root/name;assert p.is_file() and not p.is_symlink()
  info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.create_system=3;info.external_attr=0o100644<<16
  z.writestr(info,p.read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
with zipfile.ZipFile(sys.argv[2]) as z:
 assert z.testzip() is None and z.namelist()==names
 for name in names:assert z.read(name)==(root/name).read_bytes()
`,stage,archive],{input:JSON.stringify(names),timeout:120000,maxBuffer:4*1024*1024});
}
export async function packageSid8580Machine({version='dev',buildDir,releaseDir=join(machineRoot,'release'),verify:doVerify=false}={}){
  assert(typeof version==='string'&&/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(version),'Invalid research package version');
  const plan=await planSid8580MachinePackage({buildDir});releaseDir=resolve(releaseDir);
  const stage=join(releaseDir,'sid8580-machine-'+version),archive=join(releaseDir,'tetorica_sid8580_machine_'+version+'_research.zip');
  await absent(stage);await absent(archive);await mkdir(stage,{recursive:true});const records={};
  for(const [name,expected]of Object.entries(plan.sources)){
    const data=await bytesAt(machineRoot,name);assert.deepEqual(machineDigest(data),expected);await mkdir(dirname(join(stage,name)),{recursive:true});await writeFile(join(stage,name),data,{flag:'wx'});records[name]=expected;
  }
  for(const [name,expected]of Object.entries(plan.artifacts)){
    const data=await bytesAt(plan.buildDir,name.split('/').at(-1));assert.deepEqual(machineDigest(data),expected);await mkdir(dirname(join(stage,name)),{recursive:true});await writeFile(join(stage,name),data,{flag:'wx'});records[name]=expected;
  }
  const additions={'README.md':README,'index.html':'<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=docs/sid8580-lab/index.html"><a href="docs/sid8580-lab/index.html">Open the SID8580 research lab</a>\n'};
  for(const [name,text]of Object.entries(additions)){const data=Buffer.from(text);await writeFile(join(stage,name),data,{flag:'wx'});records[name]=machineDigest(data);}
  const verification=doVerify?await verify(stage,plan.receipt):{performed:false};
  const manifest={format:'tetorica-sid8580-research-machine-package',version:1,sourceVersion:version,production:false,
    compiledInputCount:Object.keys(plan.receipt.inputs).length,sourceFiles:records,verification,
    excluded:['Native binaries','GPL SID oracle implementation/binary','user ROMs','game music','PCM'],rustNoticesIncluded:true,emscriptenRuntimeNoticesIncluded:true};
  await writeFile(join(stage,'research-package.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  const names=[...Object.keys(records),'research-package.json'].sort();zip(stage,archive,names);
  return {stage,archive,files:names.length,...machineDigest(await readFile(archive)),compiledInputs:manifest.compiledInputCount,verification,zipCrcPassed:true,archiveFilesByteIdentical:true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options={};let plan=false;
  for(let i=2;i<process.argv.length;i++){
    const flag=process.argv[i];if(flag==='--plan')plan=true;else if(flag==='--verify')options.verify=true;
    else{assert(['--version','--build-dir','--release-dir'].includes(flag)&&process.argv[i+1]);options[{'--version':'version','--build-dir':'buildDir','--release-dir':'releaseDir'}[flag]]=process.argv[++i];}
  }
  if(plan){assert(!options.verify);const p=await planSid8580MachinePackage(options);console.log(JSON.stringify({passed:true,planOnly:true,compiledInputs:Object.keys(p.receipt.inputs).length,sourceFiles:Object.keys(p.sources).length,artifacts:p.artifacts,createsFiles:false},null,2));}
  else console.log(JSON.stringify(await packageSid8580Machine(options),null,2));
}
