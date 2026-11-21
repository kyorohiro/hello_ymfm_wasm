import {validateSnesOperationState} from './snes_operation_state.js';

/** @typedef {import('./snes_operation_state.js').SnesOperationState} SNESOperationState */
/** @typedef {{instanceId:string|number,clock:number,engine?:'snes-wasm',frame:number,sampleRate:number}} SNESSnapshotConfiguration */
/** @typedef {Readonly<SNESOperationState & {format:'tetorica-snes-state',version:1,instanceId:string|number,clock:number,engine:'snes-wasm',frame:number,sampleRate:number}>} SNESTimedSnapshot */

export const SNES_TIMED_STATE_FORMAT = 'tetorica-snes-state';
export const SNES_TIMED_STATE_VERSION = 1;

function identity(value) {
  if ((typeof value === 'string' && value.length > 0 && value.length <= 256) ||
      (Number.isSafeInteger(value) && value > 0)) return value;
  throw new TypeError('SNES state snapshot requires a chip instance identity');
}

/** Detached operation-resolution state. It does not restore oscillator phases,
 * envelopes or an audio engine; capture and compilation never stop playback.
 * @param {SNESOperationState} state
 * @param {SNESSnapshotConfiguration} configuration
 * @returns {SNESTimedSnapshot} */
export function createSnesTimedSnapshot(state, {instanceId, clock, engine = 'snes-wasm', frame, sampleRate} = {}) {
  const data = validateSnesOperationState(state);
  identity(instanceId);
  if (!Number.isFinite(clock) || clock <= 0) throw new RangeError('SNES state snapshot clock must be positive finite Hz');
  if (!['snes-wasm'].includes(engine)) throw new TypeError('Unsupported SNES state snapshot engine');
  if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError('SNES state snapshot frame must be a nonnegative safe integer');
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new RangeError('SNES state snapshot sample rate is required');
  const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}};freeze(data);
  return Object.freeze({format: SNES_TIMED_STATE_FORMAT, version: SNES_TIMED_STATE_VERSION,
    instanceId, clock, engine, ...data, frame, sampleRate});
}

/** Reject incompatible provenance/configuration and return independent data.
 * @param {unknown} snapshot
 * @param {{instanceId?:string|number,clock?:number,engine?:'snes-wasm'}} [expected]
 * @returns {SNESTimedSnapshot} */
export function validateSnesTimedSnapshot(snapshot, expected = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError('Expected a SNES compilation state snapshot');
  const allowed = ['format', 'version', 'instanceId', 'clock', 'engine', 'registers','sampleRate','samples','channels','nextAddress','directoryAddress','maxSampleBytes','echo','nativeFrames','pendingKon','konFrame','koff', 'frame', 'sampleRate'];
  for (const key of Reflect.ownKeys(snapshot)) {
    const descriptor = Object.getOwnPropertyDescriptor(snapshot, key);
    if (typeof key !== 'string' || !allowed.includes(key) || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Invalid SNES state snapshot fields');
  }
  if (allowed.some(key => !Object.hasOwn(snapshot, key))) throw new TypeError('Incomplete SNES state snapshot');
  if (snapshot.format !== SNES_TIMED_STATE_FORMAT || snapshot.version !== SNES_TIMED_STATE_VERSION) throw new TypeError('Unsupported SNES state snapshot format or version');
  const copy = createSnesTimedSnapshot(snapshot, snapshot);
  for (const key of ['instanceId', 'clock', 'engine']) {
    if (expected[key] !== undefined && copy[key] !== expected[key]) throw new Error(`Incompatible SNES state snapshot ${key}`);
  }
  return copy;
}
