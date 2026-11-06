// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {constants} from 'node:fs';
import {mkdir,mkdtemp,readFile,readdir,writeFile,copyFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {version as esbuildVersion} from 'esbuild';
import {checkRuntimeArtifacts,copyRuntimeArtifacts} from './runtime_artifacts.mjs';
import {copySpcSources} from './copy_spc_sources.mjs';
import {copyReadableModules} from './copy_readable_modules.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const record=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
async function filesIn(base,prefix='') {
  const files=[];
  for(const entry of await readdir(join(base,prefix),{withFileTypes:true})) {
    const path=prefix+entry.name;
    if(entry.isDirectory())files.push(...await filesIn(base,path+'/'));
    else {assert(entry.isFile(),`Unsupported archive entry: ${path}`);files.push(path);}
  }
  return files.sort();
}
function zip(base,path,names) {
  execFileSync('python3',['-c',String.raw`
import json,sys,zipfile
from pathlib import Path
base=Path(sys.argv[1]); names=json.load(sys.stdin)
with zipfile.ZipFile(sys.argv[2],'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name in names:
  info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.create_system=3;info.external_attr=0o100644<<16
  z.writestr(info,(base/name).read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
with zipfile.ZipFile(sys.argv[2]) as z: assert z.testzip() is None
`,base,path],{input:JSON.stringify(names)});
}

export function validateSnesSynthVersion(value) {
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(value))throw new Error('Invalid package version');
  return value;
}

/** Check the shipped native files against their explicit staged-byte receipt. */
export async function verifySnesSourceReceipt(stage,receipt) {
  if(receipt?.schemaVersion!==1||receipt.component!=='spc'||!Array.isArray(receipt.inputs)||!receipt.inputs.length)throw new Error('Expected SNES SPC source receipt');
  const required=new Set(['sources/wasm/spc_wasm.cpp','sources/scripts/build_spc_wasm.sh',
    'sources/third_party/snes-spc/LICENSE','sources/third_party/snes-spc/snes_spc/SPC_DSP.cpp',
    'sources/third_party/snes-spc/snes_spc/SPC_DSP.h']);
  const seen=new Set();
  const verify=async(path,expected)=>{
    if(typeof path!=='string'||!path||path.startsWith('/')||path.includes('\\')||path.split('/').some(part=>part==='.'||part==='..'||!part))throw new Error('Unsafe source receipt path');
    const actual=record(await readFile(join(stage,path)));
    if(actual.bytes!==expected?.bytes||actual.sha256!==expected.sha256)throw new Error(`SNES source receipt mismatch: ${path}`);
  };
  for(const entry of receipt.inputs) {
    if(seen.has(entry.path))throw new Error('Duplicate source receipt path');seen.add(entry.path);
    await verify(entry.path,entry);required.delete(entry.path);
  }
  if(required.size)throw new Error('Incomplete SNES SPC native source receipt');
  for(const name of ['spc_wasm.js','spc_wasm.wasm'])await verify('generated/'+name,receipt.generated?.[name]);
}

async function nativeReceipt(stage) {
  const sdk=JSON.parse(await readFile(join(root,'third_party/soundchip-sdk.json')));
  const build=JSON.parse(await readFile(join(root,'tetorica_src/runtime/generated/build-info.json'))).artifacts?.find(item=>item.id==='spc');
  if(!build)throw new Error('SPC build provenance is missing');
  const inputs=[];
  for(const name of await filesIn(join(stage,'sources')))inputs.push({path:'sources/'+name,...record(await readFile(join(stage,'sources',name)))});
  const generated={};
  for(const name of ['spc_wasm.js','spc_wasm.wasm']) {
    generated[name]=record(await readFile(join(stage,'generated',name)));
    const output=build.outputs.find(entry=>entry.path===name);
    if(output?.sha256!==generated[name].sha256||output?.size!==generated[name].bytes)throw new Error(`SPC generated output provenance mismatch: ${name}`);
  }
  const receipt={schemaVersion:1,component:'spc',sdk,build,inputs,generated,
    recipeLayout:'The standalone recipe changes its five vendor/snes-spc paths to third_party/snes-spc. Shipped-byte hashes describe this relocated recipe; build describes the original SDK compilation.'};
  await verifySnesSourceReceipt(stage,receipt);
  await writeFile(join(stage,'sources/SNES-SPC.json'),JSON.stringify(receipt,null,2)+'\n');
  return {inputs:inputs.length,sdkVersion:sdk.version};
}

