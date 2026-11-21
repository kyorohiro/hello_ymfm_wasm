import {NesApuSynth} from './nesapusynth.js';
import {createNesOperationResetState,validateNesOperationState} from './nes_operation_state.js';
export {createNesOperationResetState,validateNesOperationState} from './nes_operation_state.js';
/** @typedef {import('./nes_operation_state.js').NesOperationState} NESOperationState */
/** @typedef {{unit:'sample'|'seconds',value:number}} NESOperationTime */
/** @typedef {{time:NESOperationTime,order:number,method:string,args:unknown[]}} NESTimedOperation */
/** @typedef {{version:1,chip:'nes',referenceSampleRate:number,operations:NESTimedOperation[]}} NESOperationProgram */
/** @typedef {{referenceSampleRate?:number}} NESBuildOptions */
/** @typedef {{register:number,value:number}} NESRegisterWrite */
/** @typedef {NESRegisterWrite & {offsetSeconds:number,operationIndex:number,writeIndex:number}} NESCompiledWrite */
/** @typedef {{[K in 'writeRegister'|'setFrequency'|'setNote'|'noteOn'|'noteOff'|'keyOn'|'keyOff']:(...args:Parameters<NesApuSynth[K]>)=>NESOperationRecorder} & {
 * atSample(value:number):NESOperationRecorder,atSeconds(value:number):NESOperationRecorder,
 * pulse:{[K in keyof NesApuSynth['pulse']]:(...args:Parameters<NesApuSynth['pulse'][K]>)=>NESOperationRecorder},
 * triangle:{[K in keyof NesApuSynth['triangle']]:(...args:Parameters<NesApuSynth['triangle'][K]>)=>NESOperationRecorder},
 * fds:{[K in 'setWave'|'setModulation'|'setVolume'|'setFrequency'|'setNote'|'noteOn'|'noteOff'|'keyOn'|'keyOff']:(...args:Parameters<NesApuSynth['fds'][K]>)=>NESOperationRecorder},
 * dmc:{[K in 'play'|'stop']:(...args:Parameters<NesApuSynth['dmc'][K]>)=>NESOperationRecorder},
 * noise:{[K in keyof NesApuSynth['noise']]:(...args:Parameters<NesApuSynth['noise'][K]>)=>NESOperationRecorder}
 * }} NESOperationRecorder */
const arity=Object.freeze({writeRegister:[2,2],setFrequency:[2,2],setNote:[2,2],noteOn:[2,2],keyOn:[1,1],noteOff:[1,1],keyOff:[1,1],
 'pulse.setVoice':[2,2],'pulse.setFrequency':[2,2],'pulse.setNote':[2,2],'pulse.noteOn':[2,2],'pulse.keyOn':[1,1],'pulse.noteOff':[1,1],'pulse.keyOff':[1,1],
 'triangle.setFrequency':[1,1],'triangle.setNote':[1,1],'triangle.noteOn':[1,1],'triangle.keyOn':[0,0],'triangle.noteOff':[0,0],'triangle.keyOff':[0,0],
 'fds.setWave':[1,1],'fds.setModulation':[1,1],'fds.setVolume':[1,2],'fds.setFrequency':[1,1],'fds.setNote':[1,1],'fds.noteOn':[1,1],'fds.noteOff':[0,0],'fds.keyOn':[0,0],'fds.keyOff':[0,0],
 'dmc.play':[0,1],'dmc.stop':[0,0],
 'noise.setVoice':[0,1],'noise.noteOn':[0,0],'noise.noteOff':[0,0]});
