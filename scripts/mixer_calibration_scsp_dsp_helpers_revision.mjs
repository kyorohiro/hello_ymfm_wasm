/** Exact pure SCSP DSP codec bindings and passive Playground authoring revision.
 * Recover the complete reviewed predecessor before older calibration layers.
 * Audio renderers, WASM, measurements and Mixer gains retain their pinned bytes.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';

export const SCSP_DSP_HELPERS_REVISION_BASE_COMMIT = '6beead4162358c3ff393790aff47d7b4bfb8d231';
export const SCSP_DSP_HELPERS_REVISION_RECEIPT_PATH = 'docs/issues/playground_scsp_dsp_helpers_source_revision_01.json';
export const SCSP_DSP_HELPERS_REVISION_RECEIPT_OBJECT_SHA256 = 'e85a9c77e7a29c524a6fd1c17943cdbc63a97962730751ad47ebc536987cf209';
export const SCSP_DSP_HELPERS_REVISION_SOURCE_PATHS = Object.freeze([
  ...['playground_runtime.js', 'playground_logic_worker.js', 'playground_code_runtime.js']
    .flatMap(name => ['tetorica_src/runtime/' + name, 'docs/js/' + name]),
  ...['index.html', 'playground.js', 'playground_examples.js', 'playground_mode_examples.js',
    'playground_monaco.js', 'playground_monaco_definitions.js', 'tetorica-playground-globals.d.ts']
    .map(name => 'docs/playground/' + name),
  'docs/synth/synth_code_declarations.js',
]);
export const SCSP_DSP_HELPERS_REVISION_RELATED_PATHS = Object.freeze([
  ...['tetorica_src/runtime/scsp_dsp_assembler', 'docs/js/scsp_dsp_assembler', 'docs/synth-scsp/dsp_assembler']
    .flatMap(path => [path + '.js', path + '.d.ts']),
  'docs/playground/examples/scsp/scsp-dsp-roundtrip.js',
  ...['scsp.js', 'scspsynth.js', 'playground_scsp_worklet.js', 'soundchip_mixer_presets.js']
    .flatMap(name => ['tetorica_src/runtime/' + name, 'docs/js/' + name]),
  ...['scsp_wasm.js', 'scsp_wasm.wasm']
    .flatMap(name => ['tetorica_src/runtime/generated/' + name, 'docs/generated/' + name]),
  'docs/playground/playground_mixer_defaults.js',
]);
export const SCSP_DSP_HELPERS_REVISION_REPORT_PATHS = Object.freeze([
  'docs/issues/verification_ym2612_timed_core_20261117.json',
  'docs/issues/ym2612_timed_default_parity_01.json',
  'docs/issues/playground_chip_levels_01.json',
  'docs/issues/soundchip_psg_levels_05.json',
  'docs/issues/soundchip_psg_levels_06.json',
  ...['ps1', 'wonderswan', 'pokey', 'scsp'].flatMap(kind => [
    `docs/issues/${kind}_state_restore_chip_levels_01.json`,
    ...((kind === 'pokey' || kind === 'scsp') ? ['01', 'verify_01'] : ['01'])
      .map(suffix => `docs/issues/${kind}_ay_single_output_chip_levels_${suffix}.json`),
  ]),
]);

const root = fileURLToPath(new URL('../', import.meta.url));
const read = url => readFileSync(url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => value && Number.isSafeInteger(value.bytes) && value.bytes > 0 && /^[0-9a-f]{64}$/.test(value.sha256);
const matches = (bytes, expected) => record(expected) && Buffer.byteLength(bytes) === expected.bytes && sha(bytes) === expected.sha256;
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const fail = message => {throw Error('Invalid exact SCSP DSP helper calibration revision: ' + message);};
const predecessorReaders = new WeakSet();

function sourceName(path) {
  if (typeof path !== 'string') return path;
  if (path.startsWith('web/')) return 'tetorica_src/runtime/' + path.slice(4);
  if (path.startsWith('js/') || path.startsWith('playground/') || path.startsWith('synth/')) return 'docs/' + path;
  return path;
}

function evidence(readSource) {
  const value = JSON.parse(readSource(new URL('../' + SCSP_DSP_HELPERS_REVISION_RECEIPT_PATH, import.meta.url)));
  if (sha(JSON.stringify(value)) !== SCSP_DSP_HELPERS_REVISION_RECEIPT_OBJECT_SHA256) fail('independently pinned receipt changed');
  if (value.schemaVersion !== 1 || value.scope !== 'playground-pure-scsp-dsp-codec-bindings' ||
      value.baseCommit !== SCSP_DSP_HELPERS_REVISION_BASE_COMMIT ||
      !keys(value.sources, SCSP_DSP_HELPERS_REVISION_SOURCE_PATHS) ||
      !keys(value.relatedSources, SCSP_DSP_HELPERS_REVISION_RELATED_PATHS) ||
      !keys(value.reports, SCSP_DSP_HELPERS_REVISION_REPORT_PATHS)) fail('exact source, dependency or report inventory changed');
  for (const path of SCSP_DSP_HELPERS_REVISION_SOURCE_PATHS) {
    const entry = value.sources[path];
    if (!record(entry?.before) || !record(entry.after) || !Array.isArray(entry.reverseHunks) || !entry.reverseHunks.length) fail('incomplete predecessor pair: ' + path);
    let cursor = 0;
    for (const hunk of entry.reverseHunks) {
      if (!keys(hunk, ['afterOffset', 'afterBytes', 'beforeText']) || !Number.isSafeInteger(hunk.afterOffset) ||
          hunk.afterOffset < cursor || !Number.isSafeInteger(hunk.afterBytes) || hunk.afterBytes < 0 ||
          hunk.afterOffset + hunk.afterBytes > entry.after.bytes || typeof hunk.beforeText !== 'string') fail('invalid reverse hunk: ' + path);
      cursor = hunk.afterOffset + hunk.afterBytes;
    }
  }
  for (const path of [...SCSP_DSP_HELPERS_REVISION_RELATED_PATHS, ...SCSP_DSP_HELPERS_REVISION_REPORT_PATHS]) {
    if (!record(value.relatedSources[path] ?? value.reports[path])) fail('invalid dependency record: ' + path);
  }
  return value;
}

/** Only the complete reviewed after body and dependency graph can reconstruct
 * this revision. Future edits remain subject to the original source guards.
 */
