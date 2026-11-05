// SPDX-License-Identifier: BSD-3-Clause
// Self-contained SCSP Synth; never modifies the served docs or an older ZIP.
import assert from 'node:assert/strict';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,readdir,writeFile,copyFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {version as esbuildVersion} from 'esbuild';
import {copyReadableModules} from './copy_readable_modules.mjs';
import {copyScspSources} from './copy_scsp_sources.mjs';
import {checkRuntimeArtifacts,copyRuntimeArtifacts} from './runtime_artifacts.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const record=data=>({bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
async function filesIn(base,prefix=''){
 const names=[];for(const entry of await readdir(join(base,prefix),{withFileTypes:true})){
  const name=prefix+entry.name;
  if(entry.isDirectory())names.push(...await filesIn(base,name+'/'));
  else{assert(entry.isFile(),`Unsupported package entry: ${name}`);names.push(name);}
 }return names.sort();
}
function zip(base,out,names){execFileSync('python3',['-c',String.raw`
import json,sys,zipfile
from pathlib import Path
base=Path(sys.argv[1]); names=json.load(sys.stdin)
with zipfile.ZipFile(sys.argv[2],'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name in names:
  info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.create_system=3;info.external_attr=0o100644<<16
  z.writestr(info,(base/name).read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
with zipfile.ZipFile(sys.argv[2]) as z:
 assert z.testzip() is None
`,base,out],{input:JSON.stringify(names)});}
export function validateScspSynthVersion(version){
 if(typeof version!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(version))throw new Error('Invalid package version');return version;
}
export async function packageScspSynth({version='dev',releaseDir=join(root,'release')}={}){
 validateScspSynthVersion(version);
 await checkRuntimeArtifacts({root,ids:['scsp'],mirrors:true});
 releaseDir=resolve(releaseDir);await mkdir(releaseDir,{recursive:true});
 const archive=join(releaseDir,`tetorica_scsp_synth_${version}_itch.zip`);
 // Exclusive final creation prevents replacing an existing release by accident.
 try{await readFile(archive);throw new Error(`Archive already exists: ${archive}`);}catch(error){if(error.code!=='ENOENT')throw error;}
 const stage=await mkdtemp(join(releaseDir,`itch_scsp_synth_${version}-`));
 await mkdir(join(stage,'synth-scsp'),{recursive:true});
 const readable=await copyReadableModules({root,stage,
  entries:['docs/synth-scsp/synth.js','docs/synth-scsp/processor.js','docs/playground/scsp_dsp_lab.js','docs/synth-scsp/synth.css'],
  factories:['docs/generated/scsp_wasm.js']});
 const inputs=new Set(readable.inputs),bundles=readable.entries.slice(0,3);
 let html=await readFile(join(root,'docs/synth-scsp/index.html'),'utf8');
 html=html.replaceAll('href="../index.html"','href="https://kyorohiro.github.io/hello_ymfm_wasm/"').replaceAll('href="../scsp.md"','href="https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/docs/scsp.md"').replaceAll('href="../playground/index.html?mode=scsp"','href="https://kyorohiro.github.io/hello_ymfm_wasm/playground/?mode=scsp"');
 await writeFile(join(stage,'synth-scsp/index.html'),html);
 await writeFile(join(stage,'index.html'),html.replaceAll('../tetorica-spu-1254.webp','./tetorica-spu-1254.webp').replaceAll('href="../playground/scsp-dsp.html"','href="./playground/scsp-dsp.html"').replace(/\b(href|src)="(synth\.(?:css|js)(?:\?[^"]*)?)"/g,'$1="./synth-scsp/$2"'));
 await mkdir(join(stage,'playground'),{recursive:true});
 const labHtml=(await readFile(join(root,'docs/playground/scsp-dsp.html'),'utf8')).replace('href="index.html?mode=scsp"','href="https://kyorohiro.github.io/hello_ymfm_wasm/playground/?mode=scsp"').replace('href="../scsp.md"','href="https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/docs/scsp.md"');
 await writeFile(join(stage,'playground/scsp-dsp.html'),labHtml);
 await copyRuntimeArtifacts({root,destination:join(stage,'generated'),ids:['scsp'],includeMetadata:false});
 await copyFile(join(root,'LICENSE'),join(stage,'LICENSE'));
 await copyFile(join(root,'docs/tetorica-spu-1254.webp'),join(stage,'tetorica-spu-1254.webp'));
 const sourceCheck=await copyScspSources(stage);
 for(const path of ['docs/playground/scsp-dsp.html','docs/synth-scsp/index.html','docs/synth-scsp/synth.css','docs/synth-scsp/README.md','docs/tetorica-spu-1254.webp','tetorica_src/runtime/generated/scsp_wasm.js','LICENSE','scripts/package_itch_scsp_synth.mjs','scripts/package_itch_scsp_synth.sh','scripts/copy_readable_modules.mjs','scripts/copy_scsp_sources.mjs','scripts/runtime_artifacts.mjs','scripts/wasm_sdk_inventory.mjs'])inputs.add(path);
 await copyFile(join(root,'docs/synth-scsp/README.md'),join(stage,'README.md'));
 const names=[...inputs].sort(),sourceArchive='sources/scsp-synth-browser-inputs.zip';zip(root,join(stage,sourceArchive),names);
 const receipt={schemaVersion:1,product:'Tetorica SCSP Synth',version,builder:{name:'source-copy',minify:false,bundle:false,dependencyAnalyzer:{name:'esbuild',version:esbuildVersion}},bundles,modules:readable.modules,originalInputs:await Promise.all(names.map(async path=>({path,...record(await readFile(join(root,path)))}))),sourceArchive:{path:sourceArchive,...record(await readFile(join(stage,sourceArchive)))},factory:{path:'generated/scsp_wasm.js',...record(await readFile(join(stage,'generated/scsp_wasm.js')))},wasm:{path:'generated/scsp_wasm.wasm',...record(await readFile(join(stage,'generated/scsp_wasm.wasm')))},sourceCheck};
 await writeFile(join(stage,'sources/scsp-synth-browser.json'),JSON.stringify(receipt,null,2)+'\n');
 const files=await filesIn(stage);assert(files.length<=1000,'itch.io file limit exceeded');
 const temporary=stage+'.zip';try{zip(stage,temporary,files);await copyFile(temporary,archive,constants.COPYFILE_EXCL);await rm(temporary);}catch(error){await rm(temporary,{force:true});throw error;}
 return {passed:true,stage,archive,files:files.length,bundles:bundles.length,archiveRecord:record(await readFile(archive)),sourceCheck};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length>3)throw new Error('Usage: node scripts/package_itch_scsp_synth.mjs [VERSION]');
 console.log(JSON.stringify(await packageScspSynth({version:process.argv[2]??'dev'}),null,2));
}
