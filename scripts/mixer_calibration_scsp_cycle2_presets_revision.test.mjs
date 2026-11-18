import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {SCSP_CYCLE2_PRESETS_BASE as base,SCSP_CYCLE2_PRESETS_RECEIPT as receiptPath,
 SCSP_CYCLE2_PRESETS_PIN as pin,SCSP_CYCLE2_PRESETS_SOURCES as paths,
 SCSP_CYCLE2_PRESETS_RELATED as related,SCSP_CYCLE2_PRESETS_REPORTS as reports,
 restoreMixerCalibrationScspCycle2PresetsRevision as restore,
 createScspCycle2PresetsRevisionReadContext as context} from './mixer_calibration_scsp_cycle2_presets_revision.mjs';
import {createScspFmMultipleSelfRevisionReadContext} from './mixer_calibration_scsp_fm_multiple_self_revision.mjs';
import {createScspCycle2UiRevisionReadContext} from './mixer_calibration_scsp_cycle2_ui_revision.mjs';
const ui=createScspCycle2UiRevisionReadContext();
const url=name=>new URL('../'+name,import.meta.url),read=name=>ui.readSource(url(name));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const historical=name=>execFileSync('git',['show',base+':'+name],{maxBuffer:4*1024*1024});
const receipt=JSON.parse(read(receiptPath));
const match=(bytes,record)=>{assert.equal(bytes.length,record.bytes);assert.equal(sha(bytes),record.sha256);};

test('the Cycle2 v11 preset receipt reconstructs complete actual-Git bodies and preserves prior audio reports',()=>{
 assert.equal(sha(JSON.stringify(receipt)),pin);assert.equal(read(receiptPath).toString(),JSON.stringify(receipt,null,2)+'\n');
 assert.deepEqual(Object.keys(receipt.sources),paths);assert.deepEqual(Object.keys(receipt.relatedSources),related);assert.deepEqual(Object.keys(receipt.reports),reports);
 for(const name of paths){const bytes=read(name);match(bytes,receipt.sources[name].after);assert.deepEqual(restore(name,bytes),historical(name));}
 for(const name of reports)if(!name.endsWith('scsp_cycle2_presets_parity_01.json'))assert.deepEqual(read(name),historical(name));
 const parity=JSON.parse(read('docs/issues/scsp_cycle2_presets_parity_01.json'));
 assert.equal(parity.cases.length,206);assert.equal(parity.deviceOpened,false);
 for(const row of parity.cases)assert(row.exactPcmEqual&&row.exactEffectiveWriteTraceEqual&&row.exactRawStackEqual&&(row.kind==='cycle2'?row.cyclePresetVersion===11&&row.portableExportDidNotWrite:row.exactPresetEqual));
});
test('unknown paths, future edits and already restored bytes receive no generic reconstruction exemption',()=>{
 for(const name of paths){const current=read(name),future=Buffer.concat([current,Buffer.from('\n')]),previous=historical(name);assert.equal(restore(name,future),future);assert.equal(restore(name,previous),previous);}
 const bytes=read(paths[0]);for(const name of ['docs/js/scspsynth.js','docs/synth-scsp/future.js','../'+paths[0]])assert.equal(restore(name,bytes),bytes);
});
test('all current application, test, binary and historical report dependencies are verified before granting exact reconstruction',()=>{
 for(const name of [...paths,...related,...reports])assert.throws(()=>restore(paths[0],read(paths[0]),{readSource(location){const bytes=readFileSync(location);return location.href===url(name).href?Buffer.concat([bytes,Buffer.from('\n')]):bytes;}}),/pinned source\/report dependency changed/,name);
 assert.throws(()=>restore(paths[0],read(paths[0]),{readSource(location){if(location.href!==url(receiptPath).href)return readFileSync(location);const forged=structuredClone(receipt);forged.sources[paths[0]].before.sha256='0'.repeat(64);return Buffer.from(JSON.stringify(forged));}}),/independently pinned receipt/);
});
test('owned reads stay immutable and the prior source chain receives its exact measured predecessor',()=>{
 let changed=false;const counts=new Map(),dependency=related[0];
 const source=location=>{counts.set(location.href,(counts.get(location.href)??0)+1);const bytes=readFileSync(location);return changed&&location.href===url(dependency).href?Buffer.concat([bytes,Buffer.from('\n')]):bytes;};
 const proof=context(source);
 for(const name of paths){assert.deepEqual(proof.readSource(url(name)),historical(name));assert.deepEqual(proof.restore(name,read(name)),historical(name));}
 assert([...counts.values()].every(count=>count===1));changed=true;
 assert.deepEqual(proof.readSource(url(paths[0])),historical(paths[0]));assert.throws(()=>context(source).restore(paths[0],read(paths[0])),/pinned source\/report dependency changed/);
 const old=JSON.parse(read('docs/issues/scsp_fm_multiple_self_source_revision_01.json')),prior=createScspFmMultipleSelfRevisionReadContext();
 for(const name of ['docs/synth-scsp/routing.js','docs/synth-scsp/patch.js','docs/synth-scsp/instrument.js'])match(prior.readSource(url(name)),old.sources[name].before);
});
