// SPDX-License-Identifier: BSD-3-Clause
// Diagnostic-only wall-clock aggregates. This module has no browser/Node
// dependencies and keeps PCM, chip state and device-underrun claims out of the
// measurement. record() does not allocate; snapshot() runs outside timed spans.

const BIN_WIDTH_MS = .1;
const FINITE_BINS = 200;
const UPPER_LIMIT_MS = 20;

function span() {
  return {validBlocks: 0, invalidBlocks: 0, totalMs: 0, maxMs: 0,
    rawOverBudgetBlocks: 0, quantizationSensitiveOverBudgetBlocks: 0,
    beyondQuantumOverBudgetBlocks: 0, bins: new Uint32Array(FINITE_BINS + 1)};
}

function add(value, elapsed, budget, quantum) {
  if (!Number.isFinite(elapsed) || elapsed < 0) {value.invalidBlocks++; return;}
  value.validBlocks++; value.totalMs += elapsed;
  if (elapsed > value.maxMs) value.maxMs = elapsed;
  if (elapsed > budget) {
    value.rawOverBudgetBlocks++;
    if (elapsed - quantum <= budget) value.quantizationSensitiveOverBudgetBlocks++;
    else value.beyondQuantumOverBudgetBlocks++;
  }
  const bin = elapsed >= UPPER_LIMIT_MS ? FINITE_BINS : Math.floor(elapsed * 10);
  value.bins[bin]++;
}

function quantile(bins, count, probability) {
  if (!count) return null;
  const rank = Math.ceil(count * probability);
  let total = 0;
  for (let index = 0; index < bins.length; index++) {
    total += bins[index];
    if (total >= rank) return index === FINITE_BINS
      ? {lowerMs: UPPER_LIMIT_MS, upperMs: null, upperExclusive: false, overflow: true}
      : {lowerMs: index / 10, upperMs: (index + 1) / 10, upperExclusive: true, overflow: false};
  }
  return null;
}

function snapshotSpan(value) {
  return {validBlocks: value.validBlocks, invalidBlocks: value.invalidBlocks,
    totalMs: value.totalMs, meanMs: value.validBlocks ? value.totalMs / value.validBlocks : null,
    maxMs: value.validBlocks ? value.maxMs : null,
    rawOverBudgetBlocks: value.rawOverBudgetBlocks,
    quantizationSensitiveOverBudgetBlocks: value.quantizationSensitiveOverBudgetBlocks,
    beyondQuantumOverBudgetBlocks: value.beyondQuantumOverBudgetBlocks,
    histogram: {binWidthMs: BIN_WIDTH_MS, upperLimitMs: UPPER_LIMIT_MS,
      bins: Array.from(value.bins.subarray(0, FINITE_BINS)), overflowCount: value.bins[FINITE_BINS]},
    quantiles: {p50: quantile(value.bins, value.validBlocks, .5),
      p95: quantile(value.bins, value.validBlocks, .95), p99: quantile(value.bins, value.validBlocks, .99)}};
}

/** Fixed-size aggregates for one already-armed render window.
 *
 * record(renderMs, totalMs, frames, startMs?) accepts wall-clock durations, not
 * audio currentTime/currentFrame. renderMs covers original process(); totalMs
 * may additionally cover an observer scan. The caller reads the final timer
 * before record(), so these aggregates' own update cost is outside both spans.
 *
 * quantumMs is a declared timer-quantization assumption, not a measured bound.
 * Subtracting it only classifies observed spans conditionally. Even an elapsed
 * span beyond this allowance can include OS descheduling and cannot identify a
 * device underrun or CPU execution time. Optional startMs observations describe
 * callback-start wall-clock deltas; batched callbacks need not be underruns.
 */
export class SidWorkletMetrics {
  constructor({sampleRate, timerSource = 'Date.now', quantumMs = 1} = {}) {
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000)
      throw new RangeError('SID metrics sampleRate must be 8000..96000 Hz');
    if (typeof timerSource !== 'string' || !timerSource || timerSource.length > 80)
      throw new TypeError('SID metrics timerSource must be a short nonempty string');
    if (!Number.isFinite(quantumMs) || quantumMs < 0 || quantumMs > 1000)
      throw new RangeError('SID metrics quantumMs must be 0..1000 ms');
    this.sampleRate = sampleRate; this.timerSource = timerSource; this.quantumMs = quantumMs;
    this.blocks = 0; this.frames = 0; this.invalidFrameBlocks = 0;
    this.render = span(); this.total = span(); this.inconsistentSpans = 0;
    this.clockStarts = 0; this.lastStartMs = NaN; this.minPositiveStartDeltaMs = Infinity;
    this.negativeStartDeltas = 0; this.nonfiniteStarts = 0;
  }

  record(renderMs, totalMs, frames, startMs) {
    this.blocks++;
    if (!Number.isInteger(frames) || frames <= 0 || frames > 65536) {this.invalidFrameBlocks++; return;}
    this.frames += frames;
    const budget = frames / this.sampleRate * 1000;
    add(this.render, renderMs, budget, this.quantumMs);
    add(this.total, totalMs, budget, this.quantumMs);
    if (Number.isFinite(renderMs) && renderMs >= 0 && Number.isFinite(totalMs) && totalMs >= 0 && totalMs < renderMs)
      this.inconsistentSpans++;
    if (startMs !== undefined) {
      if (!Number.isFinite(startMs)) {this.nonfiniteStarts++; this.lastStartMs = NaN; return;}
      this.clockStarts++;
      const delta = startMs - this.lastStartMs;
      if (delta > 0 && delta < this.minPositiveStartDeltaMs) this.minPositiveStartDeltaMs = delta;
      else if (delta < 0) this.negativeStartDeltas++;
      this.lastStartMs = startMs;
    }
  }

  snapshot() {
    return {blocks: this.blocks, frames: this.frames, invalidFrameBlocks: this.invalidFrameBlocks,
      sampleRate: this.sampleRate, timerSource: this.timerSource, quantumMs: this.quantumMs,
      render: snapshotSpan(this.render), total: snapshotSpan(this.total), inconsistentSpans: this.inconsistentSpans,
      clock: {starts: this.clockStarts, minPositiveStartDeltaMs: Number.isFinite(this.minPositiveStartDeltaMs) ? this.minPositiveStartDeltaMs : null,
        negativeStartDeltas: this.negativeStartDeltas, nonfiniteStarts: this.nonfiniteStarts},
      interpretation: {measurement: 'Observed wall-clock spans, including possible descheduling; not CPU execution time.',
        quantumMs: 'Declared quantization allowance, not a proven timer-resolution bound.',
        beyondQuantumOverBudgetBlocks: 'Conditional wall-span classification after subtracting quantumMs; not confirmed device underruns.',
        quantiles: 'Nearest-rank histogram intervals; upperMs is exclusive, and null for overflow. No interpolation.',
        observerUpdate: 'record() aggregate updates and snapshot() are outside the timed spans.',
        callbackStartDeltas: 'Callback-start wall-clock deltas, not measured timer resolution or device-gap evidence.'}};
  }
}
