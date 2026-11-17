// SPDX-License-Identifier: BSD-3-Clause
export const DSP_COEFFICIENT_MIN = -4096;
export const DSP_COEFFICIENT_MAX = 4095;
export const DSP_FEEDBACK_MAX = DSP_COEFFICIENT_MAX / 4096;
// The DSP consumes the signed high 13 bits as Q12 and ignores the low three.
export const coefficientWord = value => (value & 0x1fff) << 3;
export function resolveCoefficientPatch(patch, previous) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || ArrayBuffer.isView(patch)) {
    throw new TypeError('DSP coefficients require an object with keys 0, 1 or 2');
  }
  const keys = Reflect.ownKeys(patch), next = [...previous];
  for (const key of keys) {
    if (!['0', '1', '2'].includes(key)) throw new TypeError('DSP coefficient keys must be 0, 1 or 2');
    const value = patch[key];
    if (!Number.isInteger(value) || value < DSP_COEFFICIENT_MIN || value > DSP_COEFFICIENT_MAX) {
      throw new RangeError(`COEF${key} must be an integer from ${DSP_COEFFICIENT_MIN} to ${DSP_COEFFICIENT_MAX}`);
    }
    next[Number(key)] = value;
  }
  return {keys, next, changed: next.flatMap((value, index) => value === previous[index] ? [] : [index])};
}
/** Validate the optional complete example setup without reading a live core. */
export function validateScspDspProgramOptions(options) {
  if (options === undefined) return undefined;
  if (!options || typeof options !== 'object' || Array.isArray(options) || ArrayBuffer.isView(options) ||
    Reflect.ownKeys(options).length !== 1 || !Object.hasOwn(options, 'coefficients')) {
    throw new TypeError('DSP setup Apply options require only coefficients');
  }
  const {keys, next} = resolveCoefficientPatch(options.coefficients, [0, 0, 0]);
  if (keys.length !== 3) throw new TypeError('DSP setup Apply requires COEF0, COEF1 and COEF2');
  return {coefficients: {0: next[0], 1: next[1], 2: next[2]}};
}
