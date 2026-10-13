/** Resolve a note length once, before any sound is started. Legacy units differ by API. */
/**
 * @param {{beats?: number, seconds?: number, duration?: number}} options Specify at most one duration field.
 * @param {number} bpm Positive beats per minute when converting beats.
 * @param {'seconds' | 'beats'} [legacyUnit='seconds'] Unit of the legacy duration field and defaultDuration.
 * @param {number} [defaultDuration=0.2] Fallback in legacyUnit.
 * @returns {number} Finite nonnegative duration in seconds.
 * @throws {TypeError | RangeError} For conflicting fields or invalid duration/tempo.
 */
export function resolvePlaySeconds(options, bpm, legacyUnit = 'seconds', defaultDuration = 0.2) {
  const duration = resolvePlayDuration(options, legacyUnit, defaultDuration);
  if (duration.seconds !== undefined) return duration.seconds;
  if (!Number.isFinite(bpm) || bpm <= 0) throw new RangeError('BPM must be positive');
  const seconds = duration.beats * (60 / bpm);
  if (!Number.isFinite(seconds)) throw new RangeError('Note duration is too large');
  return seconds;
}

/** Preserve beats until the shared clock waits for the note; never freeze tempo here.
 * @param {{beats?:number,seconds?:number,duration?:number}} options
 * @param {'seconds'|'beats'} [legacyUnit]
 * @param {number} [defaultDuration]
 * @returns {{seconds?:number,beats?:number}}
 */
export function resolvePlayDuration(options, legacyUnit = 'seconds', defaultDuration = 0.2) {
  const keys = ['beats', 'seconds', 'duration'].filter(key => options[key] !== undefined);
  if (keys.length > 1) throw new TypeError('Specify only one of beats, seconds or duration');
  const key = keys[0] ?? 'duration';
  const value = key === 'duration' ? options.duration ?? defaultDuration : options[key];
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Note duration must be a finite nonnegative number');
  return key === 'seconds' || (key === 'duration' && legacyUnit === 'seconds') ? {seconds:value} : {beats:value};
}
