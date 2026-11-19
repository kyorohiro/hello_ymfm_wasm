import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readHistoricalYm2608SourceMixFileSync as readFileSync,createHistoricalYm2608SourceMixReader} from '../test/helpers/historical_ym2608_source_mix_fixture.mjs';
import {createHash} from 'node:crypto';
const {restoreMixerCalibrationYm2608OutputGainRevision:restoreArchived,
  YM2608_OUTPUT_GAIN_REVISION_SOURCE_PATHS:paths,YM2608_OUTPUT_GAIN_REVISION_RELATED_PATHS:related,
  YM2608_OUTPUT_GAIN_REVISION_REPORT_PATHS:reports,YM2608_OUTPUT_GAIN_DEFAULT_PCM_PATH:proofPath,
  YM2608_OUTPUT_GAIN_REVISION_RECEIPT_PATH:receiptPath,YM2608_OUTPUT_GAIN_REVISION_RECEIPT_OBJECT_SHA256:pin,
}=await historicalCalibrationModule('mixer_calibration_ym2608_output_gain_revision.mjs');
const {assertMixerCalibrationSourceFreshness}=await historicalCalibrationModule('mixer_calibration_sources.mjs');
import {ym2608OutputGainDefaultChecker} from './check_ym2608_output_gain_defaults.mjs';

const read=name => readFileSync(new URL('../'+name,import.meta.url));
const restore=(path,bytes,options={})=>restoreArchived(path,bytes,{...options,
  readSource:createHistoricalYm2608SourceMixReader(options.readSource)});
const sha=bytes => createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(read(receiptPath));
const measured=JSON.parse(read(reports[0]));

test('the exact dormant YM2608 revision restores both measured bodies and retains all eight original reports',() => {
  assert.equal(sha(JSON.stringify(receipt)),pin);
  for(const file of reports) {
    const bytes=read(file),report=JSON.parse(bytes);
    assert.equal(sha(bytes),receipt.reports[file].sha256);
    for(const path of paths) {
      const current=read('docs/'+path),record=report.sources[path];
      assert.equal(restore(path,current,{record,report}).toString(),receipt.sources[path].beforeText);
      assert.equal(assertMixerCalibrationSourceFreshness({path,bytes:restore(path,current,{record,report}),record,report}),'raw',
        'Authenticated archived bytes identify history; current-source approval comes from fresh measurements');
    }
    assert.equal(sha(read(file)),sha(bytes));
  }
});

test('the native unity-gain witness pins every sample comparison and the one ABI-only checker adaptation',() => {
  const proof=JSON.parse(read(proofPath));
  assert.equal(sha(read(proofPath)),receipt.nativeProof.sha256);
  assert.equal(proof.passed,true);assert.equal(proof.deviceOpened,false);
  assert.equal(proof.cases.length,586);assert.equal(proof.totalOutputStereoFrames,7264744);
  assert.equal(proof.cases.filter(item => item.kind==='chip').length,522);
  assert.equal(proof.cases.filter(item => item.kind==='engine').length,64);
  assert(proof.cases.every(item => item.maximumDifference===0&&/^[a-f0-9]{64}$/.test(item.pcmSha256)));
  assert.equal(sha(ym2608OutputGainDefaultChecker(read('scripts/check_ym2608_wasm_sdk.mjs').toString())),proof.inputs.checker.sha256);
  assert.throws(() => ym2608OutputGainDefaultChecker('changed checker'),/reviewed adaptation/);
});

test('unknown edits, missing measurement context and measured YM2608 profiles cannot borrow the dormant revision',() => {
  for(const path of paths) {
    const bytes=read('docs/'+path),record=measured.sources[path];
    const edits=[Buffer.concat([bytes,Buffer.from('\n')]),Buffer.from(bytes.toString().replace('1024','1025'))];
    for(const changed of edits) {
      assert.equal(restore(path,changed,{record,report:measured}),changed);
      assert.throws(() => assertMixerCalibrationSourceFreshness({path,bytes:changed,record,report:measured}),/remeasure/);
    }
    assert.equal(restore(path,bytes,{record}),bytes);
    assert.throws(() => assertMixerCalibrationSourceFreshness({path,bytes,record}),/remeasure/);
    const altered=structuredClone(measured);altered.rows[0].kind='ym2608';
    assert.equal(restore(path,bytes,{record,report:altered}),bytes);
    assert.throws(() => assertMixerCalibrationSourceFreshness({path,bytes,record,report:altered}),/remeasure/);
    const other=structuredClone(measured);other.referenceFrequencyHz=220;
    assert.equal(restore(path,bytes,{record,report:other}),bytes);
    assert.equal(restore(path,bytes,{record:{...record,sha256:'0'.repeat(64)},report:measured}),bytes);
  }
  const bytes=read('docs/generated/ym2608_wasm.wasm');
  assert.equal(restore('generated/ym2608_wasm.wasm',bytes,{report:measured}),bytes);
  assert.equal(restore('__proto__',bytes,{report:measured}),bytes);
});

test('a changed report, runtime, native input, generated WASM or PCM proof invalidates the exact review',() => {
  const path=paths[0],bytes=read('docs/'+path),record=measured.sources[path];
  for(const target of [...reports,...related,proofPath]) {
    assert.throws(() => restore(path,bytes,{record,report:measured,readSource(url) {
      const current=readFileSync(url);
      return url.pathname.endsWith('/'+target)?Buffer.concat([current,Buffer.from([0])]):current;
    }}),/changed|another build/,target);
  }
});
