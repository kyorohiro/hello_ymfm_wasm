/** Review-time evidence generator. Does not change audio or old measurements. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {diffLines} from 'diff';
import {measureScspFmMultipleSelfDefaultParity,SCSP_FM_MULTIPLE_SELF_PARITY_REPORT} from './record_scsp_fm_multiple_self_default_parity.mjs';
import {createScspSynthCycle2RevisionReadContext} from './mixer_calibration_scsp_synth_cycle2_revision.mjs';
import {SCSP_FM_MULTIPLE_SELF_REVISION_BASE_COMMIT as baseCommit,
  SCSP_FM_MULTIPLE_SELF_REVISION_RECEIPT_PATH as destination,
  SCSP_FM_MULTIPLE_SELF_REVISION_SOURCE_PATHS as paths,
  SCSP_FM_MULTIPLE_SELF_REVISION_UNCHANGED_PATHS as unchanged,
  SCSP_FM_MULTIPLE_SELF_REVISION_RELATED_PATHS as related,
  SCSP_FM_MULTIPLE_SELF_REVISION_REPORT_PATHS as reports,
} from './mixer_calibration_scsp_fm_multiple_self_revision.mjs';
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
export async function createScspFmMultipleSelfRevisionReceipt({readSource=name=>readFile(resolve(root,name))}={}){
  const sources={},relatedSources={},reportRecords={};
  for(const name of paths){
    const before=historical(name),after=await readSource(name);
    assert(!before.equals(after),'Expected a reviewed Synth source change: '+name);
    assert(Buffer.from(after.toString('utf8')).equals(after));
    sources[name]={before:record(before),after:record(after),reverseHunks:reverseHunks(before,after)};
  }
  for(const name of related){
    const bytes=await readSource(name);
    if(unchanged.includes(name))
      assert.deepEqual(bytes,historical(name),'Measured audio/gain bytes unchanged: '+name);
    relatedSources[name]=record(bytes);
  }
  for(const name of reports){
    const bytes=await readSource(name);
    if(name!=='docs/issues/scsp_fm_multiple_self_default_parity_01.json')assert.deepEqual(bytes,historical(name),'Historical evidence unchanged: '+name);
    reportRecords[name]=record(bytes);
  }
  return {schemaVersion:1,scope:'scsp-synth-multiple-self-custom-four-six-operator-feedback',baseCommit,
    review:'Multiple exclusive Self targets in Custom4/6 extend the existing per-owned-OP X32/Y0 history policy. Complete reviewed source bodies and dependencies are pinned; 150 actual Git-predecessor/current cases retain every prior110 case plus all ten former single-Self targets in isolated and merge/fanout layouts at both output rates. Native PCM, RAM, raw64 stack checkpoints, full registers, write order, active/released/stopped state and v4-v9 serialized exports remain exact. Common runtime/core/SSF WASM, native/vendor files, gains, package versions and historical JSON remain unchanged.',
    sources,relatedSources,reports:reportRecords};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);assert(args.length===1&&['--write','--check'].includes(args[0]),'Usage: node scripts/record_scsp_fm_multiple_self_revision.mjs --write | --check');
  if(args[0]==='--write'){
    const names=['routing.js','patch.js','instrument.js'].map(name=>'docs/synth-scsp/'+name);
    const predecessorSources=Object.fromEntries(names.map(name=>[name,historical(name)]));
    const parity=await measureScspFmMultipleSelfDefaultParity({predecessorSources});
    await writeFile(resolve(root,SCSP_FM_MULTIPLE_SELF_PARITY_REPORT),JSON.stringify(parity,null,2)+'\n');
    console.log('Exact legacy baseline parity: '+parity.cases.length+' cases PASS.');
  }
  const reviewed=args[0]==='--check'?createScspSynthCycle2RevisionReadContext():null;
  const value=await createScspFmMultipleSelfRevisionReceipt(reviewed?{readSource:name=>reviewed.readSource(new URL('../'+name,import.meta.url))}:{}),text=JSON.stringify(value,null,2)+'\n';
  if(args[0]==='--write')await writeFile(resolve(root,destination),text);
  else assert.equal(await readFile(resolve(root,destination),'utf8'),text,'Multiple-Self receipt changed');
  console.log('SCSP FM multiple-Self receipt object SHA256 '+sha(JSON.stringify(value)));
}
