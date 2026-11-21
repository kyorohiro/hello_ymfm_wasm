import {YM2608Synth} from './ym2608synth.js';
import {createYm2608OperationResetState, validateYm2608OperationState, observeYm2608OperationWrite, adoptYm2608OperationState} from './ym2608_operation_state.js';
export {createYm2608OperationResetState, validateYm2608OperationState, observeYm2608OperationWrite} from './ym2608_operation_state.js';

/** @typedef {import('./ym2608_operation_state.js').YM2608OperationState} YM2608OperationState */
/** @typedef {typeof YM2608_OPERATION_METHODS[number]} YM2608RecordedMethod */
/** @typedef {{unit:'sample'|'seconds',value:number}} YM2608OperationTime */
/** @typedef {{time:YM2608OperationTime,order:number,method:YM2608RecordedMethod,args:unknown[]}} YM2608TimedOperation */
/** @typedef {{version:1,chip:'ym2608',referenceSampleRate:number,operations:YM2608TimedOperation[]}} YM2608OperationProgram */
/** @typedef {{referenceSampleRate?:number}} YM2608BuildOptions */
/** @typedef {{port:number,register:number,value:number}} YM2608RegisterWrite */
/** @typedef {YM2608RegisterWrite & {offsetSeconds:number,operationIndex:number,writeIndex:number}} YM2608CompiledWrite */
/** @typedef {'write'|'rawWrite'|'setPreset'|'setOperator'|'setOperators'|'setAlgo'|'setPan'|'setLfo'|'setChannel3SpecialMode'|'setChannel3SpecialFrequency'|'setFrequency'|'setNote'|'setBlockFnum'|'keyOn'|'keyOff'|'noteOn'|'noteOnRaw'|'noteOff'|'setModulation'} YM2608FmRecordedMethod */
/** @typedef {'write'|'tone'|'noise'|'setMixer'|'setVolume'|'setEnvelope'|'setTonePeriod'|'setFrequency'|'setNote'|'keyOn'|'keyOff'|'noteOn'|'off'} YM2608SsgRecordedMethod */
/** @typedef {{[K in 'setSample'|'setDeltaN'|'setPlaybackRate'|'setVolume'|'setPan'|'keyOn'|'keyOff']:(...args:Parameters<YM2608Synth['adpcm'][K]>)=>YM2608OperationRecorder}} YM2608AdpcmRecorder */
/** @typedef {{[K in 'setVolume'|'setVoice'|'keyOn'|'keyOff']:(...args:Parameters<YM2608Synth['rhythm'][K]>)=>YM2608OperationRecorder}} YM2608RhythmRecorder */
/** @typedef {{[K in YM2608SsgRecordedMethod]:(...args:Parameters<YM2608Synth['ssg'][K]>)=>YM2608OperationRecorder}} YM2608SsgRecorder */
/** @typedef {{[K in YM2608FmRecordedMethod]:(...args:Parameters<YM2608Synth[K]>)=>YM2608OperationRecorder} & {
 * atSample(value:number):YM2608OperationRecorder,
 * atSeconds(value:number):YM2608OperationRecorder,
 * rhythm:YM2608RhythmRecorder,
 * adpcm:YM2608AdpcmRecorder,
 * ssg:YM2608SsgRecorder
 * }} YM2608OperationRecorder */

/** Register-only authoring calls supported by the YM2608 operation recorder.
 * Validation and register conversion remain in YM2608Synth. */
const arity = Object.freeze({
  write: [3, 3], rawWrite: [3, 3], setPreset: [2, 2],
  setOperator: [3, 3], setOperators: [2, 2], setAlgo: [2, 3],
  setPan: [3, 5], setLfo: [2, 2], setChannel3SpecialMode: [1, 1],
  setChannel3SpecialFrequency: [3, 3], setFrequency: [2, 3], setNote: [2, 2],
  setBlockFnum: [3, 3], keyOn: [1, 2], keyOff: [1, 1],
  noteOn: [2, 3], noteOnRaw: [3, 3], noteOff: [1, 1],
  setModulation:[3,3],
  'adpcm.setSample':[1,1], 'adpcm.setDeltaN':[1,1], 'adpcm.setPlaybackRate':[1,1],
  'adpcm.setVolume':[1,1], 'adpcm.setPan':[2,2], 'adpcm.keyOn':[0,1], 'adpcm.keyOff':[0,0],
  'rhythm.setVolume':[1,1], 'rhythm.setVoice':[1,2], 'rhythm.keyOn':[1,1], 'rhythm.keyOff':[1,1],
  'ssg.write':[2,2], 'ssg.tone':[1,2], 'ssg.noise':[1,2],
  'ssg.setMixer':[2,2], 'ssg.setVolume':[2,3], 'ssg.setEnvelope':[1,1],
  'ssg.setTonePeriod':[2,2],
  'ssg.setFrequency':[2,2], 'ssg.setNote':[2,2],
  'ssg.keyOn':[1,1], 'ssg.keyOff':[1,1], 'ssg.noteOn':[2,2], 'ssg.off':[1,1],
});

