/** Reviewed additive AY timed-operation API and its shared default paths.
 * Exact predecessor reconstruction retains the original measurement identities.
 * Queue/processor compatibility is verified separately by offline trace tests.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {restoreMixerCalibrationLogTableCacheRevision} from './mixer_calibration_log_table_cache_revision.mjs';
import {restoreMixerCalibrationYm2612TimedRevision, createYm2612TimedRevisionReader} from './mixer_calibration_ym2612_timed_revision.mjs';
import {createScspDspHelpersRevisionReadContext} from './mixer_calibration_scsp_dsp_helpers_revision.mjs';

export const AY_TIMED_REVISION_BASE_COMMIT = '6663c6d5a286f10ff08f16645953a0083dabd34b';
export const AY_TIMED_REVISION_RECEIPT_PATH = 'docs/issues/ay_timed_operations_source_revision_01.json';
export const AY_TIMED_REVISION_RECEIPT_OBJECT_SHA256 = '60a478df985829768973086775165ef1ff3138962e365f85fa8e80d2f7e17688';

const runtimeNames = Object.freeze([
  'native_genesis_extra_ay8910.js', 'native_genesis_msx.js', 'native_runtime_synth.js',
  'playground_ay8910.js', 'playground_ay8910_audio.js', 'playground_ay8910_worklet.js',
  'playground_code_runtime.js', 'playground_log.js', 'playground_logic_worker.js',
  'playground_performance_processor.js', 'playground_performance_queue.js',
  'playground_performance_sender.js', 'playground_runtime.js',
]);
export const AY_TIMED_REVISION_SOURCE_PATHS = Object.freeze([
  ...runtimeNames.flatMap(name => ['tetorica_src/runtime/' + name, 'docs/js/' + name]),
  'docs/playground/playground_monaco_definitions.js',
  'docs/playground/tetorica-playground-globals.d.ts',
]);
export const AY_TIMED_REVISION_RELATED_PATHS = Object.freeze([
  'ay8910_operations.js', 'ay8910_timed_state.js', 'ay8910_timed_client.js',
  'ay8910_timed_processor.js', 'playground_ay_timed_lifecycle.js',
  'ay8910synth.js', 'ay8910.js', 'soundchip_pitch.js', 'playground_chip_clock.js',
].flatMap(name => ['tetorica_src/runtime/' + name, 'docs/js/' + name]));
export const AY_TIMED_REVISION_REPORT_PATHS = Object.freeze([
  ...['ps1', 'wonderswan', 'pokey', 'scsp'].flatMap(kind =>
    (kind === 'pokey' || kind === 'scsp' ? ['01', 'verify_01'] : ['01'])
      .map(suffix => `docs/issues/${kind}_ay_single_output_chip_levels_${suffix}.json`)),
]);

const read = url => readFileSync(url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => value && Number.isSafeInteger(value.bytes) && value.bytes > 0 &&
  /^[0-9a-f]{64}$/.test(value.sha256);
const matches = (bytes, expected) => record(expected) &&
  Buffer.byteLength(bytes) === expected.bytes && sha(bytes) === expected.sha256;
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const fail = message => { throw Error('Invalid exact AY timed-operation calibration revision: ' + message); };

function evidence(readSource) {
  const receipt = JSON.parse(readSource(new URL('../' + AY_TIMED_REVISION_RECEIPT_PATH, import.meta.url)));
  if (sha(JSON.stringify(receipt)) !== AY_TIMED_REVISION_RECEIPT_OBJECT_SHA256) {
    fail('independently pinned receipt changed');
  }
  if (receipt.schemaVersion !== 1 || receipt.scope !== 'ay-timed-operation-api-and-default-path-compatibility' ||
      receipt.baseCommit !== AY_TIMED_REVISION_BASE_COMMIT ||
      !keys(receipt.sources, AY_TIMED_REVISION_SOURCE_PATHS) ||
      !keys(receipt.relatedSources, AY_TIMED_REVISION_RELATED_PATHS) ||
      !keys(receipt.reports, AY_TIMED_REVISION_REPORT_PATHS)) {
    fail('source, report or dependency inventory changed');
  }
  for (const path of AY_TIMED_REVISION_SOURCE_PATHS) {
    const entry = receipt.sources[path];
    if (!record(entry?.before) || !record(entry.after) || !Array.isArray(entry.reverseHunks) || !entry.reverseHunks.length) {
      fail('incomplete predecessor/source pair: ' + path);
    }
    let cursor = 0;
    for (const hunk of entry.reverseHunks) {
      if (!keys(hunk, ['afterOffset', 'afterBytes', 'beforeText']) ||
          !Number.isSafeInteger(hunk.afterOffset) || hunk.afterOffset < cursor ||
          !Number.isSafeInteger(hunk.afterBytes) || hunk.afterBytes < 0 ||
          hunk.afterOffset + hunk.afterBytes > entry.after.bytes || typeof hunk.beforeText !== 'string') {
        fail('invalid predecessor hunk: ' + path);
      }
      cursor = hunk.afterOffset + hunk.afterBytes;
    }
  }
  for (const path of [...AY_TIMED_REVISION_RELATED_PATHS, ...AY_TIMED_REVISION_REPORT_PATHS]) {
    if (!record(receipt.relatedSources[path] ?? receipt.reports[path])) fail('invalid dependency record: ' + path);
  }
  return receipt;
}

function sourceName(path) {
  if (typeof path !== 'string') return path;
  if (path.startsWith('web/')) return 'tetorica_src/runtime/' + path.slice(4);
  if (path.startsWith('js/') || path.startsWith('playground/')) return 'docs/' + path;
  return path;
}

/** Reconstruct only exact reviewed bodies after authenticating their complete
 * feature graph. Other edits remain subject to the caller's source hash check.
 */
export function restoreMixerCalibrationAyTimedRevision(path, bytes, {readSource = read} = {}) {
  const latest = createScspDspHelpersRevisionReadContext(readSource);
  bytes = latest.restore(path, bytes); readSource = latest.readSource;
  const name = sourceName(path);
  bytes = restoreMixerCalibrationYm2612TimedRevision(name, bytes, {readSource});
  readSource = createYm2612TimedRevisionReader(readSource);
  if (!AY_TIMED_REVISION_SOURCE_PATHS.includes(name)) return bytes;
  const receipt = evidence(readSource), entry = receipt.sources[name];
  const reviewed = restoreMixerCalibrationLogTableCacheRevision(name, bytes, {readSource});
  if (!matches(reviewed, entry.after)) return bytes;
  for (const dependency of [
    ...AY_TIMED_REVISION_SOURCE_PATHS, ...AY_TIMED_REVISION_RELATED_PATHS, ...AY_TIMED_REVISION_REPORT_PATHS,
  ]) {
    const expected = receipt.sources[dependency]?.after ?? receipt.relatedSources[dependency] ?? receipt.reports[dependency];
    const current = restoreMixerCalibrationLogTableCacheRevision(dependency,
      readSource(new URL('../' + dependency, import.meta.url)), {readSource});
    if (!matches(current, expected)) {
      fail('pinned source/report dependency changed: ' + dependency);
    }
  }
  const current = Buffer.from(reviewed), parts = [];
  let cursor = 0;
  for (const hunk of entry.reverseHunks) {
    parts.push(current.subarray(cursor, hunk.afterOffset), Buffer.from(hunk.beforeText));
    cursor = hunk.afterOffset + hunk.afterBytes;
  }
  parts.push(current.subarray(cursor));
  const original = Buffer.concat(parts);
  if (!matches(original, entry.before)) fail('complete predecessor reconstruction failed: ' + name);
  return original;
}
