import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from '../test/helpers/historical_huc_timed_calibration_inputs.mjs';
const {
  MONACO_MODEL_REVISION_SOURCE_PATH:path,
  MONACO_MODEL_REVISION_RECEIPT_PATH:receiptPath,
  MONACO_MODEL_REVISION_RECEIPT_OBJECT_SHA256:pin,
  MONACO_MODEL_REVISION_REPORT_PATHS:reports,
  restoreMixerCalibrationMonacoModelRevision:restore,
}=await historicalCalibrationModule('mixer_calibration_monaco_model_revision.mjs');
const {createMonacoVirtualModelsUiReceipt}=await historicalCalibrationModule('record_monaco_virtual_models_ui_revision.mjs');
const {assertMixerCalibrationSourceFreshness:fresh}=await historicalCalibrationModule('mixer_calibration_sources.mjs');
const {restoreMixerCalibrationFm2608NavigationRevision}=await historicalCalibrationModule('mixer_calibration_fm2608_navigation_revision.mjs');
const {restoreMixerCalibrationSynthSourceNavigationRevision}=await historicalCalibrationModule('mixer_calibration_synth_source_navigation_revision.mjs');
const {createScspDspHelpersRevisionReader}=await historicalCalibrationModule('mixer_calibration_scsp_dsp_helpers_revision.mjs');

const readPredecessor = createScspDspHelpersRevisionReader();
const read = path => readPredecessor(new URL('../' + path,import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = JSON.parse(read(receiptPath));

test('the exact reviewed lazy-model revision restores all eight complete measured predecessors',async () => {
  assert.equal(sha(JSON.stringify(receipt)),pin);
  assert.equal(read(receiptPath).toString(),JSON.stringify(receipt,null,2) + '\n');
  assert.deepEqual(await createMonacoVirtualModelsUiReceipt(),receipt);
  const current = read('docs/' + path), before = restore(path,current);
  assert.equal(before.length,receipt.before.bytes);
  assert.equal(sha(before),receipt.before.sha256);
  assert.equal(restore(path,before),before);
  assert.deepEqual(restoreMixerCalibrationFm2608NavigationRevision(path,current),before);
  assert.deepEqual(restoreMixerCalibrationSynthSourceNavigationRevision(path,current),
    restoreMixerCalibrationSynthSourceNavigationRevision(path,before));
  for (const name of reports) {
    const bytes = read(name), report = JSON.parse(bytes);
    assert.deepEqual(report.sources[path],receipt.before);
    assert.equal(fresh({path,bytes:current,record:report.sources[path],report}),'ui-monaco-virtual-model-lifecycle');
    assert.equal(fresh({path,bytes:before,record:report.sources[path],report}),'raw');
    assert.deepEqual(read(name),bytes);
  }
});

test('future editor edits, other source paths and detached measurement hashes receive no exception',() => {
  const current = read('docs/' + path), changed = Buffer.from(current);
  changed[Math.floor(changed.length/2)] ^= 1;
  for (const bytes of [changed,Buffer.concat([current,Buffer.from('\n')]),Buffer.from("import './future-audio.js';\n" + current)]) {
    assert.equal(restore(path,bytes),bytes);
    assert.throws(() => fresh({path,bytes,record:receipt.before}),/remeasure/);
  }
  for (const other of ['docs/' + path,'__proto__','playground/another-viewer.js','js/ym2608synth.js','generated/ym2608_wasm.wasm']) {
    assert.equal(restore(other,current),current);
    assert.throws(() => fresh({path:other,bytes:current,record:receipt.before}));
  }
  for (const record of [undefined,{}, {...receipt.before,bytes:1},{...receipt.before,sha256:'0'.repeat(64)}]) {
    assert.throws(() => fresh({path,bytes:current,record}));
  }
});

test('edited historical measurement bytes cannot authorize the reviewed editor change',() => {
  const current = read('docs/' + path);
  for (const target of reports) {
    assert.throws(() => restore(path,current,{readSource(url) {
      const bytes = readFileSync(url);
      return url.pathname.endsWith('/' + target) ? Buffer.concat([bytes,Buffer.from([0])]) : bytes;
    }}),/original measurement changed/);
  }
});
