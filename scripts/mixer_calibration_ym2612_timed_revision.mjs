/** Exact reviewed YM2612 operation API and unchanged immediate audio path.
 * Restore complete predecessor bytes before older calibration evidence layers;
 * keep every measured source identity, sample and Mixer gain unchanged. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createScspDspHelpersRevisionReadContext} from './mixer_calibration_scsp_dsp_helpers_revision.mjs';

export const YM2612_TIMED_REVISION_BASE_COMMIT = 'd620c38f701d0c8906ae0c05387019a891237d3b';
export const YM2612_TIMED_REVISION_RECEIPT_PATH = 'docs/issues/ym2612_timed_operations_source_revision_01.json';
export const YM2612_TIMED_REVISION_RECEIPT_OBJECT_SHA256 = '317b6cb51a007179b935b54456c47ea388770aed8aded5ea3250222777377f14';

const runtimeNames = Object.freeze([
  'megasynth.js', 'native_genesis_extra_ym2612.js', 'native_genesis_synth.js',
  'playground_audition_guard.js', 'playground_ay_timed_lifecycle.js', 'playground_logic_worker.js',
  'playground_opn.js', 'playground_opn_inspector.js', 'playground_opn_worklet.js',
  'playground_performance_processor.js', 'playground_performance_queue.js',
  'playground_performance_sender.js', 'playground_runtime.js',
  'playground_sync.js', 'playground_worker_chip.js', 'soundchip-output-worklet.js',
  'ym2612-worklet.js', 'ym2612-worklet-nuked.js', 'ym2612synth.js',
]);
export const YM2612_TIMED_REVISION_SOURCE_PATHS = Object.freeze([
  ...runtimeNames.flatMap(name => ['tetorica_src/runtime/' + name, 'docs/js/' + name]),
  'docs/playground/playground_mode.js',
  'docs/playground/playground_monaco_definitions.js',
  'docs/playground/tetorica-playground-globals.d.ts',
]);
export const YM2612_TIMED_REVISION_RELATED_PATHS = Object.freeze([
  ...['ym2612_operation_state.js', 'ym2612_operations.js', 'ym2612_timed_state.js',
    'ym2612_timed_client.js', 'ym2612_timed_processor.js', 'ym2612_dac.js',
    'soundchip_pitch.js', 'playground_chip_clock.js', 'playground_soundchip_options.js']
    .flatMap(name => ['tetorica_src/runtime/' + name, 'docs/js/' + name]),
  'test/helpers/historical_ym2612_timed_source_fixture.mjs',
  'test/helpers/historical_ym2612_timed_synth.mjs',
  'test/runtime/ym2612_operations.test.mjs',
  'test/runtime/ym2612_timed_processor.test.mjs',
]);
export const YM2612_TIMED_REVISION_REPORT_PATHS = Object.freeze([
  'docs/issues/verification_ym2612_timed_core_20261117.json',
  'docs/issues/ym2612_timed_default_parity_01.json',
  'docs/issues/playground_chip_levels_01.json',
  'docs/issues/soundchip_psg_levels_06.json',
  ...['ps1', 'wonderswan', 'pokey', 'scsp'].flatMap(kind =>
    (kind === 'pokey' || kind === 'scsp' ? ['01', 'verify_01'] : ['01'])
      .map(suffix => `docs/issues/${kind}_ay_single_output_chip_levels_${suffix}.json`)),
]);

const root = fileURLToPath(new URL('../', import.meta.url));
const read = url => readFileSync(url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => value && Number.isSafeInteger(value.bytes) && value.bytes > 0 && /^[0-9a-f]{64}$/.test(value.sha256);
const matches = (bytes, expected) => record(expected) && Buffer.byteLength(bytes) === expected.bytes && sha(bytes) === expected.sha256;
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const fail = message => { throw Error('Invalid exact YM2612 timed-operation calibration revision: ' + message); };

function sourceName(path) {
  if (typeof path !== 'string') return path;
  if (path.startsWith('web/')) return 'tetorica_src/runtime/' + path.slice(4);
  if (path.startsWith('js/') || path.startsWith('playground/')) return 'docs/' + path;
  return path;
}

function evidence(readSource) {
  const receipt = JSON.parse(readSource(new URL('../' + YM2612_TIMED_REVISION_RECEIPT_PATH, import.meta.url)));
  if (sha(JSON.stringify(receipt)) !== YM2612_TIMED_REVISION_RECEIPT_OBJECT_SHA256) fail('independently pinned receipt changed');
  if (receipt.schemaVersion !== 1 || receipt.scope !== 'ym2612-timed-operation-api-and-default-path-compatibility' ||
      receipt.baseCommit !== YM2612_TIMED_REVISION_BASE_COMMIT ||
      !keys(receipt.sources, YM2612_TIMED_REVISION_SOURCE_PATHS) ||
      !keys(receipt.relatedSources, YM2612_TIMED_REVISION_RELATED_PATHS) ||
      !keys(receipt.reports, YM2612_TIMED_REVISION_REPORT_PATHS)) fail('source, dependency or report inventory changed');
  for (const path of YM2612_TIMED_REVISION_SOURCE_PATHS) {
    const entry = receipt.sources[path];
    if (!record(entry?.before) || !record(entry.after) || !Array.isArray(entry.reverseHunks) || !entry.reverseHunks.length) fail('incomplete predecessor pair: ' + path);
    let cursor = 0;
    for (const hunk of entry.reverseHunks) {
      if (!keys(hunk, ['afterOffset', 'afterBytes', 'beforeText']) || !Number.isSafeInteger(hunk.afterOffset) ||
          hunk.afterOffset < cursor || !Number.isSafeInteger(hunk.afterBytes) || hunk.afterBytes < 0 ||
          hunk.afterOffset + hunk.afterBytes > entry.after.bytes || typeof hunk.beforeText !== 'string') fail('invalid reverse hunk: ' + path);
      cursor = hunk.afterOffset + hunk.afterBytes;
    }
  }
  for (const path of [...YM2612_TIMED_REVISION_RELATED_PATHS, ...YM2612_TIMED_REVISION_REPORT_PATHS]) {
    if (!record(receipt.relatedSources[path] ?? receipt.reports[path])) fail('invalid dependency record: ' + path);
  }
  return receipt;
}

/** Only exact reviewed after bodies can recover the original measured bytes.
 * The complete feature graph and differential evidence are authenticated first.
 * Unknown paths/future edits receive no normalization or hash exemption. */
