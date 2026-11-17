// SPDX-License-Identifier: BSD-3-Clause
import {DSP_FEEDBACK_MAX} from './scsp_dsp_coefficients.js';

export const SCSP_DSP_DELAY_RAM_BYTES = 65536;
export const SCSP_DSP_DELAY_ALIGNMENT = 8192;
const RAM_BYTES = 524288;
const DEFAULTS = Object.freeze({enabled: false, timeMs: 240, feedback: .35});

function checkKeys(value, allowed, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value) ||
      Reflect.ownKeys(value).some(key => !allowed.includes(key))) {
    throw new TypeError(`Invalid ${name}`);
  }
}

/** Resolve explicit Delay settings to the codes used by the fixed SCSP DSP. */
export function resolveScspDspDelay(patch, previous = DEFAULTS) {
  checkKeys(patch, ['enabled', 'timeMs', 'feedback'], 'SCSP DSP Delay settings');
  const next = {...previous, ...patch};
  if (typeof next.enabled !== 'boolean') throw new TypeError('SCSP DSP Delay enabled must be boolean');
  if (!Number.isInteger(next.timeMs) || next.timeMs < 20 || next.timeMs > 700) {
    throw new RangeError('SCSP DSP Delay time must be 20..700 ms');
  }
  if (!Number.isFinite(next.feedback) || next.feedback < -1 || next.feedback > DSP_FEEDBACK_MAX) {
    throw new RangeError(`SCSP DSP Delay feedback must be -1..${DSP_FEEDBACK_MAX}`);
  }
  return {enabled: next.enabled, timeMs: next.timeMs, feedback: Math.floor(next.feedback * 4096) / 4096};
}

/** RBP advances by 4096 words. The owned ring contains 32768 packed words. */
export function validateScspDspDelayRam(reservation) {
  checkKeys(reservation, ['address', 'byteLength'], 'SCSP DSP Delay RAM reservation');
  if (Reflect.ownKeys(reservation).length !== 2 || reservation.byteLength !== SCSP_DSP_DELAY_RAM_BYTES ||
      !Number.isSafeInteger(reservation.address) || reservation.address < 0 ||
      reservation.address > RAM_BYTES - SCSP_DSP_DELAY_RAM_BYTES ||
      reservation.address % SCSP_DSP_DELAY_ALIGNMENT !== 0) {
    throw new RangeError('SCSP DSP Delay requires an 8192-byte-aligned 65536-byte RAM reservation');
  }
  return {address: reservation.address, byteLength: SCSP_DSP_DELAY_RAM_BYTES};
}

const word = ({ira = 0, iwt = false, coefficient = 0, accumulate = false,
  read = false, write = false, emit = false, address = 0} = {}) => [
  0, 0xa000 | (ira << 6) | (iwt ? 0x20 : 0),
  (read ? 0x2000 : 0) | (write ? 0x4000 : 0) | (emit ? 0x1000 : 0) | (accumulate ? 1 : 2),
  (coefficient << 9) | (address << 2),
];

/** Original six-step mono Delay, shared with the existing Synth's reference. */
export function createScspDspDelayProgram() {
  const program = new Uint16Array(512);
  const steps = [word(), word({read: true}), word({iwt: true}),
    word({emit: true, coefficient: 1}), word({ira: 32, coefficient: 2, accumulate: true}),
    word({write: true, address: 1})];
  steps.forEach((instruction, index) => program.set(instruction, index * 4));
  return program;
}

/** Packed SCSP floating-point zero is 0x6000 in the core's big-endian RAM. */
export function createScspDspDelaySilence() {
  const bytes = new Uint8Array(SCSP_DSP_DELAY_RAM_BYTES);
  for (let index = 0; index < bytes.length; index += 2) bytes[index] = 0x60;
  return bytes;
}
