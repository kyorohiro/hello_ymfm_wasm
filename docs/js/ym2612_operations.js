import {YM2612Synth} from './ym2612synth.js?v=audio-stability-2';
import {createYm2612OperationResetState, validateYm2612OperationState, observeYm2612OperationWrite, adoptYm2612OperationState} from './ym2612_operation_state.js?v=audio-stability-2';
export {createYm2612OperationResetState, validateYm2612OperationState, observeYm2612OperationWrite} from './ym2612_operation_state.js?v=audio-stability-2';

/** @typedef {import('./ym2612_operation_state.js?v=audio-stability-2').YM2612OperationState} YM2612OperationState */
/** @typedef {'write'|'rawWrite'|'setPreset'|'setOperator'|'setOperators'|'setAlgo'|'setPan'|'setLfo'|'setChannel3SpecialMode'|'setChannel3SpecialFrequency'|'setFrequency'|'setNote'|'setBlockFnum'|'keyOn'|'keyOff'|'noteOn'|'noteOnRaw'|'noteOff'|'setDacEnabled'|'writeDac'} YM2612RecordedMethod */
/** @typedef {{unit:'sample'|'seconds',value:number}} YM2612OperationTime */
/** @typedef {{time:YM2612OperationTime,order:number,method:YM2612RecordedMethod,args:unknown[]}} YM2612TimedOperation */
/** @typedef {{version:1,chip:'ym2612',referenceSampleRate:number,operations:YM2612TimedOperation[]}} YM2612OperationProgram */
/** @typedef {{referenceSampleRate?:number}} YM2612BuildOptions */
/** @typedef {{port:number,register:number,value:number}} YM2612RegisterWrite */
/** @typedef {YM2612RegisterWrite & {offsetSeconds:number,operationIndex:number,writeIndex:number}} YM2612CompiledWrite */
/** @typedef {Omit<{[K in YM2612RecordedMethod]:(...args:Parameters<YM2612Synth[K]>)=>YM2612OperationRecorder},'noteOn'|'setFrequency'> & {
 * atSample(value:number):YM2612OperationRecorder,
 * atSeconds(value:number):YM2612OperationRecorder,
 * noteOn(...args:[channel:number,note:string|number]|[channel:number,block:number,fnum:number]):YM2612OperationRecorder,
 * setFrequency(...args:[channel:number,hz:number]|[channel:number,block:number,fnum:number]):YM2612OperationRecorder
 * }} YM2612OperationRecorder */

/** Register-only authoring calls supported by the YM2612 operation recorder.
 * Validation and register conversion remain in YM2612Synth. */
export const YM2612_OPERATION_ARITY = Object.freeze({
  write: [3, 3], rawWrite: [3, 3], setPreset: [2, 2],
  setOperator: [3, 3], setOperators: [2, 2], setAlgo: [2, 3],
  setPan: [3, 5], setLfo: [2, 2], setChannel3SpecialMode: [1, 1],
  setChannel3SpecialFrequency: [3, 3], setFrequency: [2, 3], setNote: [2, 2],
  setBlockFnum: [3, 3], keyOn: [1, 2], keyOff: [1, 2],
  noteOn: [2, 3], noteOnRaw: [3, 3], noteOff: [1, 1],
  setDacEnabled: [1, 1], writeDac: [1, 1],
});

export const YM2612_OPERATION_METHODS = Object.freeze(Object.keys(YM2612_OPERATION_ARITY));
export const MAX_YM2612_OPERATIONS = 4096;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function fields(value, names, label) {
  object(value, label);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !names.includes(key)) throw new TypeError(`Unknown ${label} field: ${String(key)}`);
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) {
      throw new TypeError(`${label} must not contain accessors`);
    }
  }
}

