// SPDX-License-Identifier: BSD-3-Clause
// Original scalar analysis, independent of any SID implementation.
const METHOD = 'Unique descending LP/HP amplitude=1 crossing; linear log-ratio interpolation in log-frequency. Operational crossover, not an arbitrary-Q -3dB cutoff.';
const IDEAL_SLOPE_DB_PER_OCTAVE = -40 * Math.log10(2);

/**
 * Estimate an apparent LP/HP crossover from same-harmonic measurements.
 *
 * Each row is {hz, lp, hp, valid:true, clipped?:boolean|number, stable?:boolean}.
 * lp/hp are nonnegative amplitudes measured under otherwise identical drive,
 * timing and output conditions. In an ideal common-denominator two-integrator
 * filter LP/HP=(f0/f)^2; Q and shared downstream gain/RC then cancel. Mode gain,
 * nonlinearity and aliasing need not cancel in a real SID or an approximation.
 * No PCM or amplitudes are corrected or fitted by this function.
 *
 * Invalid tails are explicitly excluded. Missing data inside the crossing
 * bracket, multiple crossings and nonmonotonic excursions are rejected.
 * Thresholds are analysis policy, not hardware specifications.
 */
export function cutoffCrossing(rows, options = {}) {
  const {minAmplitude = 8 / 32768, monotonicToleranceDb = 0.5, minPoints = 3} = options ?? {};
  const result = {
    estimatedHz: null,
    reason: null,
    points: [],
    excludedPoints: [],
    bracketHz: null,
    bracketLogRatioDb: null,
    bracketSlopeDbPerOctave: null,
    idealSlopeDbPerOctave: IDEAL_SLOPE_DB_PER_OCTAVE,
    method: METHOD,
    thresholds: {minAmplitude, monotonicToleranceDb, minPoints},
    inputPointCount: Array.isArray(rows) ? rows.length : 0,
    validPointCount: 0,
  };
  const reject = reason => ({...result, reason});
  if (!Number.isFinite(minAmplitude) || minAmplitude < 0
      || !Number.isFinite(monotonicToleranceDb) || monotonicToleranceDb < 0
      || !Number.isSafeInteger(minPoints) || minPoints < 3) return reject('invalid-options');
  if (!Array.isArray(rows)) return reject('invalid-rows');

  const ordered = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!row || typeof row !== 'object') return reject('invalid-row');
    if (!Number.isFinite(row.hz) || row.hz <= 0) return reject('invalid-frequency');
    ordered.push({row, index});
  }
  ordered.sort((a, b) => a.row.hz - b.row.hz);
  if (ordered.some((x, i) => i && x.row.hz === ordered[i - 1].row.hz)) return reject('duplicate-frequency');

  for (const {row, index} of ordered) {
    let reason;
    if (row.valid !== true) reason = 'rejected-by-caller';
    else if (!Number.isFinite(row.lp) || !Number.isFinite(row.hp) || row.lp <= 0 || row.hp <= 0) reason = 'invalid-amplitude';
    else if (row.lp < minAmplitude || row.hp < minAmplitude) reason = 'weak-amplitude';
    else if (row.clipped === true || (typeof row.clipped === 'number' && row.clipped > 0)) reason = 'clipped';
    else if (row.clipped !== undefined && row.clipped !== false && row.clipped !== 0) reason = 'invalid-clipping-flag';
    else if (row.stable === false) reason = 'unstable';
    else if (row.stable !== undefined && row.stable !== true) reason = 'invalid-stability-flag';
    if (reason) {
      result.excludedPoints.push({index, hz: row.hz, reason});
      continue;
    }
    const logRatioDb = 20 * (Math.log10(row.lp) - Math.log10(row.hp));
    if (!Number.isFinite(logRatioDb)) return reject('nonfinite-ratio');
    result.points.push({index, hz: row.hz, lp: row.lp, hp: row.hp, logRatioDb});
  }
  result.validPointCount = result.points.length;
  if (result.points.length < minPoints) return reject('insufficient-valid-points');

  const points = result.points;
  const exact = points.flatMap((p, i) => p.logRatioDb === 0 ? [i] : []);
  const crossings = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (a.logRatioDb * b.logRatioDb < 0) crossings.push([i - 1, i]);
  }
  if (exact.length + crossings.length > 1) return reject('multiple-crossings');
  if (exact.length + crossings.length === 0) return reject('no-crossing');

  let left, right, estimatedHz;
  if (exact.length) {
    const i = exact[0];
    if (i === 0 || i === points.length - 1) return reject('unbracketed-equality');
    left = points[i - 1]; right = points[i + 1];
    estimatedHz = points[i].hz;
  } else {
    [left, right] = crossings[0].map(i => points[i]);
  }
  result.bracketHz = [left.hz, right.hz];
  result.bracketLogRatioDb = [left.logRatioDb, right.logRatioDb];
  if (left.logRatioDb <= 0 || right.logRatioDb >= 0) return reject('wrong-crossing-direction');
  if (result.excludedPoints.some(p => p.hz > left.hz && p.hz < right.hz)) return reject('invalid-data-inside-bracket');
  for (let i = 1; i < points.length; i++) {
    if (points[i].logRatioDb - points[i - 1].logRatioDb > monotonicToleranceDb) return reject('nonmonotonic-ratio');
  }

  const logLeft = Math.log(left.hz), logRight = Math.log(right.hz);
  const dbDifference = right.logRatioDb - left.logRatioDb;
  result.bracketSlopeDbPerOctave = dbDifference / ((logRight - logLeft) / Math.log(2));
  if (estimatedHz === undefined) {
    const fraction = -left.logRatioDb / dbDifference;
    estimatedHz = Math.exp(logLeft + fraction * (logRight - logLeft));
  }
  if (!Number.isFinite(estimatedHz) || estimatedHz <= left.hz || estimatedHz >= right.hz) return reject('invalid-interpolation');
  result.estimatedHz = estimatedHz;
  return result;
}
