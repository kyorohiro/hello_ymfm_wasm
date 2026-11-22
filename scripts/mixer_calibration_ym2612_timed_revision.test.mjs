import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoricalGitReader} from '../test/helpers/historical_calibration_git_reader.mjs';
import {createHash} from 'node:crypto';
const sourceCommit = '0ea54fd359d6443207f4d8b1b64d1af26ee67c22';
const readFileSync = createHistoricalGitReader(sourceCommit);
const {
  restoreMixerCalibrationYm2612TimedRevision:restore,
  createYm2612TimedRevisionReader,
  YM2612_TIMED_REVISION_RECEIPT_PATH:receiptPath,
  YM2612_TIMED_REVISION_RECEIPT_OBJECT_SHA256:receiptSha,
  YM2612_TIMED_REVISION_SOURCE_PATHS:paths,
  YM2612_TIMED_REVISION_RELATED_PATHS:related,
  YM2612_TIMED_REVISION_REPORT_PATHS:reports,
}=await historicalCalibrationModule('mixer_calibration_ym2612_timed_revision.mjs', {sourceCommit});
const {restoreMixerCalibrationAyTimedRevision}=await historicalCalibrationModule('mixer_calibration_ay_timed_revision.mjs', {sourceCommit});
const {assertMixerCalibrationSourceFreshness}=await historicalCalibrationModule('mixer_calibration_sources.mjs', {sourceCommit});

const read = path => readFileSync(new URL('../' + path, import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = JSON.parse(read(receiptPath));
const match = (bytes, record) => { assert.equal(bytes.length, record.bytes); assert.equal(sha(bytes), record.sha256); };

test('exact YM2612 revision preserves every measured report and reconstructs all complete predecessors', () => {
  assert.equal(sha(JSON.stringify(receipt)), receiptSha);
  for (const path of paths) {
    const current = read(path), entry = receipt.sources[path];
    match(current, entry.after);
    const before = restore(path, current);
    match(before, entry.before);
    assert.notDeepEqual(current, before);
    assert.equal(restore(path, before), before, 'Original measured/reviewed bytes remain untouched');
  }
  for (const path of [...related, ...reports]) match(read(path), receipt.relatedSources[path] ?? receipt.reports[path]);
  const parity = JSON.parse(read('docs/issues/ym2612_timed_default_parity_01.json'));
  assert.equal(parity.deviceOpened, false);
  assert.equal(receipt.verification.exactStereoFrames, 8000);
});

test('source aliases and nested old proof reads receive the authenticated predecessor, with old receipts unchanged', () => {
  const source = 'docs/js/ym2612synth.js', current = read(source);
  assert.deepEqual(restore('js/ym2612synth.js', current), restore(source, current));
  const runtime = 'tetorica_src/runtime/ym2612synth.js';
  assert.deepEqual(restore('web/ym2612synth.js', read(runtime)), restore(runtime, read(runtime)));
  const reader = createYm2612TimedRevisionReader();
  match(reader(new URL('../' + source, import.meta.url)), receipt.sources[source].before);
  const path = 'docs/js/playground_runtime.js', oldReceipt = JSON.parse(read('docs/issues/ay_timed_operations_source_revision_01.json'));
  match(restoreMixerCalibrationAyTimedRevision(path, read(path)), oldReceipt.sources[path].before);
  assert.equal(assertMixerCalibrationSourceFreshness({path: 'js/ym2612synth.js', bytes: current,
    record: receipt.sources[source].before}), 'ym2612-timed-operations-default-path-revision');
});

test('unknown paths, prior bytes and future source edits receive no reconstruction exemption', () => {
  for (const path of paths) {
    const mutated = Buffer.concat([read(path), Buffer.from('\n')]);
    assert.equal(restore(path, mutated), mutated);
  }
  const source = read(paths[0]);
  assert.equal(restore('docs/js/unrelated.js', source), source);
  assert.equal(restore('docs/generated/ym2612_wasm.wasm', source), source);
  assert.throws(() => assertMixerCalibrationSourceFreshness({path: 'js/ym2612synth.js',
    bytes: Buffer.concat([read('docs/js/ym2612synth.js'), Buffer.from('\n')]),
    record: receipt.sources['docs/js/ym2612synth.js'].before}), /remeasure|changed/);
});

test('every changed dependency, differential evidence, original measurement and receipt remains pinned', () => {
  const source = paths[0], current = read(source);
  for (const target of [...paths, ...related, ...reports]) {
    assert.throws(() => restore(source, current, {readSource(url) {
      const bytes = readFileSync(url);
      return url.pathname.endsWith('/' + target) ? Buffer.concat([bytes, Buffer.from('\n')]) : bytes;
    }}), /pinned|independently|changed/, target);
  }
  assert.throws(() => restore(source, current, {readSource(url) {
    const bytes = readFileSync(url);
    if (!url.pathname.endsWith('/' + receiptPath)) return bytes;
    const value = JSON.parse(bytes); value.sources[source].before.sha256 = '0'.repeat(64);
    return Buffer.from(JSON.stringify(value));
  }}), /independently pinned receipt/);
});
