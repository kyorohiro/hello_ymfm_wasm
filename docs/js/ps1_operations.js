import {Ps1Synth} from './ps1synth.js?v=ps1-deferred-release-1';

/** Register-only authoring calls supported by the PS1 operation recorder.
 * Validation and register conversion remain in Ps1Synth. */
const arity = Object.freeze({
  setPreset:[2,3], setChannel:[2,3], setEnvelope:[2,3], setReverb:[1,1],
  setPitch:[2,2], setFrequency:[2,2], setNote:[2,2], keyOn:[1,1], keyOff:[1,1],
  setNoiseEnabled:[2,2], setNoiseClock:[1,1], setPmonEnabled:[2,2],
  noteOn:[1,2], noteOff:[1,1], allNotesOff:[0,0],
});

export const PS1_OPERATION_METHODS = Object.freeze(Object.keys(arity));
export const MAX_PS1_OPERATIONS = 4096;

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
    if (!Number.isFinite(value)) throw new TypeError('PS1 operation numbers must be finite');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 1024) throw new RangeError('PS1 operation string is too long');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('PS1 operation arguments must be serializable data');
  if (depth >= 8 || stack.has(value)) throw new TypeError('PS1 operation arguments must be bounded, acyclic data');
  if (!Array.isArray(value)) object(value, 'PS1 operation argument');
  const keys = Reflect.ownKeys(value);
  if (keys.length > 32) throw new RangeError('PS1 operation argument is too large');
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 16) throw new RangeError('PS1 operation argument array is too large');
      const result = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('PS1 operation arrays must contain plain values');
        result.push(copyValue(descriptor.value, stack, depth + 1));
      }
      for (const key of keys) if (key !== 'length' && !/^(0|[1-9]\d*)$/.test(String(key))) {
        throw new TypeError('PS1 operation arrays must not contain extra properties');
      }
      return result;
    }
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) throw new TypeError('PS1 operation arguments must not contain symbols or accessors');
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
  fields(time, ['unit', 'value'], 'PS1 operation time');
  const {unit, value} = time;
  if (!['sample', 'seconds'].includes(unit)) throw new TypeError('PS1 operation time unit must be sample or seconds');
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER ||
      (unit === 'sample' && !Number.isSafeInteger(value))) {
    throw new RangeError('PS1 operation offset must be nonnegative and samples must be safe integers');
  }
  return {unit, value};
}

function copyCall(operation) {
  const method = operation?.method;
  if (typeof method !== 'string' || !Object.hasOwn(arity, method)) throw new TypeError(`Unsupported PS1 operation: ${String(method)}`);
  if (!Array.isArray(operation.args)) throw new TypeError('PS1 operation args must be an array');
  const [min, max] = arity[method];
  if (operation.args.length < min || operation.args.length > max) throw new TypeError(`Invalid argument count for PS1 ${method}`);
  return {method, args: copyValue(operation.args)};
}

export function ps1OperationOffsetSeconds(operation, referenceSampleRate = 44100) {
  referenceRate(referenceSampleRate);
  const time = copyTime(operation.time);
  return time.unit === 'sample' ? time.value / referenceSampleRate : time.value;
}

/** Copies/validates data without evaluating chip operations or reading state. */
function copyProgram(plan) {
  fields(plan, ['version', 'chip', 'referenceSampleRate', 'operations'], 'PS1 operation program');
  if (plan.version !== 1 || plan.chip !== 'ps1') throw new TypeError('Unsupported PS1 operation program version or chip');
  const rate = referenceRate(plan.referenceSampleRate);
  if (!Array.isArray(plan.operations) || plan.operations.length > MAX_PS1_OPERATIONS) throw new RangeError(`PS1 programs support at most ${MAX_PS1_OPERATIONS} operations`);
  let previous = 0;
  const operations = Array.from(plan.operations, (operation, index) => {
    fields(operation, ['time', 'order', 'method', 'args'], 'PS1 operation');
    if (operation.order !== index) throw new TypeError('PS1 operation order must match authored order');
    const time = copyTime(operation.time), call = copyCall(operation);
    const offset = time.unit === 'sample' ? time.value / rate : time.value;
    if (offset < previous) throw new RangeError('PS1 operation offsets must be nondecreasing');
    previous = offset;
    return {time, order: index, ...call};
  });
  return {version: 1, chip: 'ps1', referenceSampleRate: rate, operations};
}

/** Record once. This function never constructs a chip or resolves register bytes. */
export function buildPs1Operations(callback, options = {}) {
  if (typeof callback !== 'function') throw new TypeError('PS1 build requires a synchronous callback');
  fields(options, ['referenceSampleRate'], 'PS1 build options');
  const rate = referenceRate(options.referenceSampleRate ?? 44100), operations = [];
  let time = {unit: 'sample', value: 0}, active = true, previous = 0;
  const check = () => { if (!active) throw new Error('PS1 operation recorder is no longer active'); };
  const builder = Object.create(null);
  builder.atSeconds = value => {
    check(); time = copyTime({unit: 'seconds', value});
    if (value < previous) throw new RangeError('PS1 operation offsets must be nondecreasing');
    previous = value;
    return builder;
  };
  builder.atSample = value => {
    check(); time = copyTime({unit: 'sample', value});
    const seconds = value / rate;
    if (seconds < previous) throw new RangeError('PS1 operation offsets must be nondecreasing');
    previous = seconds;
    return builder;
  };
  for (const method of PS1_OPERATION_METHODS) builder[method] = (...args) => {
    check();
    if (operations.length >= MAX_PS1_OPERATIONS) throw new RangeError(`PS1 programs support at most ${MAX_PS1_OPERATIONS} operations`);
    const call = copyCall({method, args});
    operations.push({time: {...time}, order: operations.length, ...call});
    return builder;
  };
  try {
    const result = callback(builder);
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw new TypeError('PS1 build callbacks must be synchronous');
    }
    return copyProgram({version: 1, chip: 'ps1', referenceSampleRate: rate, operations});
  } finally {
    active = false;
  }
}

