// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreMixerCalibrationGameboyTimedRevision as restoreGameboy,createGameboyTimedRevisionReadContext as createGameboyContext,
 GAMEBOY_TIMED_REVISION_RECEIPT,GAMEBOY_TIMED_PCM_REPORT} from './mixer_calibration_gameboy_timed_revision.mjs';
import {createSidTimedRevisionReadContext} from './mixer_calibration_sid_timed_revision.mjs';
import {createNpmReleaseMetadataReadContext} from './mixer_calibration_npm_release_metadata.mjs';
import {createGameboyPublicTimedRevisionReadContext} from './mixer_calibration_gameboy_public_timed_revision.mjs';
import {assertMixerCalibrationSourceFreshness as fresh} from './mixer_calibration_sources.mjs';
const root=new URL('../',import.meta.url),metadata=createNpmReleaseMetadataReadContext(),connection=createGameboyPublicTimedRevisionReadContext(metadata.readSource),sidContext=createSidTimedRevisionReadContext(connection.readSource);
// Authenticate and remove the later SID promotion before testing this older
// receipt against its own unchanged strict source/dependency identities.
const read=name=>sidContext.readSource(new URL(name,root));
const restore=(path,bytes,options={})=>restoreGameboy(path,bytes,{read,...options});
const createGameboyTimedRevisionReadContext=()=>createGameboyContext(sidContext.readSource);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(read(GAMEBOY_TIMED_REVISION_RECEIPT));

test('DMG timed review restores every exact predecessor while preserving raw measurement hashes',()=>{
 const context=createGameboyTimedRevisionReadContext();
 for(const [path,pair]of Object.entries(receipt.sources)){
  const after=read(path),before=context.restore(path,after);
  assert.equal(before.length,pair.before.bytes,path);assert.equal(sha(before),pair.before.sha256,path);
  assert.deepEqual(context.readSource(new URL(path,root)),before,path+' nested older guard uses the same original');
 }
 assert.equal(fresh({path:'js/gameboy_runtime_synth.js',bytes:read('docs/js/gameboy_runtime_synth.js'),record:receipt.sources['docs/js/gameboy_runtime_synth.js'].before}),'gameboy-timed-default-pcm-parity');
});

test('review cannot authorize a later DSP change, import cache token change, or changed dependency',()=>{
 for(const path of ['docs/js/playground_gameboy_worklet.js','docs/js/playground_scsp_worklet.js']){
  const changed=Buffer.concat([read(path),Buffer.from('\n// later change\n')]);
  assert.equal(restore(path,changed),changed);
  assert.throws(()=>fresh({path:path.slice(5),bytes:changed,record:receipt.sources[path].before}),/remeasure/);
 }
 for(const dependency of ['tetorica_src/runtime/gameboysynth.js','tetorica_src/runtime/gameboy_timed_processor.js']){
  assert.throws(()=>restore('docs/js/gameboy_runtime_synth.js',read('docs/js/gameboy_runtime_synth.js'),{
   read:path=>path===dependency?Buffer.concat([read(path),Buffer.from('\n')]):read(path),
  }),/dependency/);
 }
});

test('default parity proof is mandatory, complete, unmodified and explicitly excludes timed operations',()=>{
 const proof=JSON.parse(read(GAMEBOY_TIMED_PCM_REPORT));assert.equal(proof.cases.length,180);assert.equal(proof.maximumDifference,0);
 assert.equal(proof.timedOperationsUsed,false);assert.equal(proof.physicalAudio,false);assert.equal(proof.audioContextCreated,false);
 for(const mutate of [value=>value.cases.pop(),value=>value.maximumDifference=1,value=>value.timedOperationsUsed=true]){
  const changed=structuredClone(proof);mutate(changed);
  assert.throws(()=>restore('docs/js/gameboy_runtime_synth.js',read('docs/js/gameboy_runtime_synth.js'),{
   read:path=>path===GAMEBOY_TIMED_PCM_REPORT?Buffer.from(JSON.stringify(changed)):read(path),
  }),/default PCM proof/);
 }
});

test('receipt pin and complete source collection reject forged review metadata',()=>{
 const altered=structuredClone(receipt);delete altered.sources['docs/js/playground_gameboy.js'];
 assert.throws(()=>restore('docs/js/gameboy_runtime_synth.js',read('docs/js/gameboy_runtime_synth.js'),{
  read:path=>path===GAMEBOY_TIMED_REVISION_RECEIPT?Buffer.from(JSON.stringify(altered)):read(path),
 }),/receipt/);
});
