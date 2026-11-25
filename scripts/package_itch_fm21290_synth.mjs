// SPDX-License-Identifier: BSD-3-Clause
import {cp,mkdtemp,mkdir,readFile,writeFile,rm,link} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {copyReadableModules} from './copy_readable_modules.mjs';

const version=process.argv[2]??'dev';
if(!/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,79}$/.test(version))throw Error('Invalid version');
const root=fileURLToPath(new URL('../',import.meta.url));
const release=join(root,'release'),app='synth-fm21290';
await mkdir(release,{recursive:true});
const tmp=await mkdtemp(join(release,'.fm21290-')),web=join(tmp,'web');
const output=join(release,'tetorica_fm21290_synth_'+version+'_itch.zip');
try{
  await copyReadableModules({root,stage:web,factories:[],entries:[
    'docs/'+app+'/synth.js','docs/'+app+'/synth.css','docs/'+app+'/worklet.js','docs/js/native-fx-worklet.js',
  ]});
  for(const name of [app+'/index.html',app+'/examples',app+'/README.md',app+'/registers.md',
    'tetorica_fm21290_synth.webp','js/native_audio_effect.wasm','playground/tetorica-playground-globals.d.ts',
    'js/msfa_dx7/LICENSE','js/msfa_dx7/THIRD_PARTY_NOTICES.md','playground/vendor/fflate-LICENSE','playground/vendor/es-module-lexer-LICENSE']){
    await mkdir(dirname(join(web,name)),{recursive:true});
    await cp(join(root,'docs',name),join(web,name),{recursive:true});
  }
  await cp(join(root,'LICENSE'),join(web,'LICENSE'));
  await cp(join(root,'packages/virtual-files/LICENSE'),join(web,'licenses/virtual-files-LICENSE'));
  const html=await readFile(join(web,app,'index.html'),'utf8');
  await writeFile(join(web,'index.html'),html.replace('<meta charset="utf-8">','<meta charset="utf-8"><base href="./synth-fm21290/">'));
  execFileSync('zip',['-q','-X','-r',join(tmp,'app.zip'),'.'],{cwd:web});
  execFileSync('unzip',['-tq',join(tmp,'app.zip')]);
  await link(join(tmp,'app.zip'),output);
  console.log(output);
}finally{await rm(tmp,{recursive:true,force:true});}
