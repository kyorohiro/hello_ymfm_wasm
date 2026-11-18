/** UI-only exact source receipt. No audio, core build or old report rewrite. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {diffLines} from 'diff';
import {createScspSynthSlotAllocationRevisionReadContext} from './mixer_calibration_scsp_synth_slot_allocation_revision.mjs';
import {SCSP_SSF_SLOT_MAP_BASE as base,SCSP_SSF_SLOT_MAP_RECEIPT as destination,
 SCSP_SSF_SLOT_MAP_SOURCES as paths,SCSP_SSF_SLOT_MAP_UNCHANGED as unchanged,
 SCSP_SSF_SLOT_MAP_RELATED as related,SCSP_SSF_SLOT_MAP_REPORTS as reports,
} from './mixer_calibration_scsp_ssf_slot_map_revision.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const historical=name=>execFileSync('git',['show',base+':'+name],{cwd:root,maxBuffer:4*1024*1024});
function reverseHunks(before,after){
 const hunks=[];let offset=0,pending;
 const flush=()=>{if(pending){hunks.push({afterOffset:pending.offset,afterBytes:Buffer.byteLength(pending.after),beforeText:pending.before});pending=null;}};
 for(const part of diffLines(before.toString('utf8'),after.toString('utf8'))){if(!part.added&&!part.removed){flush();offset+=Buffer.byteLength(part.value);continue;}pending??={offset,before:'',after:''};if(part.removed)pending.before+=part.value;else{pending.after+=part.value;offset+=Buffer.byteLength(part.value);}}
 flush();const parts=[];let cursor=0;
 for(const h of hunks){parts.push(after.subarray(cursor,h.afterOffset),Buffer.from(h.beforeText));cursor=h.afterOffset+h.afterBytes;}
 parts.push(after.subarray(cursor));assert.deepEqual(Buffer.concat(parts),before);return hunks;
}
export async function createScspSsfSlotMapRevisionReceipt({readSource=name=>readFile(resolve(root,name))}={}){
 const sources={},relatedSources={},reportRecords={};
 for(const name of paths){
  const before=historical(name),after=await readSource(name);
  assert(!before.equals(after),'Expected reviewed UI source change: '+name);
  assert(Buffer.from(after.toString('utf8')).equals(after),'Reviewed sources are exact UTF-8: '+name);
  sources[name]={beforeCommit:base,before:record(before),after:record(after),reverseHunks:reverseHunks(before,after)};
 }
 for(const name of related){const bytes=await readSource(name);if(unchanged.includes(name))assert.deepEqual(bytes,historical(name),'Audio/observer/runtime/package inputs stay byte-identical: '+name);relatedSources[name]=record(bytes);}
 for(const name of reports){const bytes=await readSource(name);assert.deepEqual(bytes,historical(name),'Historical native/source/SSF evidence remains immutable: '+name);reportRecords[name]=record(bytes);}
 return {schemaVersion:1,scope:'scsp-ssf-slot-activity-and-selected-configured-routes',baseCommit:base,
  review:'Read-only SSF slot activity, Gate/Release/ENV and selected configured Sound Stack, Direct and MIXS references from existing audible-position snapshots. No immediate slot-producer topology, measured audio activity or selected-slot DSP-return claim. Complete reviewed UI and proof-hook predecessors restore exactly to the base commit before the existing calibration chain. Native owner/routing, audio/core/WASM/gains/defaults, SSF observer/ABI/renderer and package implementation remain byte-identical. Existing 206-case MAME native parity and eight-case SSF passive parity receipts are pinned unchanged; this source receipt does not claim a new native or listening measurement.',
  sources,relatedSources,reports:reportRecords};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);assert(args.length===1&&['--write','--check'].includes(args[0]),'Usage: node scripts/record_scsp_ssf_slot_map_revision.mjs --write | --check');
 const reviewed=createScspSynthSlotAllocationRevisionReadContext();
 const value=await createScspSsfSlotMapRevisionReceipt({readSource:name=>reviewed.readSource(new URL('../'+name,import.meta.url))}),text=JSON.stringify(value,null,2)+'\n';
 if(args[0]==='--write')await writeFile(resolve(root,destination),text);else assert.equal(await readFile(resolve(root,destination),'utf8'),text,'SSF slot map receipt changed');
 console.log('SCSP SSF slot map receipt object SHA256 '+sha(JSON.stringify(value)));
}
