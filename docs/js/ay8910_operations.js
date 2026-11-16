import {AY8910Synth, AY8910_CLOCK} from './ay8910synth.js?v=pokey-mode-1';

/** Register-only authoring calls supported by the AY operation recorder.
 * Validation and register conversion remain in AY8910Synth. */
const arity = Object.freeze({
  writeRegister: [2, 2], setVoice: [2, 2], tone: [1, 2], setTone: [1, 2],
  noise: [1, 2], setMixer: [2, 2], setVolume: [2, 3], setEnvelope: [1, 1],
  setNoisePeriod: [1, 1], setTonePeriod: [2, 2], setFrequency: [2, 2],
  setNote: [2, 2], keyOn: [1, 1], keyOff: [1, 1], noteOn: [2, 2],
  noteOff: [1, 1], off: [1, 1], allNotesOff: [0, 0],
});

export const AY_OPERATION_METHODS = Object.freeze(Object.keys(arity));
export const MAX_AY_OPERATIONS = 4096;

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
    if (!Number.isFinite(value)) throw new TypeError('AY operation numbers must be finite');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 1024) throw new RangeError('AY operation string is too long');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('AY operation arguments must be serializable data');
  if (depth >= 8 || stack.has(value)) throw new TypeError('AY operation arguments must be bounded, acyclic data');
  if (!Array.isArray(value)) object(value, 'AY operation argument');
  const keys = Reflect.ownKeys(value);
  if (keys.length > 32) throw new RangeError('AY operation argument is too large');
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 16) throw new RangeError('AY operation argument array is too large');
      const result = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('AY operation arrays must contain plain values');
        result.push(copyValue(descriptor.value, stack, depth + 1));
      }
      for (const key of keys) if (key !== 'length' && !/^(0|[1-9]\d*)$/.test(String(key))) {
        throw new TypeError('AY operation arrays must not contain extra properties');
      }
      return result;
    }
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) throw new TypeError('AY operation arguments must not contain symbols or accessors');
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
  fields(time, ['unit', 'value'], 'AY operation time');
  const {unit, value} = time;
  if (!['sample', 'seconds'].includes(unit)) throw new TypeError('AY operation time unit must be sample or seconds');
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER ||
      (unit === 'sample' && !Number.isSafeInteger(value))) {
    throw new RangeError('AY operation offset must be nonnegative and samples must be safe integers');
  }
  return {unit, value};
}

function copyCall(operation) {
  const method = operation?.method;
  if (typeof method !== 'string' || !Object.hasOwn(arity, method)) throw new TypeError(`Unsupported AY operation: ${String(method)}`);
  if (!Array.isArray(operation.args)) throw new TypeError('AY operation args must be an array');
  const [min, max] = arity[method];
  if (operation.args.length < min || operation.args.length > max) throw new TypeError(`Invalid argument count for AY ${method}`);
  return {method, args: copyValue(operation.args)};
}

export function ayOperationOffsetSeconds(operation, referenceSampleRate = 44100) {
  referenceRate(referenceSampleRate);
  const time = copyTime(operation.time);
  return time.unit === 'sample' ? time.value / referenceSampleRate : time.value;
}

/** Copies/validates data without evaluating chip operations or reading state. */
function copyProgram(plan) {
  fields(plan, ['version', 'chip', 'referenceSampleRate', 'operations'], 'AY operation program');
  if (plan.version !== 1 || plan.chip !== 'ay8910') throw new TypeError('Unsupported AY operation program version or chip');
  const rate = referenceRate(plan.referenceSampleRate);
  if (!Array.isArray(plan.operations) || plan.operations.length > MAX_AY_OPERATIONS) throw new RangeError(`AY programs support at most ${MAX_AY_OPERATIONS} operations`);
  let previous = 0;
  const operations = Array.from(plan.operations, (operation, index) => {
    fields(operation, ['time', 'order', 'method', 'args'], 'AY operation');
    if (operation.order !== index) throw new TypeError('AY operation order must match authored order');
    const time = copyTime(operation.time), call = copyCall(operation);
    const offset = time.unit === 'sample' ? time.value / rate : time.value;
    if (offset < previous) throw new RangeError('AY operation offsets must be nondecreasing');
    previous = offset;
    return {time, order: index, ...call};
  });
  return {version: 1, chip: 'ay8910', referenceSampleRate: rate, operations};
}