export const YM2608_OPERATION_METHODS = Object.freeze(Object.keys(arity));
export const MAX_YM2608_OPERATIONS = 4096;

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
    if (!Number.isFinite(value)) throw new TypeError('YM2608 operation numbers must be finite');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 1024) throw new RangeError('YM2608 operation string is too long');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('YM2608 operation arguments must be serializable data');
  if (depth >= 8 || stack.has(value)) throw new TypeError('YM2608 operation arguments must be bounded, acyclic data');
  if (!Array.isArray(value)) object(value, 'YM2608 operation argument');
  const keys = Reflect.ownKeys(value);
  if (keys.length > 32) throw new RangeError('YM2608 operation argument is too large');
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 16) throw new RangeError('YM2608 operation argument array is too large');
      const result = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('YM2608 operation arrays must contain plain values');
        result.push(copyValue(descriptor.value, stack, depth + 1));
      }
      for (const key of keys) if (key !== 'length' && !/^(0|[1-9]\d*)$/.test(String(key))) {
        throw new TypeError('YM2608 operation arrays must not contain extra properties');
      }
      return result;
    }
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) throw new TypeError('YM2608 operation arguments must not contain symbols or accessors');
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
  fields(time, ['unit', 'value'], 'YM2608 operation time');
  const {unit, value} = time;
  if (!['sample', 'seconds'].includes(unit)) throw new TypeError('YM2608 operation time unit must be sample or seconds');
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER ||
      (unit === 'sample' && !Number.isSafeInteger(value))) {
    throw new RangeError('YM2608 operation offset must be nonnegative and samples must be safe integers');
  }
  return {unit, value};
}

function copyCall(operation) {
  const method = operation?.method;
  if (typeof method !== 'string' || !Object.hasOwn(arity, method)) throw new TypeError(`Unsupported YM2608 operation: ${String(method)}`);
  if (!Array.isArray(operation.args)) throw new TypeError('YM2608 operation args must be an array');
  const [min, max] = arity[method];
  if (operation.args.length < min || operation.args.length > max) throw new TypeError(`Invalid argument count for YM2608 ${method}`);
  return {method, args: copyValue(operation.args)};
}

/** @param {YM2608TimedOperation} operation @param {number} [referenceSampleRate]
 * @returns {number} */
export function ym2608OperationOffsetSeconds(operation, referenceSampleRate = 44100) {
  referenceRate(referenceSampleRate);
  const time = copyTime(operation.time);
  return time.unit === 'sample' ? time.value / referenceSampleRate : time.value;
}

/** Copies/validates data without evaluating chip operations or reading state. */
function copyProgram(plan) {
  fields(plan, ['version', 'chip', 'referenceSampleRate', 'operations'], 'YM2608 operation program');
  if (plan.version !== 1 || plan.chip !== 'ym2608') throw new TypeError('Unsupported YM2608 operation program version or chip');
  const rate = referenceRate(plan.referenceSampleRate);
  if (!Array.isArray(plan.operations) || plan.operations.length > MAX_YM2608_OPERATIONS) throw new RangeError(`YM2608 programs support at most ${MAX_YM2608_OPERATIONS} operations`);
  let previous = 0;
  const operations = Array.from(plan.operations, (operation, index) => {
    fields(operation, ['time', 'order', 'method', 'args'], 'YM2608 operation');
    if (operation.order !== index) throw new TypeError('YM2608 operation order must match authored order');
    const time = copyTime(operation.time), call = copyCall(operation);
    const offset = time.unit === 'sample' ? time.value / rate : time.value;
    if (offset < previous) throw new RangeError('YM2608 operation offsets must be nondecreasing');
    previous = offset;
    return {time, order: index, ...call};
  });
  return {version: 1, chip: 'ym2608', referenceSampleRate: rate, operations};
}

/** Record once. This function never constructs a chip or resolves register bytes.
 * Offsets are absolute from reservation start and independent of output rate.
 * @param {(builder:YM2608OperationRecorder)=>void} callback
 * @param {YM2608BuildOptions} [options] @returns {YM2608OperationProgram} */
