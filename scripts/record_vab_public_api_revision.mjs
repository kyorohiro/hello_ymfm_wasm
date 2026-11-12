/** Review-time source evidence only. Never rewrites measurements or gains.
 * Runtime freshness validation does not invoke git, diff or this recorder.
 */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {diffLines} from 'diff';
import {
  VAB_API_REVISION_BASE_COMMIT as baseCommit,VAB_API_REVISION_RECEIPT_PATH as destination,
  VAB_API_REVISION_SOURCE_PATHS as allowed,VAB_API_REVISION_RELATED_PATHS as related,
  VAB_API_REVISION_REPORT_PATHS as reports,VAB_API_PRIOR_EXPORT_BEFORE_COMMIT as priorBefore,
  VAB_API_PRIOR_EXPORT_AFTER_COMMIT as priorAfter,VAB_API_PRIOR_EXPORT_PATHS as priorPaths,
} from './mixer_calibration_vab_api_revision.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const historical=(commit,path)=>execFileSync('git',['show',`${commit}:${path}`],{cwd:root,maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});
const optionalHistorical=path=>{try{return historical(baseCommit,path);}catch{return null;}};
function reverseHunks(before,after) {
  let offset=0,pending;const hunks=[];
  const flush=()=>{
    if(!pending)return;
    const a=Array.from(pending.before),b=Array.from(pending.after);let prefix=0,suffix=0;
    while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
    while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
    hunks.push({afterOffset:pending.offset+Buffer.byteLength(b.slice(0,prefix).join('')),afterBytes:Buffer.byteLength(b.slice(prefix,b.length-suffix).join('')),beforeText:a.slice(prefix,a.length-suffix).join('')});pending=undefined;
  };
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
function pair(before,after) {
  if(before.equals(after))throw Error('Expected an actual reviewed source revision');
  if(!Buffer.from(before.toString('utf8')).equals(before)||!Buffer.from(after.toString('utf8')).equals(after))throw Error('Only exact UTF-8 revisions are supported');
  return {before:record(before),after:record(after),reverseHunks:reverseHunks(before,after)};
}
function sourcePath(path) {
  if(path.startsWith('web/'))return 'tetorica_src/runtime/'+path.slice(4);
  return path.startsWith('docs/')||path.startsWith('scripts/')||path.startsWith('tetorica_src/')?path:'docs/'+path;
}

export async function createVabPublicApiRevisionReceipt() {
  const reportRecords={},inventory=new Set();
  for(const path of reports) {
    const bytes=await readFile(resolve(root,path));if(!bytes.equals(historical(baseCommit,path)))throw Error('Original measurement changed: '+path);
    reportRecords[path]=record(bytes);for(const name of Object.keys(JSON.parse(bytes).sources))inventory.add(sourcePath(name));
  }
  const sources={};
  for(const path of [...inventory].sort()) {
    const before=historical(baseCommit,path),after=await readFile(resolve(root,path));
    if(before.equals(after))continue;
    if(!allowed.includes(path))throw Error('VAB revision cannot authorize another changed measured source: '+path);
    sources[path]=pair(before,after);
  }
  if(Object.keys(sources).length!==allowed.length||allowed.some(path=>!Object.hasOwn(sources,path)))throw Error('VAB revision must match its exact changed source inventory');
  const relatedSources={};
  for(const path of related) {
    const before=optionalHistorical(path),after=await readFile(resolve(root,path));
    if((path.includes('/generated/')||path.endsWith('/soundchip_mixer_presets.js'))&&(!before||!before.equals(after)))throw Error('Measured audio asset/gain changed: '+path);
    relatedSources[path]={before:before?record(before):null,after:record(after)};
  }
  const priorSources={};
  for(const path of priorPaths) {
    priorSources[path]=pair(historical(priorBefore,path),historical(priorAfter,path));
    if(JSON.stringify(priorSources[path].after)!==JSON.stringify(sources[path].before))throw Error('Prior raw-export revision is detached from the current predecessor: '+path);
  }
  return {schemaVersion:1,scope:'ps1-vab-pure-api-and-passive-routing',baseCommit,
    review:'Pure VAB parse/prepare/source-preserving export extracted into one typed runtime module; additive Playground/Code helpers, definitions, self-authored example and exact cache import rollout. The prior raw-source VAB export revision is pinned separately. Original reports, audio renderers, reference programs, WASM and source/listening gains are unchanged. No audio device or browser is used by this evidence layer.',
    reports:reportRecords,sources,relatedSources,priorSourceExport:{beforeCommit:priorBefore,afterCommit:priorAfter,sources:priorSources}};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const args=process.argv.slice(2);if(args.length!==1||!['--write','--check'].includes(args[0]))throw Error('Usage: node scripts/record_vab_public_api_revision.mjs --write | --check');
  const receipt=await createVabPublicApiRevisionReceipt(),text=JSON.stringify(receipt,null,2)+'\n';
  if(args[0]==='--write')await writeFile(resolve(root,destination),text);
  else if(await readFile(resolve(root,destination),'utf8')!==text)throw Error('VAB source receipt differs; review exact source pairs');
  console.log(`${args[0]}: ${Object.keys(receipt.sources).length} source pairs, ${Object.keys(receipt.relatedSources).length} pinned dependencies; object SHA256 ${sha(JSON.stringify(receipt))}`);
}
