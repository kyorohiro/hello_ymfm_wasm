/** Exact import-cache revision layered before the immutable AY source proof.
 * Only the six complete reviewed bodies can recover their prior import URL.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const LOG_TABLE_CACHE_REVISION_BASE_COMMIT = '7593d0f06ed85579fc1c5e89c5de03e4a2c96601';
export const LOG_TABLE_CACHE_REVISION_RECEIPT_PATH = 'docs/issues/log_table_import_cache_revision_01.json';
export const LOG_TABLE_CACHE_REVISION_RECEIPT_OBJECT_SHA256 = '15464be43051f097de608c64f9784394049e05ce76185c7b635ceabe10fb0d37';
export const LOG_TABLE_CACHE_REVISION_SOURCE_PATHS = Object.freeze([
  'playground_code_runtime.js', 'playground_runtime.js', 'playground_logic_worker.js',
].flatMap(name => ['tetorica_src/runtime/' + name, 'docs/js/' + name]));
export const LOG_TABLE_CACHE_REVISION_LOGGER_PATHS = Object.freeze([
  'tetorica_src/runtime/playground_log.js', 'docs/js/playground_log.js',
]);

const priorImport = "from './playground_log.js';";
const servedImport = "from './playground_log.js?v=console-table-1';";
const read = url => readFileSync(url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => value && Number.isSafeInteger(value.bytes) && value.bytes > 0 &&
  /^[0-9a-f]{64}$/.test(value.sha256);
const matches = (bytes, expected) => record(expected) &&
  Buffer.byteLength(bytes) === expected.bytes && sha(bytes) === expected.sha256;
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const fail = message => { throw Error('Invalid exact log-table import cache revision: ' + message); };

function evidence(readSource) {
  const receipt = JSON.parse(readSource(new URL('../' + LOG_TABLE_CACHE_REVISION_RECEIPT_PATH, import.meta.url)));
  if (sha(JSON.stringify(receipt)) !== LOG_TABLE_CACHE_REVISION_RECEIPT_OBJECT_SHA256) {
    fail('independently pinned receipt changed');
  }
  if (receipt.schemaVersion !== 1 || receipt.scope !== 'log-table-import-cache-query-only' ||
      receipt.baseCommit !== LOG_TABLE_CACHE_REVISION_BASE_COMMIT ||
      !keys(receipt.sources, LOG_TABLE_CACHE_REVISION_SOURCE_PATHS) ||
      !keys(receipt.loggers, LOG_TABLE_CACHE_REVISION_LOGGER_PATHS)) {
    fail('exact source/logger inventory changed');
  }
  for (const path of LOG_TABLE_CACHE_REVISION_SOURCE_PATHS) {
    const entry = receipt.sources[path];
    if (!keys(entry, ['before', 'after']) || !record(entry.before) || !record(entry.after)) {
      fail('incomplete source pair: ' + path);
    }
  }
  for (const path of LOG_TABLE_CACHE_REVISION_LOGGER_PATHS) {
    if (!record(receipt.loggers[path])) fail('invalid logger record: ' + path);
  }
  return receipt;
}

/** Complete hashes fence the one exact import change. Unknown paths, future
 * source edits and other cache queries receive no reconstruction.
 */
export function restoreMixerCalibrationLogTableCacheRevision(path, bytes, {readSource = read} = {}) {
  if (!LOG_TABLE_CACHE_REVISION_SOURCE_PATHS.includes(path)) return bytes;
  const receipt = evidence(readSource), entry = receipt.sources[path];
  if (!matches(bytes, entry.after)) return bytes;
  for (const logger of LOG_TABLE_CACHE_REVISION_LOGGER_PATHS) {
    if (!matches(readSource(new URL('../' + logger, import.meta.url)), receipt.loggers[logger])) {
      fail('pinned logger changed: ' + logger);
    }
  }
  const text = Buffer.from(bytes).toString('utf8');
  if (text.split(servedImport).length !== 2) fail('expected one exact versioned import: ' + path);
  const original = Buffer.from(text.replace(servedImport, priorImport));
  if (!matches(original, entry.before)) fail('complete query-only predecessor reconstruction failed: ' + path);
  return original;
}
