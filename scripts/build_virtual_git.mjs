import {build} from 'esbuild';
import {mkdir,copyFile,writeFile,readFile,readdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
const root=new URL('../',import.meta.url);
await mkdir(new URL('docs/js/tetorica_virtual_files/',root),{recursive:true});
const result=await build({entryPoints:[new URL('packages/virtual-files/src/git.js',root).pathname],outfile:new URL('docs/js/tetorica_virtual_files/git.bundle.js',root).pathname,bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof',metafile:true});
// The desktop wrapper serves this shared UI without modifying its pinned release.
await build({entryPoints:[new URL('docs/playground/playground_git.js',root).pathname],outfile:new URL('w/tetorica-fm2612-playground-tauri/desktop/git-runtime.bundle.js',root).pathname,bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
let notices='Dependencies included in the browser Git bundle\n';const packages=new Set();
for(const input of Object.keys(result.metafile.inputs)){
  if(!input.includes('node_modules/'))continue;
  let directory=dirname(new URL(input,root).pathname);
  while(directory.includes('node_modules')){
    try{const metadata=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));if(!packages.has(directory)){
      packages.add(directory);notices+='\n\n'+metadata.name+' '+metadata.version+'\n';
      const files=(await readdir(directory)).filter(name=>/^(license|copying)/i.test(name));
      if(!files.length)notices+='License: '+metadata.license+'\n';
      for(const name of files)notices+='\n'+await readFile(join(directory,name),'utf8');
    }break;}catch{directory=dirname(directory);}
  }
}
await writeFile(new URL('docs/js/tetorica_virtual_files/GIT_LICENSES.txt',root),notices);
await copyFile(new URL('docs/js/tetorica_virtual_files/GIT_LICENSES.txt',root),new URL('w/tetorica-fm2612-playground-tauri/desktop/git-js-licenses.txt',root));
