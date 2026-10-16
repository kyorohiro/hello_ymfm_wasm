export const MONITOR_RANGES = Object.freeze([
  'auto', '2', '1', '0.5', '0.2', '0.1', '0.05', '0.02', '0.01', '0.005', '0.001',
]);

export function normalizeMonitorRange(value) {
  return MONITOR_RANGES.includes(value) ? value : 'auto';
}

/** Compact real amplitudes for axes, including negative values and tiny signals. */
export function formatMonitorAmplitude(value) {
  if (!Number.isFinite(value) || value === 0) return '0';
  const rounded = Number(value.toPrecision(3));
  if (Math.abs(value) < 1e-6 || !Number.isFinite(rounded)) {
    return value.toExponential(2).replace(/\.?0+e/, 'e');
  }
  return String(rounded);
}

/** Auto range: instant headroom on growth, slow release, and hold during silence.
 * update() accepts an absolute peak and a monotonic timestamp in milliseconds.
 * Fixed ranges belong to the view; this helper only tracks the auto range.
 */
export function createMonitorScale() {
  let range = 1, hasSignal = false, lastTime = null;

  function reset() {
    range = 1;
    hasSignal = false;
    lastTime = null;
  }

  function update(peak, timeMs) {
    let elapsed = 0;
    if (Number.isFinite(timeMs) && timeMs >= 0) {
      if (lastTime !== null && timeMs >= lastTime) elapsed = Math.min(250, timeMs - lastTime);
      if (lastTime === null || timeMs >= lastTime) lastTime = timeMs;
    }
    // Ignore numerical residue as well as invalid samples. In particular,
    // silence must not make a previously useful scale collapse toward zero.
    if (!Number.isFinite(peak) || peak < 1e-6) return range;
    const target = Math.max(.001, Math.min(Number.MAX_VALUE, peak * 1.25));
    if (!hasSignal || target >= range) {
      range = target;
      hasSignal = true;
    } else if (elapsed > 0) {
      range = Math.min(Number.MAX_VALUE, target + (range - target) * Math.exp(-elapsed / 1500));
    }
    return range;
  }

  return {reset, update};
}