/** Resolver metadata only: no sample bytes, oscillator phase or decoder state. */
export function validatePs1OperationState(state) {
  if(!state || typeof state!=='object' || !Array.isArray(state.registers) || state.registers.length!==512 ||
    !Array.isArray(state.channels) || state.channels.length!==24 || !Array.isArray(state.samples) || state.samples.length>32512)
    throw TypeError('Complete PS1 register, sample and voice metadata required');
  fields(state,['registers','channels','samples','gates','reverb','nextAddress'],'PS1 resolver state');
  const presetFields=['sample','volumeLeft','volumeRight','adsr1','adsr2','pitch','reverb'];
  const sampleFields=['id','startAddress','repeatAddress','byteLength','decodedFrames','rootNote','rootFrequencyHz','basePitch','loop','loopStartSamples','editorChannel'];
  const copy={registers:Array.from(state.registers),channels:Array.from(state.channels,p=>{fields(p,presetFields,'PS1 voice');return copyValue(p);}),
    samples:Array.from(state.samples,p=>{fields(p,sampleFields,'PS1 sample');return copyValue(p);}),
    gates:Array.from(state.gates??[]),reverb:copyValue(state.reverb),nextAddress:state.nextAddress};
  if(!Number.isInteger(copy.nextAddress)||copy.nextAddress<4096||copy.nextAddress>524288||copy.nextAddress%16)throw RangeError('Invalid PS1 sample allocator');
  for(const value of copy.registers)if(!Number.isInteger(value)||value<0||value>65535)throw RangeError('Invalid PS1 register');
  // Reuse the immediate validators, with no real chip or RAM.
  const synth=scratch(copy.registers);
  synth._adoptResources({samples:copy.samples,nextAddress:copy.nextAddress});
  copy.channels=copy.channels.map((preset,ch)=>synth._preset(ch,{...preset,...(preset.sample===null?{sample:undefined}:{})}));
  copy.reverb=synth._reverb(copy.reverb);
  if(!Array.isArray(copy.gates)||copy.gates.length!==24||copy.gates.some(value=>typeof value!=='boolean'))throw TypeError('Invalid PS1 gates');
  for(let id=0;id<copy.samples.length;id++){
    const sample=copy.samples[id];
    if(sample.id!==id || !Number.isFinite(sample.rootFrequencyHz)||sample.rootFrequencyHz<=0 || sample.basePitch!==4096 ||
      !Number.isInteger(sample.startAddress)||sample.startAddress<4096||sample.startAddress%16 ||
      !Number.isInteger(sample.byteLength)||sample.byteLength<16||sample.byteLength%16||sample.startAddress+sample.byteLength>524288 ||
      !Number.isInteger(sample.repeatAddress)||sample.repeatAddress%16||sample.repeatAddress<4096||sample.repeatAddress>=524288)
      throw TypeError('Invalid PS1 sample metadata');
  }
  return {registers:copy.registers,channels:copy.channels,samples:copy.samples,gates:copy.gates,reverb:copy.reverb,nextAddress:copy.nextAddress};
}
function scratch(registers=Array(512).fill(0), onWrite=()=>{}) {
  const image=registers.slice();
  return new Ps1Synth({core:{reset(){image.fill(0);},loadRam(){throw Error('RAM transfers are not timed operations');},
    write(register,value){image[register/2]=value;onWrite(register,value);},read:register=>image[register/2],
    readRam(){return new Uint8Array(0);},renderInto(){},dispose(){},refreshEnvelope(){}}});
}
export function capturePs1OperationState(synth) {
  return validatePs1OperationState({registers:Array.from({length:512},(_,at)=>synth.core.read(at*2)),
    channels:synth.channels,samples:synth.samples,gates:synth.gates,reverb:synth.reverb,nextAddress:synth.nextAddress});
}
export function createPs1OperationResetState() {
  return capturePs1OperationState(scratch());
}
export function createPs1OperationResolver() {
  return {resolve(operation,state){
    const input=validatePs1OperationState(state),call=copyCall(operation),writes=[];
    const synth=scratch();
    // Constructor writes are deliberately excluded from the trace.
    const registers=input.registers.slice();
    synth.core.read=register=>registers[register/2];
    synth.core.write=(register,value)=>{registers[register/2]=value;writes.push({register,value});};
    synth._adoptResources({samples:input.samples,nextAddress:input.nextAddress});
    synth.channels=input.channels;synth.gates=input.gates;synth.reverb=input.reverb;
    synth[call.method](...call.args);
    return {writes,state:capturePs1OperationState(synth)};
  }};
}
export function validatePs1Operations(plan) { return copyProgram(plan); }
export function compilePs1Operations(plan,state) {
  const copy=copyProgram(plan),resolver=createPs1OperationResolver(),rows=[];
  let work=validatePs1OperationState(state);
  for(let operationIndex=0;operationIndex<copy.operations.length;operationIndex++){
    const operation=copy.operations[operationIndex],result=resolver.resolve(operation,work);
    result.writes.forEach((write,writeIndex)=>rows.push({offsetSeconds:ps1OperationOffsetSeconds(operation,copy.referenceSampleRate),...write,operationIndex,writeIndex}));
    work=result.state;
  }
  return rows;
}
