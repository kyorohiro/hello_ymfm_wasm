// SPDX-License-Identifier: BSD-3-Clause
import {execFileSync} from 'node:child_process';
import {cp, link, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
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
const web=join(tmp,'web');
async function copy(from,to){
  await mkdir(dirname(to),{recursive:true});
  await cp(from,to,{recursive:true});
}
try{
  const entries=['app.js','processor.js','code-worker.js','seek-worker.js'];
  await copyReadableModules({root,stage:web,entries:entries.map(f=>'docs/synth-cps2/'+f),factories:[]});
  for(const path of ['synth-cps2','tetorica_cps2_synth.webp',
    'playground/tetorica-playground-globals.d.ts','playground/vendor/fflate-LICENSE','playground/vendor/es-module-lexer-LICENSE']){
    await copy(join(root,'docs',path),join(web,path));
  }
  for(const path of ['LICENSE','third_party/mame-qsound/LICENSE','packages/virtual-files/LICENSE']){
    await copy(join(root,path),join(web,path));
  }
  await writeFile(join(web,'index.html'),`<!doctype html>
<meta charset="utf-8"><title>Tetorica CPS2 Synth</title>
<script>location.replace('./synth-cps2/index.html'+location.search+location.hash)</script>
<a href="./synth-cps2/index.html">Open Tetorica CPS2 Synth</a>
`);
  await writeFile(join(web,'package.json'),JSON.stringify({private:true,type:'module'},null,2)+'\n');
  await writeFile(join(web,'README.md'),`# Tetorica CPS2 Synth ${version}

Run \`python3 -m http.server 8000\` from this directory and open
http://localhost:8000/. Run the tests with Node.js 22 or later
using \`node --test synth-cps2/*.test.mjs\`.
Edit the files directly, then reload the browser. No install or build step is required.
The root index opens the editable [Synth interface](synth-cps2/index.html).
Change layouts and styles there, or change controls and keyboard routing in
[synth-cps2/app.js](synth-cps2/app.js). The chip renderer is in
[js/qsoundpcm.js](js/qsoundpcm.js) and its AudioWorklet is in
[synth-cps2/processor.js](synth-cps2/processor.js).

To change the factory jam, edit [synth-cps2/preset-jam.js](synth-cps2/preset-jam.js).
A fresh browser profile opens with the new defaults. For an existing local
cassette, export it before selecting **New cassette** to try the new defaults.
To share your edit, zip the contents of this directory with index.html at the root.
Keep the included license notices with redistributed copies.

See [the Synth guide](synth-cps2/README.md) for controls and examples.
`);
  const zip=join(tmp,'itch.zip');
  execFileSync('zip',['-q','-X','-r',zip,'.'],{cwd:web});
  execFileSync('unzip',['-tq',zip]);
  const count=execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trimEnd().split('\n').length;
  if(count>1000)throw Error('Browser ZIP exceeds 1000 entries');
  const dest=join(release,`tetorica_cps2_synth_${version}_itch.zip`);
  await link(zip,dest);
  console.log(dest+' ('+count+' entries)');
}finally{await rm(tmp,{recursive:true,force:true});}
