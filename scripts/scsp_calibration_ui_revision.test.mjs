import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {restoreMixerCalibrationScspPolicyCacheRevision} from './mixer_calibration_sources.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('SCSP calibration rollout reconstructs only two exact UI cache tokens and rejects changed bodies',async()=>{
 const receipt=JSON.parse(await readFile(new URL('../docs/issues/scsp_calibration_ui_revision_01.json',import.meta.url)));
 for(const [path,entry]of Object.entries(receipt.sources)){
  const bytes=await readFile(new URL('../docs/'+path,import.meta.url));assert.equal(bytes.length,entry.after.bytes);assert.equal(sha(bytes),entry.after.sha256);
  const restored=restoreMixerCalibrationScspPolicyCacheRevision(path,bytes);assert.equal(restored.length,entry.before.bytes);assert.equal(sha(restored),entry.before.sha256);
  assert.equal(bytes.toString().split(entry.toToken).length,2);assert.equal(restored.toString().replace(entry.fromToken,entry.toToken),bytes.toString());
  const changed=Buffer.from(bytes);changed[0]^=1;assert.equal(restoreMixerCalibrationScspPolicyCacheRevision(path,changed),changed,'different body cannot use cache-only exception');
 }
});
