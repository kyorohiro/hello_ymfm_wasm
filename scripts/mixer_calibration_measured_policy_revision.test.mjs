import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {renderSoundChipMixerPresets} from './generate_soundchip_mixer_presets.mjs';
import {MEASURED_POLICY_REVISION_RECEIPT_PATH as receiptPath,
  MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256 as pin,
  MEASURED_POLICY_REVISION_SOURCE_PATH as path,
  MEASURED_POLICY_REVISION_REPORT_PATHS as reports,
  restoreMixerCalibrationMeasuredPolicyRevision as restore} from './mixer_calibration_measured_policy_revision.mjs';

const read = path => readFileSync(new URL('../' + path,import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = JSON.parse(read(receiptPath));

test('the exact generated policy is tied to complete new measured and verified results', () => {
  assert.equal(sha(JSON.stringify(receipt)),pin);
  const current = read(path), previous = restore(path,current);
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
  assert.equal(current.toString(),served,'The served mirror retains its existing declaration URL and the same measured policy');
});

test('future policy edits, unrelated paths and changed measurement evidence cannot use the exact predecessor', () => {
  const current = read(path), byteEdit = Buffer.from(current);
  byteEdit[Math.floor(byteEdit.length/2)] ^= 1;
  for (const bytes of [byteEdit,Buffer.concat([current,Buffer.from('\n')])]) assert.equal(restore(path,bytes),bytes);
  for (const other of ['docs/js/soundchip_mixer_presets.js','docs/playground/playground_mixer_defaults.js','js/spc.js','generated/spc_wasm.wasm','__proto__'])
    assert.equal(restore(other,current),current);
  for (const target of reports) assert.throws(() => restore(path,current,{readSource(url) {
    const bytes = readFileSync(url);
    return url.pathname.endsWith('/' + target) ? Buffer.concat([bytes,Buffer.from('\n')]) : bytes;
  }}),/complete measurement changed/);
});