/** Operation arguments deliberately use a small structured-cloneable subset. */
function copyValue(value, stack = new Set(), depth = 0) {
  if (value === null || value === undefined || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('YM2612 operation numbers must be finite');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 1024) throw new RangeError('YM2612 operation string is too long');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('YM2612 operation arguments must be serializable data');
  if (depth >= 8 || stack.has(value)) throw new TypeError('YM2612 operation arguments must be bounded, acyclic data');
  if (!Array.isArray(value)) object(value, 'YM2612 operation argument');
  const keys = Reflect.ownKeys(value);
  if (keys.length > 32) throw new RangeError('YM2612 operation argument is too large');
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 16) throw new RangeError('YM2612 operation argument array is too large');
      const result = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('YM2612 operation arrays must contain plain values');
        result.push(copyValue(descriptor.value, stack, depth + 1));
      }
      for (const key of keys) if (key !== 'length' && !/^(0|[1-9]\d*)$/.test(String(key))) {
        throw new TypeError('YM2612 operation arrays must not contain extra properties');
      }
      return result;
    }
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) throw new TypeError('YM2612 operation arguments must not contain symbols or accessors');
      Object.defineProperty(result, key, {value: copyValue(descriptor.value, stack, depth + 1), enumerable: true, writable: true, configurable: true});
    }
    return result;
  } finally {
    stack.delete(value);
  }
}

function referenceRate(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('referenceSampleRate must be a positive safe integer');
  return value;
}

function copyTime(time) {
  fields(time, ['unit', 'value'], 'YM2612 operation time');
  const {unit, value} = time;
  if (!['sample', 'seconds'].includes(unit)) throw new TypeError('YM2612 operation time unit must be sample or seconds');
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER ||
      (unit === 'sample' && !Number.isSafeInteger(value))) {
    throw new RangeError('YM2612 operation offset must be nonnegative and samples must be safe integers');
  }
  return {unit, value};
}

function copyCall(operation, arity = YM2612_OPERATION_ARITY) {
  const method = operation?.method;
  if (typeof method !== 'string' || !Object.hasOwn(arity, method)) throw new TypeError(`Unsupported YM2612 operation: ${String(method)}`);
  if (!Array.isArray(operation.args)) throw new TypeError('YM2612 operation args must be an array');
  const [min, max] = arity[method];
  if (operation.args.length < min || operation.args.length > max) throw new TypeError(`Invalid argument count for YM2612 ${method}`);
  return {method, args: copyValue(operation.args)};
}

/** @param {YM2612TimedOperation} operation @param {number} [referenceSampleRate]
 * @returns {number} */
export function ym2612OperationOffsetSeconds(operation, referenceSampleRate = 44100) {
  referenceRate(referenceSampleRate);
  const time = copyTime(operation.time);
  return time.unit === 'sample' ? time.value / referenceSampleRate : time.value;
}

/** Copies/validates data without evaluating chip operations or reading state. */
function copyProgram(plan, {chip = 'ym2612', arity = YM2612_OPERATION_ARITY} = {}) {
  fields(plan, ['version', 'chip', 'referenceSampleRate', 'operations'], 'YM2612 operation program');
  if (plan.version !== 1 || plan.chip !== chip) throw new TypeError(`Unsupported ${chip.toUpperCase()} operation program version or chip`);
  const rate = referenceRate(plan.referenceSampleRate);
  if (!Array.isArray(plan.operations) || plan.operations.length > MAX_YM2612_OPERATIONS) throw new RangeError(`YM2612 programs support at most ${MAX_YM2612_OPERATIONS} operations`);
  let previous = 0;
  const operations = Array.from(plan.operations, (operation, index) => {
    fields(operation, ['time', 'order', 'method', 'args'], 'YM2612 operation');
    if (operation.order !== index) throw new TypeError('YM2612 operation order must match authored order');
    const time = copyTime(operation.time), call = copyCall(operation, arity);
    const offset = time.unit === 'sample' ? time.value / rate : time.value;
    if (offset < previous) throw new RangeError('YM2612 operation offsets must be nondecreasing');
    previous = offset;
    return {time, order: index, ...call};
  });
  return {version: 1, chip, referenceSampleRate: rate, operations};
}

/** Record once. This function never constructs a chip or resolves register bytes.
 * Offsets are absolute from reservation start and independent of output rate.
 * @param {(builder:YM2612OperationRecorder)=>void} callback
 * @param {YM2612BuildOptions} [options] @returns {YM2612OperationProgram} */
export function buildYm2612Operations(callback, options = {}) {
  return recordOpnOperations(callback, options);
}

