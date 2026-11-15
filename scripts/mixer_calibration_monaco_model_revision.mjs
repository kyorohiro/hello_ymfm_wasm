/** One exact editor-model lifecycle revision over the measured Monaco source.
 * Reconstruct its complete predecessor before the historical UI review chain.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  MEASURED_POLICY_REVISION_RECEIPT_PATH,
  MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256,
  MEASURED_POLICY_REVISION_REPORT_PATHS,
} from './mixer_calibration_measured_policy_revision.mjs';

export const MONACO_MODEL_REVISION_SOURCE_PATH = 'playground/playground_monaco.js';
export const MONACO_MODEL_REVISION_BASE_COMMIT = 'b15ff8e97487729f193b32ac488c49de5fe27d71';
export const MONACO_MODEL_REVISION_RECEIPT_PATH = 'docs/issues/monaco_virtual_models_ui_revision_01.json';
export const MONACO_MODEL_REVISION_RECEIPT_OBJECT_SHA256 = '86d4a56739dccc6745f04d4628f6476a76d7ff4c2aab74c213dcb016bdde66e2';
export const MONACO_MODEL_REVISION_REPORT_PATHS = MEASURED_POLICY_REVISION_REPORT_PATHS;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => value && Number.isSafeInteger(value.bytes) && value.bytes > 0
  && /^[0-9a-f]{64}$/.test(value.sha256);
const fail = message => {throw Error('Invalid Monaco virtual-model UI revision: ' + message);};
let receipt;

function verifiedReceipt() {
  if (receipt) return receipt;
  const value = JSON.parse(readFileSync(new URL('../' + MONACO_MODEL_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
  if (sha(JSON.stringify(value)) !== MONACO_MODEL_REVISION_RECEIPT_OBJECT_SHA256) fail('independent receipt pin mismatch');
  const measurements = JSON.parse(readFileSync(new URL('../' + MEASURED_POLICY_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
  if (sha(JSON.stringify(measurements)) !== MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256) fail('measurement receipt pin mismatch');
  if (value.schemaVersion !== 1 || value.scope !== 'monaco-passive-virtual-model-lifecycle'
    || value.path !== MONACO_MODEL_REVISION_SOURCE_PATH || value.baseCommit !== MONACO_MODEL_REVISION_BASE_COMMIT
    || !record(value.before) || !record(value.after)
    || JSON.stringify(value.reports) !== JSON.stringify(measurements.reports)
    || !Array.isArray(value.reverseHunks) || !value.reverseHunks.length) fail('exact source/report inventory mismatch');
  let cursor = 0;
  for (const hunk of value.reverseHunks) {
    if (!hunk || Object.keys(hunk).length !== 3
      || !Number.isSafeInteger(hunk.afterOffset) || hunk.afterOffset < cursor
      || !Number.isSafeInteger(hunk.afterBytes) || hunk.afterBytes < 0
      || hunk.afterOffset + hunk.afterBytes > value.after.bytes
      || typeof hunk.beforeText !== 'string') fail('invalid reverse hunk');
    cursor = hunk.afterOffset + hunk.afterBytes;
  }
  receipt = value;
  return receipt;
}

export function restoreMixerCalibrationMonacoModelRevision(path,bytes,{readSource = url => readFileSync(url)} = {}) {
  if (path !== MONACO_MODEL_REVISION_SOURCE_PATH) return bytes;
  const evidence = verifiedReceipt();
  if (bytes.length !== evidence.after.bytes || sha(bytes) !== evidence.after.sha256) return bytes;
  for (const name of MONACO_MODEL_REVISION_REPORT_PATHS) {
    const original = readSource(new URL('../' + name,import.meta.url)), expected = evidence.reports[name];
    if (!record(expected) || original.length !== expected.bytes || sha(original) !== expected.sha256) fail('original measurement changed: ' + name);
    if (JSON.stringify(JSON.parse(original).sources[path]) !== JSON.stringify(evidence.before)) fail('measured predecessor changed: ' + name);
  }
  const source = Buffer.from(bytes), parts = [];
  let cursor = 0;
  for (const hunk of evidence.reverseHunks) {
    parts.push(source.subarray(cursor,hunk.afterOffset),Buffer.from(hunk.beforeText));
    cursor = hunk.afterOffset + hunk.afterBytes;
  }
  parts.push(source.subarray(cursor));
  const original = Buffer.concat(parts);
  if (original.length !== evidence.before.bytes || sha(original) !== evidence.before.sha256) fail('complete measured predecessor reconstruction failed');
  return original;
}
