import {SnesSynth} from './snessynth.js';
import {createSnesOperationResetState,validateSnesOperationState,captureSnesOperationState,cloneSnesOperationData} from './snes_operation_state.js';
export {createSnesOperationResetState,validateSnesOperationState} from './snes_operation_state.js';
/** @typedef {import('./snes_operation_state.js').SnesOperationState} SNESOperationState */
/** @typedef {{version:1,chip:'snes',referenceSampleRate:number,operations:SNESTimedOperation[]}} SNESOperationProgram */
/** @typedef {{referenceSampleRate?:number}} SNESBuildOptions */
/** @typedef {{time:{unit:'sample'|'seconds',value:number},order:number,method:string,args:any[]}} SNESTimedOperation */
/** @typedef {{register:number,value:number}} SNESRegisterWrite */
/** @typedef {SNESRegisterWrite & {offsetSeconds:number,operationIndex:number,writeIndex:number}} SNESCompiledWrite */
/** @typedef {{atSample:(value:number)=>SNESOperationRecorder,atSeconds:(value:number)=>SNESOperationRecorder} & {[K in 'setPreset'|'setChannel'|'setPitch'|'setFrequency'|'setNote'|'keyOn'|'keyOff'|'noteOn'|'noteOff'|'writeDsp'|'setEcho']:(...args:Parameters<SnesSynth[K]>)=>SNESOperationRecorder}} SNESOperationRecorder */
const arity=Object.freeze({setEcho:[0,1],setPreset:[2,2],setChannel:[2,2],setPitch:[2,2],setFrequency:[2,2],setNote:[2,2],keyOn:[1,1],keyOff:[1,1],noteOn:[1,2],noteOff:[1,1],writeDsp:[2,2]});
export const SNES_OPERATION_METHODS=Object.freeze(Object.keys(arity));
export const MAX_SNES_OPERATIONS=4096;

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
    if (!Number.isFinite(value)) throw new TypeError('SNES operation numbers must be finite');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 1024) throw new RangeError('SNES operation string is too long');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('SNES operation arguments must be serializable data');
  if (depth >= 8 || stack.has(value)) throw new TypeError('SNES operation arguments must be bounded, acyclic data');
  if (ArrayBuffer.isView(value)&&value instanceof Uint8Array) value=Array.from(value);
  if (!Array.isArray(value)) object(value, 'SNES operation argument');
  const keys = Reflect.ownKeys(value);
  if (keys.length > (Array.isArray(value)?65:32)) throw new RangeError('SNES operation argument is too large');
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 64) throw new RangeError('SNES operation argument array is too large');
      const result = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('SNES operation arrays must contain plain values');
        result.push(copyValue(descriptor.value, stack, depth + 1));
      }
      for (const key of keys) if (key !== 'length' && !/^(0|[1-9]\d*)$/.test(String(key))) {
        throw new TypeError('SNES operation arrays must not contain extra properties');
      }
      return result;
    }
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) throw new TypeError('SNES operation arguments must not contain symbols or accessors');
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
  fields(time, ['unit', 'value'], 'SNES operation time');
  const {unit, value} = time;
  if (!['sample', 'seconds'].includes(unit)) throw new TypeError('SNES operation time unit must be sample or seconds');
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER ||
      (unit === 'sample' && !Number.isSafeInteger(value))) {
    throw new RangeError('SNES operation offset must be nonnegative and samples must be safe integers');
  }
  return {unit, value};
}

function copyCall(operation) {
  const method = operation?.method;
  if (typeof method !== 'string' || !Object.hasOwn(arity, method)) throw new TypeError(`Unsupported SNES operation: ${String(method)}`);
  if (!Array.isArray(operation.args)) throw new TypeError('SNES operation args must be an array');
  const [min, max] = arity[method];
  if (operation.args.length < min || operation.args.length > max) throw new TypeError(`Invalid argument count for SNES ${method}`);
  return {method, args: copyValue(operation.args)};
}

/** @param {SNESTimedOperation} operation @param {number} [referenceSampleRate]
 * @returns {number} */
export function snesOperationOffsetSeconds(operation, referenceSampleRate = 44100) {
  referenceRate(referenceSampleRate);
  const time = copyTime(operation.time);
  return time.unit === 'sample' ? time.value / referenceSampleRate : time.value;
}

/** Copies/validates data without evaluating chip operations or reading state. */
function copyProgram(plan) {
  fields(plan, ['version', 'chip', 'referenceSampleRate', 'operations'], 'SNES operation program');
  if (plan.version !== 1 || plan.chip !== 'snes') throw new TypeError('Unsupported SNES operation program version or chip');
  const rate = referenceRate(plan.referenceSampleRate);
  if (!Array.isArray(plan.operations) || plan.operations.length > MAX_SNES_OPERATIONS) throw new RangeError(`SNES programs support at most ${MAX_SNES_OPERATIONS} operations`);
  let previous = 0;
  const operations = Array.from(plan.operations, (operation, index) => {
    fields(operation, ['time', 'order', 'method', 'args'], 'SNES operation');
    if (operation.order !== index) throw new TypeError('SNES operation order must match authored order');
    const time = copyTime(operation.time), call = copyCall(operation);
    const offset = time.unit === 'sample' ? time.value / rate : time.value;
    if (offset < previous) throw new RangeError('SNES operation offsets must be nondecreasing');
    previous = offset;
    return {time, order: index, ...call};
  });
  return {version: 1, chip: 'snes', referenceSampleRate: rate, operations};
}

/** Record once. This function never constructs a chip or resolves register bytes.
 * Offsets are absolute from reservation start and independent of output rate.
 * @param {(builder:SNESOperationRecorder)=>void} callback
 * @param {SNESBuildOptions} [options] @returns {SNESOperationProgram} */
