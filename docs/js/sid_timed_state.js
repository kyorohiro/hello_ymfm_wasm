// SPDX-License-Identifier: BSD-3-Clause
import {validateSidOperationState} from './sid_operations.js?v=sid-timed-1';

export const SID_TIMED_STATE_FORMAT = 'tetorica-sid-state';
export const SID_TIMED_STATE_VERSION = 1;

/** Detached operation-resolution baseline; not an audio/C64 save state. */
export function createSidTimedSnapshot(state, {instanceId, frame, sampleRate} = {}) {
  const copy = validateSidOperationState(state);
  if (!((typeof instanceId === 'string' && instanceId.length > 0 && instanceId.length <= 256) ||
      (Number.isSafeInteger(instanceId) && instanceId > 0))) throw TypeError('SID snapshot requires an instance identity');
  if (!Number.isSafeInteger(frame) || frame < 0) throw RangeError('Invalid SID snapshot frame');
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw RangeError('Invalid SID snapshot sample rate');
  Object.freeze(copy.registers);
  return Object.freeze({format:SID_TIMED_STATE_FORMAT, version:SID_TIMED_STATE_VERSION,
    instanceId, frame, sampleRate, state:Object.freeze(copy)});
}

export function validateSidTimedSnapshot(snapshot, expected = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(snapshot))) throw TypeError('Expected SID snapshot');
  const fields = ['format','version','instanceId','frame','sampleRate','state'];
  for (const key of Reflect.ownKeys(snapshot)) {
    if (!fields.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(snapshot,key),'value')) throw TypeError('Invalid SID snapshot fields');
  }
  if (fields.some(key => !Object.hasOwn(snapshot,key))) throw TypeError('Incomplete SID snapshot');
  if (snapshot.format !== SID_TIMED_STATE_FORMAT || snapshot.version !== SID_TIMED_STATE_VERSION) throw TypeError('Unsupported SID snapshot format or version');
  const copy = createSidTimedSnapshot(snapshot.state, snapshot);
  if (expected.instanceId !== undefined && copy.instanceId !== expected.instanceId) throw Error('Incompatible SID snapshot instance');
  if (expected.clock !== undefined && copy.state.clock !== expected.clock) throw Error('Incompatible SID snapshot clock');
  if (expected.model !== undefined && copy.state.model !== expected.model) throw Error('Incompatible SID snapshot model');
  return copy;
}
