/** Application-only output gain / New Cassette receipt. No core, common policy or old report rewrite. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {diffLines} from 'diff';
import {SCSP_OUTPUT_LEVEL_NEW_CASSETTE_BASE as base,SCSP_OUTPUT_LEVEL_NEW_CASSETTE_RECEIPT as destination,
 SCSP_OUTPUT_LEVEL_NEW_CASSETTE_SOURCES as paths,SCSP_OUTPUT_LEVEL_NEW_CASSETTE_UNCHANGED as unchanged,
 SCSP_OUTPUT_LEVEL_NEW_CASSETTE_RELATED as related,SCSP_OUTPUT_LEVEL_NEW_CASSETTE_REPORTS as reports,
 SCSP_OUTPUT_LEVEL_NEW_CASSETTE_APPLICATION_GAIN as applicationOutputGain,
} from './mixer_calibration_scsp_output_level_new_cassette_revision.mjs';
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
export async function createScspOutputLevelNewCassetteRevisionReceipt({readSource=name=>readFile(resolve(root,name))}={}){
 const sources={},relatedSources={},reportRecords={};
 for(const name of paths){
  const before=historical(name),after=await readSource(name);
  assert(!before.equals(after),'Expected reviewed application source change: '+name);
  assert(Buffer.from(after.toString('utf8')).equals(after),'Reviewed sources are exact UTF-8: '+name);
  sources[name]={beforeCommit:base,before:record(before),after:record(after),reverseHunks:reverseHunks(before,after)};
 }
 for(const name of related){const bytes=await readSource(name);if(unchanged.includes(name))assert.deepEqual(bytes,historical(name),'Core/common Mixer/observer/runtime/package inputs stay byte-identical: '+name);relatedSources[name]=record(bytes);}
 for(const name of reports){const bytes=await readSource(name);assert.deepEqual(bytes,historical(name),'Historical native/source/SSF evidence remains immutable: '+name);reportRecords[name]=record(bytes);}
 return {schemaVersion:1,scope:'scsp-synth-application-output-level-and-new-cassette',baseCommit:base,applicationOutputGain,
  review:'SCSP Synth intentionally raises application output by a shared factor of eight (+18.06179973983887 dB) after optional Code FX and its Stop fade, before the existing final Master. Existing source and song-input balance stay 0.125, preserving Code FX input drive; keyboard, Code, audition and song routes receive compensation once. Master remains 0..3.8 and outputNode remains the final Master. This changes application listening/output gain and does not guarantee unclipped arbitrary patches, full-scale PCM, SSF or polyphony. The common calibrated Mixer target, derived gains, source units, raw SCSP core/WASM PCM, owner/allocator and SSF observer/ABI/renderer remain byte-identical. New / Cassette creates a validated fresh project through explicit confirmation without automatically running Code; cancellation and failed preparation retain the previous project. Complete application and proof-hook predecessors restore exactly to the base commit before the existing calibration chain. Existing native/passive parity and every historical JSON receipt remain immutable; no new core calibration or human listening measurement is claimed',
  sources,relatedSources,reports:reportRecords};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);assert(args.length===1&&['--write','--check'].includes(args[0]),'Usage: node scripts/record_scsp_output_level_new_cassette_revision.mjs --write | --check');
 const value=await createScspOutputLevelNewCassetteRevisionReceipt(),text=JSON.stringify(value,null,2)+'\n';
 if(args[0]==='--write')await writeFile(resolve(root,destination),text);else assert.equal(await readFile(resolve(root,destination),'utf8'),text,'Output-level / New Cassette receipt changed');
 console.log('SCSP output-level / New Cassette receipt object SHA256 '+sha(JSON.stringify(value)));
}
