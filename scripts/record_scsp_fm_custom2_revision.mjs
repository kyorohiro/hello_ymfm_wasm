/** Review-time evidence generator. Does not change audio or old measurements. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {diffLines} from 'diff';
import {SCSP_FM_CUSTOM2_REVISION_BASE_COMMIT as baseCommit,
  SCSP_FM_CUSTOM2_REVISION_RECEIPT_PATH as destination,
  SCSP_FM_CUSTOM2_REVISION_SOURCE_PATHS as paths,
  SCSP_FM_CUSTOM2_REVISION_UNCHANGED_PATHS as unchanged,
  SCSP_FM_CUSTOM2_REVISION_RELATED_PATHS as related,
  SCSP_FM_CUSTOM2_REVISION_REPORT_PATHS as reports,
} from './mixer_calibration_scsp_fm_custom_revision.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const historical=path=>execFileSync('git',['show',baseCommit+':'+path],{cwd:root,maxBuffer:4*1024*1024});
function reverseHunks(before,after){
  const hunks=[];let offset=0,pending;
  const flush=()=>{if(pending){hunks.push({afterOffset:pending.offset,afterBytes:Buffer.byteLength(pending.after),beforeText:pending.before});pending=null;}};
  for(const part of diffLines(before.toString('utf8'),after.toString('utf8'))){
    if(!part.added&&!part.removed){flush();offset+=Buffer.byteLength(part.value);continue;}
    pending??={offset,before:'',after:''};
    if(part.removed)pending.before+=part.value;else {pending.after+=part.value;offset+=Buffer.byteLength(part.value);}
  }
  flush();const parts=[];let cursor=0;
  for(const h of hunks){parts.push(after.subarray(cursor,h.afterOffset),Buffer.from(h.beforeText));cursor=h.afterOffset+h.afterBytes;}
  parts.push(after.subarray(cursor));assert.deepEqual(Buffer.concat(parts),before);return hunks;
}
export async function createScspFmCustom2RevisionReceipt(){
  const sources={},relatedSources={},reportRecords={};
  for(const name of paths){
    const before=historical(name),after=await readFile(resolve(root,name));
    assert(!before.equals(after),'Expected a reviewed Synth source change: '+name);
    assert(Buffer.from(after.toString('utf8')).equals(after));
    sources[name]={before:record(before),after:record(after),reverseHunks:reverseHunks(before,after)};
  }
  for(const name of related){
    const bytes=await readFile(resolve(root,name));
    if(unchanged.includes(name))
      assert.deepEqual(bytes,historical(name),'Measured audio/gain bytes unchanged: '+name);
    relatedSources[name]=record(bytes);
  }
  for(const name of reports){
    const bytes=await readFile(resolve(root,name));
    if(name!=='docs/issues/scsp_fm_custom2_default_parity_01.json')assert.deepEqual(bytes,historical(name),'Historical evidence unchanged: '+name);
    reportRecords[name]=record(bytes);
  }
  return {schemaVersion:1,scope:'scsp-synth-acyclic-custom-two-operator-fm',baseCommit,
    review:'Acyclic custom two-operator routing with dependency-ordered slot allocation. Complete reviewed source bodies and dependencies are pinned; legacy PCM and 2/4/6-op fixed graphs retain exact native output, state, RAM, registers, writes and v4 presets, while common runtime, WASM, gains and historical reports are unchanged.',
    sources,relatedSources,reports:reportRecords};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);assert(args.length===1&&['--write','--check'].includes(args[0]),'Usage: node scripts/record_scsp_fm_custom2_revision.mjs --write | --check');
  const value=await createScspFmCustom2RevisionReceipt(),text=JSON.stringify(value,null,2)+'\n';
  if(args[0]==='--write')await writeFile(resolve(root,destination),text);
  else assert.equal(await readFile(resolve(root,destination),'utf8'),text,'Synth DSP UI receipt changed');
  console.log('SCSP FM custom2 receipt object SHA256 '+sha(JSON.stringify(value)));
}
