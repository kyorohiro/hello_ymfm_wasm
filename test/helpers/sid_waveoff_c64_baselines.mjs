// SPDX-License-Identifier: BSD-3-Clause
// Independently pinned regression evidence. Corrected PCM is accepted only
// with the reviewed Native/WASM proof and unmodified historical records.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root = new URL('../../', import.meta.url), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const proofPath = 'docs/issues/sid_waveoff_c64_01.json';
const proofSha256 = 'a09fdbc567fafb0c5c58b180c2a0383ce77d9280ac560e644c0ab693d45d49fc';
const currentWasmSha256 = '660b379ce5dd6ac5dcbf76929389e43be583b9d92fb44216bbfdfb25bad444e8';
const markedHeaderSha256 = 'a13132ce5083e707611ac65e6e37c799a19ce18a8df4dcbb9e60292cb9520aa8';
const nativeHelperSha256 = '5b5af344ab004614e9caca801d34751d100718e3ac7df2f7082c235b2b47c0d9';
const groups = Object.freeze({
  cia: {old: 'psid_cia_baseline_004.json', corrected: 'psid_cia_waveoff_baseline_01.json', count: 9,
    oldSha256: '412852e0d74a801ad1b380fe1236ff1eaaf4f1a6df99dfa4e6a219d7ff81347e',
    correctedSha256: '023cd359a985f60c60bbf4653322020537ae3ba1646b8111dcc949b1a7f777d4'},
  rsid: {old: 'rsid_baseline_003.json', corrected: 'rsid_waveoff_baseline_01.json', count: 12,
    oldSha256: '55624da353a718ff5566cb27cc4956469209c53a82defe6b4b3f7c6a8fc4a45d',
    correctedSha256: 'f7e245babaad03f622674b463fbb45d1929fd3eec0bd1f582ed5afedabb48357'},
  relocated: {old: 'cia_relocated_baseline_006.json', corrected: 'cia_relocated_waveoff_baseline_01.json', count: 6,
    oldSha256: 'bd7bd958bae8fd39fd9497417bb9441678c434424f16e1baf16faa97b29177b6',
    correctedSha256: 'e05641853d549df5bd0c0d76b1b9ce4a8f1af53f1420a29acde3a1c40a54b9e6'},
});

export async function loadSidWaveoffC64Baseline(name) {
  assert(Object.hasOwn(groups, name), 'Unknown corrected C64 baseline group');const group = groups[name];
  const oldPath = 'test/fixtures/sid-player/' + group.old, correctedPath = 'test/fixtures/sid-player/' + group.corrected;
  const [oldBytes, correctedBytes, proofBytes, wasm, servedWasm, header, helper] = await Promise.all([
    oldPath, correctedPath, proofPath, 'tetorica_src/runtime/generated/sid-rsid/sid-rsid.wasm', 'docs/generated/sid-rsid/sid-rsid.wasm',
    'third_party/chips-m6581/m6581.h', 'test/helpers/sid_waveoff_c64_reference.cpp',
  ].map(path => readFile(new URL(path, root))));
  assert.equal(sha(oldBytes), group.oldSha256, 'Historical C64 JSON is immutable');
  assert.equal(sha(correctedBytes), group.correctedSha256, 'Corrected C64 JSON needs an independent pin review');
  assert.equal(sha(proofBytes), proofSha256, 'Native C64 evidence needs an independent pin review');
  assert.equal(sha(wasm), currentWasmSha256);assert(wasm.equals(servedWasm), 'Canonical and served C64 WASM must agree');
  assert.equal(sha(header), markedHeaderSha256);assert.equal(sha(helper), nativeHelperSha256);
  const historical = JSON.parse(oldBytes), baseline = JSON.parse(correctedBytes), proof = JSON.parse(proofBytes);
  assert.equal(baseline.format, 'tetorica-c64-waveoff-corrected-baseline');assert.equal(baseline.version, 1);assert.equal(baseline.wasmSha256, currentWasmSha256);
  assert.deepEqual(baseline.historicalBaseline, {path: oldPath, sha256: group.oldSha256, wasmSha256: historical.wasmSha256});
  assert.equal(baseline.nativeProof, proofPath);assert.equal(historical.cases.length, group.count);assert.equal(baseline.cases.length, group.count);
  assert.equal(proof.passed, true);assert.equal(proof.historicalFilesKept, true);assert.equal(proof.physicalOutputOpened, false);assert.equal(proof.currentWasm.sha256, currentWasmSha256);
  for (const [path, expected] of Object.entries(proof.sources)) {
    const bytes = await readFile(new URL(path, root));assert.deepEqual({bytes: bytes.length, sha256: sha(bytes)}, expected, 'Reviewed Native C64 proof source differs: ' + path);
  }
  const proofBaseline = proof.correctedBaselines.find(item => item.path === correctedPath);
  assert.deepEqual(proofBaseline, {path: correctedPath, bytes: correctedBytes.length, sha256: group.correctedSha256});
  const cases = proof.cases.filter(item => item.historicalFile === oldPath);assert.equal(cases.length, group.count);
  assert(cases.every(item => item.preChangeCheckpointMatchesHistorical && item.preChangeNativeWasmExact && item.nativeWasmExact && item.cpuTraceUnchanged && item.nonPhaseStateUnchanged));
  return {historical, baseline};
}
