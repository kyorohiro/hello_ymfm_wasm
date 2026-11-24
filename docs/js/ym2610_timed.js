// SPDX-License-Identifier: BSD-3-Clause
import {
  YM2612_OPERATION_ARITY, copyOpnOperationCall, copyOpnOperationProgram,
  createYm2612OperationResetState, observeYm2612OperationWrite, recordOpnOperations,
  validateYm2612OperationState, ym2612OperationOffsetSeconds,
} from './ym2612_operations.js?v=audio-stability-2';
import {adoptYm2612OperationState} from './ym2612_operation_state.js?v=audio-stability-2';
import {createYm2612TimedSnapshot, validateYm2612TimedSnapshot} from './ym2612_timed_state.js?v=audio-stability-2';
import {NeoGeoFMSynth, YM2610BSynth} from './ym2610bsynth.js';

const {setDacEnabled, writeDac, ...fmMethods} = YM2612_OPERATION_ARITY;
const arity = Object.freeze({...fmMethods, keyOff: [1, 1], setModulation: [3, 3]});
const stateFormat = 'tetorica-ym2610-state';

function profile(variant) {
  if (variant !== 'ym2610' && variant !== 'ym2610b') throw new RangeError('Choose YM2610 or YM2610B.');
  return {chip: variant, arity};
}

/** FM, SSG and ADPCM registers live on two OPNB ports. Reset opens both stereo gates. */
export function createYm2610OperationResetState() {
  const state = createYm2612OperationResetState();
  for (const bank of state.registers) bank.fill(0xc0, 0xb4, 0xb7);
  return state;
}

function createResolver({clock, variant}) {
  const configuration = profile(variant);
  let writes = [];
  const raw = new YM2610BSynth({clock, transport: {
    write(port, register, value) { writes.push({port, register, value}); },
  }});
  const fm = variant === 'ym2610' ? new NeoGeoFMSynth(raw) : raw;
  return {
    resolve(operation, state) {
      const input = validateYm2612OperationState(state);
      const {method, args} = copyOpnOperationCall(operation, configuration.arity);
      adoptYm2612OperationState(raw, input);
      raw._modeRegister &= ~0x30;
      writes = [];
      // Raw addresses are physical on both variants. Musical FM calls use the compact Neo Geo mapping.
      if (method === 'rawWrite' || method === 'write') raw.write(...args);
      else fm[method](...args);
      for (const {port, register, value} of writes) observeYm2612OperationWrite(input, port, register, value);
      return {writes, state: input};
    },
  };
}

function validateOperations(operations, {clock, variant, validateArguments = true}) {
  const plan = copyOpnOperationProgram(operations, profile(variant));
  if (validateArguments) {
    const resolver = createResolver({clock, variant});
    let state = createYm2610OperationResetState();
    for (const operation of plan.operations) state = resolver.resolve(operation, state).state;
  }
  return plan;
}

function compile(operations, state, {clock, variant}) {
  const plan = validateOperations(operations, {clock, variant, validateArguments: false});
  const resolver = createResolver({clock, variant});
  return plan.operations.flatMap((operation, operationIndex) => {
    const result = resolver.resolve(operation, state);
    state = result.state;
    const offsetSeconds = ym2612OperationOffsetSeconds(operation, plan.referenceSampleRate);
    return result.writes.map((write, writeIndex) => ({offsetSeconds, ...write, operationIndex, writeIndex}));
  });
}

function createSnapshot(state, configuration) {
  profile(configuration.variant);
  return Object.freeze({...createYm2612TimedSnapshot(state, configuration), format: stateFormat,
    variant: configuration.variant});
}

function validateSnapshot(value, expected) {
  if (value?.format !== stateFormat || value.variant !== expected.variant) {
    throw new TypeError('Incompatible YM2610 timed snapshot.');
  }
  const {variant, ...snapshot} = value;
  const state = validateYm2612TimedSnapshot({...snapshot, format: 'tetorica-ym2612-state'}, expected);
  return Object.freeze({...state, format: stateFormat, variant});
}

/** The shared OPN reservation lifecycle with OPNB's channel mapping and register resolver. */
export const ym2610Timing = Object.freeze({
  protocol: 'ym2610Timed',
  errorType: 'ym2610-timed-error',
  build(callback, options = {}, {variant}) {
    return recordOpnOperations(callback, options, profile(variant));
  },
  compile, validateOperations, createResolver, createSnapshot, validateSnapshot,
  createResetState: createYm2610OperationResetState, validateState: validateYm2612OperationState,
});
