// SPDX-License-Identifier: BSD-3-Clause
import {validateAswanOperationState} from './operations.js';

export const ASWAN_TIMED_STATE_FORMAT = 'tetorica-wonderswan-state';
export const ASWAN_TIMED_STATE_VERSION = 1;

/** Detached operation-resolution state, not an oscillator/audio save state. */
export function createAswanTimedSnapshot(state, {instanceId, frame, sampleRate} = {}) {
  const copy = validateAswanOperationState(state);
  if (!((typeof instanceId === 'string' && instanceId.length > 0 && instanceId.length <= 256) ||
      (Number.isSafeInteger(instanceId) && instanceId > 0))) throw TypeError('ASWAN snapshot requires an instance identity');
  if (!Number.isSafeInteger(frame) || frame < 0) throw RangeError('Invalid ASWAN snapshot frame');
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw RangeError('Invalid ASWAN snapshot sample rate');
  Object.freeze(copy.registers); Object.freeze(copy.memory);
  return Object.freeze({format:ASWAN_TIMED_STATE_FORMAT, version:ASWAN_TIMED_STATE_VERSION,
    instanceId, frame, sampleRate, state:Object.freeze(copy)});
}

export function validateAswanTimedSnapshot(snapshot, expected = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw TypeError('Expected ASWAN snapshot');
  const fields = ['format','version','instanceId','frame','sampleRate','state'];
  for (const key of Reflect.ownKeys(snapshot)) {
    if (!fields.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(snapshot,key),'value')) throw TypeError('Invalid ASWAN snapshot fields');
  }
  if (fields.some(key => !Object.hasOwn(snapshot,key))) throw TypeError('Incomplete ASWAN snapshot');
  if (snapshot.format !== ASWAN_TIMED_STATE_FORMAT || snapshot.version !== ASWAN_TIMED_STATE_VERSION) throw TypeError('Unsupported ASWAN snapshot format or version');
  const copy = createAswanTimedSnapshot(snapshot.state,snapshot);
  if (expected.instanceId !== undefined && copy.instanceId !== expected.instanceId) throw Error('Incompatible ASWAN snapshot instance');
  if (expected.clock !== undefined && copy.state.clock !== expected.clock) throw Error('Incompatible ASWAN snapshot clock');
  return copy;
}