export const NES_OPERATION_METHODS=Object.freeze(Object.keys(arity));
export const MAX_NES_OPERATIONS=4096;

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
    if (!Number.isFinite(value)) throw new TypeError('NES operation numbers must be finite');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 1024) throw new RangeError('NES operation string is too long');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('NES operation arguments must be serializable data');
  if (depth >= 8 || stack.has(value)) throw new TypeError('NES operation arguments must be bounded, acyclic data');
  if (ArrayBuffer.isView(value)&&value instanceof Uint8Array) value=Array.from(value);
  if (!Array.isArray(value)) object(value, 'NES operation argument');
  const keys = Reflect.ownKeys(value);
  if (keys.length > (Array.isArray(value)?65:32)) throw new RangeError('NES operation argument is too large');
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 64) throw new RangeError('NES operation argument array is too large');
      const result = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('NES operation arrays must contain plain values');
        result.push(copyValue(descriptor.value, stack, depth + 1));
      }
      for (const key of keys) if (key !== 'length' && !/^(0|[1-9]\d*)$/.test(String(key))) {
        throw new TypeError('NES operation arrays must not contain extra properties');
      }
      return result;
    }
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) throw new TypeError('NES operation arguments must not contain symbols or accessors');
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
  fields(time, ['unit', 'value'], 'NES operation time');
  const {unit, value} = time;
  if (!['sample', 'seconds'].includes(unit)) throw new TypeError('NES operation time unit must be sample or seconds');
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER ||
      (unit === 'sample' && !Number.isSafeInteger(value))) {
    throw new RangeError('NES operation offset must be nonnegative and samples must be safe integers');
  }
  return {unit, value};
}

function copyCall(operation) {
  const method = operation?.method;
  if (typeof method !== 'string' || !Object.hasOwn(arity, method)) throw new TypeError(`Unsupported NES operation: ${String(method)}`);
  if (!Array.isArray(operation.args)) throw new TypeError('NES operation args must be an array');
  const [min, max] = arity[method];
  if (operation.args.length < min || operation.args.length > max) throw new TypeError(`Invalid argument count for NES ${method}`);
  return {method, args: copyValue(operation.args)};
}

/** @param {NESTimedOperation} operation @param {number} [referenceSampleRate]
 * @returns {number} */
export function nesOperationOffsetSeconds(operation, referenceSampleRate = 44100) {
  referenceRate(referenceSampleRate);
  const time = copyTime(operation.time);
  return time.unit === 'sample' ? time.value / referenceSampleRate : time.value;
}

/** Copies/validates data without evaluating chip operations or reading state. */
function copyProgram(plan) {
  fields(plan, ['version', 'chip', 'referenceSampleRate', 'operations'], 'NES operation program');
  if (plan.version !== 1 || plan.chip !== 'nes') throw new TypeError('Unsupported NES operation program version or chip');
  const rate = referenceRate(plan.referenceSampleRate);
  if (!Array.isArray(plan.operations) || plan.operations.length > MAX_NES_OPERATIONS) throw new RangeError(`NES programs support at most ${MAX_NES_OPERATIONS} operations`);
  let previous = 0;
  const operations = Array.from(plan.operations, (operation, index) => {
    fields(operation, ['time', 'order', 'method', 'args'], 'NES operation');
    if (operation.order !== index) throw new TypeError('NES operation order must match authored order');
    const time = copyTime(operation.time), call = copyCall(operation);
    const offset = time.unit === 'sample' ? time.value / rate : time.value;
    if (offset < previous) throw new RangeError('NES operation offsets must be nondecreasing');
    previous = offset;
    return {time, order: index, ...call};
  });
  return {version: 1, chip: 'nes', referenceSampleRate: rate, operations};
}

/** Record once. This function never constructs a chip or resolves register bytes.
 * Offsets are absolute from reservation start and independent of output rate.
 * @param {(builder:NESOperationRecorder)=>void} callback
 * @param {NESBuildOptions} [options] @returns {NESOperationProgram} */
export function buildNesOperations(callback, options = {}) {
  if (typeof callback !== 'function') throw new TypeError('NES build requires a synchronous callback');
  fields(options, ['referenceSampleRate'], 'NES build options');
  const rate = referenceRate(options.referenceSampleRate ?? 44100), operations = [];
  let time = {unit: 'sample', value: 0}, active = true, previous = 0;
  const check = () => { if (!active) throw new Error('NES operation recorder is no longer active'); };
  const builder = Object.create(null);
  builder.atSeconds = value => {
    check(); time = copyTime({unit: 'seconds', value});
    if (value < previous) throw new RangeError('NES operation offsets must be nondecreasing');
    previous = value;
    return builder;
  };
  builder.atSample = value => {
    check(); time = copyTime({unit: 'sample', value});
    const seconds = value / rate;
    if (seconds < previous) throw new RangeError('NES operation offsets must be nondecreasing');
    previous = seconds;
    return builder;
  };
  for(const group of ['pulse','triangle','noise','dmc','fds'])builder[group]=Object.create(null);
  for (const method of NES_OPERATION_METHODS) (method.includes('.')?builder[method.split('.')[0]]:builder)[method.split('.').at(-1)] = (...args) => {
    check();
    if (operations.length >= MAX_NES_OPERATIONS) throw new RangeError(`NES programs support at most ${MAX_NES_OPERATIONS} operations`);
    const call = copyCall({method, args});
    operations.push({time: {...time}, order: operations.length, ...call});
    return builder;
  };
  try {
    const result = callback(builder);
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw new TypeError('NES build callbacks must be synchronous');
    }
    return copyProgram({version: 1, chip: 'nes', referenceSampleRate: rate, operations});
  } finally {
    active = false;
  }
}

