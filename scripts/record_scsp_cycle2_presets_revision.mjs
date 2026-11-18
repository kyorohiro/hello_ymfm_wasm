/** Review-time evidence generator. Does not change audio or old measurements. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {diffLines} from 'diff';
import {measureScspCycle2PresetsParity,SCSP_CYCLE2_PRESETS_PARITY_REPORT} from './record_scsp_cycle2_presets_parity.mjs';
import {SCSP_CYCLE2_PRESETS_BASE as baseCommit,
  SCSP_CYCLE2_PRESETS_RECEIPT as destination,
  SCSP_CYCLE2_PRESETS_SOURCES as paths,
  SCSP_CYCLE2_PRESETS_UNCHANGED as unchanged,
  SCSP_CYCLE2_PRESETS_RELATED as related,
  SCSP_CYCLE2_PRESETS_REPORTS as reports,
} from './mixer_calibration_scsp_cycle2_presets_revision.mjs';
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
export async function createScspCycle2PresetsRevisionReceipt({readSource=name=>readFile(resolve(root,name))}={}){
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
    if(name!=='docs/issues/scsp_cycle2_presets_parity_01.json')assert.deepEqual(bytes,historical(name),'Historical evidence unchanged: '+name);
    reportRecords[name]=record(bytes);
  }
  return {schemaVersion:1,scope:'scsp-cycle2-v11-portable-presets',baseCommit,
    review:'Portable version 11 explicitly serializes the bounded FM2 Cycle connection and six PCM/voice/effect sources; old formats retain their meaning and reject Cycle aliases. Saved authoring, Files/JSON/Cassette/draft/recovery paths retain edits. Fixed physical mapping, attack/history behavior, shared runtime/core/WASM/gains and prior evidence remain unchanged. Whole reviewed source predecessors are reconstructed before older calibration proof layers. Exact pre-v11/current sound parity covers 166 legacy cases plus 40 already-supported Cycle cases at 44.1/48 kHz; Cycle portable export is deliberately new rather than falsely compared to the old export rejection.',
    sources,relatedSources,reports:reportRecords};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);assert(args.length===1&&['--write','--check'].includes(args[0]),'Usage: node scripts/record_scsp_cycle2_presets_revision.mjs --write | --check');
  if(args[0]==='--write'){
    const names=['routing.js','patch.js','instrument.js'].map(name=>'docs/synth-scsp/'+name);
    const predecessorSources=Object.fromEntries(names.map(name=>[name,historical(name)]));
    const parity=await measureScspCycle2PresetsParity({predecessorSources});
    await writeFile(resolve(root,SCSP_CYCLE2_PRESETS_PARITY_REPORT),JSON.stringify(parity,null,2)+'\n');
    console.log('Exact prior-default baseline parity: '+parity.cases.length+' cases PASS.');
  }
  const value=await createScspCycle2PresetsRevisionReceipt(),text=JSON.stringify(value,null,2)+'\n';
  if(args[0]==='--write')await writeFile(resolve(root,destination),text);
  else assert.equal(await readFile(resolve(root,destination),'utf8'),text,'SCSP Cycle2 receipt changed');
  console.log('SCSP Cycle2 v11 preset receipt object SHA256 '+sha(JSON.stringify(value)));
}