function createRestorer(readSource, snapshot = false) {
  let receipt, verified = false;
  return (path, bytes) => {
    const name = sourceName(path);
    if (!SCSP_DSP_HELPERS_REVISION_SOURCE_PATHS.includes(name)) return bytes;
    receipt = snapshot ? receipt ?? evidence(readSource) : evidence(readSource);
    const entry = receipt.sources[name];
    if (!matches(bytes, entry.after)) return bytes;
    if (!verified) {
      for (const dependency of [...SCSP_DSP_HELPERS_REVISION_SOURCE_PATHS,
        ...SCSP_DSP_HELPERS_REVISION_RELATED_PATHS, ...SCSP_DSP_HELPERS_REVISION_REPORT_PATHS]) {
        const expected = receipt.sources[dependency]?.after ?? receipt.relatedSources[dependency] ?? receipt.reports[dependency];
        if (!matches(readSource(new URL('../' + dependency, import.meta.url)), expected)) fail('pinned source/report dependency changed: ' + dependency);
      }
      verified = snapshot;
    }
    const current = Buffer.from(bytes), parts = [];
    let cursor = 0;
    for (const hunk of entry.reverseHunks) {
      parts.push(current.subarray(cursor, hunk.afterOffset), Buffer.from(hunk.beforeText));
      cursor = hunk.afterOffset + hunk.afterBytes;
    }
    parts.push(current.subarray(cursor));
    const before = Buffer.concat(parts);
    if (!matches(before, entry.before)) fail('complete predecessor reconstruction failed: ' + name);
    return before;
  };
}

export function restoreMixerCalibrationScspDspHelpersRevision(path, bytes, {readSource = read} = {}) {
  return createRestorer(readSource)(path, bytes);
}

/** One synchronous verification owns this immutable read snapshot. Callers
 * create a fresh context for every top-level proof, including custom readers.
 */
export function createScspDspHelpersRevisionReadContext(readSource = read) {
  const originals = new Map(), predecessors = new Map();
  const original = url => {
    const key = url instanceof URL ? url.href : url;
    if (!originals.has(key)) originals.set(key, Buffer.from(readSource(url)));
    return originals.get(key);
  };
  const restore = createRestorer(original, true);
  const reader = url => {
    const key = url instanceof URL ? url.href : url;
    if (!predecessors.has(key)) {
      const bytes = original(url);
      const path = url instanceof URL && url.protocol === 'file:'
        ? relative(root, fileURLToPath(url)).replaceAll('\\', '/') : null;
      predecessors.set(key, path === null ? bytes : restore(path, bytes));
    }
    return predecessors.get(key);
  };
  predecessorReaders.add(reader);
  return {restore, readSource: reader};
}

/** Nested reads into earlier evidence layers receive this exact predecessor. */
export function createScspDspHelpersRevisionReader(readSource = read) {
  if (predecessorReaders.has(readSource)) return readSource;
  const reader = url => {
    const bytes = readSource(url);
    if (!(url instanceof URL) || url.protocol !== 'file:') return bytes;
    const path = relative(root, fileURLToPath(url)).replaceAll('\\', '/');
    return restoreMixerCalibrationScspDspHelpersRevision(path, bytes, {readSource});
  };
  predecessorReaders.add(reader);
  return reader;
}
