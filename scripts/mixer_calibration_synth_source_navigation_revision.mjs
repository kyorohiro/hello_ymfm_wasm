/** Exact passive implementation-viewer revisions for the S-DSP and FM2608
 * Code editors. Restore their complete reviewed predecessors before the older
 * HuC6280 and VAB layers. Audio sources and measurements retain their hashes.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {restoreMixerCalibrationFm2608NavigationRevision} from './mixer_calibration_fm2608_navigation_revision.mjs';
import {
  HUC6280_UI_REVISION_RECEIPT_PATH,
  HUC6280_UI_REVISION_RECEIPT_OBJECT_SHA256,
  HUC6280_UI_REVISION_SOURCE_PATHS,
  HUC6280_UI_REVISION_REPORT_PATHS,
} from './mixer_calibration_huc6280_ui_revision.mjs';

export const SYNTH_SOURCE_NAVIGATION_BASE_COMMIT = '5999ed7da221c20699b26b8cab296c013b504baf';
export const SYNTH_SOURCE_NAVIGATION_RECEIPT_PATH = 'docs/issues/synth_source_navigation_ui_revision_01.json';
export const SYNTH_SOURCE_NAVIGATION_RECEIPT_OBJECT_SHA256 = 'bf5720c41db9bb678de125271bbc872d7844d6e6a320ac34b7028376125968c6';
export const SYNTH_SOURCE_NAVIGATION_SOURCE_PATHS = HUC6280_UI_REVISION_SOURCE_PATHS;
export const SYNTH_SOURCE_NAVIGATION_REPORT_PATHS = HUC6280_UI_REVISION_REPORT_PATHS;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const record = value => value && Number.isSafeInteger(value.bytes) && value.bytes > 0
  && /^[0-9a-f]{64}$/.test(value.sha256);
const fail = message => { throw Error('Invalid Synth source-navigation calibration revision: ' + message); };
let cached;

function verifiedReceipt() {
  if (cached) return cached;
  const receipt = JSON.parse(readFileSync(new URL('../' + SYNTH_SOURCE_NAVIGATION_RECEIPT_PATH, import.meta.url), 'utf8'));
  if (sha(JSON.stringify(receipt)) !== SYNTH_SOURCE_NAVIGATION_RECEIPT_OBJECT_SHA256) fail('independent receipt pin mismatch');
  if (receipt.schemaVersion !== 1 || receipt.scope !== 'synth-passive-implementation-source-navigation'
    || receipt.baseCommit !== SYNTH_SOURCE_NAVIGATION_BASE_COMMIT
    || !keys(receipt.sources, SYNTH_SOURCE_NAVIGATION_SOURCE_PATHS)
    || !keys(receipt.reports, SYNTH_SOURCE_NAVIGATION_REPORT_PATHS)) fail('scope or exact inventory mismatch');
  const predecessor = JSON.parse(readFileSync(new URL('../' + HUC6280_UI_REVISION_RECEIPT_PATH, import.meta.url), 'utf8'));
  if (sha(JSON.stringify(predecessor)) !== HUC6280_UI_REVISION_RECEIPT_OBJECT_SHA256) fail('predecessor receipt pin mismatch');
  if (JSON.stringify(receipt.reports) !== JSON.stringify(predecessor.reports)) fail('historical report identities changed');
  for (const path of SYNTH_SOURCE_NAVIGATION_SOURCE_PATHS) {
    const entry = receipt.sources[path], prior = predecessor.sources[path]?.after;
    if (!record(entry?.before) || !record(entry.after) || JSON.stringify(entry.before) !== JSON.stringify(prior)
      || !Array.isArray(entry.reverseHunks) || !entry.reverseHunks.length) fail('invalid complete source pair: ' + path);
    let cursor = 0;
    for (const hunk of entry.reverseHunks) {
      if (!keys(hunk, ['afterOffset', 'afterBytes', 'beforeText'])
        || !Number.isSafeInteger(hunk.afterOffset) || hunk.afterOffset < cursor
        || !Number.isSafeInteger(hunk.afterBytes) || hunk.afterBytes < 0
        || hunk.afterOffset + hunk.afterBytes > entry.after.bytes || typeof hunk.beforeText !== 'string') fail('invalid reverse hunk: ' + path);
      cursor = hunk.afterOffset + hunk.afterBytes;
    }
  }
  cached = receipt;
  return receipt;
}

export function restoreMixerCalibrationSynthSourceNavigationRevision(path, bytes, {readSource = url => readFileSync(url)} = {}) {
  if (!SYNTH_SOURCE_NAVIGATION_SOURCE_PATHS.includes(path)) return bytes;
  bytes = restoreMixerCalibrationFm2608NavigationRevision(path,bytes,{readSource});
  const receipt = verifiedReceipt(), entry = receipt.sources[path];
  if (Buffer.byteLength(bytes) !== entry.after.bytes || sha(bytes) !== entry.after.sha256) return bytes;
  for (const report of SYNTH_SOURCE_NAVIGATION_REPORT_PATHS) {
    const original = readSource(new URL('../' + report, import.meta.url)), expected = receipt.reports[report];
    if (!record(expected) || original.length !== expected.bytes || sha(original) !== expected.sha256) fail('original measurement changed: ' + report);
  }
  const source = Buffer.from(bytes), parts = [];
  let cursor = 0;
  for (const hunk of entry.reverseHunks) {
    parts.push(source.subarray(cursor, hunk.afterOffset), Buffer.from(hunk.beforeText));
    cursor = hunk.afterOffset + hunk.afterBytes;
  }
  parts.push(source.subarray(cursor));
  const original = Buffer.concat(parts);
  if (original.length !== entry.before.bytes || sha(original) !== entry.before.sha256) fail('complete predecessor reconstruction failed: ' + path);
  return original;
}
