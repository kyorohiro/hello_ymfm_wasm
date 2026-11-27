// SPDX-License-Identifier: BSD-3-Clause
import {execFileSync} from 'node:child_process';
import {cp, link, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyReadableModules} from './copy_readable_modules.mjs';

const version=process.argv[2]??'dev';
if(process.argv.length>3 || !/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,79}$/.test(version))
  throw Error('Usage: sh scripts/package_itch_cps2_synth.sh VERSION');
const root=fileURLToPath(new URL('../',import.meta.url));
const release=join(root,'release');
await mkdir(release,{recursive:true});
const tmp=await mkdtemp(join(release,'.cps2-'));
const web=join(tmp,'web'),source=join(tmp,'source');
async function copy(from,to){
  await mkdir(dirname(to),{recursive:true});
  await cp(from,to,{recursive:true});
}
function archive(dir,name){
  const zip=join(tmp,name+'.zip');
  execFileSync('zip',['-q','-X','-r',zip,'.'],{cwd:dir});
  execFileSync('unzip',['-tq',zip]);
  const count=execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trimEnd().split('\n').length;
  if(dir===web && count>1000)throw Error('Browser ZIP exceeds 1000 entries');
  return zip;
}
try{
  const entries=['app.js','processor.js','code-worker.js','seek-worker.js'];
  await copyReadableModules({root,stage:web,entries:entries.map(f=>'docs/synth-cps2/'+f),factories:[]});
  for(const path of ['synth-cps2/README.md','synth-cps2/index.html','tetorica_cps2_synth.webp',
    'playground/tetorica-playground-globals.d.ts','playground/vendor/fflate-LICENSE','playground/vendor/es-module-lexer-LICENSE']){
    await copy(join(root,'docs',path),join(web,path));
  }
  await copy(web,join(source,'docs'));
  await copy(join(root,'docs/synth-cps2'),join(source,'docs/synth-cps2'));
  for(const path of ['LICENSE','third_party/mame-qsound/LICENSE','packages/virtual-files/LICENSE']){
    for(const dir of [web,source])await copy(join(root,path),join(dir,path));
  }
  const html=await readFile(join(web,'synth-cps2/index.html'),'utf8');
  await writeFile(join(web,'index.html'),html.replace('<meta charset="utf-8">','<meta charset="utf-8"><base href="./synth-cps2/">'));
  await writeFile(join(source,'package.json'),JSON.stringify({private:true,type:'module'},null,2)+'\n');
  await writeFile(join(source,'README.md'),`# Tetorica CPS2 Synth ${version}

Run \`python3 -m http.server 8000 --directory docs\` from this directory and open
http://localhost:8000/synth-cps2/. Run the tests with Node.js 22 or later
using \`node --test docs/synth-cps2/*.test.mjs\`.
See [the Synth guide](docs/synth-cps2/README.md) for controls and examples.
`);
  const archives=[archive(web,'itch'),archive(source,'source')];
  const published=[];
  try{
    for(const zip of archives){
      const suffix=zip===archives[0]?'itch':'source';
      const dest=join(release,`tetorica_cps2_synth_${version}_${suffix}.zip`);
      await link(zip,dest);published.push(dest);
    }
  }catch(error){
    for(const path of published)await rm(path);
    throw error;
  }
  console.log(published.join('\n'));
}finally{await rm(tmp,{recursive:true,force:true});}
