import {validateYm2612OperationState} from './ym2612_operation_state.js?v=audio-stability-2';

/** @typedef {import('./ym2612_operation_state.js?v=audio-stability-2').YM2612OperationState} YM2612OperationState */
/** @typedef {{instanceId:string|number,clock:number,engine?:'ymfm'|'nuked',frame:number,sampleRate:number}} YM2612SnapshotConfiguration */
/** @typedef {Readonly<YM2612OperationState & {format:'tetorica-ym2612-state',version:1,instanceId:string|number,clock:number,engine:'ymfm'|'nuked',frame:number,sampleRate:number}>} YM2612TimedSnapshot */

export const YM2612_TIMED_STATE_FORMAT = 'tetorica-ym2612-state';
export const YM2612_TIMED_STATE_VERSION = 1;

function identity(value) {
  if ((typeof value === 'string' && value.length > 0 && value.length <= 256) ||
      (Number.isSafeInteger(value) && value > 0)) return value;
  throw new TypeError('YM2612 state snapshot requires a chip instance identity');
}

/** Detached operation-resolution state. It does not restore oscillator phases,
 * envelopes or an audio engine; capture and compilation never stop playback.
 * @param {YM2612OperationState} state
 * @param {YM2612SnapshotConfiguration} configuration
 * @returns {YM2612TimedSnapshot} */
export function createYm2612TimedSnapshot(state, {instanceId, clock, engine = 'ymfm', frame, sampleRate} = {}) {
  const data = validateYm2612OperationState(state);
  identity(instanceId);
  if (!Number.isFinite(clock) || clock <= 0) throw new RangeError('YM2612 state snapshot clock must be positive finite Hz');
  if (!['ymfm', 'nuked'].includes(engine)) throw new TypeError('Unsupported YM2612 state snapshot engine');
  if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError('YM2612 state snapshot frame must be a nonnegative safe integer');
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new RangeError('YM2612 state snapshot sample rate is required');
  for (const row of data.registers) Object.freeze(row);
  for (const value of Object.values(data)) Object.freeze(value);
  return Object.freeze({format: YM2612_TIMED_STATE_FORMAT, version: YM2612_TIMED_STATE_VERSION,
    instanceId, clock, engine, ...data, frame, sampleRate});
}

/** Reject incompatible provenance/configuration and return independent data.
 * @param {unknown} snapshot
 * @param {{instanceId?:string|number,clock?:number,engine?:'ymfm'|'nuked'}} [expected]
 * @returns {YM2612TimedSnapshot} */
export function validateYm2612TimedSnapshot(snapshot, expected = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError('Expected a YM2612 compilation state snapshot');
  const allowed = ['format', 'version', 'instanceId', 'clock', 'engine', 'registers',
    'frequencyLatches', 'pitches', 'specialPitches', 'keyMasks', 'frame', 'sampleRate'];
  for (const key of Reflect.ownKeys(snapshot)) {
    const descriptor = Object.getOwnPropertyDescriptor(snapshot, key);
    if (typeof key !== 'string' || !allowed.includes(key) || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Invalid YM2612 state snapshot fields');
  }
  if (allowed.some(key => !Object.hasOwn(snapshot, key))) throw new TypeError('Incomplete YM2612 state snapshot');
  if (snapshot.format !== YM2612_TIMED_STATE_FORMAT || snapshot.version !== YM2612_TIMED_STATE_VERSION) throw new TypeError('Unsupported YM2612 state snapshot format or version');
  const copy = createYm2612TimedSnapshot(snapshot, snapshot);
  for (const key of ['instanceId', 'clock', 'engine']) {
    if (expected[key] !== undefined && copy[key] !== expected[key]) throw new Error(`Incompatible YM2612 state snapshot ${key}`);
  }
  return copy;
}
