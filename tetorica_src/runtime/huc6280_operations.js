import {Huc6280Synth, HUC6280_CLOCK} from './huc6280synth.js';

/** Register-only authoring calls supported by the HuC6280 operation recorder.
 * Validation and register conversion remain in Huc6280Synth. */
const arity = Object.freeze({
  writeRegister:[2,2], setVolume:[2,2], setPan:[2,3], setMasterVolume:[1,2],
  setFrequency:[2,2], setNote:[2,2], keyOn:[1,1], keyOff:[1,1],
  noteOn:[2,2], noteOff:[1,1], allNotesOff:[0,0],
  setNoise:[2,2], setDda:[2,2], writeDda:[2,2], setLfo:[1,1],
});

export const HUC6280_OPERATION_METHODS = Object.freeze(Object.keys(arity));
export const MAX_HUC6280_OPERATIONS = 4096;

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
    if (!Number.isFinite(value)) throw new TypeError('HuC6280 operation numbers must be finite');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 1024) throw new RangeError('HuC6280 operation string is too long');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('HuC6280 operation arguments must be serializable data');
  if (depth >= 8 || stack.has(value)) throw new TypeError('HuC6280 operation arguments must be bounded, acyclic data');
  if (!Array.isArray(value)) object(value, 'HuC6280 operation argument');
  const keys = Reflect.ownKeys(value);
  if (keys.length > 32) throw new RangeError('HuC6280 operation argument is too large');
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 16) throw new RangeError('HuC6280 operation argument array is too large');
      const result = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('HuC6280 operation arrays must contain plain values');
        result.push(copyValue(descriptor.value, stack, depth + 1));
      }
      for (const key of keys) if (key !== 'length' && !/^(0|[1-9]\d*)$/.test(String(key))) {
        throw new TypeError('HuC6280 operation arrays must not contain extra properties');
      }
      return result;
    }
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) throw new TypeError('HuC6280 operation arguments must not contain symbols or accessors');
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
  fields(time, ['unit', 'value'], 'HuC6280 operation time');
  const {unit, value} = time;
  if (!['sample', 'seconds'].includes(unit)) throw new TypeError('HuC6280 operation time unit must be sample or seconds');
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER ||
      (unit === 'sample' && !Number.isSafeInteger(value))) {
    throw new RangeError('HuC6280 operation offset must be nonnegative and samples must be safe integers');
  }
  return {unit, value};
}

function copyCall(operation) {
  const method = operation?.method;
  if (typeof method !== 'string' || !Object.hasOwn(arity, method)) throw new TypeError(`Unsupported HuC6280 operation: ${String(method)}`);
  if (!Array.isArray(operation.args)) throw new TypeError('HuC6280 operation args must be an array');
  const [min, max] = arity[method];
  if (operation.args.length < min || operation.args.length > max) throw new TypeError(`Invalid argument count for HuC6280 ${method}`);
  return {method, args: copyValue(operation.args)};
}

export function huc6280OperationOffsetSeconds(operation, referenceSampleRate = 44100) {
  referenceRate(referenceSampleRate);
  const time = copyTime(operation.time);
  return time.unit === 'sample' ? time.value / referenceSampleRate : time.value;
}

/** Copies/validates data without evaluating chip operations or reading state. */
function copyProgram(plan) {
  fields(plan, ['version', 'chip', 'referenceSampleRate', 'operations'], 'HuC6280 operation program');
  if (plan.version !== 1 || plan.chip !== 'huc6280') throw new TypeError('Unsupported HuC6280 operation program version or chip');
  const rate = referenceRate(plan.referenceSampleRate);
  if (!Array.isArray(plan.operations) || plan.operations.length > MAX_HUC6280_OPERATIONS) throw new RangeError(`HuC6280 programs support at most ${MAX_HUC6280_OPERATIONS} operations`);
  let previous = 0;
  const operations = Array.from(plan.operations, (operation, index) => {
    fields(operation, ['time', 'order', 'method', 'args'], 'HuC6280 operation');
    if (operation.order !== index) throw new TypeError('HuC6280 operation order must match authored order');
    const time = copyTime(operation.time), call = copyCall(operation);
    const offset = time.unit === 'sample' ? time.value / rate : time.value;
    if (offset < previous) throw new RangeError('HuC6280 operation offsets must be nondecreasing');
    previous = offset;
    return {time, order: index, ...call};
  });
  return {version: 1, chip: 'huc6280', referenceSampleRate: rate, operations};
}

/** Record once. This function never constructs a chip or resolves register bytes. */
export function buildHuc6280Operations(callback, options = {}) {
  if (typeof callback !== 'function') throw new TypeError('HuC6280 build requires a synchronous callback');
  fields(options, ['referenceSampleRate'], 'HuC6280 build options');
  const rate = referenceRate(options.referenceSampleRate ?? 44100), operations = [];
  let time = {unit: 'sample', value: 0}, active = true, previous = 0;
  const check = () => { if (!active) throw new Error('HuC6280 operation recorder is no longer active'); };
  const builder = Object.create(null);
  builder.atSeconds = value => {
    check(); time = copyTime({unit: 'seconds', value});
    if (value < previous) throw new RangeError('HuC6280 operation offsets must be nondecreasing');
    previous = value;
    return builder;
  };
  builder.atSample = value => {
    check(); time = copyTime({unit: 'sample', value});
    const seconds = value / rate;
    if (seconds < previous) throw new RangeError('HuC6280 operation offsets must be nondecreasing');
    previous = seconds;
    return builder;
  };
  for (const method of HUC6280_OPERATION_METHODS) builder[method] = (...args) => {
    check();
    if (operations.length >= MAX_HUC6280_OPERATIONS) throw new RangeError(`HuC6280 programs support at most ${MAX_HUC6280_OPERATIONS} operations`);
    const call = copyCall({method, args});
    operations.push({time: {...time}, order: operations.length, ...call});
    return builder;
  };
  try {
    const result = callback(builder);
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw new TypeError('HuC6280 build callbacks must be synchronous');
    }
    return copyProgram({version: 1, chip: 'huc6280', referenceSampleRate: rate, operations});
  } finally {
    active = false;
  }
}

