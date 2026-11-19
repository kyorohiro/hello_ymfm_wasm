import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from '../test/helpers/historical_huc_timed_calibration_inputs.mjs';
import {execFileSync} from 'node:child_process';
const {SCSP_CYCLE2_EXAMPLES_BASE:base,SCSP_CYCLE2_EXAMPLES_RECEIPT:receiptPath,
 SCSP_CYCLE2_EXAMPLES_PIN:pin,SCSP_CYCLE2_EXAMPLES_SOURCES:paths,
 SCSP_CYCLE2_EXAMPLES_RELATED:related,SCSP_CYCLE2_EXAMPLES_REPORTS:reports,
 restoreMixerCalibrationPlaygroundScspCycle2ExamplesRevision:restore,
 createPlaygroundScspCycle2ExamplesRevisionReadContext:context,
 parseScspCycle2ExampleCatalog,verifyScspCycle2ExamplesDataOnly}=await historicalCalibrationModule('mixer_calibration_playground_scsp_cycle2_examples_revision.mjs');
const {createScspDspRoutingRevisionReadContext}=await historicalCalibrationModule('mixer_calibration_scsp_dsp_routing_revision.mjs');
const url=name=>new URL('../'+name,import.meta.url),read=name=>readFileSync(url(name));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const historical=name=>execFileSync('git',['show',base+':'+name],{maxBuffer:4*1024*1024});
const receipt=JSON.parse(read(receiptPath));
const match=(bytes,record)=>{assert.equal(bytes.length,record.bytes);assert.equal(sha(bytes),record.sha256);};

test('three complete reviewed bodies reconstruct actual Git and preserve every old example/default without executing source',()=>{
 assert.equal(sha(JSON.stringify(receipt)),pin);assert.equal(read(receiptPath).toString(),JSON.stringify(receipt,null,2)+'\n');
 assert.deepEqual(Object.keys(receipt.sources),paths);assert.deepEqual(Object.keys(receipt.relatedSources),related);assert.deepEqual(Object.keys(receipt.reports),reports);
 const before={},after={};
 for(const name of paths){after[name]=read(name);before[name]=historical(name);match(after[name],receipt.sources[name].after);assert.deepEqual(restore(name,after[name]),before[name]);assert.deepEqual(restore('playground/'+name.split('/').at(-1),after[name]),before[name]);}
 assert.deepEqual(verifyScspCycle2ExamplesDataOnly(before,after,read(related[0])),receipt.dataOnly);
 assert.deepEqual(read(related[0]),historical('docs/playground/research/scsp-cycle2-prototype.js'));
 for(const name of reports)assert.deepEqual(read(name),historical(name));
 assert.equal(receipt.dataOnly.exampleExecuted,false);
});
test('data-only verifier rejects changed defaults, old examples, added execution or unrelated page/mode edits',()=>{
 const before=Object.fromEntries(paths.map(name=>[name,historical(name)])),after=Object.fromEntries(paths.map(name=>[name,read(name)])),example=read(related[0]);
 const catalog=paths[0],parsed=parseScspCycle2ExampleCatalog(after[catalog]);
 for(const [from,to]of [[JSON.stringify(parsed.DEFAULT_CODE),JSON.stringify(parsed.DEFAULT_CODE+'// changed')],
  [JSON.stringify(parsed.EXAMPLE_FILES[0].data),JSON.stringify(parsed.EXAMPLE_FILES[0].data+'// changed')],
  ['export const EXAMPLES = Object.fromEntries','console.log("execute");\nexport const EXAMPLES = Object.fromEntries']]){
  const changed=Buffer.from(after[catalog].toString().replace(from,to));assert.notDeepEqual(changed,after[catalog]);assert.throws(()=>verifyScspCycle2ExamplesDataOnly(before,{...after,[catalog]:changed},example));
 }
 for(const name of paths.slice(1))assert.throws(()=>verifyScspCycle2ExamplesDataOnly(before,{...after,[name]:Buffer.concat([after[name],Buffer.from('\n// unrelated')])},example));
 assert.throws(()=>verifyScspCycle2ExamplesDataOnly(before,after,Buffer.concat([example,Buffer.from('\n')])));
});
test('unknown paths, future edits and already restored bytes receive no reconstruction exemption',()=>{
 for(const name of paths){const current=read(name),future=Buffer.concat([current,Buffer.from('\n')]),previous=historical(name);assert.equal(restore(name,future),future);assert.equal(restore(name,previous),previous);}
 const bytes=read(paths[0]);for(const name of ['docs/js/scspsynth.js','docs/playground/future.js','../'+paths[0]])assert.equal(restore(name,bytes),bytes);
});
test('source dependencies, historical reports and forged receipts cannot authorize changed bytes',()=>{
 for(const name of [...paths,...related,...reports])assert.throws(()=>restore(paths[0],read(paths[0]),{readSource(location){const bytes=readFileSync(location);return location.href===url(name).href?Buffer.concat([bytes,Buffer.from('\n')]):bytes;}}),/pinned source\/report dependency changed/,name);
 assert.throws(()=>restore(paths[0],read(paths[0]),{readSource(location){if(location.href!==url(receiptPath).href)return readFileSync(location);const forged=structuredClone(receipt);forged.sources[paths[0]].before.sha256='0'.repeat(64);return Buffer.from(JSON.stringify(forged));}}),/independently pinned receipt/);
});
test('one proof owns an immutable read snapshot and the old routing chain receives its exact catalog predecessor',()=>{
 let changed=false;const counts=new Map(),dependency=related[0];
 const source=location=>{counts.set(location.href,(counts.get(location.href)??0)+1);const bytes=readFileSync(location);return changed&&location.href===url(dependency).href?Buffer.concat([bytes,Buffer.from('\n')]):bytes;};
 const proof=context(source);
 for(const name of paths){assert.deepEqual(proof.readSource(url(name)),historical(name));assert.deepEqual(proof.restore(name,read(name)),historical(name));}
 assert([...counts.values()].every(count=>count===1));changed=true;
 assert.deepEqual(proof.readSource(url(paths[0])),historical(paths[0]));assert.throws(()=>context(source).restore(paths[0],read(paths[0])),/pinned source\/report dependency changed/);
 const old=JSON.parse(read('docs/issues/playground_scsp_dsp_routing_source_revision_01.json'));
 const oldReader=createScspDspRoutingRevisionReadContext();
 for(const name of paths)match(oldReader.readSource(url(name)),old.sources[name].before);
});
