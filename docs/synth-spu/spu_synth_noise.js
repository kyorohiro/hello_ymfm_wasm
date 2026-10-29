// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
export const DEFAULT_NOISE = Object.freeze({enabled:false, clock:48});
export function readNoise(value = DEFAULT_NOISE) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key=>!Object.hasOwn(DEFAULT_NOISE,key))) throw new TypeError('Invalid Noise settings');
  const result={...DEFAULT_NOISE,...value};
  if (typeof result.enabled !== 'boolean') throw new TypeError('Noise enabled must be boolean');
  if (!Number.isSafeInteger(result.clock) || result.clock<0 || result.clock>63) throw new RangeError('Noise clock must be an integer from 0 to 63');
  return result;
}
