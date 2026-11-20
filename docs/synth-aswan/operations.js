// SPDX-License-Identifier: BSD-3-Clause
import {WonderSwanSynth as AswanSynth} from '../js/wonderswansynth.js';
import {WONDERSWAN_CLOCK as ASWAN_CLOCK} from '../js/wonderswan.js';

/** Register-only authoring calls supported by the ASWAN operation recorder.
 * Validation and register conversion remain in AswanSynth. */
const arity = Object.freeze({
  setVolume:[2,3], setPan:[2,3], setFrequency:[2,2], setNote:[2,2],
  setNoise:[1,1], setSweep:[1,1],
  noteOn:[2,2], noteOff:[1,1], keyOn:[1,1], keyOff:[1,1],
});

export const ASWAN_OPERATION_METHODS = Object.freeze(Object.keys(arity));
export const MAX_ASWAN_OPERATIONS = 4096;

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
    if (!Number.isFinite(value)) throw new TypeError('ASWAN operation numbers must be finite');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 1024) throw new RangeError('ASWAN operation string is too long');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('ASWAN operation arguments must be serializable data');
  if (depth >= 8 || stack.has(value)) throw new TypeError('ASWAN operation arguments must be bounded, acyclic data');
  if (!Array.isArray(value)) object(value, 'ASWAN operation argument');
  const keys = Reflect.ownKeys(value);
  if (keys.length > 32) throw new RangeError('ASWAN operation argument is too large');
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 16) throw new RangeError('ASWAN operation argument array is too large');
      const result = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('ASWAN operation arrays must contain plain values');
        result.push(copyValue(descriptor.value, stack, depth + 1));
      }
      for (const key of keys) if (key !== 'length' && !/^(0|[1-9]\d*)$/.test(String(key))) {
        throw new TypeError('ASWAN operation arrays must not contain extra properties');
      }
      return result;
    }
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) throw new TypeError('ASWAN operation arguments must not contain symbols or accessors');
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
  fields(time, ['unit', 'value'], 'ASWAN operation time');
  const {unit, value} = time;
  if (!['sample', 'seconds'].includes(unit)) throw new TypeError('ASWAN operation time unit must be sample or seconds');
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER ||
      (unit === 'sample' && !Number.isSafeInteger(value))) {
    throw new RangeError('ASWAN operation offset must be nonnegative and samples must be safe integers');
  }
  return {unit, value};
}

function copyCall(operation) {
  const method = operation?.method;
  if (typeof method !== 'string' || !Object.hasOwn(arity, method)) throw new TypeError(`Unsupported ASWAN operation: ${String(method)}`);
  if (!Array.isArray(operation.args)) throw new TypeError('ASWAN operation args must be an array');
  const [min, max] = arity[method];
  if (operation.args.length < min || operation.args.length > max) throw new TypeError(`Invalid argument count for ASWAN ${method}`);
  return {method, args: copyValue(operation.args)};
}

export function aswanOperationOffsetSeconds(operation, referenceSampleRate = 44100) {
  referenceRate(referenceSampleRate);
  const time = copyTime(operation.time);
  return time.unit === 'sample' ? time.value / referenceSampleRate : time.value;
}

/** Copies/validates data without evaluating chip operations or reading state. */
function copyProgram(plan) {
  fields(plan, ['version', 'chip', 'referenceSampleRate', 'operations'], 'ASWAN operation program');
  if (plan.version !== 1 || plan.chip !== 'wonderswan') throw new TypeError('Unsupported ASWAN operation program version or chip');
  const rate = referenceRate(plan.referenceSampleRate);
  if (!Array.isArray(plan.operations) || plan.operations.length > MAX_ASWAN_OPERATIONS) throw new RangeError(`ASWAN programs support at most ${MAX_ASWAN_OPERATIONS} operations`);
  let previous = 0;
  const operations = Array.from(plan.operations, (operation, index) => {
    fields(operation, ['time', 'order', 'method', 'args'], 'ASWAN operation');
    if (operation.order !== index) throw new TypeError('ASWAN operation order must match authored order');
    const time = copyTime(operation.time), call = copyCall(operation);
    const offset = time.unit === 'sample' ? time.value / rate : time.value;
    if (offset < previous) throw new RangeError('ASWAN operation offsets must be nondecreasing');
    previous = offset;
    return {time, order: index, ...call};
  });
  return {version: 1, chip: 'wonderswan', referenceSampleRate: rate, operations};
}

/** Record once. This function never constructs a chip or resolves register bytes. */
export function buildAswanOperations(callback, options = {}) {
  if (typeof callback !== 'function') throw new TypeError('ASWAN build requires a synchronous callback');
  fields(options, ['referenceSampleRate'], 'ASWAN build options');
  const rate = referenceRate(options.referenceSampleRate ?? 44100), operations = [];
  let time = {unit: 'sample', value: 0}, active = true, previous = 0;
  const check = () => { if (!active) throw new Error('ASWAN operation recorder is no longer active'); };
  const builder = Object.create(null);
  builder.atSeconds = value => {
    check(); time = copyTime({unit: 'seconds', value});
    if (value < previous) throw new RangeError('ASWAN operation offsets must be nondecreasing');
    previous = value;
    return builder;
  };
  builder.atSample = value => {
    check(); time = copyTime({unit: 'sample', value});
    const seconds = value / rate;
    if (seconds < previous) throw new RangeError('ASWAN operation offsets must be nondecreasing');
    previous = seconds;
    return builder;
  };
  for (const method of ASWAN_OPERATION_METHODS) builder[method] = (...args) => {
    check();
    if (operations.length >= MAX_ASWAN_OPERATIONS) throw new RangeError(`ASWAN programs support at most ${MAX_ASWAN_OPERATIONS} operations`);
    const call = copyCall({method, args});
    operations.push({time: {...time}, order: operations.length, ...call});
    return builder;
  };
  try {
    const result = callback(builder);
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw new TypeError('ASWAN build callbacks must be synchronous');
    }
    return copyProgram({version: 1, chip: 'wonderswan', referenceSampleRate: rate, operations});
  } finally {
    active = false;
  }
}

