import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {
  restoreMixerCalibrationScspDspHelpersRevision as restore,
  createScspDspHelpersRevisionReader,
  createScspDspHelpersRevisionReadContext,
  SCSP_DSP_HELPERS_REVISION_BASE_COMMIT as baseCommit,
  SCSP_DSP_HELPERS_REVISION_RECEIPT_PATH as receiptPath,
  SCSP_DSP_HELPERS_REVISION_RECEIPT_OBJECT_SHA256 as receiptSha,
  SCSP_DSP_HELPERS_REVISION_SOURCE_PATHS as paths,
  SCSP_DSP_HELPERS_REVISION_RELATED_PATHS as related,
  SCSP_DSP_HELPERS_REVISION_REPORT_PATHS as reports,
} from './mixer_calibration_scsp_dsp_helpers_revision.mjs';
import {createYm2612TimedRevisionReader} from './mixer_calibration_ym2612_timed_revision.mjs';
import {restoreMixerCalibrationVabApiRevision} from './mixer_calibration_vab_api_revision.mjs';
import {createScspDspExecutionRevisionReader} from './mixer_calibration_scsp_dsp_execution_revision.mjs';

const url = path => new URL('../' + path, import.meta.url);
const currentPredecessor = createScspDspExecutionRevisionReader();
const read = path => currentPredecessor(url(path));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = JSON.parse(read(receiptPath));
function match(bytes, record) {
  assert.equal(bytes.length, record.bytes);
  assert.equal(sha(bytes), record.sha256);
}

test('SCSP helper receipt pins complete source pairs, existing codec and unchanged audio evidence', () => {
  assert.equal(sha(JSON.stringify(receipt)), receiptSha);
  assert.equal(receipt.baseCommit, baseCommit);
  assert.equal(read(receiptPath).toString(), JSON.stringify(receipt, null, 2) + '\n');
  assert.deepEqual(Object.keys(receipt.sources), [...paths]);
  assert.deepEqual(Object.keys(receipt.relatedSources), [...related]);
  assert.deepEqual(Object.keys(receipt.reports), [...reports]);
  for (const path of paths) {
    const bytes = read(path), entry = receipt.sources[path];
    match(bytes, entry.after);
    const before = restore(path, bytes);
    match(before, entry.before);
    assert.notDeepEqual(before, bytes);
    assert.equal(restore(path, before), before);
  }
  for (const path of [...related, ...reports]) match(read(path), receipt.relatedSources[path] ?? receipt.reports[path]);
  for (const suffix of ['js', 'd.ts']) {
    assert.deepEqual(read(`tetorica_src/runtime/scsp_dsp_assembler.${suffix}`), read(`docs/js/scsp_dsp_assembler.${suffix}`));
    assert.deepEqual(read(`tetorica_src/runtime/scsp_dsp_assembler.${suffix}`), read(`docs/synth-scsp/dsp_assembler.${suffix}`));
  }
});

test('aliases and nested timed/VAB evidence reads receive exact predecessor bytes', () => {
  for (const [alias, canonical] of [
    ['web/playground_runtime.js', 'tetorica_src/runtime/playground_runtime.js'],
    ['js/playground_logic_worker.js', 'docs/js/playground_logic_worker.js'],
    ['playground/playground_monaco.js', 'docs/playground/playground_monaco.js'],
    ['synth/synth_code_declarations.js', 'docs/synth/synth_code_declarations.js'],
  ]) assert.deepEqual(restore(alias, read(canonical)), restore(canonical, read(canonical)));

  const immediateReader = createScspDspHelpersRevisionReader();
  const timedReader = createYm2612TimedRevisionReader();
  const timedReceipt = JSON.parse(read('docs/issues/ym2612_timed_operations_source_revision_01.json'));
  const worker = 'docs/js/playground_logic_worker.js';
  match(immediateReader(url(worker)), receipt.sources[worker].before);
  match(timedReader(url(worker)), timedReceipt.sources[worker].before);
  match(restoreMixerCalibrationVabApiRevision(worker, read(worker)), timedReceipt.sources[worker].before);
  const factory = 'tetorica_src/runtime/soundchip.js';
  assert.throws(() => restoreMixerCalibrationVabApiRevision(factory, read(factory)),
    /pinned report\/helper\/cache dependency changed: docs\/generated\/ay8910_wasm\.wasm/,
    'The older VAB proof still reaches and enforces its original changed-WASM guard');
});

test('unknown paths and additional edits retain their bytes and receive no reconstruction', () => {
  for (const path of paths) {
    const current = read(path), sameLength = Buffer.from(current);
    sameLength[sameLength.length - 1] ^= 1;
    for (const changed of [sameLength, Buffer.concat([current, Buffer.from('\n')])]) {
      assert.equal(restore(path, changed), changed);
    }
  }
  const bytes = read(paths[0]);
  for (const path of ['docs/js/unlisted.js', '../' + paths[0], 'docs/generated/scsp_wasm.wasm']) {
    assert.equal(restore(path, bytes), bytes);
  }
});

test('every source, codec, example, audio asset, gain and report dependency remains pinned', () => {
  const source = paths[0], bytes = read(source);
  for (const dependency of [...paths, ...related, ...reports]) {
    assert.throws(() => restore(source, bytes, {readSource(location) {
      const current = readFileSync(location);
      return location.href === url(dependency).href ? Buffer.concat([current, Buffer.from('\n')]) : current;
    }}), /pinned source\/report dependency changed/, dependency);
  }
  assert.throws(() => restore(source, bytes, {readSource(location) {
    if (location.href !== url(receiptPath).href) return readFileSync(location);
    const forged = structuredClone(receipt);
    forged.sources[source].before.sha256 = '0'.repeat(64);
    return Buffer.from(JSON.stringify(forged));
  }}), /independently pinned receipt/);
});

test('a retained predecessor reader rechecks later dependency changes', () => {
  let changed = false;
  const codec = url('tetorica_src/runtime/scsp_dsp_assembler.js').href;
  const reader = createScspDspHelpersRevisionReader(location => {
    const bytes = readFileSync(location);
    return changed && location.href === codec ? Buffer.concat([bytes, Buffer.from('\n')]) : bytes;
  });
  match(reader(url(paths[0])), receipt.sources[paths[0]].before);
  changed = true;
  assert.throws(() => reader(url(paths[0])), /pinned source\/report dependency changed/);
});

test('one proof shares owned source reads while a subsequent proof rejects changed dependencies', () => {
  const counts = new Map();
  let changed = false;
  const codec = url('tetorica_src/runtime/scsp_dsp_assembler.js').href;
  const readSource = location => {
    counts.set(location.href, (counts.get(location.href) ?? 0) + 1);
    const bytes = readFileSync(location);
    return changed && location.href === codec ? Buffer.concat([bytes, Buffer.from('\n')]) : bytes;
  };
  const current = read(paths[0]);
  const proof = createScspDspHelpersRevisionReadContext(readSource);
  match(proof.restore(paths[0], current), receipt.sources[paths[0]].before);
  for (const path of paths) {
    match(proof.readSource(url(path)), receipt.sources[path].before);
    match(proof.readSource(url(path)), receipt.sources[path].before);
  }
  assert([...counts.values()].every(count => count === 1), 'Each dependency is read once within this proof');
  changed = true;
  const nextProof = createScspDspHelpersRevisionReadContext(readSource);
  assert.throws(() => nextProof.restore(paths[0], current), /pinned source\/report dependency changed/);
});