/** Record once. This function never constructs a chip or resolves register bytes. */
export function buildAyOperations(callback, options = {}) {
  if (typeof callback !== 'function') throw new TypeError('AY build requires a synchronous callback');
  fields(options, ['referenceSampleRate'], 'AY build options');
  const rate = referenceRate(options.referenceSampleRate ?? 44100), operations = [];
  let time = {unit: 'sample', value: 0}, active = true, previous = 0;
  const check = () => { if (!active) throw new Error('AY operation recorder is no longer active'); };
  const builder = Object.create(null);
  builder.atSeconds = value => {
    check(); time = copyTime({unit: 'seconds', value});
    if (value < previous) throw new RangeError('AY operation offsets must be nondecreasing');
    previous = value;
    return builder;
  };
  builder.atSample = value => {
    check(); time = copyTime({unit: 'sample', value});
    const seconds = value / rate;
    if (seconds < previous) throw new RangeError('AY operation offsets must be nondecreasing');
    previous = seconds;
    return builder;
  };
  for (const method of AY_OPERATION_METHODS) builder[method] = (...args) => {
    check();
    if (operations.length >= MAX_AY_OPERATIONS) throw new RangeError(`AY programs support at most ${MAX_AY_OPERATIONS} operations`);
    const call = copyCall({method, args});
    operations.push({time: {...time}, order: operations.length, ...call});
    return builder;
  };
  try {
    const result = callback(builder);
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw new TypeError('AY build callbacks must be synchronous');
    }
    return copyProgram({version: 1, chip: 'ay8910', referenceSampleRate: rate, operations});
  } finally {
    active = false;
  }
}

/** Require complete semantic state; raw-only adoption would lose muted levels. */
export function validateAyOperationState(state) {
  if (!state || typeof state !== 'object') throw new TypeError('AY operation state is required');
  const values = (source, length, max, label) => {
    if (!(Array.isArray(source) || source instanceof Uint8Array) || source.length !== length) throw new TypeError(`AY operation state requires ${length} ${label}`);
    return Array.from(source, value => {
      if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`Invalid AY ${label}`);
      return value;
    });
  };
  return {registers: values(state.registers, 16, 255, 'register bytes'), levels: values(state.levels, 3, 31, 'retained levels')};
}

export function createAyOperationResetState() {
  return {registers: Array(16).fill(0), levels: [9, 9, 9]};
}

/** One scratch chip shares all existing parameter validation and register math.
 * Its transport only collects a batch; callers apply it after complete success. */
export function createAyOperationResolver({clock = AY8910_CLOCK} = {}) {
  let writes = [];
  const synth = new AY8910Synth({clock, transport: {writeRegister(register, value) { writes.push({register, value}); }}});
  return {
    resolve(operation, state) {
      const input = validateAyOperationState(state), call = copyCall(operation);
      synth._adoptState(input);
      writes = [];
      synth[call.method](...call.args);
      return {writes, state: synth._getState()};
    },
  };
}

/** Validate all calls using their shared existing conversion, without live state. */
export function validateAyOperations(plan, {clock = AY8910_CLOCK, validateArguments = true} = {}) {
  const copy = copyProgram(plan);
  if (!validateArguments) return copy;
  const resolver = createAyOperationResolver({clock});
  let state = createAyOperationResetState();
  for (const operation of copy.operations) state = resolver.resolve(operation, state).state;
  return copy;
}

/** Compile one virtual pass. Baseline adoption never contributes write rows. */
export function compileAyOperations(plan, state, {clock = AY8910_CLOCK} = {}) {
  const copy = copyProgram(plan), resolver = createAyOperationResolver({clock}), rows = [];
  let work = validateAyOperationState(state);
  for (let operationIndex = 0; operationIndex < copy.operations.length; operationIndex++) {
    const operation = copy.operations[operationIndex];
    const result = resolver.resolve(operation, work), offsetSeconds = ayOperationOffsetSeconds(operation, copy.referenceSampleRate);
    for (let writeIndex = 0; writeIndex < result.writes.length; writeIndex++) {
      rows.push({offsetSeconds, ...result.writes[writeIndex], operationIndex, writeIndex});
    }
    work = result.state;
  }
  return rows;
}
