import {cp,mkdir,writeFile,rm,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const stage=join(root,'dist/virtual-files');
await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
for(const file of ['package.json','README.md','src'])await cp(join(root,'packages/virtual-files',file),join(stage,file),{recursive:true});
await cp(join(root,'LICENSE'),join(stage,'LICENSE'));
for(const file of await readdir(join(stage,'src')))if(file.endsWith('.d.ts'))await rm(join(stage,'src',file));
const config=join(stage,'tsconfig.json');
await writeFile(config,JSON.stringify({compilerOptions:{allowJs:true,declaration:true,emitDeclarationOnly:true,noEmitOnError:true,strictNullChecks:true,target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',types:[]},include:['src/*.js']}));
execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'-p',config],{stdio:'inherit'});
await rm(config);
for(const file of await readdir(join(stage,'src')))if(file.endsWith('.d.ts'))await cp(join(stage,'src',file),join(root,'packages/virtual-files/src',file));
await cp(join(root,'LICENSE'),join(root,'packages/virtual-files/LICENSE'));
// Browser releases use a local copy of the same canonical source modules.
await cp(join(root,'packages/virtual-files/src'),join(root,'docs/js/tetorica_virtual_files'),{recursive:true});
console.log(`Built ${stage} and browser modules`);