/** Full authoring metadata, including the selected register bank and Wave RAM
 * write cursor. This is resolver state, not oscillator/envelope phase. */
export function validateHuc6280OperationState(state) {
  if(!state||typeof state!=='object'||typeof state.initialized!=='boolean')throw TypeError('Complete HuC6280 operation state required');
  const values=(input,length,max)=>{
    if(!(Array.isArray(input)||input instanceof Uint8Array)||input.length!==length)throw TypeError('Incomplete HuC6280 operation state');
    return Array.from(input,value=>{if(!Number.isInteger(value)||value<0||value>max)throw RangeError('Invalid HuC6280 state value');return value;});
  };
  if(!Number.isInteger(state.selectedChannel)||state.selectedChannel<0||state.selectedChannel>7)throw RangeError('Invalid HuC6280 selected channel');
  if(!Number.isInteger(state.clock)||state.clock<100000||state.clock>100000000)throw RangeError('Invalid HuC6280 state clock');
  if(!Array.isArray(state.registers)||state.registers.length!==8||!Array.isArray(state.waveforms)||state.waveforms.length!==8)throw TypeError('Incomplete HuC6280 bank state');
  return {clock:state.clock,initialized:state.initialized,selectedChannel:state.selectedChannel,
    globals:values(state.globals,10,255),registers:state.registers.map(row=>values(row,8,255)),
    waveforms:state.waveforms.map(row=>values(row,32,31)),indices:values(state.indices,8,31)};
}

export function createHuc6280OperationResetState({clock=HUC6280_CLOCK}={}) {
  // Ready is SDK metadata only: hardware bytes stay zero, without initialize()
  // writing defaults into the trace or altering a live chip.
  return validateHuc6280OperationState({clock,initialized:true,selectedChannel:0,
    globals:Array(10).fill(0),registers:Array.from({length:8},()=>Array(8).fill(0)),
    waveforms:Array.from({length:8},()=>Array(32).fill(0)),indices:Array(8).fill(0)});
}

/** One scratch chip shares all existing parameter validation and register math.
 * Its transport only collects a batch; callers apply it after complete success. */
export function createHuc6280OperationResolver({clock = HUC6280_CLOCK} = {}) {
  let writes = [];
  const synth = new Huc6280Synth({clock, transport: {writeRegister(register, value) { writes.push({register, value}); },reset(){throw Error("Reset is outside register-only operations");}}});
  return {
    resolve(operation, state) {
      const input = validateHuc6280OperationState(state), call = copyCall(operation);
      if(input.clock!==clock)throw Error("Incompatible HuC6280 state clock");
      synth._adoptState(input);
      writes = [];
      synth[call.method](...call.args);
      return {writes, state: synth._getState()};
    },
  };
}

/** Validate all calls using their shared existing conversion, without live state. */
export function validateHuc6280Operations(plan, {clock = HUC6280_CLOCK, validateArguments = true} = {}) {
  const copy = copyProgram(plan);
  if (!validateArguments) return copy;
  const resolver = createHuc6280OperationResolver({clock});
  let state = createHuc6280OperationResetState({clock});
  for (const operation of copy.operations) state = resolver.resolve(operation, state).state;
  return copy;
}

/** Compile one virtual pass. Baseline adoption never contributes write rows. */
export function compileHuc6280Operations(plan, state, {clock = HUC6280_CLOCK} = {}) {
  const copy = copyProgram(plan), resolver = createHuc6280OperationResolver({clock}), rows = [];
  let work = validateHuc6280OperationState(state);
  for (let operationIndex = 0; operationIndex < copy.operations.length; operationIndex++) {
    const operation = copy.operations[operationIndex];
    const result = resolver.resolve(operation, work), offsetSeconds = huc6280OperationOffsetSeconds(operation, copy.referenceSampleRate);
    for (let writeIndex = 0; writeIndex < result.writes.length; writeIndex++) {
      rows.push({offsetSeconds, ...result.writes[writeIndex], operationIndex, writeIndex});
    }
    work = result.state;
  }
  return rows;
}

/** Live register reservations do not transfer Wave RAM: the rendering cursor
 * may have advanced independently of the sent-register mirror. DDA R6 is safe. */
export function validateHuc6280RegisterOnlyPlan(plan, state) {
  const resolver=createHuc6280OperationResolver({clock:state.clock});
  let work=state;
  for(const operation of plan.operations){
    if(operation.method==='writeRegister'&&operation.args[0]===6&&!(work.registers[work.selectedChannel][4]&64)){
      throw Error('Scheduled Wave RAM transfer is not supported; use setWaveform immediately, or enable DDA before writing R6.');
    }
    work=resolver.resolve(operation,work).state;
  }
}