/** Record register operations for an OPN profile using its supported methods. */
export function recordOpnOperations(callback, options, {chip = 'ym2612', arity = YM2612_OPERATION_ARITY} = {}) {
  if (typeof callback !== 'function') throw new TypeError('YM2612 build requires a synchronous callback');
  fields(options, ['referenceSampleRate'], 'YM2612 build options');
  const rate = referenceRate(options.referenceSampleRate ?? 44100), operations = [];
  let time = {unit: 'sample', value: 0}, active = true, previous = 0;
  const check = () => { if (!active) throw new Error('YM2612 operation recorder is no longer active'); };
  const builder = Object.create(null);
  builder.atSeconds = value => {
    check(); time = copyTime({unit: 'seconds', value});
    if (value < previous) throw new RangeError('YM2612 operation offsets must be nondecreasing');
    previous = value;
    return builder;
  };
  builder.atSample = value => {
    check(); time = copyTime({unit: 'sample', value});
    const seconds = value / rate;
    if (seconds < previous) throw new RangeError('YM2612 operation offsets must be nondecreasing');
    previous = seconds;
    return builder;
  };
  for (const method of Object.keys(arity)) builder[method] = (...args) => {
    check();
    if (operations.length >= MAX_YM2612_OPERATIONS) throw new RangeError(`YM2612 programs support at most ${MAX_YM2612_OPERATIONS} operations`);
    const call = copyCall({method, args}, arity);
    operations.push({time: {...time}, order: operations.length, ...call});
    return builder;
  };
  try {
    const result = callback(builder);
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw new TypeError('YM2612 build callbacks must be synchronous');
    }
    return copyProgram({version: 1, chip, referenceSampleRate: rate, operations}, {chip, arity});
  } finally {
    active = false;
  }
}

export {copyProgram as copyOpnOperationProgram, copyCall as copyOpnOperationCall};

/** A scratch chip shares existing parameter validation and register conversion.
 * State adoption and raw-shadow updates never touch the live SoundChip.
 * @param {{clock?:number}} [options]
 * @returns {{resolve(operation:YM2612TimedOperation,state:YM2612OperationState):{writes:YM2612RegisterWrite[],state:YM2612OperationState}}} */
export function createYm2612OperationResolver({clock = 7670454} = {}) {
  let writes = [];
  const synth = new YM2612Synth({clock, transport: {
    write(port, register, value) { writes.push({port, register, value}); },
  }});
  return {
    resolve(operation, state) {
      const input = validateYm2612OperationState(state), call = copyCall(operation);
      adoptYm2612OperationState(synth, input);
      synth._timedState.keyMasks = input.keyMasks.slice();
      writes = [];
      synth[call.method](...call.args);
      for (const write of writes) observeYm2612OperationWrite(input, write.port, write.register, write.value);
      return {writes, state: input};
    },
  };
}

/** Validate all calls using their shared existing conversion, without live state.
 * @param {YM2612OperationProgram} plan
 * @param {{clock?:number,validateArguments?:boolean}} [options]
 * @returns {YM2612OperationProgram} */
export function validateYm2612Operations(plan, {clock = 7670454, validateArguments = true} = {}) {
  const copy = copyProgram(plan);
  if (!validateArguments) return copy;
  const resolver = createYm2612OperationResolver({clock});
  let state = createYm2612OperationResetState();
  for (const operation of copy.operations) state = resolver.resolve(operation, state).state;
  return copy;
}

/** Compile one virtual pass. Baseline adoption never contributes write rows.
 * @param {YM2612OperationProgram} plan @param {YM2612OperationState} state
 * @param {{clock?:number}} [options] @returns {YM2612CompiledWrite[]} */
export function compileYm2612Operations(plan, state, {clock = 7670454} = {}) {
  const copy = copyProgram(plan), resolver = createYm2612OperationResolver({clock}), rows = [];
  let work = validateYm2612OperationState(state);
  for (let operationIndex = 0; operationIndex < copy.operations.length; operationIndex++) {
    const operation = copy.operations[operationIndex];
    const result = resolver.resolve(operation, work), offsetSeconds = ym2612OperationOffsetSeconds(operation, copy.referenceSampleRate);
    for (let writeIndex = 0; writeIndex < result.writes.length; writeIndex++) {
      rows.push({offsetSeconds, ...result.writes[writeIndex], operationIndex, writeIndex});
    }
    work = result.state;
  }
  return rows;
}
