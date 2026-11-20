// SPDX-License-Identifier: BSD-3-Clause
import {SidSynth, validateSidClock, SID_PAL_CLOCK} from './sidsynth.js';

/** Register-only authoring calls supported by the SID operation recorder.
 * Existing SidSynth owns validation and register conversion. Lifecycle methods
 * remain immediate; this data contains no callbacks or synthesizer instances. */
const arity = Object.freeze({
  writeRegister:[2,2], setVoice:[2,2], setFilter:[1,1],
  setFrequency:[2,2], setNote:[2,2], noteOn:[2,2],
  keyOn:[1,1], keyOff:[1,1], noteOff:[1,1], allNotesOff:[0,0],
});

export const SID_OPERATION_METHODS = Object.freeze(Object.keys(arity));
export const MAX_SID_OPERATIONS = 4096;

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

/** Copy only the bounded, structured-cloneable data consumed by SidSynth. */
function copyValue(value, stack = new Set(), depth = 0) {
  if (value === null || value === undefined || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('SID operation numbers must be finite');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 1024) throw new RangeError('SID operation string is too long');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('SID operation arguments must be serializable data');
  if (depth >= 8 || stack.has(value)) throw new TypeError('SID operation arguments must be bounded, acyclic data');
  if (!Array.isArray(value)) object(value, 'SID operation argument');
  const keys = Reflect.ownKeys(value);
  if (keys.length > 33) throw new RangeError('SID operation argument is too large');
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 32) throw new RangeError('SID operation argument array is too large');
      const result = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('SID operation arrays must contain plain values');
        result.push(copyValue(descriptor.value, stack, depth + 1));
      }
      for (const key of keys) if (key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
        throw new TypeError('SID operation arrays must not contain extra properties');
      }
      return result;
    }
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) throw new TypeError('SID operation arguments must not contain symbols or accessors');
      Object.defineProperty(result, key, {value:copyValue(descriptor.value, stack, depth + 1), enumerable:true, writable:true, configurable:true});
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
  fields(time, ['unit', 'value'], 'SID operation time');
  const {unit, value} = time;
  if (!['sample', 'seconds'].includes(unit)) throw new TypeError('SID operation time unit must be sample or seconds');
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER ||
      (unit === 'sample' && !Number.isSafeInteger(value))) {
    throw new RangeError('SID operation offset must be nonnegative and samples must be safe integers');
  }
  return {unit, value};
}

function copyCall(operation) {
  const method = operation?.method;
  if (typeof method !== 'string' || !Object.hasOwn(arity, method)) throw new TypeError(`Unsupported SID operation: ${String(method)}`);
  if (!Array.isArray(operation.args)) throw new TypeError('SID operation args must be an array');
  const [min, max] = arity[method];
  if (operation.args.length < min || operation.args.length > max) throw new TypeError(`Invalid argument count for SID ${method}`);
  return {method, args:copyValue(operation.args)};
}

export function sidOperationOffsetSeconds(operation, referenceSampleRate = 44100) {
  referenceRate(referenceSampleRate);
  const time = copyTime(operation.time);
  return time.unit === 'sample' ? time.value / referenceSampleRate : time.value;
}

/** Copy/validate a recorded program without evaluating chip calls or state. */
function copyProgram(plan) {
  fields(plan, ['version', 'chip', 'referenceSampleRate', 'operations'], 'SID operation program');
  if (plan.version !== 1 || plan.chip !== 'sid') throw new TypeError('Unsupported SID operation program version or chip');
  const rate = referenceRate(plan.referenceSampleRate);
  if (!Array.isArray(plan.operations) || plan.operations.length > MAX_SID_OPERATIONS) throw new RangeError(`SID programs support at most ${MAX_SID_OPERATIONS} operations`);
  if (Reflect.ownKeys(plan.operations).length !== plan.operations.length + 1) throw TypeError('SID operations must be an ordinary array');
  let previous = 0;
  const operations = Array.from({length:plan.operations.length}, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(plan.operations, String(index));
    if (!descriptor || !Object.hasOwn(descriptor,'value')) throw TypeError('SID operations must contain plain values');
    const operation = descriptor.value;
    fields(operation, ['time', 'order', 'method', 'args'], 'SID operation');
    if (operation.order !== index) throw new TypeError('SID operation order must match authored order');
    const time = copyTime(operation.time), call = copyCall(operation);
    const offset = time.unit === 'sample' ? time.value / rate : time.value;
    if (offset < previous) throw new RangeError('SID operation offsets must be nondecreasing');
    previous = offset;
    return {time, order:index, ...call};
  });
  return {version:1, chip:'sid', referenceSampleRate:rate, operations};
}

