/** Data-only proof generator. Never executes examples or remeasures audio. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {diffLines} from 'diff';
import {SCSP_CYCLE2_EXAMPLES_BASE as base,SCSP_CYCLE2_EXAMPLES_RECEIPT as destination,
 SCSP_CYCLE2_EXAMPLES_SOURCES as paths,SCSP_CYCLE2_EXAMPLES_RELATED as related,
 SCSP_CYCLE2_EXAMPLES_REPORTS as reports,verifyScspCycle2ExamplesDataOnly} from './mixer_calibration_playground_scsp_cycle2_examples_revision.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:bytes.length,sha256:sha(bytes)}),historical=name=>execFileSync('git',['show',base+':'+name],{cwd:root,maxBuffer:4*1024*1024});
function reverseHunks(before,after){
 const hunks=[];let offset=0,pending;
 const flush=()=>{if(pending){hunks.push({afterOffset:pending.offset,afterBytes:Buffer.byteLength(pending.after),beforeText:pending.before});pending=null;}};
 for(const part of diffLines(before.toString('utf8'),after.toString('utf8'))){if(!part.added&&!part.removed){flush();offset+=Buffer.byteLength(part.value);continue;}pending??={offset,before:'',after:''};if(part.removed)pending.before+=part.value;else{pending.after+=part.value;offset+=Buffer.byteLength(part.value);}}
 flush();return hunks;
}
export async function createPlaygroundScspCycle2ExamplesReceipt(){
 const before={},after={},sources={},relatedSources={},reportRecords={};
 for(const name of paths){before[name]=historical(name);after[name]=await readFile(resolve(root,name));assert(!before[name].equals(after[name]),'Expected reviewed Examples body change: '+name);sources[name]={before:record(before[name]),after:record(after[name]),reverseHunks:reverseHunks(before[name],after[name])};}
 const example=await readFile(resolve(root,related[0]));assert.deepEqual(example,historical('docs/playground/research/scsp-cycle2-prototype.js'),'Readable prototype source itself remains unchanged');
 const dataOnly=verifyScspCycle2ExamplesDataOnly(before,after,example);
 const changedRelated=new Set([related[0],related[1],related[2],'scripts/check_scsp_cycle2_prototype_browser.cjs','scripts/mixer_calibration_scsp_fm_multiple_self_revision.mjs']);
 for(const name of related){const bytes=await readFile(resolve(root,name));if(!changedRelated.has(name))assert.deepEqual(bytes,historical(name),'Unrelated runtime, gain or build bytes remain unchanged: '+name);relatedSources[name]=record(bytes);}
 for(const name of reports){const bytes=await readFile(resolve(root,name));assert.deepEqual(bytes,historical(name),'Historical evidence remains immutable: '+name);reportRecords[name]=record(bytes);}
 return {schemaVersion:1,scope:'playground-scsp-cycle2-data-only-examples-registration',baseCommit:base,
 review:'Only one existing research source is registered as SCSP example data. Every prior example path/name/data/order, default and history, all other mode catalogs, and executable generated scaffold are identical. The page has one catalog-cache query edit. No example is executed by catalog parsing and no audio/runtime/core/gain change is authorized.',dataOnly,sources,relatedSources,reports:reportRecords};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);assert(args.length===1&&['--write','--check'].includes(args[0]),'Usage: node scripts/record_playground_scsp_cycle2_examples_revision.mjs --write | --check');
 const receipt=await createPlaygroundScspCycle2ExamplesReceipt(),text=JSON.stringify(receipt,null,2)+'\n';
 if(args[0]==='--write')await writeFile(resolve(root,destination),text);else assert.equal(await readFile(resolve(root,destination),'utf8'),text,'SCSP Examples receipt changed');
 console.log('SCSP cycle2 Examples receipt object SHA256 '+sha(JSON.stringify(receipt)));
}
