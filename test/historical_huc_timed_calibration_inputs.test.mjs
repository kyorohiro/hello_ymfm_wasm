import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {readPreHucTimedInput,HUC_HISTORY_PATH,HUC_HISTORY_PIN} from './helpers/historical_huc_timed_calibration_inputs.mjs';
import {historicalCalibrationModule} from './helpers/historical_calibration_modules.mjs';
import {assertMixerCalibrationSourceFreshness as productionFresh} from '../scripts/mixer_calibration_sources.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),url=name=>new URL('../'+name,import.meta.url);

test('historical test input archive is pinned and each source is the actual fixed Git predecessor',()=>{
 const archive=JSON.parse(readFileSync(url(HUC_HISTORY_PATH)));
 assert.equal(sha(JSON.stringify(archive)),HUC_HISTORY_PIN);assert.equal(archive.schemaVersion,1);
 for(const [name,entry]of Object.entries(archive.sources)){
  const bytes=gunzipSync(Buffer.from(entry.gzipBase64,'base64'));assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.sha256);
  assert.deepEqual(bytes,execFileSync('git',['show',(entry.commit??archive.baseCommit)+':'+name],{maxBuffer:2*1024*1024}));
 }
 const copy=readPreHucTimedInput(url('docs/js/playground_runtime.js')),expected=Buffer.from(copy);copy.fill(0);
 assert.deepEqual(readPreHucTimedInput(url('docs/js/playground_runtime.js')),expected);
 assert.deepEqual(readPreHucTimedInput(url('README.md')),readFileSync(url('README.md')));
});

test('archived guard modules cannot grant current production source freshness approval',async()=>{
 const path='js/playground_huc6280_worklet.js',current=readFileSync(url('docs/'+path));
 const archive=readPreHucTimedInput(url('docs/'+path)),record={bytes:archive.length,sha256:sha(archive)};
 assert.notDeepEqual(current,archive);
 assert.throws(()=>productionFresh({path,bytes:current,record}),/remeasure|dependency changed/);
 const frozen=await historicalCalibrationModule('mixer_calibration_sources.mjs');
 assert.notEqual(frozen.assertMixerCalibrationSourceFreshness,productionFresh);
 assert.equal(frozen.assertMixerCalibrationSourceFreshness({path,bytes:archive,record}),'raw');
 assert.throws(()=>productionFresh({path,bytes:current,record}),/remeasure|dependency changed/,'using the fixture does not install hooks or patch production');
});
