import {validateAy8910} from './ay8910.js';
import {validateAyOperationState} from './ay8910_operations.js';

export const AY_TIMED_STATE_FORMAT = 'tetorica-ay8910-state';
export const AY_TIMED_STATE_VERSION = 1;

function identity(value) {
  if ((typeof value === 'string' && value.length > 0 && value.length <= 256) ||
      (Number.isSafeInteger(value) && value > 0)) return value;
  throw new TypeError('AY state snapshot requires a chip instance identity');
}

/** A detached register/control snapshot, not an audio-engine save state. */
export function createAyTimedSnapshot(state, {instanceId, clock, type = 0, flags = 1, frame, sampleRate} = {}) {
  const data = validateAyOperationState(state);
  identity(instanceId);
  if (!Number.isInteger(clock) || clock <= 0) throw new RangeError('AY state snapshot clock is required');
  validateAy8910({clock, type, flags, sampleRate});
  if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError('AY state snapshot frame must be a nonnegative safe integer');
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new RangeError('AY state snapshot sample rate is required');
  Object.freeze(data.registers);
  Object.freeze(data.levels);
  return Object.freeze({
    format: AY_TIMED_STATE_FORMAT, version: AY_TIMED_STATE_VERSION,
    instanceId, clock, type, flags,
    registers: data.registers, levels: data.levels, frame, sampleRate,
  });
}

/** Validate provenance/configuration and return a new independently owned value. */
export function validateAyTimedSnapshot(snapshot, expected = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError('Expected an AY compilation state snapshot');
  const allowed = ['format','version','instanceId','clock','type','flags','registers','levels','frame','sampleRate'];
  for (const key of Reflect.ownKeys(snapshot)) {
    const descriptor = Object.getOwnPropertyDescriptor(snapshot, key);
    if (typeof key !== 'string' || !allowed.includes(key) || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Invalid AY state snapshot fields');
  }
  if (allowed.some(key => !Object.hasOwn(snapshot, key))) throw new TypeError('Incomplete AY state snapshot');
  if (snapshot.format !== AY_TIMED_STATE_FORMAT || snapshot.version !== AY_TIMED_STATE_VERSION) throw new TypeError('Unsupported AY state snapshot format or version');
  const copy = createAyTimedSnapshot(snapshot, snapshot);
  for (const key of ['instanceId','clock','type','flags']) {
    if (expected[key] !== undefined && copy[key] !== expected[key]) throw new Error(`Incompatible AY state snapshot ${key}`);
  }
  return copy;
}
