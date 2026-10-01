/** Resolve a note length once, before any sound is started. Legacy units differ by API. */
export function resolvePlaySeconds(options, bpm, legacyUnit = 'seconds', defaultDuration = 0.2) {
  const keys = ['beats', 'seconds', 'duration'].filter(key => options[key] !== undefined);
  if (keys.length > 1) throw new TypeError('Specify only one of beats, seconds or duration');
  const key = keys[0] ?? 'duration';
  const value = key === 'duration' ? options.duration ?? defaultDuration : options[key];
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Note duration must be a finite nonnegative number');
  if (key === 'seconds' || (key === 'duration' && legacyUnit === 'seconds')) return value;
  if (!Number.isFinite(bpm) || bpm <= 0) throw new RangeError('BPM must be positive');
  const seconds = value * (60 / bpm);
  if (!Number.isFinite(seconds)) throw new RangeError('Note duration is too large');
  return seconds;
}