export function buildSnesOperations(callback, options = {}) {
  if (typeof callback !== 'function') throw new TypeError('SNES build requires a synchronous callback');
  fields(options, ['referenceSampleRate'], 'SNES build options');
  const rate = referenceRate(options.referenceSampleRate ?? 44100), operations = [];
  let time = {unit: 'sample', value: 0}, active = true, previous = 0;
  const check = () => { if (!active) throw new Error('SNES operation recorder is no longer active'); };
  const builder = Object.create(null);
  builder.atSeconds = value => {
    check(); time = copyTime({unit: 'seconds', value});
    if (value < previous) throw new RangeError('SNES operation offsets must be nondecreasing');
    previous = value;
    return builder;
  };
  builder.atSample = value => {
    check(); time = copyTime({unit: 'sample', value});
    const seconds = value / rate;
    if (seconds < previous) throw new RangeError('SNES operation offsets must be nondecreasing');
    previous = seconds;
    return builder;
  };

  for (const method of SNES_OPERATION_METHODS) (method.includes('.')?builder[method.split('.')[0]]:builder)[method.split('.').at(-1)] = (...args) => {
    check();
    if (operations.length >= MAX_SNES_OPERATIONS) throw new RangeError(`SNES programs support at most ${MAX_SNES_OPERATIONS} operations`);
    const call = copyCall({method, args});
    operations.push({time: {...time}, order: operations.length, ...call});
    return builder;
  };
  try {
    const result = callback(builder);
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw new TypeError('SNES build callbacks must be synchronous');
    }
    return copyProgram({version: 1, chip: 'snes', referenceSampleRate: rate, operations});
  } finally {
    active = false;
  }
}

/** A scratch chip shares existing parameter validation and register conversion.
 * State adoption and raw-shadow updates never touch the live SoundChip.
 * @param {{clock?:number}} [options]
 * @returns {{resolve(operation:SNESTimedOperation,state:SNESOperationState):{writes:SNESRegisterWrite[],state:SNESOperationState}}} */
export function createSnesOperationResolver({clock=32000}={}){if(clock!==32000)throw TypeError('SNES native clock is 32000');
 return {resolve(operation,state){
  const input=validateSnesOperationState(state),call=copyCall(operation),registers=input.registers.slice(),writes=[];
  const synth=new SnesSynth({core:{reset(){},loadRam(){},writeDsp(){},readDsp:r=>registers[r]}});
  synth.core.writeDsp=(register,value)=>{registers[register]=value;writes.push({register,value});};
  synth.core.nativeFrames=input.nativeFrames;
  synth.samples=cloneSnesOperationData(input.samples);synth.channels=cloneSnesOperationData(input.channels);
  synth.echo=cloneSnesOperationData(input.echo);synth.echoReserved=input.echo.reserved;synth.echoConfigured=true;
  synth.directoryAddress=input.directoryAddress;synth.nextAddress=input.nextAddress;
  synth.pendingKon=input.pendingKon;synth.konFrame=input.konFrame;synth.koff=input.koff;
  if(call.method==='writeDsp'){
   const r=call.args[0];
   if(!Number.isInteger(r)||r<0||r>127||(r&15)>7&&![0x0c,0x1c,0x2c,0x3c,0x0d,0x2d,0x3d,0x4d,0x4c,0x5c,0x6c].includes(r)&&(r&15)!==15)throw Error('SNES timed raw DSP register is outside this slice');
   if(([0x2c,0x3c,0x0d,0x4d].includes(r)||(r&15)===15)&&!input.echo.reserved)throw Error('Reserve Echo RAM before scheduling Echo controls');
   if(r===0x6c&&!(call.args[1]&0x20)&&!input.echo.reserved)throw Error('Reserve Echo RAM before enabling Echo');
  }
  if(call.method==='setEcho'&&!input.echo.reserved)throw Error('Reserve Echo RAM before scheduling setEcho');
  synth[call.method](...call.args);
  return {writes,state:captureSnesOperationState(synth)};
 }};
}

/** Validate all calls using their shared existing conversion, without live state.
 * @param {SNESOperationProgram} plan
 * @param {{clock?:number,validateArguments?:boolean,initialState?:SNESOperationState}} [options]
 * @returns {SNESOperationProgram} */
export function validateSnesOperations(plan, {clock = 32000, validateArguments = true, initialState} = {}) {
  const copy = copyProgram(plan);
  if (!validateArguments) return copy;
  const resolver = createSnesOperationResolver({clock});
  let state = initialState ? validateSnesOperationState(initialState) : createSnesOperationResetState({clock});
  for (const operation of copy.operations) state = resolver.resolve(operation, state).state;
  return copy;
}

/** Compile one virtual pass. Baseline adoption never contributes write rows.
 * @param {SNESOperationProgram} plan @param {SNESOperationState} state
 * @param {{clock?:number}} [options] @returns {SNESCompiledWrite[]} */
export function compileSnesOperations(plan, state, {clock = 32000} = {}) {
  const copy = copyProgram(plan), resolver = createSnesOperationResolver({clock}), rows = [];
  let work = validateSnesOperationState(state);
  for (let operationIndex = 0; operationIndex < copy.operations.length; operationIndex++) {
    const operation = copy.operations[operationIndex];
    const offsetSeconds=snesOperationOffsetSeconds(operation,copy.referenceSampleRate);
    const result=resolver.resolve(operation,{...work,nativeFrames:state.nativeFrames+1+Math.round(offsetSeconds*32000)});
    for (let writeIndex = 0; writeIndex < result.writes.length; writeIndex++) {
      rows.push({offsetSeconds, ...result.writes[writeIndex], operationIndex, writeIndex});
    }
    work = result.state;
  }
  return rows;
}
