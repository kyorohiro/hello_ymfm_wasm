// SPDX-License-Identifier: BSD-3-Clause
// Reconstruct the reviewed predecessor for host preparation budget changes.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const WONDERSWAN_HOST_BUDGET_REVISION_BASE_COMMIT =
  '2c7d6a5be230eb7cf9040e6e7841da0046c897a2';
export const WONDERSWAN_HOST_BUDGET_REVISION_RECEIPT_PATH =
  'docs/issues/wonderswan_host_budget_source_revision_01.json';
export const WONDERSWAN_HOST_BUDGET_REVISION_RECEIPT_OBJECT_SHA256 =
  'b189c018133996b991913c319f4ca33bb2a5d91f1f920afb5cfbca3fa9eace00';
export const WONDERSWAN_HOST_BUDGET_REVISION_SOURCE_PATHS = Object.freeze([
  'tetorica_src/runtime/wonderswan_timeline.js',
  'docs/js/wonderswan_timeline.js',
  'docs/playground/wonderswan_vgm_import.js',
]);
export const WONDERSWAN_HOST_BUDGET_REVISION_REPORT_PATHS = Object.freeze(
  ['ps1', 'wonderswan', 'pokey', 'scsp'].map(
    (kind) => `docs/issues/${kind}_spc_voice_edit_chip_levels_01.json`,
  ),
);
export const WONDERSWAN_HOST_BUDGET_REVISION_RELATED_PATHS = Object.freeze([
  'docs/issues/aswan_epilogue_native_20261116.json',
  'docs/generated/wonderswan_wasm.js',
  'docs/generated/wonderswan_wasm.wasm',
  'tetorica_src/runtime/wonderswansynth.js',
  'docs/js/wonderswansynth.js',
  'tetorica_src/runtime/playground_wonderswan_worklet.js',
  'docs/js/playground_wonderswan_worklet.js',
  'tetorica_src/runtime/playground_wonderswan.js',
  'docs/js/playground_wonderswan.js',
  'tetorica_src/runtime/native_genesis_wonderswan.js',
  'docs/js/native_genesis_wonderswan.js',
  'test/runtime/wonderswan_timeline.test.mjs',
  'test/runtime/playground_wonderswan_timeline.test.mjs',
  'docs/playground/wonderswan_vgm_import.test.mjs',
  'docs/synth-aswan/large_vgm.test.mjs',
  'test/helpers/wonderswan_large_vgm_fixture.mjs',
  'test/helpers/wonderswan_vgm_fixture.mjs',
  'docs/issues/aswan_host_budget_offline_20261116.json',
]);
const aliases = Object.freeze({
  'js/wonderswan_timeline.js': 'docs/js/wonderswan_timeline.js',
  'playground/wonderswan_vgm_import.js': 'docs/playground/wonderswan_vgm_import.js',
});
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const record = (value) =>
  value &&
  Number.isSafeInteger(value.bytes) &&
  value.bytes > 0 &&
  /^[0-9a-f]{64}$/.test(value.sha256);
const keys = (value, names) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
const fail = (message) => {
  throw new Error(
    'Invalid WonderSwan host budget calibration revision; review source evidence: ' + message,
  );
};
let cached;