/** Run the recorder once. It neither constructs a chip nor reads live state. */
export function buildSidOperations(callback, options = {}) {
  if (typeof callback !== 'function') throw new TypeError('SID build requires a synchronous callback');
  fields(options, ['referenceSampleRate'], 'SID build options');
  const rate = referenceRate(options.referenceSampleRate ?? 44100), operations = [];
  let time = {unit:'sample', value:0}, active = true, previous = 0;
  const check = () => { if (!active) throw new Error('SID operation recorder is no longer active'); };
  const builder = Object.create(null);
  builder.atSeconds = value => {
    check(); time = copyTime({unit:'seconds', value});
    if (value < previous) throw new RangeError('SID operation offsets must be nondecreasing');
    previous = value;
    return builder;
  };
  builder.atSample = value => {
    check(); time = copyTime({unit:'sample', value});
    const seconds = value / rate;
    if (seconds < previous) throw new RangeError('SID operation offsets must be nondecreasing');
    previous = seconds;
    return builder;
  };
  for (const method of SID_OPERATION_METHODS) builder[method] = (...args) => {
    check();
    if (operations.length >= MAX_SID_OPERATIONS) throw new RangeError(`SID programs support at most ${MAX_SID_OPERATIONS} operations`);
    const call = copyCall({method, args});
    operations.push({time:{...time}, order:operations.length, ...call});
    return builder;
  };
  try {
    const result = callback(builder);
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw new TypeError('SID build callbacks must be synchronous');
    }
    return copyProgram({version:1, chip:'sid', referenceSampleRate:rate, operations});
  } finally {
    active = false;
  }
}

/** Sent registers and initialized/configuration metadata only. Derived live
 * inspection fields are accepted from SidSynth._getState(), then discarded;
 * oscillator phase, envelope progress and C64 memory are not resolver state. */
export function validateSidOperationState(state) {
  fields(state, ['clock','model','initialized','registers','channels','filter','cycles'], 'SID operation state');
  if (typeof state.initialized !== 'boolean') throw TypeError('Complete SID operation state required: initialized metadata is missing');
  const clock = validateSidClock(state.clock), model = state.model;
  if (!['6581','8580'].includes(model)) throw RangeError('SID state model must be 6581 or 8580');
  if (model === '8580' && clock !== SID_PAL_CLOCK) throw RangeError('8580 state requires the PAL clock 985248 Hz');
  const bytes = state.registers;
  if (!Array.isArray(bytes) || bytes.length !== 32 || Reflect.ownKeys(bytes).length !== 33) throw TypeError('Incomplete SID operation state: 32 register bytes are required');
  const registers = Array.from({length:32}, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(bytes, String(index));
    if (!descriptor || !Object.hasOwn(descriptor,'value')) throw TypeError('SID state bytes must be plain values');
    const value = descriptor.value;
    if (!Number.isInteger(value) || value < 0 || value > 255) throw RangeError('Invalid SID state byte');
    return value;
  });
  return {clock, model, initialized:state.initialized, registers};
}

export function createSidOperationResetState({clock = SID_PAL_CLOCK, model = '6581'} = {}) {
  // Actual reset authoring state, without high-level initialize() writes.
  return validateSidOperationState({clock, model, initialized:false, registers:Array(32).fill(0)});
}

/** One isolated SidSynth shares existing validation and packed-register math.
 * Transport writes are only collected; callers apply the whole successful batch. */
export function createSidOperationResolver({clock = SID_PAL_CLOCK, model = '6581'} = {}) {
  let writes = [];
  const synth = new SidSynth({clock, model, transport:{
    writeRegister(register, value) { writes.push({register, value}); },
    reset() { throw Error('Reset is outside SID register operations'); },
  }});
  const start = state => {
    const input = validateSidOperationState(state);
    if (input.clock !== clock) throw Error('Incompatible SID state clock');
    if (input.model !== model) throw Error('Incompatible SID state model');
    synth._adoptState(input);
  };
  const apply = operation => {
    const call = copyCall(operation);
    writes = [];
    synth[call.method](...call.args);
    return writes;
  };
  return {start, apply,
    resolve(operation, state) {
      start(state);
      const result = apply(operation);
      return {writes:result, state:validateSidOperationState(synth._getState())};
    },
  };
}

/** Validate every call through existing conversion without reading live state. */
export function validateSidOperations(plan, {clock = SID_PAL_CLOCK, model = '6581', validateArguments = true} = {}) {
  const copy = copyProgram(plan);
  if (!validateArguments) return copy;
  const resolver = createSidOperationResolver({clock, model});
  const scratch = new SidSynth({clock, model, transport:{writeRegister(){}, reset(){}}});
  scratch.initialize();
  resolver.start(scratch._getState());
  for (const operation of copy.operations) resolver.apply(operation);
  return copy;
}

/** One virtual pass, preserving all operation writes and their same-time order.
 * Baseline adoption never contributes writes to the returned trace. */
export function compileSidOperations(plan, state, {clock = SID_PAL_CLOCK, model = '6581'} = {}) {
  const copy = copyProgram(plan), resolver = createSidOperationResolver({clock, model}), rows = [];
  resolver.start(state);
  for (let operationIndex = 0; operationIndex < copy.operations.length; operationIndex++) {
    const operation = copy.operations[operationIndex];
    const writes = resolver.apply(operation), offsetSeconds = sidOperationOffsetSeconds(operation, copy.referenceSampleRate);
    for (let writeIndex = 0; writeIndex < writes.length; writeIndex++) {
      rows.push({offsetSeconds, ...writes[writeIndex], operationIndex, writeIndex});
    }
  }
  return rows;
}
