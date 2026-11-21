import {validateNesOperationState} from './nes_operation_state.js';

/** @typedef {import('./nes_operation_state.js').NesOperationState} NESOperationState */
/** @typedef {{instanceId:string|number,clock:number,engine?:'nes-wasm',frame:number,sampleRate:number}} NESSnapshotConfiguration */
/** @typedef {Readonly<NESOperationState & {format:'tetorica-nes-state',version:1,instanceId:string|number,clock:number,engine:'nes-wasm',frame:number,sampleRate:number}>} NESTimedSnapshot */

export const NES_TIMED_STATE_FORMAT = 'tetorica-nes-state';
export const NES_TIMED_STATE_VERSION = 1;

function identity(value) {
  if ((typeof value === 'string' && value.length > 0 && value.length <= 256) ||
      (Number.isSafeInteger(value) && value > 0)) return value;
  throw new TypeError('NES state snapshot requires a chip instance identity');
}

/** Detached operation-resolution state. It does not restore oscillator phases,
 * envelopes or an audio engine; capture and compilation never stop playback.
 * @param {NESOperationState} state
 * @param {NESSnapshotConfiguration} configuration
 * @returns {NESTimedSnapshot} */
export function createNesTimedSnapshot(state, {instanceId, clock, engine = 'nes-wasm', frame, sampleRate} = {}) {
  const data = validateNesOperationState(state);
  identity(instanceId);
  if (!Number.isFinite(clock) || clock <= 0) throw new RangeError('NES state snapshot clock must be positive finite Hz');
  if (!['nes-wasm'].includes(engine)) throw new TypeError('Unsupported NES state snapshot engine');
  if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError('NES state snapshot frame must be a nonnegative safe integer');
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new RangeError('NES state snapshot sample rate is required');
  for (const row of data.registers) Object.freeze(row);
  for (const value of Object.values(data)) Object.freeze(value);
  return Object.freeze({format: NES_TIMED_STATE_FORMAT, version: NES_TIMED_STATE_VERSION,
    instanceId, clock, engine, ...data, frame, sampleRate});
}

/** Reject incompatible provenance/configuration and return independent data.
 * @param {unknown} snapshot
 * @param {{instanceId?:string|number,clock?:number,engine?:'nes-wasm'}} [expected]
 * @returns {NESTimedSnapshot} */
export function validateNesTimedSnapshot(snapshot, expected = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError('Expected a NES compilation state snapshot');
  const allowed = ['format', 'version', 'instanceId', 'clock', 'engine', 'registers','enabled','fdsActive','fdsGain','fdsMaster','sample', 'frame', 'sampleRate'];
  for (const key of Reflect.ownKeys(snapshot)) {
    const descriptor = Object.getOwnPropertyDescriptor(snapshot, key);
    if (typeof key !== 'string' || !allowed.includes(key) || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Invalid NES state snapshot fields');
  }
  if (allowed.some(key => !Object.hasOwn(snapshot, key))) throw new TypeError('Incomplete NES state snapshot');
  if (snapshot.format !== NES_TIMED_STATE_FORMAT || snapshot.version !== NES_TIMED_STATE_VERSION) throw new TypeError('Unsupported NES state snapshot format or version');
  const copy = createNesTimedSnapshot(snapshot, snapshot);
  for (const key of ['instanceId', 'clock', 'engine']) {
    if (expected[key] !== undefined && copy[key] !== expected[key]) throw new Error(`Incompatible NES state snapshot ${key}`);
  }
  return copy;
}
