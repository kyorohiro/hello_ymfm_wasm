import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {SCSP_CYCLE2_UI_BASE as base,SCSP_CYCLE2_UI_RECEIPT as receiptPath,
 SCSP_CYCLE2_UI_PREDECESSORS as predecessors,
 SCSP_CYCLE2_UI_PIN as pin,SCSP_CYCLE2_UI_SOURCES as paths,
 SCSP_CYCLE2_UI_RELATED as related,SCSP_CYCLE2_UI_REPORTS as reports,
 verifyScspCycle2UiExampleData as verifyData,
 restoreMixerCalibrationScspCycle2UiRevision as restore,
 createScspCycle2UiRevisionReadContext as context} from './mixer_calibration_scsp_cycle2_ui_revision.mjs';
import {createScspCycle2PresetsRevisionReadContext} from './mixer_calibration_scsp_cycle2_presets_revision.mjs';
import {createScspSsfSlotMapRevisionReadContext} from './mixer_calibration_scsp_ssf_slot_map_revision.mjs';
const latest=createScspSsfSlotMapRevisionReadContext();
const url=name=>new URL('../'+name,import.meta.url),read=name=>latest.readSource(url(name));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const historical=name=>execFileSync('git',['show',(predecessors[name]??base)+':'+name],{maxBuffer:4*1024*1024});
const receipt=JSON.parse(read(receiptPath));
const match=(bytes,record)=>{assert.equal(bytes.length,record.bytes);assert.equal(sha(bytes),record.sha256);};

test('complete UI predecessors match actual Git while native sound inputs and historical parity remain unchanged',()=>{
 assert.equal(sha(JSON.stringify(receipt)),pin);assert.equal(read(receiptPath).toString(),JSON.stringify(receipt,null,2)+'\n');
 assert.deepEqual(Object.keys(receipt.sources),paths);assert.deepEqual(Object.keys(receipt.relatedSources),related);assert.deepEqual(Object.keys(receipt.reports),reports);
 const before={},after={};
 for(const name of paths){const bytes=read(name);match(bytes,receipt.sources[name].after);assert.equal(receipt.sources[name].beforeCommit,predecessors[name]??base);before[name]=historical(name);after[name]=bytes;assert.deepEqual(restore(name,bytes),before[name]);}
 for(const name of reports)assert.deepEqual(read(name),historical(name));
 assert.deepEqual(verifyData(before,after,read('docs/synth-scsp/examples/cycle2.js')),receipt.exampleData);
 assert.deepEqual(receipt.exampleData,{oldExamples:4,addedPath:'/examples/cycle2.js',canonicalExact:true,oldBodiesExact:true,oldStarterAndRestoreExact:true,exampleExecuted:false});
 const parity=JSON.parse(read('docs/issues/scsp_cycle2_presets_parity_01.json'));assert.equal(parity.cases.length,206);assert.equal(parity.deviceOpened,false);
});
test('example proof rejects old example edits, executable scaffolding, noncanonical additions and default/project/host edits',()=>{
 const before=Object.fromEntries(paths.map(name=>[name,historical(name)])),after=Object.fromEntries(paths.map(name=>[name,read(name)])),example=read('docs/synth-scsp/examples/cycle2.js');
 const examples='docs/synth-scsp/code_examples.js',project='docs/synth-scsp/code_project.js',host='docs/synth-scsp/code_host.js';
 const variants=[
  [examples,Buffer.from(after[examples].toString().replace('setBpm(120)','setBpm(121)'))],
  [examples,Buffer.concat([after[examples],Buffer.from('globalThis.unreviewedExampleExecution = true;\n')])],
  [project,Buffer.from(after[project].toString().replace("mode: 'pcm'","mode: 'fm2'"))],
  [host,Buffer.concat([after[host],Buffer.from('// unreviewed host change\n')])],
 ];
 for(const [name,bytes]of variants)assert.throws(()=>verifyData(before,{...after,[name]:bytes},example));
 assert.throws(()=>verifyData(before,after,Buffer.concat([example,Buffer.from('// not canonical\n')])));
});
test('unknown paths, future edits and already restored bytes receive no generic UI exemption',()=>{
 for(const name of paths){const current=read(name),future=Buffer.concat([current,Buffer.from('\n')]),previous=historical(name);assert.equal(restore(name,future),future);assert.equal(restore(name,previous),previous);}
 const bytes=read(paths[0]);for(const name of ['docs/js/scspsynth.js','docs/synth-scsp/future.js','../'+paths[0]])assert.equal(restore(name,bytes),bytes);
});
test('all current source/test/binary/report dependencies and immutable receipt pin are checked',()=>{
 for(const name of [...paths,...related,...reports])assert.throws(()=>restore(paths[0],read(paths[0]),{readSource(location){const bytes=readFileSync(location);return location.href===url(name).href?Buffer.concat([bytes,Buffer.from('\n')]):bytes;}}),/pinned source\/report dependency changed/,name);
 assert.throws(()=>restore(paths[0],read(paths[0]),{readSource(location){if(location.href!==url(receiptPath).href)return readFileSync(location);const forged=structuredClone(receipt);forged.sources[paths[0]].before.sha256='0'.repeat(64);return Buffer.from(JSON.stringify(forged));}}),/independently pinned receipt/);
});
test('one proof owns immutable reads and existing v11 calibration receives its exact complete predecessor',()=>{
 let changed=false;const counts=new Map(),dependency=related[0];
 const source=location=>{counts.set(location.href,(counts.get(location.href)??0)+1);const bytes=readFileSync(location);return changed&&location.href===url(dependency).href?Buffer.concat([bytes,Buffer.from('\n')]):bytes;};
 const proof=context(source);
 for(const name of paths){assert.deepEqual(proof.readSource(url(name)),historical(name));assert.deepEqual(proof.restore(name,read(name)),historical(name));}
 assert([...counts.values()].every(count=>count===1));changed=true;
 assert.deepEqual(proof.readSource(url(paths[0])),historical(paths[0]));assert.throws(()=>context(source).restore(paths[0],read(paths[0])),/pinned source\/report dependency changed/);
 const old=JSON.parse(read('docs/issues/scsp_cycle2_presets_source_revision_01.json')),prior=createScspCycle2PresetsRevisionReadContext();
 for(const name of ['docs/synth-scsp/routing.js','docs/synth-scsp/patch.js','docs/synth-scsp/instrument.js'])match(prior.readSource(url(name)),old.sources[name]?.before??old.relatedSources[name]);
});