export function buildYm2608Operations(callback, options = {}) {
  if (typeof callback !== 'function') throw new TypeError('YM2608 build requires a synchronous callback');
  fields(options, ['referenceSampleRate'], 'YM2608 build options');
  const rate = referenceRate(options.referenceSampleRate ?? 44100), operations = [];
  let time = {unit: 'sample', value: 0}, active = true, previous = 0;
  const check = () => { if (!active) throw new Error('YM2608 operation recorder is no longer active'); };
  const builder = Object.create(null);
  builder.atSeconds = value => {
    check(); time = copyTime({unit: 'seconds', value});
    if (value < previous) throw new RangeError('YM2608 operation offsets must be nondecreasing');
    previous = value;
    return builder;
  };
  builder.atSample = value => {
    check(); time = copyTime({unit: 'sample', value});
    const seconds = value / rate;
    if (seconds < previous) throw new RangeError('YM2608 operation offsets must be nondecreasing');
    previous = seconds;
    return builder;
  };
  builder.ssg=Object.create(null);
  builder.rhythm=Object.create(null);
  builder.adpcm=Object.create(null);
  for (const method of YM2608_OPERATION_METHODS) (method.includes('.')?builder[method.split('.')[0]]:builder)[method.split('.').at(-1)] = (...args) => {
    check();
    if (operations.length >= MAX_YM2608_OPERATIONS) throw new RangeError(`YM2608 programs support at most ${MAX_YM2608_OPERATIONS} operations`);
    const call = copyCall({method, args});
    operations.push({time: {...time}, order: operations.length, ...call});
    return builder;
  };
  try {
    const result = callback(builder);
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw new TypeError('YM2608 build callbacks must be synchronous');
    }
    return copyProgram({version: 1, chip: 'ym2608', referenceSampleRate: rate, operations});
  } finally {
    active = false;
  }
}

/** A scratch chip shares existing parameter validation and register conversion.
 * State adoption and raw-shadow updates never touch the live SoundChip.
 * @param {{clock?:number}} [options]
 * @returns {{resolve(operation:YM2608TimedOperation,state:YM2608OperationState):{writes:YM2608RegisterWrite[],state:YM2608OperationState}}} */
export function createYm2608OperationResolver({clock = 8000000} = {}) {
  let writes = [];
  const synth = new YM2608Synth({clock, transport: {
    write(port, register, value) { writes.push({port, register, value}); },
  }});
  return {
    resolve(operation, state) {
      const input = validateYm2608OperationState(state), call = copyCall(operation);
      adoptYm2608OperationState(synth, input);
      writes = [];
      if(['write','rawWrite'].includes(call.method)){
        const [port,reg]=call.args;
        if(!(port===0&&reg>=0&&reg<=13||(port===0||port===1)&&reg>=0x30&&reg<=0xb6||port===1&&[0,1,2,3,4,5,9,10,11,12,13].includes(reg)||port===0&&([0x10,0x11,0x22,0x28,0x29].includes(reg)||reg>=0x18&&reg<=0x1d)))throw new Error('YM2608 timed raw writes support FM/SSG/Rhythm and ADPCM-B playback registers only');
      }
      if(call.method==='ssg.write'&&(call.args[0]<0||call.args[0]>13))throw new Error('YM2608 timed SSG writes exclude I/O ports');
      // Timed raw control excludes CPU memory transfers and recording.
      if(['write','rawWrite'].includes(call.method)&&call.args[0]===1&&call.args[1]===0&&![0,1,0xa0,0xb0].includes(call.args[2]))throw new Error('YM2608 timed ADPCM-B control excludes recording and CPU transfer');
      if(['write','rawWrite'].includes(call.method)&&call.args[0]===1&&call.args[1]===1&&((call.args[2]&63)!==2))throw new Error('YM2608 timed ADPCM-B memory mode must be 8-bit DRAM');
      const section=call.method.includes('.')?synth[call.method.split('.')[0]]:synth;
      section[call.method.split('.').at(-1)](...call.args);
      for (const write of writes) observeYm2608OperationWrite(input, write.port, write.register, write.value);
      input.ssgLevels=synth.ssg._getState().levels.map(value=>value&31);
      return {writes, state: input};
    },
  };
}

/** Validate all calls using their shared existing conversion, without live state.
 * @param {YM2608OperationProgram} plan
 * @param {{clock?:number,validateArguments?:boolean}} [options]
 * @returns {YM2608OperationProgram} */
export function validateYm2608Operations(plan, {clock = 8000000, validateArguments = true} = {}) {
  const copy = copyProgram(plan);
  if (!validateArguments) return copy;
  const resolver = createYm2608OperationResolver({clock});
  let state = createYm2608OperationResetState();
  for (const operation of copy.operations) state = resolver.resolve(operation, state).state;
  return copy;
}

/** Compile one virtual pass. Baseline adoption never contributes write rows.
 * @param {YM2608OperationProgram} plan @param {YM2608OperationState} state
 * @param {{clock?:number}} [options] @returns {YM2608CompiledWrite[]} */
export function compileYm2608Operations(plan, state, {clock = 8000000} = {}) {
  const copy = copyProgram(plan), resolver = createYm2608OperationResolver({clock}), rows = [];
  let work = validateYm2608OperationState(state);
  for (let operationIndex = 0; operationIndex < copy.operations.length; operationIndex++) {
    const operation = copy.operations[operationIndex];
    const result = resolver.resolve(operation, work), offsetSeconds = ym2608OperationOffsetSeconds(operation, copy.referenceSampleRate);
    for (let writeIndex = 0; writeIndex < result.writes.length; writeIndex++) {
      rows.push({offsetSeconds, ...result.writes[writeIndex], operationIndex, writeIndex});
    }
    work = result.state;
  }
  return rows;
}
