// SPDX-License-Identifier: BSD-3-Clause
import {validateGameboyOperationState} from './gameboy_operations.js?v=gameboy-timed-1';

export const GAMEBOY_TIMED_STATE_FORMAT = 'tetorica-gameboy-state';
export const GAMEBOY_TIMED_STATE_VERSION = 1;

/** Detached operation-resolution state, not an oscillator/audio save state. */
export function createGameboyTimedSnapshot(state, {instanceId, frame, sampleRate} = {}) {
  const copy = validateGameboyOperationState(state);
  if (!((typeof instanceId === 'string' && instanceId.length > 0 && instanceId.length <= 256) ||
      (Number.isSafeInteger(instanceId) && instanceId > 0))) throw TypeError('GAMEBOY snapshot requires an instance identity');
  if (!Number.isSafeInteger(frame) || frame < 0) throw RangeError('Invalid GAMEBOY snapshot frame');
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw RangeError('Invalid GAMEBOY snapshot sample rate');
  Object.freeze(copy.registers); Object.freeze(copy.voice);
  return Object.freeze({format:GAMEBOY_TIMED_STATE_FORMAT, version:GAMEBOY_TIMED_STATE_VERSION,
    instanceId, frame, sampleRate, state:Object.freeze(copy)});
}

export function validateGameboyTimedSnapshot(snapshot, expected = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw TypeError('Expected GAMEBOY snapshot');
  const fields = ['format','version','instanceId','frame','sampleRate','state'];
  for (const key of Reflect.ownKeys(snapshot)) {
    if (!fields.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(snapshot,key),'value')) throw TypeError('Invalid GAMEBOY snapshot fields');
  }
  if (fields.some(key => !Object.hasOwn(snapshot,key))) throw TypeError('Incomplete GAMEBOY snapshot');
  if (snapshot.format !== GAMEBOY_TIMED_STATE_FORMAT || snapshot.version !== GAMEBOY_TIMED_STATE_VERSION) throw TypeError('Unsupported GAMEBOY snapshot format or version');
  const copy = createGameboyTimedSnapshot(snapshot.state,snapshot);
  if (expected.instanceId !== undefined && copy.instanceId !== expected.instanceId) throw Error('Incompatible GAMEBOY snapshot instance');
  if (expected.clock !== undefined && copy.state.clock !== expected.clock) throw Error('Incompatible GAMEBOY snapshot clock');
  return copy;
}
