// SPDX-License-Identifier: BSD-3-Clause
import {validateWonderSwanOperationState} from './wonderswan_operations.js';

export const WONDERSWAN_TIMED_STATE_FORMAT = 'tetorica-wonderswan-state';
export const WONDERSWAN_TIMED_STATE_VERSION = 1;

/** Detached operation-resolution state, not an oscillator/audio save state. */
export function createWonderSwanTimedSnapshot(state, {instanceId, frame, sampleRate} = {}) {
  const copy = validateWonderSwanOperationState(state);
  if (!((typeof instanceId === 'string' && instanceId.length > 0 && instanceId.length <= 256) ||
      (Number.isSafeInteger(instanceId) && instanceId > 0))) throw TypeError('WONDERSWAN snapshot requires an instance identity');
  if (!Number.isSafeInteger(frame) || frame < 0) throw RangeError('Invalid WONDERSWAN snapshot frame');
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw RangeError('Invalid WONDERSWAN snapshot sample rate');
  Object.freeze(copy.registers); Object.freeze(copy.memory);
  return Object.freeze({format:WONDERSWAN_TIMED_STATE_FORMAT, version:WONDERSWAN_TIMED_STATE_VERSION,
    instanceId, frame, sampleRate, state:Object.freeze(copy)});
}

export function validateWonderSwanTimedSnapshot(snapshot, expected = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw TypeError('Expected WONDERSWAN snapshot');
  const fields = ['format','version','instanceId','frame','sampleRate','state'];
  for (const key of Reflect.ownKeys(snapshot)) {
    if (!fields.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(snapshot,key),'value')) throw TypeError('Invalid WONDERSWAN snapshot fields');
  }
  if (fields.some(key => !Object.hasOwn(snapshot,key))) throw TypeError('Incomplete WONDERSWAN snapshot');
  if (snapshot.format !== WONDERSWAN_TIMED_STATE_FORMAT || snapshot.version !== WONDERSWAN_TIMED_STATE_VERSION) throw TypeError('Unsupported WONDERSWAN snapshot format or version');
  const copy = createWonderSwanTimedSnapshot(snapshot.state,snapshot);
  if (expected.instanceId !== undefined && copy.instanceId !== expected.instanceId) throw Error('Incompatible WONDERSWAN snapshot instance');
  if (expected.clock !== undefined && copy.state.clock !== expected.clock) throw Error('Incompatible WONDERSWAN snapshot clock');
  return copy;
}
