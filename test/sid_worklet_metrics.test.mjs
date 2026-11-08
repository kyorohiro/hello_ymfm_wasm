// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {SidWorkletMetrics} from '../scripts/sid_worklet_metrics.mjs';

test('coarse 3 ms spans straddle the 44.1 kHz budget and stay conditional, while larger spans remain distinct', () => {
  const metrics = new SidWorkletMetrics({sampleRate: 44100});
  for (const elapsed of [0, 1, 2, 3, 4]) metrics.record(elapsed, elapsed, 128);
  const state = metrics.snapshot();
  assert.equal(state.blocks, 5); assert.equal(state.frames, 640);
  for (const span of [state.render, state.total]) {
    assert.equal(span.rawOverBudgetBlocks, 2);
    assert.equal(span.quantizationSensitiveOverBudgetBlocks, 1);
    assert.equal(span.beyondQuantumOverBudgetBlocks, 1);
    assert.equal(span.meanMs, 2); assert.equal(span.maxMs, 4);
  }
  assert.match(state.interpretation.beyondQuantumOverBudgetBlocks, /not confirmed device underruns/);
  assert.match(state.interpretation.measurement, /not CPU/);
});

test('each block uses its actual frame budget, including equality and the quantization boundary', () => {
  const metrics = new SidWorkletMetrics({sampleRate: 48000, timerSource: 'test clock', quantumMs: 1});
  metrics.record(2, 3, 96); // 2 ms is exactly the budget; 3-1 ms is still ambiguous.
  metrics.record(2.5, 3.001, 96);
  metrics.record(3, 3, 192); // 4 ms budget.
  const state = metrics.snapshot();
  assert.equal(state.frames, 384);
  assert.equal(state.render.rawOverBudgetBlocks, 1);
  assert.equal(state.render.quantizationSensitiveOverBudgetBlocks, 1);
  assert.equal(state.total.rawOverBudgetBlocks, 2);
  assert.equal(state.total.quantizationSensitiveOverBudgetBlocks, 1);
  assert.equal(state.total.beyondQuantumOverBudgetBlocks, 1);
});

test('negative or nonfinite durations remain invalid instead of becoming zero-cost successful samples', () => {
  const metrics = new SidWorkletMetrics({sampleRate: 44100});
  metrics.record(-1, 2, 128, 10);
  metrics.record(NaN, Infinity, 128, 9);
  metrics.record(1, -1, 128, NaN);
  metrics.record(2, 1, 128, 15); // A separate clock consistency warning, no clamping.
  const state = metrics.snapshot();
  assert.equal(state.blocks, 4); assert.equal(state.frames, 512);
  assert.equal(state.render.validBlocks, 2); assert.equal(state.render.invalidBlocks, 2);
  assert.equal(state.total.validBlocks, 2); assert.equal(state.total.invalidBlocks, 2);
  assert.equal(state.render.meanMs, 1.5); assert.equal(state.total.meanMs, 1.5);
  assert.equal(state.inconsistentSpans, 1);
  assert.equal(state.clock.negativeStartDeltas, 1); assert.equal(state.clock.nonfiniteStarts, 1);
  assert.equal(state.clock.minPositiveStartDeltaMs, null, 'an invalid start must break the delta sequence');
});

test('callback-start deltas distinguish duplicates, negative jumps and observed positive intervals', () => {
  const metrics = new SidWorkletMetrics({sampleRate: 48000});
  for (const start of [100, 100, 104, 107, 106, 108]) metrics.record(1, 1, 128, start);
  const state = metrics.snapshot();
  assert.equal(state.clock.starts, 6); assert.equal(state.clock.minPositiveStartDeltaMs, 2);
  assert.equal(state.clock.negativeStartDeltas, 1);
  assert.match(state.interpretation.callbackStartDeltas, /not measured timer resolution/);
});

test('histogram quantiles preserve finite bounds and overflow rather than manufacturing precise tail values', () => {
  const metrics = new SidWorkletMetrics({sampleRate: 48000, quantumMs: 0});
  for (let index = 0; index < 98; index++) metrics.record(.25, .35, 128);
  metrics.record(20, 25, 128); metrics.record(100, 100, 128);
  const state = metrics.snapshot();
  assert.equal(state.render.histogram.bins.length, 200); assert.equal(state.render.histogram.bins[2], 98);
  assert.equal(state.render.histogram.overflowCount, 2);
  assert.deepEqual(state.render.quantiles.p50, {lowerMs: .2, upperMs: .3, upperExclusive: true, overflow: false});
  assert.deepEqual(state.render.quantiles.p95, state.render.quantiles.p50);
  assert.deepEqual(state.render.quantiles.p99, {lowerMs: 20, upperMs: null, upperExclusive: false, overflow: true});
  assert.equal(state.render.rawOverBudgetBlocks, state.render.beyondQuantumOverBudgetBlocks);
  const serialized = JSON.parse(JSON.stringify(state)); assert.deepEqual(serialized, state);
});

test('empty windows do not claim zero mean or a measured quantile, and snapshots are detached', () => {
  const metrics = new SidWorkletMetrics({sampleRate: 44100});
  const before = metrics.snapshot();
  assert.equal(before.render.meanMs, null); assert.equal(before.render.maxMs, null);
  assert.equal(before.render.quantiles.p50, null);
  before.render.histogram.bins[0] = 100;
  metrics.record(0, 0, 128);
  assert.equal(metrics.snapshot().render.histogram.bins[0], 1);
  assert.equal(before.blocks, 0);
});

test('independent windows do not inherit warmup samples and constructor choices reject invalid clocks', () => {
  const warmup = new SidWorkletMetrics({sampleRate: 44100}), measured = new SidWorkletMetrics({sampleRate: 44100});
  warmup.record(50, 50, 128); measured.record(1, 1, 128);
  assert.equal(warmup.snapshot().render.maxMs, 50); assert.equal(measured.snapshot().render.maxMs, 1);
  for (const options of [{}, {sampleRate: 0}, {sampleRate: 96001}, {sampleRate: 44100.5},
    {sampleRate: 44100, timerSource: ''}, {sampleRate: 44100, quantumMs: -1}, {sampleRate: 44100, quantumMs: Infinity}])
    assert.throws(() => new SidWorkletMetrics(options));
});
