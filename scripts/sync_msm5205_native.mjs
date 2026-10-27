// Keep the standalone Tauri application's application-owned MSM5205 core an
// explicit byte-for-byte snapshot. Sound-chip SDK pins are not changed here.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);
if(args.some(arg=>!['--check','--write'].includes(arg))||args.length!==1)throw new Error('Usage: node scripts/sync_msm5205_native.mjs --check|--write');
const destination=resolve(root,'w/tetorica-fm2612-playground-tauri/src-tauri/native-msm5205');
const files=['msm5205_pcm.c','msm5205_pcm.h','LICENSE','NOTICE.md'];
const result=[];
if(args[0]==='--write')await mkdir(destination,{recursive:true});
for(const file of files){
  const source=await readFile(join(root,'native/msm5205',file));
  if(args[0]==='--write')await writeFile(join(destination,file),source);
  const snapshot=await readFile(join(destination,file));
  if(!source.equals(snapshot))throw new Error(`Tauri MSM5205 snapshot differs: ${file}; run --write before building`);
  result.push({file,bytes:source.length,sha256:createHash('sha256').update(source).digest('hex')});
}
if(args[0]==='--write')await writeFile(join(destination,'sources.json'),JSON.stringify({
  schemaVersion:1,source:'hello_ymfm/native/msm5205',
  sha256:Object.fromEntries(result.map(({file,sha256})=>[file,sha256])),
},null,2)+'\n');
console.log(JSON.stringify({passed:true,files:result},null,2));
