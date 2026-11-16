/** Preserve historical dependency checks after a complete measured policy
 * update. Only the exact generated npm policy can reconstruct its predecessor.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {restoreMixerCalibrationAySingleOutputPolicyRevision} from './mixer_calibration_ay_single_output_policy_revision.mjs';

export const MEASURED_POLICY_REVISION_RECEIPT_PATH = 'docs/issues/spc_voice_edit_mixer_policy_revision_01.json';
export const MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256 = 'ab1701112defa1016f19a2bdd82c3d3edf28ad4b2c3cc3892a01e7cf84086e1f';
export const MEASURED_POLICY_REVISION_SOURCE_PATH = 'tetorica_src/runtime/soundchip_mixer_presets.js';
export const MEASURED_POLICY_REVISION_REPORT_PATHS = Object.freeze(
  ['ps1','wonderswan','pokey','scsp'].flatMap(kind => [
    `docs/issues/${kind}_spc_voice_edit_chip_levels_01.json`,
    `docs/issues/${kind}_spc_voice_edit_chip_levels_verify_01.json`,
  ]),
);
const previousPath = 'docs/issues/ps1_vab_public_api_source_revision_01.json';
const previousPin = 'c6acbc62409a143a87b559c0e255395e294338fe19f1067eb664a947ce34c6c3';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => value && Number.isSafeInteger(value.bytes) && value.bytes > 0
  && /^[0-9a-f]{64}$/.test(value.sha256);
const fail = message => {throw Error('Invalid measured Mixer policy revision: ' + message);};
let receipt;

function verifiedReceipt() {
  if (receipt) return receipt;
  const value = JSON.parse(readFileSync(new URL('../' + MEASURED_POLICY_REVISION_RECEIPT_PATH, import.meta.url), 'utf8'));
  if (sha(JSON.stringify(value)) !== MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256) fail('independent receipt pin mismatch');
  if (value.schemaVersion !== 1 || value.scope !== 'complete-spc-voice-edit-mixer-remeasurement'
    || value.path !== MEASURED_POLICY_REVISION_SOURCE_PATH
    || JSON.stringify(Object.keys(value.reports ?? {})) !== JSON.stringify(MEASURED_POLICY_REVISION_REPORT_PATHS)
    || !record(value.before) || !record(value.after) || typeof value.beforeText !== 'string') fail('exact source/report inventory mismatch');
  const previous = JSON.parse(readFileSync(new URL('../' + previousPath, import.meta.url), 'utf8'));
  if (sha(JSON.stringify(previous)) !== previousPin
    || JSON.stringify(value.before) !== JSON.stringify(previous.relatedSources[value.path].after)) fail('historical policy predecessor changed');
  const before = Buffer.from(value.beforeText);
  if (before.length !== value.before.bytes || sha(before) !== value.before.sha256) fail('historical policy bytes changed');
  receipt = value;
  return receipt;
}

export function restoreMixerCalibrationMeasuredPolicyRevision(path, bytes, {readSource = url => readFileSync(url)} = {}) {
  if (path !== MEASURED_POLICY_REVISION_SOURCE_PATH) return bytes;
  bytes = restoreMixerCalibrationAySingleOutputPolicyRevision(path,bytes,{readSource});
  const evidence = verifiedReceipt();
  if (bytes.length !== evidence.after.bytes || sha(bytes) !== evidence.after.sha256) return bytes;
  for (const path of MEASURED_POLICY_REVISION_REPORT_PATHS) {
    const actual = readSource(new URL('../' + path, import.meta.url)), expected = evidence.reports[path];
    if (!record(expected) || actual.length !== expected.bytes || sha(actual) !== expected.sha256) fail('complete measurement changed: ' + path);
  }
  return Buffer.from(evidence.beforeText);
}