export async function packageSnesSynth({version='dev',releaseDir=join(root,'release')}={}) {
  validateSnesSynthVersion(version);
  await checkRuntimeArtifacts({root,ids:['spc'],mirrors:true});
  releaseDir=resolve(releaseDir);await mkdir(releaseDir,{recursive:true});
  const archive=join(releaseDir,`tetorica_sdsp_synth_${version}_itch.zip`);
  try{await readFile(archive);throw new Error(`Archive already exists: ${archive}`);}catch(error){if(error.code!=='ENOENT')throw error;}
  const stage=await mkdtemp(join(releaseDir,`itch_sdsp_synth_${version}-`));
  const browser=await copyReadableModules({root,stage,
    entries:['docs/synth-snes/synth.js','docs/synth-snes/processor.js','docs/synth-snes/synth.css'],
    factories:['docs/generated/spc_wasm.js']});
  const inputs=new Set(browser.inputs),home='https://kyorohiro.github.io/hello_ymfm_wasm/',icon='tetorica_sdsp_synth.webp';
  let html=await readFile(join(root,'docs/synth-snes/index.html'),'utf8');
  html=html.replace(/href="(\.\.\/[^"#]+)"/g,(_match,path)=>path==='../'+icon?`href="${path}"`:path==='../js/snessynth.js'
    ?'href="https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/tetorica_src/runtime/snessynth.js"'
    :`href="${new URL(path,home+'synth-snes/').href}"`);
  await writeFile(join(stage,'synth-snes/index.html'),html);
  await writeFile(join(stage,'index.html'),html.replace(/\b(href|src)="\.\/(synth\.(?:css|js))"/g,'$1="./synth-snes/$2"').replaceAll('../'+icon,'./'+icon));
  await copyFile(join(root,'docs',icon),join(stage,icon));
  await copyRuntimeArtifacts({root,destination:join(stage,'generated'),ids:['spc'],includeMetadata:false});
  await copySpcSources(stage);
  const sourceCheck=await nativeReceipt(stage);
  await copyFile(join(root,'LICENSE'),join(stage,'LICENSE'));
  const guide=(await readFile(join(root,'docs/synth-snes/README.md'),'utf8')).replace(/\]\(([^)]+)\)/g,(match,target)=>{
    if(/^(?:https?:|#)/.test(target)||target==='index.html')return match;
    return `](${new URL(target,'https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/docs/synth-snes/').href})`;
  });
  await writeFile(join(stage,'synth-snes/README.md'),guide);
  await writeFile(join(stage,'README.md'),guide+'\n## Included sources\n\nSee [SNES SPC native sources and rebuilding](sources/SNES-SPC.md), [native byte receipt](sources/SNES-SPC.json), [browser build inputs](sources/sdsp-synth-browser-inputs.zip) and their [hash receipt](sources/sdsp-synth-browser.json).\n');
  for(const path of ['docs/synth-snes/index.html','docs/synth-snes/README.md','docs/'+icon,'docs/issues/sdsp_synth_icon_prompt.txt','LICENSE','package.json','package-lock.json',
    'scripts/package_itch_snes_synth.mjs','scripts/package_itch_snes_synth.sh','scripts/copy_spc_sources.mjs',
    'scripts/copy_readable_modules.mjs','scripts/runtime_artifacts.mjs','scripts/wasm_sdk_inventory.mjs',
    'tetorica_src/runtime/generated/spc_wasm.js'])inputs.add(path);
  const names=[...inputs].sort(),sourceArchive='sources/sdsp-synth-browser-inputs.zip';
  zip(root,join(stage,sourceArchive),names);
  const receipt={schemaVersion:1,product:'Tetorica S-DSP Synth',productId:'tetorica-sdsp-synth',version,
    builder:{name:'source-copy',minify:false,bundle:false,dependencyAnalyzer:{name:'esbuild',version:esbuildVersion}},
    bundles:browser.entries,modules:browser.modules,
    originalInputs:await Promise.all(names.map(async path=>({path,...record(await readFile(join(root,path)))}))),
    sourceArchive:{path:sourceArchive,...record(await readFile(join(stage,sourceArchive)))},sourceCheck};
  await writeFile(join(stage,'sources/sdsp-synth-browser.json'),JSON.stringify(receipt,null,2)+'\n');
  const namesInStage=await filesIn(stage);assert(namesInStage.length<=1000,'itch.io file limit exceeded');
  const temporary=stage+'.zip';
  try{zip(stage,temporary,namesInStage);await copyFile(temporary,archive,constants.COPYFILE_EXCL);await rm(temporary);}
  catch(error){await rm(temporary,{force:true});throw error;}
  return {passed:true,stage,archive,files:namesInStage.length,bundles:browser.entries.length,archiveRecord:record(await readFile(archive)),sourceCheck};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length>3)throw new Error('Usage: node scripts/package_itch_snes_synth.mjs [VERSION]');
  console.log(JSON.stringify(await packageSnesSynth({version:process.argv[2]??'dev'}),null,2));
}
