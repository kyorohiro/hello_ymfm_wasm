import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {SCSP_LIVE_HIGHLIGHT_BASE as base,SCSP_LIVE_HIGHLIGHT_RECEIPT as receiptPath,
 SCSP_LIVE_HIGHLIGHT_PIN as pin,SCSP_LIVE_HIGHLIGHT_SOURCES as paths,
 SCSP_LIVE_HIGHLIGHT_UNCHANGED as unchanged,
 SCSP_LIVE_HIGHLIGHT_RELATED as related,SCSP_LIVE_HIGHLIGHT_REPORTS as reports,
 restoreMixerCalibrationScspLiveHighlightRevision as restore,
 createScspLiveHighlightRevisionReadContext as context} from './mixer_calibration_scsp_live_highlight_revision.mjs';
import {createScspAllocationNavigationRevisionReadContext} from './mixer_calibration_scsp_allocation_navigation_revision.mjs';
import {createScspSynthSlotAllocationRevisionReadContext} from './mixer_calibration_scsp_synth_slot_allocation_revision.mjs';
import {createScspSsfSlotMapRevisionReadContext} from './mixer_calibration_scsp_ssf_slot_map_revision.mjs';
import {createScspCycle2UiRevisionReadContext} from './mixer_calibration_scsp_cycle2_ui_revision.mjs';
import {createScspCycle2PresetsRevisionReadContext} from './mixer_calibration_scsp_cycle2_presets_revision.mjs';
import {createScspOutputLevelNewCassetteRevisionReadContext} from './mixer_calibration_scsp_output_level_new_cassette_revision.mjs';
const latest=createScspOutputLevelNewCassetteRevisionReadContext();
const url=name=>new URL('../'+name,import.meta.url),read=name=>latest.readSource(url(name));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const historical=name=>execFileSync('git',['show',base+':'+name],{maxBuffer:4*1024*1024});
const receipt=JSON.parse(read(receiptPath));
const match=(bytes,record)=>{assert.equal(bytes.length,record.bytes);assert.equal(sha(bytes),record.sha256);};

test('Live parameter highlighting reconstructs complete actual-Git predecessors and preserves every historical report',()=>{
 assert.equal(sha(JSON.stringify(receipt)),pin);assert.equal(read(receiptPath).toString(),JSON.stringify(receipt,null,2)+'\n');
 assert.equal(receipt.baseCommit,base);assert.deepEqual(Object.keys(receipt.sources),paths);assert.deepEqual(Object.keys(receipt.relatedSources),related);assert.deepEqual(Object.keys(receipt.reports),reports);
 for(const name of paths){const bytes=read(name);match(bytes,receipt.sources[name].after);assert.equal(receipt.sources[name].beforeCommit,base);assert.deepEqual(restore(name,bytes),historical(name));}
 for(const name of related)match(read(name),receipt.relatedSources[name]);
 for(const name of unchanged)assert.deepEqual(read(name),historical(name),'Runtime/core/owner/audio/observer/API/gain/package input remains byte-identical: '+name);
 for(const name of reports){match(read(name),receipt.reports[name]);assert.deepEqual(read(name),historical(name));}
 const parity=JSON.parse(read('docs/issues/scsp_cycle2_presets_parity_01.json'));assert.equal(parity.cases.length,206);assert.equal(parity.deviceOpened,false);
 const passive=JSON.parse(read('docs/issues/scsp_ssf_dsp_passive_parity_01.json'));assert.equal(passive.cases.length,8);assert.equal(passive.deviceOpened,false);
});
test('unknown paths, future edits and already restored bytes receive no generic highlight exemption',()=>{
 for(const name of paths){const current=read(name),future=Buffer.concat([current,Buffer.from('\n')]),previous=historical(name);assert.equal(restore(name,future),future);assert.equal(restore(name,previous),previous);if(name.startsWith('docs/synth-scsp/'))assert.deepEqual(restore(name.slice(5),current),previous);}
 const bytes=read(paths[0]);for(const name of ['docs/js/scspsynth.js','docs/synth-scsp/future.js','../'+paths[0]])assert.equal(restore(name,bytes),bytes);
});
test('every current source, observer, test, binary and historical receipt is checked before reconstruction',()=>{
 for(const name of [...paths,...related,...reports])assert.throws(()=>restore(paths[0],read(paths[0]),{readSource(location){const bytes=readFileSync(location);return location.href===url(name).href?Buffer.concat([bytes,Buffer.from('\n')]):bytes;}}),/pinned source\/report dependency changed/,name);
 assert.throws(()=>restore(paths[0],read(paths[0]),{readSource(location){if(location.href!==url(receiptPath).href)return readFileSync(location);const forged=structuredClone(receipt);forged.sources[paths[0]].before.sha256='0'.repeat(64);return Buffer.from(JSON.stringify(forged));}}),/independently pinned receipt/);
});
test('owned proof reads stay immutable and the prior allocation/SSF/Cycle2 UI/native chain receives exact predecessors',()=>{
 let changed=false;const counts=new Map(),dependency=related[0];
 const source=location=>{counts.set(location.href,(counts.get(location.href)??0)+1);const bytes=readFileSync(location);return changed&&location.href===url(dependency).href?Buffer.concat([bytes,Buffer.from('\n')]):bytes;};
 const proof=context(source);
 for(const name of paths){assert.deepEqual(proof.readSource(url(name)),historical(name));assert.deepEqual(proof.restore(name,read(name)),historical(name));}
 assert([...counts.values()].every(count=>count===1));changed=true;
 assert.deepEqual(proof.readSource(url(paths[0])),historical(paths[0]));assert.throws(()=>context(source).restore(paths[0],read(paths[0])),/pinned source\/report dependency changed/);
 const navigationReceipt=JSON.parse(read('docs/issues/scsp_allocation_navigation_source_revision_01.json')),navigation=createScspAllocationNavigationRevisionReadContext();
 for(const name of Object.keys(navigationReceipt.sources))match(navigation.readSource(url(name)),navigationReceipt.sources[name].before);
 const allocationReceipt=JSON.parse(read('docs/issues/scsp_synth_slot_allocation_source_revision_01.json')),allocation=createScspSynthSlotAllocationRevisionReadContext();
 for(const name of Object.keys(allocationReceipt.sources))match(allocation.readSource(url(name)),allocationReceipt.sources[name].before);
 const ssfReceipt=JSON.parse(read('docs/issues/scsp_ssf_slot_map_source_revision_01.json')),ssf=createScspSsfSlotMapRevisionReadContext();
 for(const name of Object.keys(ssfReceipt.sources))match(ssf.readSource(url(name)),ssfReceipt.sources[name].before);
 const uiReceipt=JSON.parse(read('docs/issues/scsp_cycle2_ui_source_revision_01.json')),ui=createScspCycle2UiRevisionReadContext();
 for(const name of ['docs/synth-scsp/synth.js','docs/synth-scsp/index.html','docs/synth-scsp/README.md'])match(ui.readSource(url(name)),uiReceipt.sources[name].before);
 const nativeReceipt=JSON.parse(read('docs/issues/scsp_cycle2_presets_source_revision_01.json')),native=createScspCycle2PresetsRevisionReadContext();
 for(const name of ['docs/synth-scsp/routing.js','docs/synth-scsp/patch.js','docs/synth-scsp/instrument.js'])match(native.readSource(url(name)),nativeReceipt.sources[name]?.before??nativeReceipt.relatedSources[name]);
});

