// SPDX-License-Identifier: BSD-3-Clause
import {execFileSync} from 'node:child_process';
import {cp, link, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyReadableModules} from './copy_readable_modules.mjs';

const version=process.argv[2]??'dev';
if(process.argv.length>3 || !/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,79}$/.test(version))
  throw Error('Usage: sh scripts/package_itch_cps1_synth.sh VERSION');
const root=fileURLToPath(new URL('../',import.meta.url));
const release=join(root,'release');
const output=join(release,`tetorica_cps1_synth_${version}_itch.zip`);
await mkdir(release,{recursive:true});
const tmp=await mkdtemp(join(release,'.cps1-')),web=join(tmp,'web');
try{
  const entries=['synth.js','synth.css','code-worker.js','fm-worklet.js','oki-worklet.js','song-worklet.js'];
  await copyReadableModules({root,stage:web,entries:entries.map(file=>'docs/synth-cps1/'+file),
    factories:['docs/generated/ym2151_wasm.js']});
  async function copy(source,destination){
    await mkdir(dirname(join(web,destination)),{recursive:true});
    await cp(join(root,source),join(web,destination),{recursive:true});
  }
  for(const path of ['playground/samples/sonic-pi','synth-cps1/README.md','synth-cps1/examples','tetorica_cps1_synth.webp',
    'generated/ym2151_wasm.js','generated/ym2151_wasm.wasm','playground/tetorica-playground-globals.d.ts',
    'playground/vendor/fflate-LICENSE','playground/vendor/es-module-lexer-LICENSE']){
    await copy('docs/'+path,path);
  }
  await copy('LICENSE','LICENSE');
  await copy('third_party/mame-okim6295','third_party/mame-okim6295');
  await copy('third_party/tetorica-soundchip-native/LICENSE','licenses/tetorica-soundchip-native/LICENSE');
  await copy('third_party/tetorica-soundchip-native/vendor/ymfm/LICENSE','licenses/ymfm/LICENSE');
  await copy('packages/virtual-files/LICENSE','licenses/virtual-files/LICENSE');
  const html=(await readFile(join(root,'docs/synth-cps1/index.html'),'utf8'))
    .replace('href="../index.html"','href="https://kyorohiro.github.io/hello_ymfm_wasm/"');
  await writeFile(join(web,'synth-cps1/index.html'),html);
  await writeFile(join(web,'index.html'),html.replace('<meta charset="utf-8">','<meta charset="utf-8"><base href="./synth-cps1/">'));
  const zip=join(tmp,'cps1.zip');
  execFileSync('zip',['-q','-X','-r',zip,'.'],{cwd:web});
  execFileSync('unzip',['-tq',zip]);
  const count=execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trimEnd().split('\n').length;
  if(count>1000)throw Error('Browser ZIP exceeds 1000 entries');
  await link(zip,output);
  console.log(output);
}finally{await rm(tmp,{recursive:true,force:true});}