export function restoreMixerCalibrationYm2612TimedRevision(path, bytes, {readSource = read} = {}) {
  const latest = createScspDspHelpersRevisionReadContext(readSource);
  bytes = latest.restore(path, bytes);
  readSource = latest.readSource;
  const name = sourceName(path);
  if (!YM2612_TIMED_REVISION_SOURCE_PATHS.includes(name)) return bytes;
  const receipt = evidence(readSource), entry = receipt.sources[name];
  if (!matches(bytes, entry.after)) return bytes;
  for (const dependency of [...YM2612_TIMED_REVISION_SOURCE_PATHS,
    ...YM2612_TIMED_REVISION_RELATED_PATHS, ...YM2612_TIMED_REVISION_REPORT_PATHS]) {
    const expected = receipt.sources[dependency]?.after ?? receipt.relatedSources[dependency] ?? receipt.reports[dependency];
    if (!matches(readSource(new URL('../' + dependency, import.meta.url)), expected)) fail('pinned source/report dependency changed: ' + dependency);
  }
  const current = Buffer.from(bytes), parts = [];
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

/** Older evidence layers retain their complete original dependency inventories.
 * Feed them authenticated predecessor bytes, including nested source reads. */
export function createYm2612TimedRevisionReader(readSource = read) {
  return url => {
    const bytes = readSource(url);
    if (!(url instanceof URL) || url.protocol !== 'file:') return bytes;
    const path = relative(root, fileURLToPath(url)).replaceAll('\\', '/');
    return restoreMixerCalibrationYm2612TimedRevision(path, bytes, {readSource});
  };
}