/** Detached sent-register and RAM metadata. Not oscillator/LFSR/Sweep phase. */
export function validateAswanOperationState(state) {
  fields(state, ['clock','initialized','registers','memory'], 'ASWAN operation state');
  if(typeof state.initialized !== 'boolean') throw TypeError('Complete ASWAN operation state required');
  if(!Number.isInteger(state.clock)||state.clock<100000||state.clock>100000000) throw RangeError('Invalid ASWAN state clock');
  const bytes = (input, length) => {
    if(!Array.isArray(input) || input.length !== length) throw TypeError('Incomplete ASWAN operation state');
    return Array.from(input, value => {
      if(!Number.isInteger(value)||value<0||value>255) throw RangeError('Invalid ASWAN state byte');
      return value;
    });
  };
  return {clock:state.clock, initialized:state.initialized,
    registers:bytes(state.registers,32), memory:bytes(state.memory,16384)};
}
export function createAswanOperationResetState({clock=ASWAN_CLOCK}={}) {
  return validateAswanOperationState({clock,initialized:true,
    registers:Array(32).fill(0),memory:Array(16384).fill(0)});
}

/** One scratch chip shares all existing parameter validation and register math.
 * Its transport only collects a batch; callers apply it after complete success. */
export function createAswanOperationResolver({clock = ASWAN_CLOCK} = {}) {
  let writes = [];
  const synth = new AswanSynth({clock, transport: {writeRegister(register, value) { writes.push({register, value}); },writeMemory(){throw Error("RAM transfer is outside timed operations");},reset(){throw Error("Reset is outside register-only operations");}}});
  const start = state => {
    const input = validateAswanOperationState(state);
    if(input.clock !== clock) throw Error('Incompatible ASWAN state clock');
    synth._adoptState({...input, initialized:true});
  };
  const apply = operation => {
    const call = copyCall(operation);
    writes = [];
    synth[call.method === 'noteOff' ? 'keyOff' : call.method](...call.args);
    return writes;
  };
  return { start, apply,
    resolve(operation, state) {
      start(state);
      const result = apply(operation);
      return {writes:result, state:synth._getState()};
    },
  };
}

/** Validate all calls using their shared existing conversion, without live state. */
export function validateAswanOperations(plan, {clock = ASWAN_CLOCK, validateArguments = true} = {}) {
  const copy = copyProgram(plan);
  if (!validateArguments) return copy;
  const resolver = createAswanOperationResolver({clock});
  resolver.start(createAswanOperationResetState({clock}));
  for (const operation of copy.operations) resolver.apply(operation);
  return copy;
}

/** Compile one virtual pass. Baseline adoption never contributes write rows. */
export function compileAswanOperations(plan, state, {clock = ASWAN_CLOCK} = {}) {
  const copy = copyProgram(plan), resolver = createAswanOperationResolver({clock}), rows = [];
  if (copy.operations.some(operation => ['noteOn','noteOff'].includes(operation.method)))
    throw new Error('ASWAN compile cannot predict Synth software envelopes/ownership; use setNote + keyOn/keyOff for hardware register traces');
  validateAswanParameterPlan(copy,state);
  resolver.start(state);
  for (let operationIndex = 0; operationIndex < copy.operations.length; operationIndex++) {
    const operation = copy.operations[operationIndex];
    const writes = resolver.apply(operation), offsetSeconds = aswanOperationOffsetSeconds(operation, copy.referenceSampleRate);
    for (let writeIndex = 0; writeIndex < writes.length; writeIndex++) {
      rows.push({offsetSeconds, ...writes[writeIndex], operationIndex, writeIndex});
    }
  }
  return rows;
}

/** In Voice mode R89 is the DAC byte, not CH2 stereo gain. Keep PCM feeding
 * outside this bounded parameter API, even if mode changes after admission. */
export function validateAswanParameterPlan(plan, state) {
  if ((state.registers[16] & 32) && plan.operations.some(operation =>
    ['setVolume','setPan'].includes(operation.method) && operation.args[0] === 1)) {
    throw new Error('ASWAN timed CH2 volume/pan requires Wave mode; Voice PCM feeding is outside this parameter API');
  }
}

/** Admission validates soft note arguments through the existing hardware API,
 * but does not claim its trace represents the Synth software envelope. */
export function validateAswanScheduledOperations(plan, state) {
  const copy = validateAswanOperations(plan, {clock:state.clock});
  validateAswanParameterPlan(copy,state);
  if ((state.registers[16] & 32) && copy.operations.some(operation =>
    operation.method === 'noteOn' && operation.args[0] === 1))
    throw new Error('ASWAN scheduled CH2 noteOn requires Wave mode; Voice PCM feeding is outside this API');
  return copy;
}
