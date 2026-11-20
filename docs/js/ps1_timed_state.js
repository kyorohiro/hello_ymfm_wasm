import {validatePs1OperationState} from './ps1_operations.js?v=ps1-deferred-release-1';

export const PS1_TIMED_STATE_FORMAT = 'tetorica-ps1-state';
export const PS1_TIMED_STATE_VERSION = 1;

/** Detached operation-resolution state, not an oscillator/audio save state. */
export function createPs1TimedSnapshot(state, {instanceId, frame, sampleRate} = {}) {
  const copy = validatePs1OperationState(state);
  if (!((typeof instanceId === 'string' && instanceId.length > 0 && instanceId.length <= 256) ||
      (Number.isSafeInteger(instanceId) && instanceId > 0))) throw TypeError('PS1 snapshot requires an instance identity');
  if (!Number.isSafeInteger(frame) || frame < 0) throw RangeError('Invalid PS1 snapshot frame');
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw RangeError('Invalid PS1 snapshot sample rate');
  const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
  freeze(copy);
  return Object.freeze({format:PS1_TIMED_STATE_FORMAT, version:PS1_TIMED_STATE_VERSION,
    instanceId, frame, sampleRate, state:Object.freeze(copy)});
}

export function validatePs1TimedSnapshot(snapshot, expected = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw TypeError('Expected PS1 snapshot');
  const fields = ['format','version','instanceId','frame','sampleRate','state'];
  for (const key of Reflect.ownKeys(snapshot)) {
    if (!fields.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(snapshot,key),'value')) throw TypeError('Invalid PS1 snapshot fields');
  }
  if (fields.some(key => !Object.hasOwn(snapshot,key))) throw TypeError('Incomplete PS1 snapshot');
  if (snapshot.format !== PS1_TIMED_STATE_FORMAT || snapshot.version !== PS1_TIMED_STATE_VERSION) throw TypeError('Unsupported PS1 snapshot format or version');
  const copy = createPs1TimedSnapshot(snapshot.state,snapshot);
  if (expected.instanceId !== undefined && copy.instanceId !== expected.instanceId) throw Error('Incompatible PS1 snapshot instance');
  return copy;
}
