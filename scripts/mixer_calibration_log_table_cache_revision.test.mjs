import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readHistoricalYm2612TimedFileSync as readFileSync} from '../test/helpers/historical_ym2612_timed_calibration_fixture.mjs';
import {
  restoreMixerCalibrationLogTableCacheRevision as restore,
  LOG_TABLE_CACHE_REVISION_BASE_COMMIT as baseCommit,
  LOG_TABLE_CACHE_REVISION_RECEIPT_PATH as receiptPath,
  LOG_TABLE_CACHE_REVISION_RECEIPT_OBJECT_SHA256 as pin,
  LOG_TABLE_CACHE_REVISION_SOURCE_PATHS as paths,
  LOG_TABLE_CACHE_REVISION_LOGGER_PATHS as loggers,
} from './mixer_calibration_log_table_cache_revision.mjs';
import {
  restoreMixerCalibrationAyTimedRevision as restoreAy,
  AY_TIMED_REVISION_RECEIPT_PATH as ayReceiptPath,
} from './mixer_calibration_ay_timed_revision.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const record = bytes => ({bytes:bytes.length, sha256:sha(bytes)});
const receipt = JSON.parse(read(receiptPath)), ayReceipt = JSON.parse(read(ayReceiptPath));
const oldImport = "from './playground_log.js';";
const newImport = "from './playground_log.js?v=console-table-1';";

test('six complete source pairs change only one cache query and retain the immutable AY after bodies', () => {
  assert.equal(sha(JSON.stringify(receipt)), pin);
  assert.equal(receipt.baseCommit, baseCommit);
  assert.equal(read(receiptPath).toString(), JSON.stringify(receipt, null, 2) + '\n');
  assert.deepEqual(Object.keys(receipt.sources), [...paths]);
  assert.deepEqual(Object.keys(receipt.loggers), [...loggers]);
  for (const path of paths) {
    const current = read(path), previous = restore(path, current), entry = receipt.sources[path];
    assert.deepEqual(record(current), entry.after, path);
    assert.deepEqual(record(previous), entry.before, path);
    assert.deepEqual(entry.before, ayReceipt.sources[path].after, path);
    assert.equal(previous.toString().split(oldImport).length, 2, path);
    assert.equal(previous.toString().replace(oldImport, newImport), current.toString(), path);
    assert.equal(restore(path, previous), previous, 'prior bodies are not reinterpreted');
  }
  for (const path of loggers) {
    assert.deepEqual(record(read(path)), receipt.loggers[path], path);
    assert.deepEqual(receipt.loggers[path], ayReceipt.sources[path].after, path);
  }
});

test('future bodies, other queries, whitespace edits and unknown paths receive no cache reconstruction', () => {
  for (const path of paths) {
    const current = read(path), edited = Buffer.from(current);
    edited[Math.floor(edited.length / 2)] ^= 1;
    for (const changed of [edited, Buffer.concat([current, Buffer.from('\n')]),
      Buffer.from(current.toString().replace('console-table-1', 'console-table-2')),
      Buffer.from(current.toString().replace(newImport, newImport.replace('from ', 'from  ')))]) {
      assert.equal(restore(path, changed), changed, path);
      assert.equal(restoreAy(path, changed), changed, path);
    }
  }
  const bytes = read(paths[0]);
  for (const path of ['js/unknown.js', '__proto__', '../' + paths[0], 'docs/js/playground_log.js']) {
    assert.equal(restore(path, bytes), bytes, path);
  }
});

test('the independent receipt and both complete logger targets remain required', () => {
  const path = paths[0], current = read(path);
  for (const dependency of [receiptPath, ...loggers]) {
    const target = new URL('../' + dependency, import.meta.url).href;
    const readSource = url => {
      const bytes = readFileSync(url);
      if (url.href !== target) return bytes;
      if (dependency === receiptPath) {
        const forged = JSON.parse(bytes);
        forged.sources[path].after.sha256 = '0'.repeat(64);
        return Buffer.from(JSON.stringify(forged));
      }
      return Buffer.concat([bytes, Buffer.from('\n')]);
    };
    assert.throws(() => restore(path, current, {readSource}), /pinned.*changed/, dependency);
    assert.throws(() => restoreAy(path, current, {readSource}), /pinned.*changed/, dependency);
  }
});

test('AY restoration authenticates upgraded dependencies and retains web and docs aliases', () => {
  const source = 'docs/js/native_runtime_synth.js', current = read(source);
  for (const path of paths) {
    const target = new URL('../' + path, import.meta.url).href;
    assert.throws(() => restoreAy(source, current, {readSource(url) {
      const bytes = readFileSync(url);
      return url.href === target
        ? Buffer.from(bytes.toString().replace('console-table-1', 'console-table-2')) : bytes;
    }}), /pinned source\/report dependency changed/, path);
    const alias = path.startsWith('docs/') ? path.slice(5) : 'web/' + path.slice('tetorica_src/runtime/'.length);
    assert.deepEqual(restoreAy(alias, read(path)), restoreAy(path, read(path)), alias);
  }
});
