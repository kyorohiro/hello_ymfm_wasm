import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readHistoricalAyTimedFileSync as readFileSync} from '../test/helpers/historical_ay_timed_source_fixture.mjs';
import {FM2608_NAVIGATION_REVISION_PATH as path,
  FM2608_NAVIGATION_REVISION_RECEIPT_PATH as receiptPath,
  FM2608_NAVIGATION_REVISION_RECEIPT_OBJECT_SHA256 as pin,
  restoreMixerCalibrationFm2608NavigationRevision as restore} from './mixer_calibration_fm2608_navigation_revision.mjs';
import {assertMixerCalibrationSourceFreshness as fresh} from './mixer_calibration_sources.mjs';
const read = path => readFileSync(new URL('../' + path,import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = JSON.parse(read(receiptPath));

test('passive hardware links restore the intermediate bytes from all eight measured reports', () => {
  assert.equal(sha(JSON.stringify(receipt)),pin);
  const current=read('docs/' + path), before=restore(path,current);
  assert.equal(before.length,receipt.before.bytes);
  assert.equal(sha(before),receipt.before.sha256);
  assert.equal(restore(path,before),before);
  for (const name of Object.keys(receipt.reports)) {
    const bytes=read(name),report=JSON.parse(bytes);
    assert.deepEqual(report.sources[path],receipt.before);
    assert.equal(fresh({path,bytes:current,record:report.sources[path],report}),'ui-fm2608-hardware-source-navigation');
    assert.equal(fresh({path,bytes:before,record:report.sources[path],report}),'raw');
    assert.deepEqual(read(name),bytes);
  }
});

test('another byte, DSP path or edited report cannot borrow the exact navigation layer', () => {
  const current=read('docs/' + path),changed=Buffer.from(current);changed[Math.floor(changed.length/2)]^=1;
  for(const bytes of [changed,Buffer.concat([current,Buffer.from('\n')])]) {
    assert.equal(restore(path,bytes),bytes);
    assert.throws(()=>fresh({path,bytes,record:receipt.before}),/remeasure/);
  }
  for(const other of ['js/spc.js','js/ym2608synth.js','generated/ym2608_wasm.wasm','playground/another-viewer.js'])assert.equal(restore(other,current),current);
  for(const target of Object.keys(receipt.reports))assert.throws(()=>restore(path,current,{readSource(url) {
    const bytes=readFileSync(url);
    return url.pathname.endsWith('/' + target)?Buffer.concat([bytes,Buffer.from('\n')]):bytes;
  }}),/original measurement changed/);
});
