// Keep the standalone Tauri application's application-owned CD-DA core an
// explicit byte-for-byte snapshot. Sound-chip SDK pins are not changed here.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);
if(args.some(arg=>!['--check','--write'].includes(arg))||args.length!==1)throw new Error('Usage: node scripts/sync_cdda_native.mjs --check|--write');
const destination=resolve(root,'w/tetorica-fm2612-playground-tauri/src-tauri/native-cdda');
const files=['cdda_pcm.c','cdda_pcm.h','LICENSE'];
const result=[];
if(args[0]==='--write')await mkdir(destination,{recursive:true});
for(const file of files){
  const source=await readFile(join(root,'native/cdda',file));
  if(args[0]==='--write')await writeFile(join(destination,file),source);
  const snapshot=await readFile(join(destination,file));
  if(!source.equals(snapshot))throw new Error(`Tauri CD-DA snapshot differs: ${file}; run --write before building`);
  result.push({file,bytes:source.length,sha256:createHash('sha256').update(source).digest('hex')});
}
console.log(JSON.stringify({passed:true,files:result},null,2));
