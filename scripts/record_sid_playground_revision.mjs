/** Review-time generator only; calibration checks never depend on diff or git.
 * This writes evidence but never changes measurements, gains or the helper pin.
 */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {diffLines} from 'diff';
import {SID_PLAYGROUND_REVISION_BASE_COMMIT as baseCommit,SID_PLAYGROUND_REVISION_SOURCE_PATHS as allowed,SID_PLAYGROUND_REVISION_REPORT_PATHS as reports,SID_PLAYGROUND_REVISION_RECEIPT_PATH as destination} from './mixer_calibration_sid_revision.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const historical=path=>execFileSync('git',['show',`${baseCommit}:${path}`],{cwd:root,maxBuffer:64*1024*1024});
function reverseHunks(before,after){
  let offset=0,pending;const hunks=[];
  const flush=()=>{
    if(!pending)return;
    // Trim equal code points inside a changed line block. Generated example
    // lines and register dispatch lists can be long; keep only the changed
    // bytes, without splitting UTF-8 characters or duplicating full sources.
    const a=Array.from(pending.before),b=Array.from(pending.after);let prefix=0,suffix=0;
    while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
    while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
    const beforeText=a.slice(prefix,a.length-suffix).join(''),afterText=b.slice(prefix,b.length-suffix).join('');
    hunks.push({afterOffset:pending.offset+Buffer.byteLength(b.slice(0,prefix).join('')),afterBytes:Buffer.byteLength(afterText),beforeText});
    pending=undefined;
  };
  for(const chunk of diffLines(before.toString('utf8'),after.toString('utf8'))){
    if(!chunk.added&&!chunk.removed){flush();offset+=Buffer.byteLength(chunk.value);continue;}
    pending??={offset,before:'',after:''};
    if(chunk.removed)pending.before+=chunk.value;
    else{pending.after+=chunk.value;offset+=Buffer.byteLength(chunk.value);}
  }
  flush();const parts=[];let cursor=0;
  for(const hunk of hunks){parts.push(after.subarray(cursor,hunk.afterOffset),Buffer.from(hunk.beforeText));cursor=hunk.afterOffset+hunk.afterBytes;}
  parts.push(after.subarray(cursor));if(!Buffer.concat(parts).equals(before))throw new Error('Reverse hunk reconstruction failed');
  return hunks;
}

export async function createSidPlaygroundRevisionReceipt(){
  const inventory=new Set(),reportRecords={};
  for(const path of reports){
    const bytes=await readFile(resolve(root,path));
    if(!bytes.equals(historical(path)))throw new Error('Historical calibration report changed: '+path);
    reportRecords[path]=record(bytes);const report=JSON.parse(bytes);
    for(const name of Object.keys(report.sources))inventory.add(name);
  }
  const sources={};
  for(const name of [...inventory].sort()){
    const before=historical('docs/'+name),after=await readFile(resolve(root,'docs',name));
    if(before.equals(after))continue;
    if(!allowed.includes(name))throw new Error('SID revision cannot authorize this changed calibration source: '+name);
    if(!Buffer.from(before.toString('utf8')).equals(before)||!Buffer.from(after.toString('utf8')).equals(after))throw new Error('SID revision requires UTF-8 source: '+name);
    sources[name]={before:record(before),after:record(after),reverseHunks:reverseHunks(before,after)};
  }
  if(Object.keys(sources).length!==allowed.length||allowed.some(name=>!Object.hasOwn(sources,name)))throw new Error('SID revision must retain the exact reviewed source inventory');
  return {schemaVersion:1,scope:'sid-playground-routing-only',baseCommit,
    review:'SID-only register routing, explicit chip names, mode/tab/type/completion and self-authored examples. Existing chip DSP, measured PCM, target and source/listening gains are unchanged.',
    reports:reportRecords,sources};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2);if(args.length!==1||!['--write','--check'].includes(args[0]))throw new Error('Usage: node scripts/record_sid_playground_revision.mjs --write | --check');
  const receipt=await createSidPlaygroundRevisionReceipt(),output=JSON.stringify(receipt,null,2)+'\n';
  if(args[0]==='--write')await writeFile(resolve(root,destination),output);
  else if(await readFile(resolve(root,destination),'utf8')!==output)throw new Error('SID revision receipt differs; review the new exact before/after pair');
  console.log(`${args[0]}: ${Object.keys(receipt.sources).length} SID source pairs; object SHA256 ${sha(JSON.stringify(receipt))}`);
}
