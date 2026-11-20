// SPDX-License-Identifier: BSD-3-Clause
import {GameboySynth} from './gameboysynth.js?v=audio-stability-2';
import {GAMEBOY_APU_CLOCK} from './gameboyapu.js?v=audio-stability-2';

/** Register-only authoring calls supported by the GAMEBOY operation recorder.
 * Validation and register conversion remain in GameboySynth. Lifecycle methods
 * are immediate only; Wave uploads retain their 32-nibble DAC-stop semantics. */
const arity = Object.freeze({
  writeRegister:[2,2], setFrequency:[2,2], setNote:[2,2], noteOn:[2,2],
  keyOn:[1,1], keyOff:[1,1], setPan:[3,3], setMasterVolume:[2,2],
  'pulse.setVoice':[2,2], 'pulse.setDuty':[2,2], 'pulse.setEnvelope':[2,2],
  'pulse.setSweep':[1,1], 'pulse.setFrequency':[2,2], 'pulse.setNote':[2,2],
  'pulse.noteOn':[2,2], 'pulse.keyOn':[1,1], 'pulse.keyOff':[1,1],
  'wave.stopAndSetWaveform':[1,1], 'wave.setWaveform':[1,1], 'wave.setLevel':[1,1],
  'wave.setFrequency':[1,1], 'wave.setNote':[1,1], 'wave.noteOn':[1,1],
  'wave.keyOn':[0,0], 'wave.keyOff':[0,0],
  'noise.setVoice':[1,1], 'noise.setEnvelope':[1,1], 'noise.setParameters':[1,1],
  'noise.keyOn':[0,0], 'noise.keyOff':[0,0],
});

export const GAMEBOY_OPERATION_METHODS = Object.freeze(Object.keys(arity));
export const MAX_GAMEBOY_OPERATIONS = 4096;

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
    if (!Number.isFinite(value)) throw new TypeError('GAMEBOY operation numbers must be finite');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 1024) throw new RangeError('GAMEBOY operation string is too long');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('GAMEBOY operation arguments must be serializable data');
  if (depth >= 8 || stack.has(value)) throw new TypeError('GAMEBOY operation arguments must be bounded, acyclic data');
  if (value instanceof Uint8Array) {
    if (Object.getPrototypeOf(value) !== Uint8Array.prototype || Reflect.ownKeys(value).length !== value.length) throw TypeError('GAMEBOY sample data must contain only ordinary bytes');
    if (value.length > 32) throw new RangeError('GAMEBOY operation sample data is too large');
    return Array.from(value);
  }
  if (!Array.isArray(value)) object(value, 'GAMEBOY operation argument');
  const keys = Reflect.ownKeys(value);
  if (keys.length > 33) throw new RangeError('GAMEBOY operation argument is too large');
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 32) throw new RangeError('GAMEBOY operation argument array is too large');
      const result = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('GAMEBOY operation arrays must contain plain values');
        result.push(copyValue(descriptor.value, stack, depth + 1));
      }
      for (const key of keys) if (key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
        throw new TypeError('GAMEBOY operation arrays must not contain extra properties');
      }
      return result;
    }
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) throw new TypeError('GAMEBOY operation arguments must not contain symbols or accessors');
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
  fields(time, ['unit', 'value'], 'GAMEBOY operation time');
  const {unit, value} = time;
  if (!['sample', 'seconds'].includes(unit)) throw new TypeError('GAMEBOY operation time unit must be sample or seconds');
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER ||
      (unit === 'sample' && !Number.isSafeInteger(value))) {
    throw new RangeError('GAMEBOY operation offset must be nonnegative and samples must be safe integers');
  }
  return {unit, value};
}

function copyCall(operation) {
  const method = operation?.method;
  if (typeof method !== 'string' || !Object.hasOwn(arity, method)) throw new TypeError(`Unsupported GAMEBOY operation: ${String(method)}`);
  if (!Array.isArray(operation.args)) throw new TypeError('GAMEBOY operation args must be an array');
  const [min, max] = arity[method];
  if (operation.args.length < min || operation.args.length > max) throw new TypeError(`Invalid argument count for GAMEBOY ${method}`);
  return {method, args: copyValue(operation.args)};
}