/** A scratch chip shares existing parameter validation and register conversion.
 * State adoption and raw-shadow updates never touch the live SoundChip.
 * @param {{clock?:number,fds?:boolean}} [options]
 * @returns {{resolve(operation:NESTimedOperation,state:NESOperationState):{writes:NESRegisterWrite[],state:NESOperationState}}} */
export function createNesOperationResolver({clock=1789772.7272727273,fds=false}={}) {
 let writes=[];
 const synth=new NesApuSynth({transport:{clock,writeRegister(register,value){writes.push({register,value});}},initialize:false,fds});
 return {resolve(operation,state){
  const input=validateNesOperationState(state),call=copyCall(operation);
  if(call.method==='writeRegister'&&![0x4000,0x4001,0x4002,0x4003,0x4004,0x4005,0x4006,0x4007,0x4008,0x400a,0x400b,0x400c,0x400e,0x400f,0x4010,0x4011,0x4023,0x4080,0x4082,0x4083,0x4084,0x4085,0x4086,0x4087,0x4089,0x408a].includes(call.args[0]))throw new Error('NES timed raw writes support Pulse/Triangle/Noise and DMC rate/DAC and FDS control registers only (no RAM); shared enables use keyOn/keyOff');
  if(call.method.startsWith('pulse.')&&(!Number.isInteger(call.args[0])||call.args[0]<0||call.args[0]>1))throw new RangeError('Pulse channels are 0 or 1');
  if(!call.method.includes('.')&&call.method!=='writeRegister'&&(!Number.isInteger(call.args[0])||call.args[0]<0||call.args[0]>(fds?5:['keyOff','noteOff'].includes(call.method)?4:3)))throw new RangeError('NES timed tone channels are 0..3; DMC supports Off');
  synth._adoptState({...input,clock});writes=[];
  const [group,method]=call.method.split('.');
  if(method)synth[group][method](...call.args);else synth[group](...call.args);
  return {writes,state:validateNesOperationState(synth._getState())};
 }};
}

/** Validate all calls using their shared existing conversion, without live state.
 * @param {NESOperationProgram} plan
 * @param {{clock?:number,fds?:boolean,validateArguments?:boolean,initialState?:NESOperationState}} [options]
 * @returns {NESOperationProgram} */
export function validateNesOperations(plan, {clock = 1789772.7272727273, validateArguments = true, initialState, fds=false} = {}) {
  const copy = copyProgram(plan);
  if (!validateArguments) return copy;
  const resolver = createNesOperationResolver({clock,fds});
  let state = initialState ? validateNesOperationState(initialState) : createNesOperationResetState({clock});
  for (const operation of copy.operations) state = resolver.resolve(operation, state).state;
  return copy;
}

/** Compile one virtual pass. Baseline adoption never contributes write rows.
 * @param {NESOperationProgram} plan @param {NESOperationState} state
 * @param {{clock?:number,fds?:boolean}} [options] @returns {NESCompiledWrite[]} */
export function compileNesOperations(plan, state, {clock = 1789772.7272727273,fds=false} = {}) {
  const copy = copyProgram(plan), resolver = createNesOperationResolver({clock,fds}), rows = [];
  let work = validateNesOperationState(state);
  for (let operationIndex = 0; operationIndex < copy.operations.length; operationIndex++) {
    const operation = copy.operations[operationIndex];
    const result = resolver.resolve(operation, work), offsetSeconds = nesOperationOffsetSeconds(operation, copy.referenceSampleRate);
    for (let writeIndex = 0; writeIndex < result.writes.length; writeIndex++) {
      rows.push({offsetSeconds, ...result.writes[writeIndex], operationIndex, writeIndex});
    }
    work = result.state;
  }
  return rows;
}
