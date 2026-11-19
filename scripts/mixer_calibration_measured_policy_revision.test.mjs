import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from '../test/helpers/historical_huc_timed_calibration_inputs.mjs';
const {restoreMixerCalibrationAySingleOutputPolicyRevision:restoreLatest}=await historicalCalibrationModule('mixer_calibration_ay_single_output_policy_revision.mjs');
import {renderSoundChipMixerPresets} from './generate_soundchip_mixer_presets.mjs';
const {createYm2608SourceMixPolicyReader}=await historicalCalibrationModule('mixer_calibration_ym2608_source_mix_policy_revision.mjs');
const {MEASURED_POLICY_REVISION_RECEIPT_PATH:receiptPath,
  MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256:pin,
  MEASURED_POLICY_REVISION_SOURCE_PATH:path,
  MEASURED_POLICY_REVISION_REPORT_PATHS:reports,
  restoreMixerCalibrationMeasuredPolicyRevision:restore}=await historicalCalibrationModule('mixer_calibration_measured_policy_revision.mjs');

const policyHistory=createYm2608SourceMixPolicyReader();
const read = path => policyHistory(new URL('../' + path,import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = JSON.parse(read(receiptPath));

test('the historical SPC generated policy remains tied to its exact measured and verified results', () => {
  assert.equal(sha(JSON.stringify(receipt)),pin);
  const current = restoreLatest(path,read(path)), previous = restore(path,current);
  assert.equal(previous.length,receipt.before.bytes);
  assert.equal(sha(previous),receipt.before.sha256);
  assert.equal(restore(path,previous),previous,'Historical policy needs no exception');
  const baseline = JSON.parse(read('docs/issues/playground_chip_levels_01.json'));
  const psg = JSON.parse(read('docs/issues/soundchip_psg_levels_05.json'));
  const measured = [];
  for (const path of reports) {
    const bytes = read(path), report = JSON.parse(bytes);
    assert.equal(bytes.length,receipt.reports[path].bytes);
    assert.equal(sha(bytes),receipt.reports[path].sha256);
    assert(report.passed && report.completeCoverage && report.pcmContinuous,path);
    if (!report.verify) measured.push(report);
  }
  assert.equal(current.toString(),renderSoundChipMixerPresets(baseline,psg,...measured));
  const served=read('docs/js/soundchip_mixer_presets.js').toString()
    .replace("import('./soundchip_mixer.js?v=y8950-adpcm-ui-1')","import('./soundchip_mixer.js')");
  assert.equal(current.toString(),restoreLatest(path,Buffer.from(served)).toString(),'The served mirror retains its declaration URL and exact historical predecessor');
});

test('future policy edits, unrelated paths and changed measurement evidence cannot use the exact predecessor', () => {
  const current = restoreLatest(path,read(path)), byteEdit = Buffer.from(current);
  byteEdit[Math.floor(byteEdit.length/2)] ^= 1;
  for (const bytes of [byteEdit,Buffer.concat([current,Buffer.from('\n')])]) assert.equal(restore(path,bytes),bytes);
  for (const other of ['docs/js/soundchip_mixer_presets.js','docs/playground/playground_mixer_defaults.js','js/spc.js','generated/spc_wasm.wasm','__proto__'])
    assert.equal(restore(other,current),current);
  for (const target of reports) assert.throws(() => restore(path,current,{readSource(url) {
    const bytes = readFileSync(url);
    return url.pathname.endsWith('/' + target) ? Buffer.concat([bytes,Buffer.from('\n')]) : bytes;
  }}),/complete measurement changed/);
});
