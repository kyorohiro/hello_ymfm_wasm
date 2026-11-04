// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {constants} from 'node:fs';
import {mkdir, mkdtemp, readFile, readdir, writeFile, copyFile, rm} from 'node:fs/promises';
import {join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build, version as esbuildVersion} from 'esbuild';
import {checkRuntimeArtifacts, copyRuntimeArtifacts} from './runtime_artifacts.mjs';
import {copyNesSources} from './copy_nes_sources.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const slash = value => value.split(sep).join('/');
const clean = value => value.replace(/[?#].*$/, '');
const record = bytes => ({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
const safe = name => /^[\w./+-]+$/.test(name) && !name.startsWith('/') && !name.split('/').some(part=>part==='..'||part==='');
async function filesIn(base, prefix='') {
  const result=[];
  for (const entry of await readdir(join(base,prefix),{withFileTypes:true})) {
    const name=prefix+entry.name;
    if(entry.isDirectory()) result.push(...await filesIn(base,name+'/'));
    else {assert(entry.isFile(),`Unsupported archive entry: ${name}`);result.push(name);}
  }
  return result.sort();
}
function zip(base, path, names) {
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
export function validate2a03SynthVersion(value) {
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(value)) throw new Error('Invalid package version');
  return value;
}
export async function package2a03Synth({version='dev',releaseDir=join(root,'release')}={}) {
  validate2a03SynthVersion(version);
  await checkRuntimeArtifacts({root,ids:['nesapu'],mirrors:true});
  releaseDir=resolve(releaseDir);await mkdir(releaseDir,{recursive:true});
  const archive=join(releaseDir,`tetorica_2a03_synth_${version}_itch.zip`);
  try{await readFile(archive);throw new Error(`Archive already exists: ${archive}`);}catch(error){if(error.code!=='ENOENT') throw error;}
  const stage=await mkdtemp(join(releaseDir,`itch_2a03_synth_${version}-`)),inputs=new Set(),bundles=[];
  await mkdir(join(stage,'synth-2a03'),{recursive:true});
  for(const name of ['synth.js','processor.js','synth.css']) {
    const outfile=join(stage,'synth-2a03',name);
    const result=await build({absWorkingDir:root,entryPoints:[`docs/synth-2a03/${name}`],outfile,
      bundle:true,format:'esm',platform:'browser',target:'es2022',define:{process:'undefined'},minify:true,
      keepNames:true,legalComments:'linked',metafile:true,write:false,logLevel:'silent',plugins:[{
        name:'unchanged-nes-factory',setup(builder){builder.onResolve({filter:/nesapu_wasm\.js(?:[?#]|$)/},args=>{
          // The public wrapper has the same basename; bundle that wrapper,
          // externalizing only the original generated Emscripten factory.
          if(resolve(args.resolveDir,clean(args.path))===resolve(root,'docs/generated/nesapu_wasm.js')) {
            return {path:'../generated/nesapu_wasm.js',external:true};
          }
        });}
      }]});
    for(const path of Object.keys(result.metafile.inputs)){assert(safe(clean(path)),path);inputs.add(clean(path));}
    for(const output of result.outputFiles){assert(safe(slash(relative(stage,output.path))));await writeFile(output.path,output.contents);}
    const metadata=result.metafile.outputs[slash(relative(root,outfile))];assert(metadata);
    for(const edge of metadata.imports) assert(edge.external&&edge.path==='../generated/nesapu_wasm.js');
    bundles.push({path:`synth-2a03/${name}`,...record(await readFile(outfile)),localImports:metadata.imports.map(edge=>edge.path)});
  }
  const home='https://kyorohiro.github.io/hello_ymfm_wasm/';
  let html=await readFile(join(root,'docs/synth-2a03/index.html'),'utf8');
  html=html.replace(/href="(\.\.\/[^"#]+)"/g,(_match,path)=>{
    if(path==='../tetorica_2a03_synth.webp') return `href="${path}"`;
    if(path==='../js/nesapusynth.js') return 'href="https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/tetorica_src/runtime/nesapusynth.js"';
    return `href="${new URL(path,home+'synth-2a03/').href}"`;
  });
  await writeFile(join(stage,'synth-2a03/index.html'),html);
  await writeFile(join(stage,'index.html'),html.replaceAll('../tetorica_2a03_synth.webp','./tetorica_2a03_synth.webp').replace(/\b(href|src)="\.\/(synth\.(?:css|js))"/g,'$1="./synth-2a03/$2"'));
  await copyRuntimeArtifacts({root,destination:join(stage,'generated'),ids:['nesapu'],includeMetadata:false});
  await copyNesSources(stage);
  const sdk=JSON.parse(await readFile(join(root,'third_party/soundchip-sdk.json'),'utf8'));
  const nativeInputs=await filesIn(join(stage,'sources'));
  const native={schemaVersion:1,component:'nesapu',sdk,
    inputs:await Promise.all(nativeInputs.map(async name=>({path:'sources/'+name,...record(await readFile(join(stage,'sources',name)))}))),
    generated:Object.fromEntries(await Promise.all(['nesapu_wasm.js','nesapu_wasm.wasm'].map(async name=>[name,record(await readFile(join(stage,'generated',name)))]))),
  };
  await writeFile(join(stage,'sources/NES-FDS.json'),JSON.stringify(native,null,2)+'\n');
  const sourceCheck={inputs:native.inputs.length,sdkVersion:sdk.version};
  await copyFile(join(root,'LICENSE'),join(stage,'LICENSE'));
  await copyFile(join(root,'docs/tetorica_2a03_synth.webp'),join(stage,'tetorica_2a03_synth.webp'));
  const guide=(await readFile(join(root,'docs/synth-2a03/README.md'),'utf8')).replace(/\]\(([^)]+)\)/g,(match,target)=>{
    if (/^(?:https?:|#)/.test(target)||target==='index.html') return match;
    return `](${new URL(target,'https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/docs/synth-2a03/').href})`;
  });
  await writeFile(join(stage,'README.md'),guide+'\n## Included sources\n\nSee [NES + FDS sources and rebuilding](sources/NES-FDS.md), [browser build inputs](sources/2a03-synth-browser-inputs.zip) and their [hash receipt](sources/2a03-synth-browser.json).\n');
  for(const path of ['docs/synth-2a03/index.html','docs/synth-2a03/README.md','docs/tetorica_2a03_synth.webp','LICENSE','package.json','package-lock.json',
    'scripts/package_itch_2a03_synth.mjs','scripts/package_itch_2a03_synth.sh','scripts/copy_nes_sources.mjs',
    'third_party/soundchip-sdk.json','third_party/tetorica-soundchip-native/RELEASE-MANIFEST.json',
    'tetorica_src/runtime/generated/nesapu_wasm.js']) inputs.add(path);
  const names=[...inputs].sort(),sourceArchive='sources/2a03-synth-browser-inputs.zip';
  zip(root,join(stage,sourceArchive),names);
  const receipt={schemaVersion:1,product:'Tetorica 2A03 Synth',productId:'tetorica-2a03-synth',version,builder:{name:'esbuild',version:esbuildVersion,define:{process:'undefined'}},bundles,
    originalInputs:await Promise.all(names.map(async path=>({path,...record(await readFile(join(root,path)))}))),
    sourceArchive:{path:sourceArchive,...record(await readFile(join(stage,sourceArchive)))},sourceCheck};
  await writeFile(join(stage,'sources/2a03-synth-browser.json'),JSON.stringify(receipt,null,2)+'\n');
  const namesInStage=await filesIn(stage);assert(namesInStage.length<=1000,'itch.io file limit exceeded');
  const temporary=stage+'.zip';
  try{zip(stage,temporary,namesInStage);await copyFile(temporary,archive,constants.COPYFILE_EXCL);await rm(temporary);}
  catch(error){await rm(temporary,{force:true});throw error;}
  return {passed:true,stage,archive,files:namesInStage.length,bundles:bundles.length,archiveRecord:record(await readFile(archive)),sourceCheck};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length>3) throw new Error('Usage: node scripts/package_itch_2a03_synth.mjs [VERSION]');
  console.log(JSON.stringify(await package2a03Synth({version:process.argv[2]??'dev'}),null,2));
}
