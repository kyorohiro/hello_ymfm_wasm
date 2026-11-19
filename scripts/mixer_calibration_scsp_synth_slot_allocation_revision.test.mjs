import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from '../test/helpers/historical_huc_timed_calibration_inputs.mjs';
import {execFileSync} from 'node:child_process';
const {SCSP_SYNTH_SLOT_ALLOCATION_BASE:base,SCSP_SYNTH_SLOT_ALLOCATION_RECEIPT:receiptPath,
 SCSP_SYNTH_SLOT_ALLOCATION_PIN:pin,SCSP_SYNTH_SLOT_ALLOCATION_SOURCES:paths,
 SCSP_SYNTH_SLOT_ALLOCATION_UNCHANGED:unchanged,
 SCSP_SYNTH_SLOT_ALLOCATION_RELATED:related,SCSP_SYNTH_SLOT_ALLOCATION_REPORTS:reports,
 restoreMixerCalibrationScspSynthSlotAllocationRevision:restore,
 createScspSynthSlotAllocationRevisionReadContext:context}=await historicalCalibrationModule('mixer_calibration_scsp_synth_slot_allocation_revision.mjs');
const {createScspSsfSlotMapRevisionReadContext}=await historicalCalibrationModule('mixer_calibration_scsp_ssf_slot_map_revision.mjs');
const {createScspCycle2UiRevisionReadContext}=await historicalCalibrationModule('mixer_calibration_scsp_cycle2_ui_revision.mjs');
const {createScspCycle2PresetsRevisionReadContext}=await historicalCalibrationModule('mixer_calibration_scsp_cycle2_presets_revision.mjs');
const {createScspAllocationNavigationRevisionReadContext}=await historicalCalibrationModule('mixer_calibration_scsp_allocation_navigation_revision.mjs');
const latest=createScspAllocationNavigationRevisionReadContext();
const url=name=>new URL('../'+name,import.meta.url),read=name=>latest.readSource(url(name));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const historical=name=>execFileSync('git',['show',base+':'+name],{maxBuffer:4*1024*1024});
const receipt=JSON.parse(read(receiptPath));
const match=(bytes,record)=>{assert.equal(bytes.length,record.bytes);assert.equal(sha(bytes),record.sha256);};

test('Synth slot allocation view reconstructs complete actual-Git predecessors and preserves every historical report',()=>{
 assert.equal(sha(JSON.stringify(receipt)),pin);assert.equal(read(receiptPath).toString(),JSON.stringify(receipt,null,2)+'\n');
 assert.equal(receipt.baseCommit,base);assert.deepEqual(Object.keys(receipt.sources),paths);assert.deepEqual(Object.keys(receipt.relatedSources),related);assert.deepEqual(Object.keys(receipt.reports),reports);
 for(const name of paths){const bytes=read(name);match(bytes,receipt.sources[name].after);assert.equal(receipt.sources[name].beforeCommit,base);assert.deepEqual(restore(name,bytes),historical(name));}
 for(const name of related)match(read(name),receipt.relatedSources[name]);
 for(const name of unchanged)assert.deepEqual(read(name),historical(name),'Runtime/core/owner/audio/observer/API/gain/package input remains byte-identical: '+name);
 for(const name of reports){match(read(name),receipt.reports[name]);assert.deepEqual(read(name),historical(name));}
 const parity=JSON.parse(read('docs/issues/scsp_cycle2_presets_parity_01.json'));assert.equal(parity.cases.length,206);assert.equal(parity.deviceOpened,false);
 const passive=JSON.parse(read('docs/issues/scsp_ssf_dsp_passive_parity_01.json'));assert.equal(passive.cases.length,8);assert.equal(passive.deviceOpened,false);
});
test('unknown paths, future edits and already restored bytes receive no generic allocation exemption',()=>{
 for(const name of paths){const current=read(name),future=Buffer.concat([current,Buffer.from('\n')]),previous=historical(name);assert.equal(restore(name,future),future);assert.equal(restore(name,previous),previous);if(name.startsWith('docs/synth-scsp/'))assert.deepEqual(restore(name.slice(5),current),previous);}
 const bytes=read(paths[0]);for(const name of ['docs/js/scspsynth.js','docs/synth-scsp/future.js','../'+paths[0]])assert.equal(restore(name,bytes),bytes);
});
test('every current source, observer, test, binary and historical receipt is checked before reconstruction',()=>{
 for(const name of [...paths,...related,...reports])assert.throws(()=>restore(paths[0],read(paths[0]),{readSource(location){const bytes=readFileSync(location);return location.href===url(name).href?Buffer.concat([bytes,Buffer.from('\n')]):bytes;}}),/pinned source\/report dependency changed/,name);
 assert.throws(()=>restore(paths[0],read(paths[0]),{readSource(location){if(location.href!==url(receiptPath).href)return readFileSync(location);const forged=structuredClone(receipt);forged.sources[paths[0]].before.sha256='0'.repeat(64);return Buffer.from(JSON.stringify(forged));}}),/independently pinned receipt/);
});
test('owned proof reads stay immutable and the prior SSF/Cycle2 UI/native chain receives exact predecessors',()=>{
 let changed=false;const counts=new Map(),dependency=related[0];
 const source=location=>{counts.set(location.href,(counts.get(location.href)??0)+1);const bytes=readFileSync(location);return changed&&location.href===url(dependency).href?Buffer.concat([bytes,Buffer.from('\n')]):bytes;};
 const proof=context(source);
 for(const name of paths){assert.deepEqual(proof.readSource(url(name)),historical(name));assert.deepEqual(proof.restore(name,read(name)),historical(name));}
 assert([...counts.values()].every(count=>count===1));changed=true;
 assert.deepEqual(proof.readSource(url(paths[0])),historical(paths[0]));assert.throws(()=>context(source).restore(paths[0],read(paths[0])),/pinned source\/report dependency changed/);
 const ssfReceipt=JSON.parse(read('docs/issues/scsp_ssf_slot_map_source_revision_01.json')),ssf=createScspSsfSlotMapRevisionReadContext();
 for(const name of Object.keys(ssfReceipt.sources))match(ssf.readSource(url(name)),ssfReceipt.sources[name].before);
 const uiReceipt=JSON.parse(read('docs/issues/scsp_cycle2_ui_source_revision_01.json')),ui=createScspCycle2UiRevisionReadContext();
 for(const name of ['docs/synth-scsp/synth.js','docs/synth-scsp/index.html','docs/synth-scsp/README.md'])match(ui.readSource(url(name)),uiReceipt.sources[name].before);
 const nativeReceipt=JSON.parse(read('docs/issues/scsp_cycle2_presets_source_revision_01.json')),native=createScspCycle2PresetsRevisionReadContext();
 for(const name of ['docs/synth-scsp/routing.js','docs/synth-scsp/patch.js','docs/synth-scsp/instrument.js'])match(native.readSource(url(name)),nativeReceipt.sources[name]?.before??nativeReceipt.relatedSources[name]);
});
