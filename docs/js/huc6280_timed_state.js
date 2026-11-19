import {validateHuc6280OperationState} from './huc6280_operations.js';

export const HUC6280_TIMED_STATE_FORMAT = 'tetorica-huc6280-state';
export const HUC6280_TIMED_STATE_VERSION = 1;

/** Detached operation-resolution state, not an oscillator/audio save state. */
export function createHuc6280TimedSnapshot(state, {instanceId, frame, sampleRate} = {}) {
  const copy = validateHuc6280OperationState(state);
  if (!((typeof instanceId === 'string' && instanceId.length > 0 && instanceId.length <= 256) ||
      (Number.isSafeInteger(instanceId) && instanceId > 0))) throw TypeError('HuC6280 snapshot requires an instance identity');
  if (!Number.isSafeInteger(frame) || frame < 0) throw RangeError('Invalid HuC6280 snapshot frame');
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw RangeError('Invalid HuC6280 snapshot sample rate');
  for (const rows of [copy.registers, copy.waveforms]) {
    rows.forEach(Object.freeze); Object.freeze(rows);
  }
  Object.freeze(copy.globals); Object.freeze(copy.indices);
  return Object.freeze({format:HUC6280_TIMED_STATE_FORMAT, version:HUC6280_TIMED_STATE_VERSION,
    instanceId, frame, sampleRate, state:Object.freeze(copy)});
}

export function validateHuc6280TimedSnapshot(snapshot, expected = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw TypeError('Expected HuC6280 snapshot');
  const fields = ['format','version','instanceId','frame','sampleRate','state'];
  for (const key of Reflect.ownKeys(snapshot)) {
    if (!fields.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(snapshot,key),'value')) throw TypeError('Invalid HuC6280 snapshot fields');
  }
  if (fields.some(key => !Object.hasOwn(snapshot,key))) throw TypeError('Incomplete HuC6280 snapshot');
  if (snapshot.format !== HUC6280_TIMED_STATE_FORMAT || snapshot.version !== HUC6280_TIMED_STATE_VERSION) throw TypeError('Unsupported HuC6280 snapshot format or version');
  const copy = createHuc6280TimedSnapshot(snapshot.state,snapshot);
  if (expected.instanceId !== undefined && copy.instanceId !== expected.instanceId) throw Error('Incompatible HuC6280 snapshot instance');
  if (expected.clock !== undefined && copy.state.clock !== expected.clock) throw Error('Incompatible HuC6280 snapshot clock');
  return copy;
}
