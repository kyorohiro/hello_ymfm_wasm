import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
// Passive source provenance. All audio measurements are immutable inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createHistoricalGitReader} from '../test/helpers/historical_calibration_git_reader.mjs';
const sourceCommit = 'a04e3ff87ccc25dcceb27d56d842ad45514669ac';
const readFileSync = createHistoricalGitReader(sourceCommit);
const ayWasmUrl = new URL('../docs/generated/ay8910_wasm.wasm', import.meta.url);
const readAyOutput = createHistoricalGitReader('39c8f1e024dd8727c75bb764d2630605092e5677');
const {
  SYNTH_SOURCE_NAVIGATION_RECEIPT_PATH:receiptPath,
  SYNTH_SOURCE_NAVIGATION_RECEIPT_OBJECT_SHA256:pin,
  SYNTH_SOURCE_NAVIGATION_SOURCE_PATHS:paths,
  SYNTH_SOURCE_NAVIGATION_REPORT_PATHS:reports,
  restoreMixerCalibrationSynthSourceNavigationRevision:restore,
}=await historicalCalibrationModule('mixer_calibration_synth_source_navigation_revision.mjs',{sourceCommit});
const {assertMixerCalibrationSourceFreshness:fresh}=await historicalCalibrationModule('mixer_calibration_sources.mjs',{sourceCommit});
const {HUC6280_UI_REVISION_RECEIPT_PATH,restoreMixerCalibrationHuc6280UiRevision}=await historicalCalibrationModule('mixer_calibration_huc6280_ui_revision.mjs',{sourceCommit});
const {restoreMixerCalibrationVabApiRevision}=await historicalCalibrationModule('mixer_calibration_vab_api_revision.mjs',{sourceCommit});

const read = path => readFileSync(new URL('../' + path, import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = JSON.parse(read(receiptPath));

test('Synth navigation restores the exact independently pinned HuC6280 viewer bodies', () => {
  assert.equal(sha(JSON.stringify(receipt)), pin);
  assert.equal(read(receiptPath).toString(), JSON.stringify(receipt, null, 2) + '\n');
  const previous = JSON.parse(read(HUC6280_UI_REVISION_RECEIPT_PATH));
  for (const path of paths) {
    const current = read('docs/' + path), original = restore(path, current), entry = receipt.sources[path];
    assert.notEqual(original, current);
    assert.deepEqual(entry.before, previous.sources[path].after);
    assert.equal(original.length, entry.before.bytes);
    assert.equal(sha(original), entry.before.sha256);
    assert.equal(fresh({path, bytes:current, record:entry.before}), 'ui-synth-source-navigation');
    assert.equal(fresh({path, bytes:current, record:entry.after}), 'raw');
    assert.equal(restore(path, original), original);
    for (const reportPath of reports) {
      const bytes = read(reportPath), report = JSON.parse(bytes), identity = receipt.reports[reportPath];
      assert.equal(bytes.length, identity.bytes);
      assert.equal(sha(bytes), identity.sha256);
      // Keep the old measured DSP contract stale for today's AY output assets.
      // Its source-viewer chain remains independently reproducible from the
      // exact archived VAB predecessor, without a production DSP exception.
      const vab = restoreMixerCalibrationHuc6280UiRevision(path,original);
      assert.throws(() => restoreMixerCalibrationVabApiRevision(path,vab,{
        readSource:url=>url.href===ayWasmUrl.href?readAyOutput(url):readFileSync(url),
      }), /pinned report\/helper\/cache dependency changed: docs\/generated\/ay8910_wasm\.wasm/);
      const historical=restoreMixerCalibrationVabApiRevision(path,vab);
      assert.doesNotThrow(() => fresh({path, bytes:historical, record:report.sources[path], report}));
      assert.deepEqual(read(reportPath), bytes);
    }
  }
});

test('source navigation never authorizes future UI edits, DSP sources or mutated measurement records', () => {
  for (const path of paths) {
    const current = read('docs/' + path), entry = receipt.sources[path], changedByte = Buffer.from(current);
    changedByte[Math.floor(changedByte.length / 2)] ^= 1;
    const changes = [changedByte, Buffer.concat([current, Buffer.from('\n')]),
      Buffer.from("import './future-audio.js';\n" + current),
      Buffer.from(current.toString().replace('sdsp-code-review-1', 'future-source-1')),
      Buffer.from(current.toString().replace('readOnly:true', 'readOnly:false'))];
    for (const changed of changes.filter(value => !value.equals(current))) {
      assert.equal(restore(path, changed), changed);
      assert.throws(() => fresh({path, bytes:changed, record:entry.before}), /remeasure/);
    }
    for (const other of ['__proto__', 'docs/' + path, 'js/spc.js', 'js/playground_spc.js', 'generated/spc_wasm.wasm']) {
      assert.equal(restore(other, current), current);
      assert.throws(() => fresh({path:other, bytes:current, record:entry.before}));
    }
    for (const target of reports) {
      assert.throws(() => restore(path, current, {readSource(url) {
        const bytes = readFileSync(url);
        return url.pathname.endsWith('/' + target) ? Buffer.concat([bytes, Buffer.from([0])]) : bytes;
      }}), /original measurement changed/);
    }
  }
});
