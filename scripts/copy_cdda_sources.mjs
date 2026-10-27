import {cp,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function copyCddaSources(stage){
  await mkdir(join(stage,'generated'),{recursive:true});
  for(const ext of ['js','wasm'])await cp(join(root,'web/generated',`cdda_wasm.${ext}`),join(stage,'generated',`cdda_wasm.${ext}`));
  await mkdir(join(stage,'sources/native/cdda'),{recursive:true});
  await cp(join(root,'native/cdda'),join(stage,'sources/native/cdda'),{recursive:true});
  await mkdir(join(stage,'sources/scripts'),{recursive:true});
  await cp(join(root,'scripts/build_cdda_wasm.sh'),join(stage,'sources/scripts/build_cdda_wasm.sh'));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await copyCddaSources(resolve(process.argv[2]));