export function gameboyOperationOffsetSeconds(operation, referenceSampleRate = 44100) {
  referenceRate(referenceSampleRate);
  const time = copyTime(operation.time);
  return time.unit === 'sample' ? time.value / referenceSampleRate : time.value;
}

/** Copies/validates data without evaluating chip operations or reading state. */
function copyProgram(plan) {
  fields(plan, ['version', 'chip', 'referenceSampleRate', 'operations'], 'GAMEBOY operation program');
  if (plan.version !== 1 || plan.chip !== 'gameboy') throw new TypeError('Unsupported GAMEBOY operation program version or chip');
  const rate = referenceRate(plan.referenceSampleRate);
  if (!Array.isArray(plan.operations) || plan.operations.length > MAX_GAMEBOY_OPERATIONS) throw new RangeError(`GAMEBOY programs support at most ${MAX_GAMEBOY_OPERATIONS} operations`);
  if (Reflect.ownKeys(plan.operations).length !== plan.operations.length + 1) throw TypeError('GAMEBOY operations must be an ordinary array');
  let previous = 0;
  const operations = Array.from({length:plan.operations.length}, (_, index) => {
    const descriptor=Object.getOwnPropertyDescriptor(plan.operations,String(index));
    if (!descriptor || !Object.hasOwn(descriptor,'value')) throw TypeError('GAMEBOY operations must contain plain values');
    const operation=descriptor.value;
    fields(operation, ['time', 'order', 'method', 'args'], 'GAMEBOY operation');
    if (operation.order !== index) throw new TypeError('GAMEBOY operation order must match authored order');
    const time = copyTime(operation.time), call = copyCall(operation);
    const offset = time.unit === 'sample' ? time.value / rate : time.value;
    if (offset < previous) throw new RangeError('GAMEBOY operation offsets must be nondecreasing');
    previous = offset;
    return {time, order: index, ...call};
  });
  return {version: 1, chip: 'gameboy', referenceSampleRate: rate, operations};
}

/** Record once. This function never constructs a chip or resolves register bytes. */
export function buildGameboyOperations(callback, options = {}) {
  if (typeof callback !== 'function') throw new TypeError('GAMEBOY build requires a synchronous callback');
  fields(options, ['referenceSampleRate'], 'GAMEBOY build options');
  const rate = referenceRate(options.referenceSampleRate ?? 44100), operations = [];
  let time = {unit: 'sample', value: 0}, active = true, previous = 0;
  const check = () => { if (!active) throw new Error('GAMEBOY operation recorder is no longer active'); };
  const builder = Object.create(null);
  builder.atSeconds = value => {
    check(); time = copyTime({unit: 'seconds', value});
    if (value < previous) throw new RangeError('GAMEBOY operation offsets must be nondecreasing');
    previous = value;
    return builder;
  };
  builder.atSample = value => {
    check(); time = copyTime({unit: 'sample', value});
    const seconds = value / rate;
    if (seconds < previous) throw new RangeError('GAMEBOY operation offsets must be nondecreasing');
    previous = seconds;
    return builder;
  };
  for (const method of GAMEBOY_OPERATION_METHODS) {
    const [group, member] = method.split('.');
    const target = member ? (builder[group] ??= Object.create(null)) : builder;
    target[member ?? group] = (...args) => {
      check();
      if (operations.length >= MAX_GAMEBOY_OPERATIONS) throw new RangeError(`GAMEBOY programs support at most ${MAX_GAMEBOY_OPERATIONS} operations`);
      const call = copyCall({method, args});
      operations.push({time: {...time}, order: operations.length, ...call});
      return builder;
    };
  }
  try {
    const result = callback(builder);
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw new TypeError('GAMEBOY build callbacks must be synchronous');
    }
    return copyProgram({version: 1, chip: 'gameboy', referenceSampleRate: rate, operations});
  } finally {
    active = false;
  }
}

