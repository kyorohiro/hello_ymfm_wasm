import {readPreHucTimedInput} from '../test/helpers/historical_huc_timed_calibration_inputs.mjs';
import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createHistoricalFm2612ApplicationReader} from '../test/helpers/historical_fm2612_application_source_fixture.mjs';
import {execFileSync} from 'node:child_process';
const {createYm2608SourceMixPolicyReader}=await historicalCalibrationModule('mixer_calibration_ym2608_source_mix_policy_revision.mjs');
const {SCSP_OUTPUT_LEVEL_NEW_CASSETTE_BASE:base,SCSP_OUTPUT_LEVEL_NEW_CASSETTE_RECEIPT:receiptPath,
 SCSP_OUTPUT_LEVEL_NEW_CASSETTE_PIN:pin,SCSP_OUTPUT_LEVEL_NEW_CASSETTE_SOURCES:paths,
 SCSP_OUTPUT_LEVEL_NEW_CASSETTE_UNCHANGED:unchanged,
 SCSP_OUTPUT_LEVEL_NEW_CASSETTE_RELATED:related,SCSP_OUTPUT_LEVEL_NEW_CASSETTE_REPORTS:reports,
 SCSP_OUTPUT_LEVEL_NEW_CASSETTE_APPLICATION_GAIN:applicationOutputGain,
 restoreMixerCalibrationScspOutputLevelNewCassetteRevision:productionRestore,
 createScspOutputLevelNewCassetteRevisionReadContext:productionContext}=await historicalCalibrationModule('mixer_calibration_scsp_output_level_new_cassette_revision.mjs');
const {createScspLiveHighlightRevisionReadContext}=await historicalCalibrationModule('mixer_calibration_scsp_live_highlight_revision.mjs');
const {createScspAllocationNavigationRevisionReadContext}=await historicalCalibrationModule('mixer_calibration_scsp_allocation_navigation_revision.mjs');
const {createScspSynthSlotAllocationRevisionReadContext}=await historicalCalibrationModule('mixer_calibration_scsp_synth_slot_allocation_revision.mjs');
const {createScspSsfSlotMapRevisionReadContext}=await historicalCalibrationModule('mixer_calibration_scsp_ssf_slot_map_revision.mjs');
const {createScspCycle2UiRevisionReadContext}=await historicalCalibrationModule('mixer_calibration_scsp_cycle2_ui_revision.mjs');
const {createScspCycle2PresetsRevisionReadContext}=await historicalCalibrationModule('mixer_calibration_scsp_cycle2_presets_revision.mjs');
// Exercise immutable historical evidence with its exact dependency bodies.
// Raw production readers still reject the newer, unapproved application graph.
const readFileSync=createHistoricalFm2612ApplicationReader(readPreHucTimedInput);
const restore=(path,bytes,options={})=>productionRestore(path,bytes,{readSource:readFileSync,...options});
const context=(reader=readFileSync)=>productionContext(reader);
const policyHistory=createYm2608SourceMixPolicyReader(readFileSync);
const url=name=>new URL('../'+name,import.meta.url),read=name=>policyHistory(url(name));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const historical=name=>execFileSync('git',['show',base+':'+name],{maxBuffer:4*1024*1024});
const receipt=JSON.parse(read(receiptPath));
const match=(bytes,record)=>{assert.equal(bytes.length,record.bytes);assert.equal(sha(bytes),record.sha256);};

