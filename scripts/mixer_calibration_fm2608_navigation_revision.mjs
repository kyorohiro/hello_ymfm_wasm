/** Exact passive hardware-method links added after the complete measurements.
 * The intermediate source must match every new measured source fingerprint.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {MEASURED_POLICY_REVISION_RECEIPT_PATH,MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256,
  MEASURED_POLICY_REVISION_REPORT_PATHS} from './mixer_calibration_measured_policy_revision.mjs';

export const FM2608_NAVIGATION_REVISION_PATH = 'playground/playground_monaco_definitions.js';
export const FM2608_NAVIGATION_REVISION_RECEIPT_PATH = 'docs/issues/fm2608_hardware_navigation_ui_revision_01.json';
export const FM2608_NAVIGATION_REVISION_RECEIPT_OBJECT_SHA256 = '2d64fcde3b7e0dc9038ac0b1b32cf969fa4954b63eb8262bc1f046553baa26c4';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => value && Number.isSafeInteger(value.bytes) && value.bytes > 0 && /^[0-9a-f]{64}$/.test(value.sha256);
const fail = message => {throw Error('Invalid FM2608 hardware-navigation revision: ' + message);};
let receipt;

export function restoreMixerCalibrationFm2608NavigationRevision(path,bytes,{readSource = url => readFileSync(url)} = {}) {
  if (path !== FM2608_NAVIGATION_REVISION_PATH) return bytes;
  if (!receipt) {
    const value=JSON.parse(readFileSync(new URL('../' + FM2608_NAVIGATION_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
    if (sha(JSON.stringify(value)) !== FM2608_NAVIGATION_REVISION_RECEIPT_OBJECT_SHA256) fail('independent receipt pin mismatch');
    const measurements=JSON.parse(readFileSync(new URL('../' + MEASURED_POLICY_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
    if (sha(JSON.stringify(measurements)) !== MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256) fail('measurement receipt pin mismatch');
    if (value.schemaVersion !== 1 || value.scope !== 'fm2608-passive-hardware-source-navigation' || value.path !== path
      || !record(value.before) || !record(value.after) || typeof value.removedText !== 'string'
      || !Number.isSafeInteger(value.afterOffset) || value.afterOffset < 0
      || value.afterOffset + Buffer.byteLength(value.removedText) > value.after.bytes
      || JSON.stringify(value.reports) !== JSON.stringify(measurements.reports)) fail('exact source/report inventory mismatch');
    receipt=value;
  }
  if (bytes.length !== receipt.after.bytes || sha(bytes) !== receipt.after.sha256) return bytes;
  for (const path of MEASURED_POLICY_REVISION_REPORT_PATHS) {
    const actual=readSource(new URL('../' + path,import.meta.url)), expected=receipt.reports[path];
    if (!record(expected) || actual.length !== expected.bytes || sha(actual) !== expected.sha256) fail('original measurement changed: ' + path);
    if (JSON.stringify(JSON.parse(actual).sources[receipt.path]) !== JSON.stringify(receipt.before)) fail('measured intermediate source changed');
  }
  const start=receipt.afterOffset,end=start+Buffer.byteLength(receipt.removedText);
  if (bytes.subarray(start,end).toString() !== receipt.removedText) fail('exact passive insertion changed');
  const original=Buffer.concat([bytes.subarray(0,start),bytes.subarray(end)]);
  if (original.length !== receipt.before.bytes || sha(original) !== receipt.before.sha256) fail('measured intermediate reconstruction failed');
  return original;
}
