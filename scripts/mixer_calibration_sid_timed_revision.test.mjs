// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreMixerCalibrationSidTimedRevision as restore,createSidTimedRevisionReadContext,
 SID_TIMED_REVISION_RECEIPT,SID_TIMED_PCM_REPORT} from './mixer_calibration_sid_timed_revision.mjs';
import {assertMixerCalibrationSourceFreshness as fresh} from './mixer_calibration_sources.mjs';
const root=new URL('../',import.meta.url),read=name=>readFileSync(new URL(name,root));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(read(SID_TIMED_REVISION_RECEIPT));

test('SID timed review reconstructs every complete predecessor and keeps historical raw evidence untouched',()=>{
 const context=createSidTimedRevisionReadContext();
 for(const [path,pair]of Object.entries(receipt.sources)){
  const after=read(path),before=context.restore(path,after);
  assert.equal(before.length,pair.before.bytes,path);assert.equal(sha(before),pair.before.sha256,path);
  assert.deepEqual(context.readSource(new URL(path,root)),before,path+' older guards consume the same predecessor');
 }
 assert.equal(fresh({path:'js/playground_sid.js',bytes:read('docs/js/playground_sid.js'),record:receipt.sources['docs/js/playground_sid.js'].before}),'sid-timed-default-pcm-parity');
});

test('SID review does not authorize later DSP/cache edits or changed render and gain dependencies',()=>{
 for(const path of ['docs/js/playground_sid_worklet.js','docs/js/playground_scsp_worklet.js','tetorica_src/runtime/playground_performance_sender.js']){
  const changed=Buffer.concat([read(path),Buffer.from('\n// unreviewed later revision\n')]);
  assert.equal(restore(path,changed),changed);
  assert.throws(()=>fresh({path:path.startsWith('docs/')?path.slice(5):path,bytes:changed,record:receipt.sources[path].before}),/remeasure/);
 }
 for(const dependency of ['tetorica_src/runtime/sidsynth.js','tetorica_src/runtime/sid_timed_processor.js','tetorica_src/runtime/soundchip_mixer_presets.js']){
  assert.throws(()=>restore('docs/js/playground_sid.js',read('docs/js/playground_sid.js'),{
   read:path=>path===dependency?Buffer.concat([read(path),Buffer.from('\n')]):read(path),
  }),/dependency/);
 }
});

test('SID parity proof requires real both-model and primary-core coverage without timed execution or physical audio',()=>{
 const proof=JSON.parse(read(SID_TIMED_PCM_REPORT));
 assert.equal(proof.cases.length,282);assert.equal(proof.totalStereoFrames,1155072);assert.equal(proof.maximumDifference,0);
 assert.equal(proof.timedOperationsUsed,false);assert.equal(proof.physicalAudio,false);assert.equal(proof.audioContextCreated,false);
 assert.equal(proof.cases.filter(row=>row.model==='8580').length,90);
 assert.equal(proof.cases.filter(row=>row.chip==='ym2612').length,12);
 for(const mutate of [value=>value.cases.pop(),value=>value.maximumDifference=1,value=>value.timedOperationsUsed=true,value=>value.physicalAudio=true]){
  const changed=structuredClone(proof);mutate(changed);
  assert.throws(()=>restore('docs/js/playground_sid.js',read('docs/js/playground_sid.js'),{
   read:path=>path===SID_TIMED_PCM_REPORT?Buffer.from(JSON.stringify(changed)):read(path),
  }),/default PCM proof/);
 }
});

test('SID receipt identity rejects an incomplete or forged source review',()=>{
 const altered=structuredClone(receipt);delete altered.sources['docs/js/playground_sid.js'];
 assert.throws(()=>restore('docs/js/playground_sid.js',read('docs/js/playground_sid.js'),{
  read:path=>path===SID_TIMED_REVISION_RECEIPT?Buffer.from(JSON.stringify(altered)):read(path),
 }),/receipt/);
});