test('all historical JSON and the unchanged FM scalar helper/callers retain exact base bytes',()=>{
 const historicalReports=execFileSync('git',['ls-tree','-r','--name-only',base,'--','docs/issues'],{encoding:'utf8'}).trim().split('\n').filter(name=>name.endsWith('.json'));
 assert(historicalReports.length>0);
 execFileSync('git',['diff','--exit-code',base,'--',...historicalReports],{maxBuffer:4*1024*1024});
 for(const name of ['docs/synth/synth_live_highlight.js','docs/synth/synth_live_highlight.test.mjs','docs/synth/synth.js','docs/synth/index.html','docs/synth-spu/synth.css'])assert.deepEqual(read(name),historical(name));
});

test('every complete source predecessor in the established SCSP proof chain still restores exactly',async()=>{
 const chain=[
  ['scsp_allocation_navigation','createScspAllocationNavigationRevisionReadContext','scsp_allocation_navigation'],
  ['scsp_synth_slot_allocation','createScspSynthSlotAllocationRevisionReadContext','scsp_synth_slot_allocation'],
  ['scsp_ssf_slot_map','createScspSsfSlotMapRevisionReadContext','scsp_ssf_slot_map'],
  ['scsp_cycle2_ui','createScspCycle2UiRevisionReadContext','scsp_cycle2_ui'],
  ['scsp_cycle2_presets','createScspCycle2PresetsRevisionReadContext','scsp_cycle2_presets'],
  ['scsp_synth_cycle2','createScspSynthCycle2RevisionReadContext','scsp_synth_cycle2'],
  ['playground_scsp_cycle2_examples','createPlaygroundScspCycle2ExamplesRevisionReadContext','playground_scsp_cycle2_examples'],
  ['scsp_fm_multiple_self','createScspFmMultipleSelfRevisionReadContext','scsp_fm_multiple_self'],
  ['scsp_fm_multi_self_feedback','createScspFmMultiSelfFeedbackRevisionReadContext','scsp_fm_multi_self_feedback'],
  ['scsp_fm_self_feedback','createScspFmSelfFeedbackRevisionReadContext','scsp_fm_self_feedback'],
  ['scsp_ssf_dsp','createScspSsfDspRevisionReadContext','scsp_ssf_dsp'],
  ['scsp_fm_depth','createScspFmDepthRevisionReadContext','scsp_fm_depth'],
  ['scsp_fm_multi','createScspFmMultiRevisionReadContext','scsp_fm_multi'],
  ['scsp_fm_custom','createScspFmCustom2RevisionReadContext','scsp_fm_custom2'],
  ['scsp_dsp_flow','createScspDspFlowRevisionReadContext','scsp_dsp_signal_flow'],
  ['scsp_dsp_ui','createScspDspUiRevisionReadContext','scsp_dsp_routing_ui'],
  ['scsp_dsp_routing','createScspDspRoutingRevisionReadContext','playground_scsp_dsp_routing'],
  ['scsp_dsp_delay','createScspDspDelayRevisionReadContext','playground_scsp_dsp_delay'],
  ['scsp_dsp_execution','createScspDspExecutionRevisionReadContext','playground_scsp_dsp_execution'],
  ['scsp_dsp_helpers','createScspDspHelpersRevisionReadContext','playground_scsp_dsp_helpers'],
 ];
 for(const [moduleName,createName,receiptName] of chain){
  const module=await import('./mixer_calibration_'+moduleName+'_revision.mjs'),proof=module[createName]();
  const previous=JSON.parse(read('docs/issues/'+receiptName+'_source_revision_01.json'));
  for(const [name,entry] of Object.entries(previous.sources))match(proof.readSource(url(name)),entry.before);
 }
});
