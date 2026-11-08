// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {advanceSidPhase, rawPhaseScenarios, checkSidWaveoff} from '../scripts/check_sid_waveoff.mjs';

const voice = (phase, frequency, control = 0) => ({phase, frequency, control, rising: false});
const phase = state => state.map(value => value.phase);
const rising = state => state.map(value => value.rising);

test('independent phase arithmetic wraps at24bits and observes only a low-to-high MSB crossing', () => {
  const input = [voice(0xffffff, 1), voice(0x7fffff, 1), voice(0x800000, 65535)];
  const before = structuredClone(input), result = advanceSidPhase(input);
  assert.deepEqual(phase(result), [0, 0x800000, 0x80ffff]);assert.deepEqual(rising(result), [false, true, false]);
  assert.deepEqual(input, before, 'the expected arithmetic does not adopt chip observations or mutate its seed');
});

test('the phase oracle is independent of Gate and every waveform selector, while TEST holds zero', () => {
  for (let wave = 0; wave < 16; wave++) for (const gate of [0, 1]) {
    const result = advanceSidPhase([voice(0x123456, 4567, wave << 4 | gate), voice(0, 65535, 8), voice(0, 0)]);
    assert.deepEqual(phase(result), [0x12462d, 0, 0]);assert.equal(result[1].rising, false);
  }
});

test('independent Sync arithmetic resets only the next physical target for each source position', () => {
  for (let source = 0; source < 3; source++) {
    const input = [voice(0x100000, 7, 0x20), voice(0x200000, 11, 0x20), voice(0x300000, 13, 0x20)];
    input[source] = voice(0x7fffff, 1);const target = (source + 1) % 3;input[target].control |= 2;
    const result = advanceSidPhase(input);
    assert.equal(result[source].phase, 0x800000);assert.equal(result[target].phase, 0);
    const other = (source + 2) % 3;assert.equal(result[other].phase, input[other].phase + input[other].frequency);
  }
});

test('simultaneous source synchronization suppresses cascaded resets, not the source rising edge', () => {
  const all = [voice(0x7fffff, 1, 2), voice(0x7fffff, 1, 3), voice(0x7fffff, 1, 2)];
  const result = advanceSidPhase(all);assert.deepEqual(phase(result), [0x800000, 0x800000, 0x800000]);assert.deepEqual(rising(result), [true, true, true]);
});

test('raw chip probes distinguish phase, MSB, TEST, Ring and output-latch decay for every voice position', () => {
  const names = rawPhaseScenarios().map(value => value.name);assert.equal(names.length, 32);assert.equal(new Set(names).size, names.length);
  for (let voice = 1; voice <= 3; voice++) {
    assert(names.includes(`waveoff-phase-v${voice}-gate0`));assert(names.includes(`waveoff-wrap-v${voice}-gate1`));
    assert(names.includes(`test-edge-hold-release-v${voice}-gate1`));assert(names.includes(`triangle-ring-source-waveoff-v${voice}`));assert(names.includes(`output-latch-decay-v${voice}`));
  }
});

test('the marked header remains exactly reproducible from the unmodified pinned upstream', async () => {
  execFileSync('python3', ['scripts/prepare_sid_core.py', '--check'], {stdio: 'pipe'});
  const pristine = await readFile(new URL('../third_party/chips-m6581/upstream/m6581.h', import.meta.url));
  assert.equal(createHash('sha256').update(pristine).digest('hex'), 'a793225ee69b91e0ea8c91b221d06ee024e45e6c8179176980abfa95d5a54cdf');
});

test('real Native and checked WASM pass independent phase math at four output rates and both chip clocks', {timeout: 180000}, async () => {
  const report = await checkSidWaveoff();assert.equal(report.passed, true);assert.equal(report.phaseFailures, 0);
  assert.equal(report.raw.length, 32);assert.equal(report.cases.length, 280);
  assert.deepEqual(report.rates, [32000, 44100, 48000, 96000]);assert.deepEqual(report.clocks, [985248, 1022727]);
  assert(report.cases.every(row => row.phaseMatchesOracle));assert.equal(report.physicalOutputOpened, false);
  assert.equal(report.cases.filter(row => row.classification === 'invariant-wave-first').length, 192);
  assert.equal(report.cases.filter(row => row.classification !== 'invariant-wave-first').length, 88);
});
