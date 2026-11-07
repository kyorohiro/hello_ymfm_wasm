#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Package authored browser modules unchanged. No minification or runtime bundle.
import assert from 'node:assert/strict';
import {constants} from 'node:fs';
import {copyFile,cp,lstat,mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {version as esbuildVersion} from 'esbuild';
import {copyReadableModules} from './copy_readable_modules.mjs';
import {syncSidPlayerArtifacts,SID_PLAYER_BUILD_INPUTS} from './sid_player_artifacts.mjs';
import {syncSidRsidArtifacts,SID_RSID_BUILD_INPUTS} from './sid_rsid_artifacts.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const record=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
const home='https://kyorohiro.github.io/hello_ymfm_wasm/';
const demos=['tone','pulse','noise','melody-filter'];
async function filesIn(directory,prefix=''){
  const names=[];
  for(const entry of await readdir(join(directory,prefix),{withFileTypes:true})){
    const name=prefix+entry.name;
    if(entry.isDirectory())names.push(...await filesIn(directory,name+'/'));
    else{assert(entry.isFile(),`Unsupported package entry: ${name}`);names.push(name);}
  }
  return names.sort();
}
function zip(base,target,names){
  execFileSync('python3',['-c',String.raw`
import json,sys,zipfile
from pathlib import Path
base=Path(sys.argv[1]);names=json.load(sys.stdin)
with zipfile.ZipFile(sys.argv[2],"x",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name in names:
  assert not name.startswith('/') and '..' not in name.split('/')
  info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.create_system=3;info.external_attr=0o100644<<16
  z.writestr(info,(base/name).read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
with zipfile.ZipFile(sys.argv[2]) as z: assert z.testzip() is None
`,base,target],{input:JSON.stringify(names)});
}
async function requireAbsent(path){
  try{await lstat(path);}catch(error){if(error.code==='ENOENT')return;throw error;}
  throw new Error(`Archive already exists: ${path}`);
}
function localPath(value,entry){
  const url=new URL(value,new URL(entry,'https://package.invalid/'));
  assert.equal(url.origin,'https://package.invalid',`${entry}: external runtime dependency ${value}`);
  return decodeURIComponent(url.pathname.slice(1));
}
export function validateSidPlayerVersion(version){
  if(typeof version!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(version))throw new Error('Invalid SID player package version');
  return version;
}

async function copyNativeKit(stage,component,buildInputs){
  await mkdir(join(stage,'generated'),{recursive:true});
  await cp(join(root,'docs/generated',component),join(stage,'generated',component),{recursive:true});
  assert.deepEqual(await filesIn(join(stage,'generated',component)),[`${component}-build.json`,`${component}.wasm`],'Unexpected files in generated '+component);
  await mkdir(join(stage,'sources'),{recursive:true});
  await cp(join(root,'docs/sources',component),join(stage,'sources',component),{recursive:true});
  assert.deepEqual(await filesIn(join(stage,'sources',component)),[...buildInputs,'README.md'].sort(),'Unexpected files in '+component+' native source kit');
  const receipt=JSON.parse(await readFile(join(stage,'generated',component,`${component}-build.json`),'utf8'));
  assert.equal(receipt.component,component);assert.equal(receipt.fixedSdkArtifact,false);
  assert.deepEqual(record(await readFile(join(stage,'generated',component,`${component}.wasm`))),receipt.output);
  for(const [path,digest] of Object.entries(receipt.inputs))assert.deepEqual(record(await readFile(join(stage,'sources',component,path))),digest,`Native source hash differs: ${component}: ${path}`);
  return{path:`generated/${component}/${component}.wasm`,...receipt.output};
}

async function copyRsidDemo(stage,inputs){
  const directory='docs/sid-player/demos/rsid',target='sid-player/demos/rsid';
  const files=['irq.sid','fixture.mjs','LICENSE.txt','README.md','provenance.json'];
  const provenance=JSON.parse(await readFile(join(root,directory,'provenance.json'),'utf8'));
  assert.equal(provenance.format,'tetorica-rsid-demo-provenance');assert.equal(provenance.license,'BSD-3-Clause');
  assert.equal(provenance.containsThirdPartyMusic,false);assert.equal(provenance.containsRomDump,false);
  assert.equal(provenance.generator.file,'fixture.mjs');
  const generator=await readFile(join(root,directory,'fixture.mjs'));
  assert.deepEqual(generator,await readFile(join(root,'test/helpers/rsid_fixtures.mjs')),'RSID demo generator differs from original');
  assert.deepEqual(record(generator),{bytes:provenance.generator.bytes,sha256:provenance.generator.sha256});
  assert.equal(provenance.outputs.length,1);assert.equal(provenance.outputs[0].file,'irq.sid');assert.equal(provenance.outputs[0].profile,'cia-irq');
  await mkdir(join(stage,target),{recursive:true});
  for(const file of files){
    const source=`${directory}/${file}`;
    await copyFile(join(root,source),join(stage,target,file));inputs.add(source);
  }
  for(const file of provenance.outputs)assert.deepEqual(record(await readFile(join(stage,target,file.file))),{bytes:file.bytes,sha256:file.sha256},`RSID demo hash differs: ${file.file}`);
}

/** Make a new standalone ZIP and stage; never merge or overwrite an old build. */
export async function packageSidPlayer({version='dev',releaseDir=join(root,'release')}={}){
  validateSidPlayerVersion(version);
  await syncSidPlayerArtifacts({check:true});
  await syncSidRsidArtifacts({check:true});
  assert.deepEqual(await readFile(join(root,'docs/js/sid_psid.js')),await readFile(join(root,'tetorica_src/runtime/sid_psid.js')),'Served PSID parser differs from canonical source');
  assert.deepEqual(await readFile(join(root,'docs/js/sid_rsid.js')),await readFile(join(root,'tetorica_src/runtime/sid_rsid.js')),'Served RSID parser differs from canonical source');
  releaseDir=resolve(releaseDir);await mkdir(releaseDir,{recursive:true});
  const archive=join(releaseDir,`tetorica_sid_player_${version}_itch.zip`);
  await requireAbsent(archive);
  const stage=await mkdtemp(join(releaseDir,`sid-player-${version}-stage-`));
  const browser=await copyReadableModules({root,stage,entries:['docs/sid-player/player.js','docs/sid-player/processor.js','docs/sid-player/player.css'],factories:[]});
  const inputs=new Set(browser.inputs);
  for(const module of browser.modules){
    const text=await readFile(join(stage,module.path),'utf8');
    assert(!/\.test\.[cm]?js$/.test(module.path),`Test is in runtime closure: ${module.path}`);
    assert(!/(?:from\s*|import\s*\(|require\s*\()\s*['"]node:/.test(text),`Node import in runtime: ${module.path}`);
  }
  const nativeArtifacts=[await copyNativeKit(stage,'sid-player',SID_PLAYER_BUILD_INPUTS),await copyNativeKit(stage,'sid-rsid',SID_RSID_BUILD_INPUTS)];
  const demoFiles=['README.md','LICENSE.txt','fixture.mjs','provenance.json',...demos.map(name=>name+'.sid')];
  const provenance=JSON.parse(await readFile(join(root,'docs/sid-player/demos/provenance.json'),'utf8'));
  assert.equal(provenance.license,'BSD-3-Clause');
  assert.deepEqual(provenance.files.map(file=>file.profile),demos);
  assert.deepEqual(await readFile(join(root,'docs/sid-player/demos/fixture.mjs')),await readFile(join(root,'test/fixtures/sid-reference/fixture.mjs')),'Demo generator differs from original');
  assert.equal(record(await readFile(join(root,'docs/sid-player/demos/fixture.mjs'))).sha256,provenance.generator.sha256);
  await mkdir(join(stage,'sid-player/demos'),{recursive:true});
  for(const name of demoFiles){
    const source=`docs/sid-player/demos/${name}`;
    await copyFile(join(root,source),join(stage,'sid-player/demos',name));inputs.add(source);
  }
  for(const file of provenance.files){
    assert.equal(file.name,file.profile+'.sid','Unexpected demo provenance filename');
    assert.deepEqual(record(await readFile(join(stage,'sid-player/demos',file.name))),{bytes:file.bytes,sha256:file.sha256},`Demo hash differs: ${file.name}`);
  }
  await copyRsidDemo(stage,inputs);
  for(const source of ['docs/tetorica_sid_synth.webp','LICENSE']){
    await copyFile(join(root,source),join(stage,source.replace(/^docs\//,'')));inputs.add(source);
  }
  const guide=await readFile(join(root,'docs/sid-player/README.md'),'utf8');
  await writeFile(join(stage,'sid-player/README.md'),guide);
  await writeFile(join(stage,'README.md'),'# Tetorica SID Player\n\nOpen [the player](sid-player/index.html) through a local HTTP server or an HTTPS host. Read the [player guide](sid-player/README.md) for file limits, sources and rebuilding.\n\nJavaScript and CSS preserve their authored modules and comments; no runtime bundle or minification is used.\n');
  // Preserve source UI paths for local dependencies. Navigation to products and
  // guides outside this standalone package opens their published documentation.
  let html=await readFile(join(root,'docs/sid-player/index.html'),'utf8');
  const copied=new Set(await filesIn(stage));
  html=html.replace(/(<a\b[^>]*\bhref=")([^"#]+)(")/g,(match,before,value,after)=>{
    const url=new URL(value,home+'sid-player/');
    if(url.origin!==new URL(home).origin)return match;
    const local=new URL(value,'https://package.invalid/sid-player/index.html').pathname.slice(1);
    if(copied.has(local)||local==='sid-player/index.html')return match;
    return before+url.href+after;
  });
  await writeFile(join(stage,'sid-player/index.html'),html);
  await writeFile(join(stage,'index.html'),'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=sid-player/index.html"><title>Tetorica SID Player</title><a href="sid-player/index.html">Open Tetorica SID Player</a></html>\n');
  for(const source of ['docs/sid-player/index.html','docs/sid-player/README.md','tetorica_src/runtime/sid_psid.js','tetorica_src/runtime/sid_rsid.js',
    'tetorica_src/cli/sid_psid.mjs','test/fixtures/sid-reference/fixture.mjs','test/helpers/rsid_fixtures.mjs','package.json','package-lock.json',
    'scripts/package_sid_player.mjs','scripts/copy_readable_modules.mjs',...SID_PLAYER_BUILD_INPUTS,...SID_RSID_BUILD_INPUTS])inputs.add(source);
  const names=[...inputs].sort(),sourceArchive='sources/sid-player-browser-inputs.zip';
  assert(!names.some(name=>/\.(?:bin|rom)$/i.test(name)),'Firmware images must never be package source inputs');
  zip(root,join(stage,sourceArchive),names);
  const receipt={schemaVersion:1,product:'Tetorica SID Player',productId:'tetorica-sid-player',version,
    builder:{name:'source-copy',minify:false,bundle:false,dependencyAnalyzer:{name:'esbuild',version:esbuildVersion}},
    entries:browser.entries,modules:browser.modules,
    nativeArtifact:nativeArtifacts[0],nativeArtifacts,
    originalInputs:await Promise.all(names.map(async path=>({path,...record(await readFile(join(root,path)))}))),
    sourceArchive:{path:sourceArchive,...record(await readFile(join(stage,sourceArchive)))}};
  await writeFile(join(stage,'sources/sid-player-browser.json'),JSON.stringify(receipt,null,2)+'\n');
  const packageNames=await filesIn(stage),present=new Set(packageNames);
  assert(packageNames.length<=1000,'itch.io file limit exceeded');
  for(const [tag] of html.matchAll(/<(?:img|script|link)\b[^>]*>/g))for(const [,value] of tag.matchAll(/\b(?:src|href)="([^"]+)"/g))assert(present.has(localPath(value,'sid-player/index.html')),`Missing HTML dependency: ${value}`);
  for(const module of browser.modules){
    for(const specifier of module.localImports)assert(present.has(localPath(specifier,module.path)),`Missing module dependency: ${module.path}: ${specifier}`);
    const source=await readFile(join(stage,module.path),'utf8');
    for(const [, ,value] of source.matchAll(/new URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g))assert(present.has(localPath(value,module.path)),`Missing runtime URL: ${module.path}: ${value}`);
  }
  assert(!packageNames.some(name=>/\.(?:bin|rom)$|\.test\.[cm]?js$|(?:^|\/)(?:libsidplayfp|libresidfp|C64Music|hvsc)(?:\/|$)/i.test(name)),'Unexpected ROM image, test, GPL player or music corpus in package');
  const temporary=stage+'.zip';
  try{zip(stage,temporary,packageNames);await copyFile(temporary,archive,constants.COPYFILE_EXCL);await rm(temporary);}
  catch(error){await rm(temporary,{force:true});throw error;}
  return{passed:true,stage,archive,files:packageNames.length,modules:browser.modules.length,archiveRecord:record(await readFile(archive))};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length>3)throw new Error('Usage: node scripts/package_sid_player.mjs [VERSION]');
  console.log(JSON.stringify(await packageSidPlayer({version:process.argv[2]??'dev'}),null,2));
}
