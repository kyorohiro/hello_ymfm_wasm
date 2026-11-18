/** Review-time evidence generator. Does not change audio or old measurements. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {diffLines} from 'diff';
import {measureScspSynthCycle2DefaultParity,SCSP_SYNTH_CYCLE2_PARITY_REPORT} from './record_scsp_synth_cycle2_default_parity.mjs';
import {SCSP_SYNTH_CYCLE2_BASE as baseCommit,
  SCSP_SYNTH_CYCLE2_RECEIPT as destination,
  SCSP_SYNTH_CYCLE2_SOURCES as paths,
  SCSP_SYNTH_CYCLE2_UNCHANGED as unchanged,
  SCSP_SYNTH_CYCLE2_RELATED as related,
  SCSP_SYNTH_CYCLE2_REPORTS as reports,
} from './mixer_calibration_scsp_synth_cycle2_revision.mjs';
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
export async function createScspSynthCycle2RevisionReceipt({readSource=name=>readFile(resolve(root,name))}={}){
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
    if(name!=='docs/issues/scsp_synth_cycle2_default_parity_01.json')assert.deepEqual(bytes,historical(name),'Historical evidence unchanged: '+name);
    reportRecords[name]=record(bytes);
  }
  return {schemaVersion:1,scope:'scsp-synth-cycle2-instrument-and-code',baseCommit,
    review:'Bounded FM2 Cycle instrument and Code support, with fixed A-before-B current-forward/history-average taps and four-cell initialization only for newly owned Auto/Code groups. UI connection selection and portable cycle v11 export remain unavailable. Complete predecessor bodies are reconstructed before prior calibration proofs. Existing default PCM, fixed FM, DAG, Self and multiple-Self PCM/registers/ring/writes/state/presets match the actual Git predecessor in 166 real-WASM cases at44.1/48kHz. Shared runtime/core/WASM/gains and historical evidence remain unchanged.',
    sources,relatedSources,reports:reportRecords};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);assert(args.length===1&&['--write','--check'].includes(args[0]),'Usage: node scripts/record_scsp_synth_cycle2_revision.mjs --write | --check');
  if(args[0]==='--write'){
    const names=['routing.js','patch.js','instrument.js'].map(name=>'docs/synth-scsp/'+name);
    const predecessorSources=Object.fromEntries(names.map(name=>[name,historical(name)]));
    const parity=await measureScspSynthCycle2DefaultParity({predecessorSources});
    await writeFile(resolve(root,SCSP_SYNTH_CYCLE2_PARITY_REPORT),JSON.stringify(parity,null,2)+'\n');
    console.log('Exact prior-default baseline parity: '+parity.cases.length+' cases PASS.');
  }
  const value=await createScspSynthCycle2RevisionReceipt(),text=JSON.stringify(value,null,2)+'\n';
  if(args[0]==='--write')await writeFile(resolve(root,destination),text);
  else assert.equal(await readFile(resolve(root,destination),'utf8'),text,'SCSP Cycle2 receipt changed');
  console.log('SCSP Synth Cycle2 receipt object SHA256 '+sha(JSON.stringify(value)));
}