/** Sent-register and configured-voice metadata, not oscillator/Envelope/Sweep
 * progress. Key Off can silence a sent register while preserving its voice. */
export function validateGameboyOperationState(state) {
  fields(state, ['clock','initialized','registers','voice'], 'GAMEBOY operation state');
  if (typeof state.initialized !== 'boolean') throw TypeError('Complete GAMEBOY operation state required');
  if (!Number.isInteger(state.clock) || state.clock < 1 || state.clock > 0x3fffffff) throw RangeError('Invalid GAMEBOY state clock');
  const bytes = input => {
    if (!Array.isArray(input) || input.length !== 48 || Reflect.ownKeys(input).length !== 49) throw TypeError('Incomplete GAMEBOY operation state');
    return Array.from({length:48}, (_, index) => {
      const descriptor=Object.getOwnPropertyDescriptor(input,String(index));
      if (!descriptor || !Object.hasOwn(descriptor,'value')) throw TypeError('GAMEBOY state bytes must be plain values');
      const value=descriptor.value;
      if (!Number.isInteger(value) || value < 0 || value > 255) throw RangeError('Invalid GAMEBOY state byte');
      if ([4,9,14,19].includes(index) && value & 128) throw RangeError('GAMEBOY state must not retain trigger bits');
      return value;
    });
  };
  const result={clock:state.clock,initialized:state.initialized,registers:bytes(state.registers),voice:bytes(state.voice)};
  if (result.initialized && !(result.registers[22] & 128)) throw Error('Incompatible GAMEBOY initialization and power state');
  return result;
}
export function createGameboyOperationResetState({clock=GAMEBOY_APU_CLOCK}={}) {
  // Actual hardware-reset authoring state: APU power is off. High-level calls
  // retain their normal initialize() requirement; raw register writes compile.
  return validateGameboyOperationState({clock,initialized:false,registers:Array(48).fill(0),voice:Array(48).fill(0)});
}

/** One scratch chip shares all existing parameter validation and register math.
 * Its transport only collects a batch; callers apply it after complete success. */
export function createGameboyOperationResolver({clock = GAMEBOY_APU_CLOCK} = {}) {
  let writes = [];
  const synth = new GameboySynth({clock,transport:{
    writeRegister(register,value){writes.push({register,value});},
    reset(){throw Error('Reset is outside GAMEBOY register operations');},
  }});
  const start = state => {
    const input = validateGameboyOperationState(state);
    if(input.clock !== clock) throw Error('Incompatible GAMEBOY state clock');
    synth._adoptState(input);
  };
  const apply = operation => {
    const call = copyCall(operation);
    writes = [];
    const [group,member]=call.method.split('.');
    if (member) synth[group][member](...call.args);
    else synth[group](...call.args);
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
export function validateGameboyOperations(plan, {clock = GAMEBOY_APU_CLOCK, validateArguments = true} = {}) {
  const copy = copyProgram(plan);
  if (!validateArguments) return copy;
  const resolver = createGameboyOperationResolver({clock});
  const scratch=new GameboySynth({clock,transport:{writeRegister(){},reset(){}}});
  scratch.initialize();resolver.start(scratch._getState());
  for (const operation of copy.operations) resolver.apply(operation);
  return copy;
}

/** Compile one virtual pass. Baseline adoption never contributes write rows. */
export function compileGameboyOperations(plan, state, {clock = GAMEBOY_APU_CLOCK} = {}) {
  const copy = copyProgram(plan), resolver = createGameboyOperationResolver({clock}), rows = [];
  resolver.start(state);
  for (let operationIndex = 0; operationIndex < copy.operations.length; operationIndex++) {
    const operation = copy.operations[operationIndex];
    const writes = resolver.apply(operation), offsetSeconds = gameboyOperationOffsetSeconds(operation, copy.referenceSampleRate);
    for (let writeIndex = 0; writeIndex < writes.length; writeIndex++) {
      rows.push({offsetSeconds, ...writes[writeIndex], operationIndex, writeIndex});
    }
  }
  return rows;
}

