// Compatibility command: verify that main and Tauri consume the same fixed SDK.
// Import complete SDK source releases with their importers; never rewrite pins.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);
if(args.length!==1||args[0]!=='--check')throw new Error('Usage: node scripts/sync_msm5205_native.mjs --check. Import fixed SDK releases; this command never writes sources or pins.');
const app=resolve(root,'w/tetorica-fm2612-playground-tauri');
const python=process.platform==='win32'?'python':'python3';
for(const repository of [root,app]){
  const checked=spawnSync(python,[join(repository,'scripts/import_soundchip_sdk.py'),'--check'],{cwd:repository,encoding:'utf8'});
  if(checked.status!==0)throw new Error(`Fixed SDK verification failed: ${checked.stderr||checked.stdout||checked.error}`);
}
const mainPin=JSON.parse(await readFile(join(root,'third_party/soundchip-sdk.json'),'utf8'));
const appPin=JSON.parse(await readFile(join(app,'src-tauri/soundchip-sdk.json'),'utf8'));
for(const field of ['version','archiveSha256','manifestSha256','sourceCommit'])if(mainPin[field]!==appPin[field])throw new Error(`Main/Tauri fixed SDK ${field} differs; import the same published release first`);
const component='msm5205';
const files=[`${component}_pcm.c`,`${component}_pcm.h`,'LICENSE','NOTICE.md'];
const result=[];
for(const file of files){
  const source=await readFile(join(root,'third_party/tetorica-soundchip-native/vendor',`tetorica-${component}`,file));
  const snapshot=await readFile(join(app,'src-tauri/vendor/tetorica-soundchip-native/vendor',`tetorica-${component}`,file));
  if(!source.equals(snapshot))throw new Error(`Main/Tauri fixed SDK application audio differs: ${component}/${file}`);
  result.push({file,bytes:source.length,sha256:createHash('sha256').update(source).digest('hex')});
}
console.log(JSON.stringify({passed:true,component,version:mainPin.version,archiveSha256:mainPin.archiveSha256,sourceCommit:mainPin.sourceCommit,readOnly:true,files:result},null,2));
