/** Review-time source evidence only. Never measures audio or rewrites reports. */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {diffLines} from 'diff';
import {
  HUC6280_UI_REVISION_BASE_COMMIT as baseCommit,HUC6280_UI_REVISION_RECEIPT_PATH as destination,
  HUC6280_UI_REVISION_SOURCE_PATHS as paths,HUC6280_UI_REVISION_REPORT_PATHS as reports,
} from './mixer_calibration_huc6280_ui_revision.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const historical=path=>execFileSync('git',['show',`${baseCommit}:${path}`],{cwd:root,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
function reverseHunks(before,after) {
  const hunks=[];let offset=0,pending;
  const flush=()=>{if(!pending)return;hunks.push({afterOffset:pending.offset,afterBytes:Buffer.byteLength(pending.after),beforeText:pending.before});pending=undefined;};
  for(const part of diffLines(before.toString('utf8'),after.toString('utf8'))) {
    if(!part.added&&!part.removed){flush();offset+=Buffer.byteLength(part.value);continue;}
    pending??={offset,before:'',after:''};
    if(part.removed)pending.before+=part.value;else{pending.after+=part.value;offset+=Buffer.byteLength(part.value);}
  }
  flush();const parts=[];let cursor=0;
  for(const hunk of hunks){parts.push(after.subarray(cursor,hunk.afterOffset),Buffer.from(hunk.beforeText));cursor=hunk.afterOffset+hunk.afterBytes;}
  parts.push(after.subarray(cursor));if(!Buffer.concat(parts).equals(before))throw Error('Source reconstruction failed');
  return hunks;
}
export async function createHuc6280UiRevisionReceipt() {
  const sources={},reportRecords={};
  const prior=JSON.parse(await readFile(resolve(root,'docs/issues/ps1_vab_public_api_source_revision_01.json'),'utf8'));
  for(const path of reports) {
    const bytes=await readFile(resolve(root,path));
    if(!bytes.equals(historical(path)))throw Error('Original measurement changed: '+path);
    reportRecords[path]=record(bytes);
  }
  for(const path of paths) {
    const before=historical('docs/'+path),after=await readFile(resolve(root,'docs/'+path));
    if(JSON.stringify(record(before))!==JSON.stringify(prior.sources['docs/'+path].after))throw Error('Predecessor is detached from the existing VAB receipt: '+path);
    if(before.equals(after)||!Buffer.from(after.toString('utf8')).equals(after))throw Error('Expected one exact UTF-8 UI revision: '+path);
    sources[path]={before:record(before),after:record(after),reverseHunks:reverseHunks(before,after)};
  }
  return {schemaVersion:1,scope:'huc6280-and-cdrom2-passive-source-viewer',baseCommit,
    review:'Exact read-only HuC6280 and media API definition targets, safe namespaced implementation source URL resolution and one cache-query rollout. Includes the prior HuC6280 Code viewer additions. No audio execution, synth parameter defaults, DSP, WASM, measured gains or historical reports change. Dedicated MSM5205/CD-DA editors remain under construction.',
    reports:reportRecords,sources};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const args=process.argv.slice(2);if(args.length!==1||!['--write','--check'].includes(args[0]))throw Error('Usage: node scripts/record_huc6280_cdrom2_ui_revision.mjs --write | --check');
  const receipt=await createHuc6280UiRevisionReceipt(),text=JSON.stringify(receipt,null,2)+'\n';
  if(args[0]==='--write')await writeFile(resolve(root,destination),text);
  else if(await readFile(resolve(root,destination),'utf8')!==text)throw Error('HuC6280 passive UI receipt differs; review complete source pairs');
  console.log(`${args[0]}: ${Object.keys(receipt.sources).length} passive source pairs; object SHA256 ${sha(JSON.stringify(receipt))}`);
}