test('Application output-level / New Cassette reconstructs complete actual-Git predecessors and preserves every historical report',()=>{
 assert.equal(sha(JSON.stringify(receipt)),pin);assert.equal(read(receiptPath).toString(),JSON.stringify(receipt,null,2)+'\n');
 assert.deepEqual(receipt.applicationOutputGain,applicationOutputGain);
 assert.equal(receipt.baseCommit,base);assert.deepEqual(Object.keys(receipt.sources),paths);assert.deepEqual(Object.keys(receipt.relatedSources),related);assert.deepEqual(Object.keys(receipt.reports),reports);
 for(const name of paths){const bytes=read(name);match(bytes,receipt.sources[name].after);assert.equal(receipt.sources[name].beforeCommit,base);assert.deepEqual(restore(name,bytes),historical(name));}
 for(const name of related)match(read(name),receipt.relatedSources[name]);
 for(const name of unchanged)assert.deepEqual(read(name),historical(name),'Core/common Mixer/owner/observer/API/package input remains byte-identical: '+name);
 for(const name of reports){match(read(name),receipt.reports[name]);assert.deepEqual(read(name),historical(name));}
 const parity=JSON.parse(read('docs/issues/scsp_cycle2_presets_parity_01.json'));assert.equal(parity.cases.length,206);assert.equal(parity.deviceOpened,false);
 const passive=JSON.parse(read('docs/issues/scsp_ssf_dsp_passive_parity_01.json'));assert.equal(passive.cases.length,8);assert.equal(passive.deviceOpened,false);
});
test('unknown paths, future edits and already restored bytes receive no generic application gain or menu exemption',()=>{
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
 const highlightReceipt=JSON.parse(read('docs/issues/scsp_live_highlight_source_revision_01.json')),highlight=createScspLiveHighlightRevisionReadContext(readFileSync);
 for(const name of Object.keys(highlightReceipt.sources))match(highlight.readSource(url(name)),highlightReceipt.sources[name].before);
 const navigationReceipt=JSON.parse(read('docs/issues/scsp_allocation_navigation_source_revision_01.json')),navigation=createScspAllocationNavigationRevisionReadContext(readFileSync);
 for(const name of Object.keys(navigationReceipt.sources))match(navigation.readSource(url(name)),navigationReceipt.sources[name].before);
 const allocationReceipt=JSON.parse(read('docs/issues/scsp_synth_slot_allocation_source_revision_01.json')),allocation=createScspSynthSlotAllocationRevisionReadContext(readFileSync);
 for(const name of Object.keys(allocationReceipt.sources))match(allocation.readSource(url(name)),allocationReceipt.sources[name].before);
 const ssfReceipt=JSON.parse(read('docs/issues/scsp_ssf_slot_map_source_revision_01.json')),ssf=createScspSsfSlotMapRevisionReadContext(readFileSync);
 for(const name of Object.keys(ssfReceipt.sources))match(ssf.readSource(url(name)),ssfReceipt.sources[name].before);
 const uiReceipt=JSON.parse(read('docs/issues/scsp_cycle2_ui_source_revision_01.json')),ui=createScspCycle2UiRevisionReadContext(readFileSync);
 for(const name of ['docs/synth-scsp/synth.js','docs/synth-scsp/index.html','docs/synth-scsp/README.md'])match(ui.readSource(url(name)),uiReceipt.sources[name].before);
 const nativeReceipt=JSON.parse(read('docs/issues/scsp_cycle2_presets_source_revision_01.json')),native=createScspCycle2PresetsRevisionReadContext(readFileSync);
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
  ['scsp_live_highlight','createScspLiveHighlightRevisionReadContext','scsp_live_highlight'],
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
  const module=await historicalCalibrationModule('mixer_calibration_'+moduleName+'_revision.mjs'),proof=module[createName](readFileSync);
  const previous=JSON.parse(read('docs/issues/'+receiptName+'_source_revision_01.json'));
  for(const [name,entry] of Object.entries(previous.sources))match(proof.readSource(url(name)),entry.before);
 }
});

test('application output gain changes explicitly while common measured source units retain their scope',()=>{
 const name='docs/synth-scsp/audio.js';
 assert(paths.includes(name));assert(paths.includes('docs/synth-scsp/audio.test.mjs'));assert(!unchanged.includes(name));
 assert.notDeepEqual(read(name),historical(name));
 assert.equal(applicationOutputGain.afterOutputCompensation/applicationOutputGain.beforeOutputCompensation,8);
 assert.equal(applicationOutputGain.gainRatio,8);assert.equal(applicationOutputGain.changeDb,18.06179973983887);
 assert.equal(applicationOutputGain.beforeSourceBalance,applicationOutputGain.afterSourceBalance);
 assert.equal(applicationOutputGain.beforeSongInputBalance,applicationOutputGain.afterSongInputBalance);
 assert.equal(applicationOutputGain.commonMixerGainChanged,false);assert.equal(applicationOutputGain.corePcmChanged,false);
 assert.equal(applicationOutputGain.universalClippingGuarantee,false);
 const measured=JSON.parse(read('docs/issues/scsp_ay_single_output_chip_levels_01.json'));
 assert(!Object.keys(measured.sources).some(path=>path==='synth-scsp/audio.js'||path===name));
 assert.equal(measured.rows[0].pcm.tap,'audio.masterInputNode (after source Mixer, before FX/master/listening)');
 for(const path of ['tetorica_src/runtime/soundchip_mixer_presets.js','docs/js/soundchip_mixer_presets.js','docs/playground/playground_mixer_defaults.js']){
  assert(unchanged.includes(path));assert.deepEqual(read(path),historical(path));
 }
 const withoutImportVersions=bytes=>bytes.toString().replace(/(from\s+['"]\.[^'"]*?)\?v=[^'"]+(['"])/g,'$1$2');
 for(const path of ['docs/synth-scsp/synth.js','docs/synth-scsp/code_host.js'])
  assert.equal(withoutImportVersions(read(path)),withoutImportVersions(historical(path)),'Launcher/host changes are import cache queries only: '+path);
});
