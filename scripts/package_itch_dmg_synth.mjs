// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {constants} from 'node:fs';
import {mkdir, mkdtemp, readFile, readdir, writeFile, copyFile, cp, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {version as esbuildVersion} from 'esbuild';
import {checkRuntimeArtifacts, copyRuntimeArtifacts} from './runtime_artifacts.mjs';
import {copyGameboySources} from './copy_gameboy_sources.mjs';
import {copyReadableModules} from './copy_readable_modules.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const record = bytes => ({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
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
export function validateDmgSynthVersion(value) {
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(value)) throw new Error('Invalid package version');
  return value;
}
export async function packageDmgSynth({version='dev',releaseDir=join(root,'release')}={}) {
  validateDmgSynthVersion(version);
  await checkRuntimeArtifacts({root,ids:['gameboy_apu','native_audio_effect'],mirrors:true});
  releaseDir=resolve(releaseDir);await mkdir(releaseDir,{recursive:true});
  const archive=join(releaseDir,`tetorica_dmg_synth_${version}_itch.zip`);
  try{await readFile(archive);throw new Error(`Archive already exists: ${archive}`);}catch(error){if(error.code!=='ENOENT') throw error;}
  const stage=await mkdtemp(join(releaseDir,`itch_dmg_synth_${version}-`));
  const browser=await copyReadableModules({root,stage,
    entries:['docs/synth-dmg/synth.js','docs/synth-dmg/processor.js','docs/synth-dmg/synth.css','docs/js/native-fx-worklet.js'],
    factories:['docs/generated/gameboy_apu_wasm.js']});
  const inputs=new Set(browser.inputs),bundles=browser.entries;
  // These named Monaco resources and the software FX binary are not static
  // import edges. Keep them local and readable without adding other chip WASM.
  for(const name of ['tetorica-playground-globals.d.ts','tetorica-playground-gameboy.d.ts','tetorica-shell.d.ts']){
    const source='docs/playground/'+name;await mkdir(join(stage,'playground'),{recursive:true});await copyFile(join(root,source),join(stage,'playground',name));inputs.add(source);
  }
  for(const [source,destination]of [['docs/playground/vendor/fflate-LICENSE','playground/vendor/fflate-LICENSE'],['packages/virtual-files/LICENSE','licenses/tetorica-virtual-files/LICENSE']]){
    await mkdir(join(stage,destination.slice(0,destination.lastIndexOf('/'))),{recursive:true});await copyFile(join(root,source),join(stage,destination));inputs.add(source);
  }
  const effectSource='tetorica_src/runtime/generated/effects/gain.wasm',effectPath='js/native_audio_effect.wasm';
  await copyFile(join(root,effectSource),join(stage,effectPath));inputs.add(effectSource);
  const effectKit='sources/code-effects';
  await mkdir(join(stage,effectKit,'scripts'),{recursive:true});await mkdir(join(stage,effectKit,'tetorica_src/native'),{recursive:true});
  await cp(join(root,'tetorica_src/native/audio_effect'),join(stage,effectKit,'tetorica_src/native/audio_effect'),{recursive:true});
  await copyFile(join(root,'scripts/build_native_audio_effect.sh'),join(stage,effectKit,'scripts/build_native_audio_effect.sh'));
  await copyFile(join(root,'LICENSE'),join(stage,effectKit,'LICENSE'));
  for(const file of await filesIn(join(root,'tetorica_src/native/audio_effect')))inputs.add('tetorica_src/native/audio_effect/'+file);
  inputs.add('scripts/build_native_audio_effect.sh');
  await writeFile(join(stage,effectKit,'README.md'),`# Code software effects

This original Tetorica C effect rack is BSD-3-Clause; see LICENSE. It runs after
the DMG APU as host software, separately from its hardware sound controls.
The readable browser host is js/native_fx_rack.js; its binary is
js/native_audio_effect.wasm. With Emscripten installed, run here:

\`\`\`sh
sh scripts/build_native_audio_effect.sh /tmp/tetorica-dmg-code-effects
cp /tmp/tetorica-dmg-code-effects/gain.wasm ../../js/native_audio_effect.wasm
\`\`\`

An explicit output directory keeps this rebuild independent of artifact-sync tools.
`);
  const home='https://kyorohiro.github.io/hello_ymfm_wasm/';
  let html=await readFile(join(root,'docs/synth-dmg/index.html'),'utf8');
  html=html.replace(/href="(\.\.\/[^"#]+)"/g,(_match,path)=>{
    if(path==='../tetorica_dmg_synth.webp') return `href="${path}"`;
    if(path==='../js/gameboysynth.js') return 'href="https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/tetorica_src/runtime/gameboysynth.js"';
    return `href="${new URL(path,home+'synth-dmg/').href}"`;
  });
  await writeFile(join(stage,'synth-dmg/index.html'),html);
  await writeFile(join(stage,'index.html'),html.replaceAll('../tetorica_dmg_synth.webp','./tetorica_dmg_synth.webp').replace(/\b(href|src)="\.\/(synth\.(?:css|js)(?:\?[^"#]*)?)"/g,'$1="./synth-dmg/$2"'));
  await copyRuntimeArtifacts({root,destination:join(stage,'generated'),ids:['gameboy_apu'],includeMetadata:false});
  const sourceCheck=await copyGameboySources(stage);
  await copyFile(join(root,'LICENSE'),join(stage,'LICENSE'));
  await copyFile(join(root,'docs/tetorica_dmg_synth.webp'),join(stage,'tetorica_dmg_synth.webp'));
  const guide=(await readFile(join(root,'docs/synth-dmg/README.md'),'utf8')).replace(/\]\(([^)]+)\)/g,(match,target)=>{
    if (/^(?:https?:|#)/.test(target)||target==='index.html') return match;
    return `](${new URL(target,'https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/docs/synth-dmg/').href})`;
  });
  await writeFile(join(stage,'README.md'),guide+'\n## Included sources\n\nSee [Game Boy native sources and rebuilding](sources/GameBoy.md), [browser build inputs](sources/dmg-synth-browser-inputs.zip) and their [hash receipt](sources/dmg-synth-browser.json).\n');
  for(const path of ['docs/synth-dmg/index.html','docs/synth-dmg/README.md','docs/tetorica_dmg_synth.webp','LICENSE','package.json','package-lock.json',
    'scripts/package_itch_dmg_synth.mjs','scripts/package_itch_dmg_synth.sh','scripts/copy_gameboy_sources.mjs',
    'scripts/copy_readable_modules.mjs','scripts/runtime_artifacts.mjs','scripts/wasm_sdk_inventory.mjs',
    'tetorica_src/runtime/generated/gameboy_apu_wasm.js']) inputs.add(path);
  const names=[...inputs].sort(),sourceArchive='sources/dmg-synth-browser-inputs.zip';
  zip(root,join(stage,sourceArchive),names);
  const receipt={schemaVersion:1,product:'Tetorica DMG Synth',productId:'tetorica-dmg-synth',version,
    builder:{name:'source-copy',minify:false,bundle:false,dependencyAnalyzer:{name:'esbuild',version:esbuildVersion}},bundles,modules:browser.modules,
    originalInputs:await Promise.all(names.map(async path=>({path,...record(await readFile(join(root,path)))}))),
    sourceArchive:{path:sourceArchive,...record(await readFile(join(stage,sourceArchive)))},sourceCheck};
  await writeFile(join(stage,'sources/dmg-synth-browser.json'),JSON.stringify(receipt,null,2)+'\n');
  const namesInStage=await filesIn(stage);assert(namesInStage.length<=1000,'itch.io file limit exceeded');
  const temporary=stage+'.zip';
  try{zip(stage,temporary,namesInStage);await copyFile(temporary,archive,constants.COPYFILE_EXCL);await rm(temporary);}
  catch(error){await rm(temporary,{force:true});throw error;}
  return {passed:true,stage,archive,files:namesInStage.length,bundles:bundles.length,archiveRecord:record(await readFile(archive)),sourceCheck};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length>3) throw new Error('Usage: node scripts/package_itch_dmg_synth.mjs [VERSION]');
  console.log(JSON.stringify(await packageDmgSynth({version:process.argv[2]??'dev'}),null,2));
}