function verifiedReceipt() {
  if (cached) return cached;
  const value = JSON.parse(
    readFileSync(
      new URL('../' + WONDERSWAN_HOST_BUDGET_REVISION_RECEIPT_PATH, import.meta.url),
      'utf8',
    ),
  );
  if (sha(JSON.stringify(value)) !== WONDERSWAN_HOST_BUDGET_REVISION_RECEIPT_OBJECT_SHA256)
    fail('receipt does not match its independently pinned SHA');
  if (
    value.schemaVersion !== 1 ||
    value.scope !== 'wonderswan-host-preparation-budget' ||
    value.baseCommit !== WONDERSWAN_HOST_BUDGET_REVISION_BASE_COMMIT ||
    !keys(value.sources, WONDERSWAN_HOST_BUDGET_REVISION_SOURCE_PATHS) ||
    !keys(value.reports, WONDERSWAN_HOST_BUDGET_REVISION_REPORT_PATHS) ||
    !keys(value.related, WONDERSWAN_HOST_BUDGET_REVISION_RELATED_PATHS)
  )
    fail('scope or exact path inventory mismatch');
  if (
    value.constraints?.defaultTimelineBytes !== 8 * 1024 * 1024 ||
    value.constraints.maximumHostTimelineBytes !== 32 * 1024 * 1024 ||
    value.constraints.maximumWritesPerQuantum !== 512
  )
    fail('preparation or callback limits changed');
  for (const group of ['reports', 'related'])
    for (const [path, entry] of Object.entries(value[group]))
      if (!record(entry)) fail('invalid dependency record: ' + path);
  for (const [path, entry] of Object.entries(value.sources)) {
    if (
      !record(entry?.before) ||
      !record(entry.after) ||
      !Array.isArray(entry.reverseHunks) ||
      !entry.reverseHunks.length
    )
      fail('invalid predecessor/source pair: ' + path);
    let cursor = 0;
    for (const hunk of entry.reverseHunks) {
      if (
        !keys(hunk, ['afterOffset', 'afterBytes', 'beforeText']) ||
        !Number.isSafeInteger(hunk.afterOffset) ||
        hunk.afterOffset < cursor ||
        !Number.isSafeInteger(hunk.afterBytes) ||
        hunk.afterBytes < 0 ||
        hunk.afterOffset + hunk.afterBytes > entry.after.bytes ||
        typeof hunk.beforeText !== 'string'
      )
        fail('invalid reverse hunk: ' + path);
      cursor = hunk.afterOffset + hunk.afterBytes;
    }
  }
  cached = value;
  return value;
}

function checkedDependency(path, expected, readSource) {
  const bytes = readSource(new URL('../' + path, import.meta.url));
  if (bytes.length !== expected.bytes || sha(bytes) !== expected.sha256)
    fail('dependency changed: ' + path);
  return bytes;
}

/** Match a complete reviewed source, verify its evidence, then reconstruct its
 * complete predecessor. Other source bytes keep their existing freshness path.
 */
export function restoreMixerCalibrationWonderSwanHostBudgetRevision(
  path,
  bytes,
  { readSource = (url) => readFileSync(url) } = {},
) {
  const sourcePath = Object.hasOwn(aliases, path) ? aliases[path] : path;
  if (!WONDERSWAN_HOST_BUDGET_REVISION_SOURCE_PATHS.includes(sourcePath)) return bytes;
  const receipt = verifiedReceipt(),
    entry = receipt.sources[sourcePath];
  if (Buffer.byteLength(bytes) !== entry.after.bytes || sha(bytes) !== entry.after.sha256)
    return bytes;
  for (const source of WONDERSWAN_HOST_BUDGET_REVISION_SOURCE_PATHS)
    checkedDependency(source, receipt.sources[source].after, readSource);
  for (const report of WONDERSWAN_HOST_BUDGET_REVISION_REPORT_PATHS)
    checkedDependency(report, receipt.reports[report], readSource);
  for (const related of WONDERSWAN_HOST_BUDGET_REVISION_RELATED_PATHS)
    checkedDependency(related, receipt.related[related], readSource);
  const proof = JSON.parse(readSource(new URL('../' + receipt.nativeProof.path, import.meta.url)));
  if (
    proof.passed !== true ||
    proof.fullPlayback?.exactStereoMatch !== true ||
    proof.frames !== receipt.nativeProof.frames ||
    proof.events !== receipt.nativeProof.events ||
    proof.extraction?.voices !== receipt.nativeProof.voices
  )
    fail('full-song native comparison is incomplete');
  const calibration = JSON.parse(
    readSource(new URL('../' + receipt.defaultCalibrationProof.path, import.meta.url)),
  );
  if (
    calibration.passed !== true ||
    calibration.routes?.length !== receipt.defaultCalibrationProof.routes ||
    calibration.nativeMaximumDifference !== 0 ||
    calibration.audioContextCreated !== false
  )
    fail('default calibration comparison is incomplete');
  const source = Buffer.from(bytes),
    parts = [];
  let cursor = 0;
  for (const hunk of entry.reverseHunks) {
    parts.push(source.subarray(cursor, hunk.afterOffset), Buffer.from(hunk.beforeText));
    cursor = hunk.afterOffset + hunk.afterBytes;
  }
  parts.push(source.subarray(cursor));
  const original = Buffer.concat(parts);
  if (original.length !== entry.before.bytes || sha(original) !== entry.before.sha256)
    fail('complete predecessor reconstruction failed: ' + path);
  return original;
}
