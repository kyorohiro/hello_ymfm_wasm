/** UI/data-only evidence generator. No audio, old report rewrite or example execution. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {diffLines} from 'diff';
import {createScspSsfSlotMapRevisionReadContext} from './mixer_calibration_scsp_ssf_slot_map_revision.mjs';
import {SCSP_CYCLE2_UI_BASE as base,SCSP_CYCLE2_UI_RECEIPT as destination,
 SCSP_CYCLE2_UI_PREDECESSORS as predecessors,
 SCSP_CYCLE2_UI_SOURCES as paths,SCSP_CYCLE2_UI_UNCHANGED as unchanged,
 SCSP_CYCLE2_UI_RELATED as related,SCSP_CYCLE2_UI_REPORTS as reports,
 verifyScspCycle2UiExampleData} from './mixer_calibration_scsp_cycle2_ui_revision.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const historical=name=>execFileSync('git',['show',(predecessors[name]??base)+':'+name],{cwd:root,maxBuffer:4*1024*1024});
function reverseHunks(before,after){
 const hunks=[];let offset=0,pending;
 const flush=()=>{if(pending){hunks.push({afterOffset:pending.offset,afterBytes:Buffer.byteLength(pending.after),beforeText:pending.before});pending=null;}};
 for(const part of diffLines(before.toString('utf8'),after.toString('utf8'))){if(!part.added&&!part.removed){flush();offset+=Buffer.byteLength(part.value);continue;}pending??={offset,before:'',after:''};if(part.removed)pending.before+=part.value;else{pending.after+=part.value;offset+=Buffer.byteLength(part.value);}}
 flush();return hunks;
}
export async function createScspCycle2UiRevisionReceipt({readSource=name=>readFile(resolve(root,name))}={}){
 const before={},after={},sources={},relatedSources={},reportRecords={};
 for(const name of paths){before[name]=historical(name);after[name]=await readSource(name);assert(!before[name].equals(after[name]),'Expected reviewed UI source change: '+name);sources[name]={beforeCommit:predecessors[name]??base,before:record(before[name]),after:record(after[name]),reverseHunks:reverseHunks(before[name],after[name])};}
 const example=await readSource('docs/synth-scsp/examples/cycle2.js');
 const exampleData=verifyScspCycle2UiExampleData(before,after,example);
 for(const name of related){const bytes=await readSource(name);if(unchanged.includes(name))assert.deepEqual(bytes,historical(name),'Audio/default/runtime inputs stay byte-identical: '+name);relatedSources[name]=record(bytes);}
 for(const name of reports){const bytes=await readSource(name);assert.deepEqual(bytes,historical(name),'Existing native/source evidence remains immutable: '+name);reportRecords[name]=record(bytes);}
 const original=JSON.parse(await readSource('docs/issues/scsp_fm_multiple_self_source_revision_01.json'));
 assert.deepEqual(sources['docs/synth-scsp/README.md'].before,original.sources['docs/synth-scsp/README.md'].after,'The inherited README fix restores exactly the originally pinned document');
 return {schemaVersion:1,scope:'scsp-cycle2-selectable-ui-and-example',baseCommit:base,
 review:'Selectable Cycle2 authoring UI, fixed current/history-return visualization, existing destination-depth/output controls and explicit mode transitions. The Synth example is inert source data, exact against its canonical file; old examples, starter and project restoration stay unchanged. Native-critical owner/codec/routing/processor, raw runtime/core/WASM/gains/defaults and existing 206-case real-WASM parity report are byte-identical. Whole reviewed predecessors are restored before existing calibration proof layers; no new native measurement is implied. The README alone restores its exact 6ca predecessor because v11 documentation landed after that source receipt was frozen; this closes the inherited documentation-only calibration gap without changing historical receipts.',
 exampleData,sources,relatedSources,reports:reportRecords};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);assert(args.length===1&&['--write','--check'].includes(args[0]),'Usage: node scripts/record_scsp_cycle2_ui_revision.mjs --write | --check');
 const reviewed=createScspSsfSlotMapRevisionReadContext();
 const value=await createScspCycle2UiRevisionReceipt({readSource:name=>reviewed.readSource(new URL('../'+name,import.meta.url))}),text=JSON.stringify(value,null,2)+'\n';
 if(args[0]==='--write')await writeFile(resolve(root,destination),text);else assert.equal(await readFile(resolve(root,destination),'utf8'),text,'SCSP Cycle UI receipt changed');
 console.log('SCSP Cycle2 UI receipt object SHA256 '+sha(JSON.stringify(value)));
}
