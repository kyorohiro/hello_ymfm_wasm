import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoricalGitReader} from '../test/helpers/historical_calibration_git_reader.mjs';
import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
import {createHash} from 'node:crypto';
const sourceCommit = '924d5a39ca2e6bd1d4752b17bac89268712d1038';
const readFileSync = createHistoricalGitReader(sourceCommit);
const {restoreMixerCalibrationYm2413StateRevision:restore,YM2413_STATE_REVISION_PATHS:paths,YM2413_STATE_REVISION_RECEIPT:receiptPath,YM2413_STATE_REVISION_PIN:pin} = await historicalCalibrationModule('mixer_calibration_ym2413_state_revision.mjs', {sourceCommit});
const {assertMixerCalibrationSourceFreshness:fresh} = await historicalCalibrationModule('mixer_calibration_sources.mjs', {sourceCommit});
const read=path=>readFileSync(new URL('../'+path,import.meta.url));
const receipt=JSON.parse(read(receiptPath));
const sha=b=>createHash('sha256').update(b).digest('hex');
test('state ABI compatibility restores exact predecessor bytes only with complete immutable evidence',()=>{
 assert.equal(sha(JSON.stringify(receipt)),pin);
 for(const path of paths){const current=read('docs/'+path),before=restore(path,current),entry=receipt.sources[path];
  assert.equal(sha(before),entry.before.sha256);assert.equal(before.length,entry.before.bytes);
  assert.equal(fresh({path,bytes:current,record:entry.before}),'ym2413-native-checkpoint-api');
  assert.deepEqual(restore(path,before),before);
 }
});
test('later served source edits remain rejected, and unrelated sources are never normalized',()=>{
 for(const path of paths){const bytes=Buffer.from(read('docs/'+path));bytes[bytes.length-1]^=1;assert.throws(()=>restore(path,bytes),/remeasure/);}
 const unrelated=Buffer.from('other chip');assert.equal(restore('js/other.js',unrelated),unrelated);
});
test('state proof, retained policy, runtime and SDK dependencies cannot drift',()=>{
 for(const target of ['docs/issues/ym2413_state_pcm_parity_01.json','docs/issues/ym2413_state_checkpoint_validation_01.json','tetorica_src/runtime/ym2413audioengine.js','third_party/soundchip-sdk.json','third_party/tetorica-soundchip-native/wasm/ym2413_wasm.cpp','docs/issues/scsp_ws_timed_chip_levels_01.json']) {
  const badRead=path=>{const b=read(path);return path===target?Buffer.concat([b,Buffer.from(' ')]):b;};
  assert.throws(()=>restore(paths[0],read('docs/'+paths[0]),{read:badRead}),/remeasure/,target);
 }
});
test('all fresh raw and current-policy verification reports are required',()=>{
 for(const target of Object.keys(receipt.dependencies).filter(p=>/chip_levels(?:_verify)?_01\.json$/.test(p)&&p.includes('ym2413_state'))){
  assert.throws(()=>restore(paths[0],read('docs/'+paths[0]),{read:path=>path===target?Buffer.from('{}'):read(path)}),/remeasure/);
 }
});
test('receipt mutations cannot approve new sources',()=>{
 const changed=structuredClone(receipt);changed.sources[paths[0]].after.sha256='0'.repeat(64);
 assert.throws(()=>restore(paths[0],read('docs/'+paths[0]),{read:path=>path===receiptPath?Buffer.from(JSON.stringify(changed)):read(path)}),/remeasure/);
});
