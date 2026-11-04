// SPDX-License-Identifier: BSD-3-Clause
import {MAX_DPCM_BYTES} from './preset.js';

const MAX_TARGETS = MAX_DPCM_BYTES * 8;
function copyBytes(value) {
  if (!Array.isArray(value) && !(value instanceof Uint8Array)) throw new TypeError('DPCM: expected an array of bytes');
  if (value.length > MAX_DPCM_BYTES || Reflect.ownKeys(value).length !== value.length + (Array.isArray(value) ? 1 : 0)) throw new RangeError(`DPCM: expected 0–${MAX_DPCM_BYTES} dense bytes`);
  const data = [];
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value,index) || !Number.isInteger(value[index]) || value[index] < 0 || value[index] > 255) throw new RangeError('DPCM: expected dense bytes from 0 to 255');
    data.push(value[index]);
  }
  return data;
}

/** Choose DPCM steps nearest to manually drawn DAC targets.
 * Targets address the level after an original bit, in LSB-first playback
 * order. Untargeted bits are kept, including those before/after a stroke;
 * generated hardware padding is not editable here. Each choice observes the
 * DAC's ±2 / boundary-hold behavior, and ties keep the original bit.
 * This edits existing encoded data; it does not import or convert PCM audio.
 * @param {number[]|Uint8Array} value
 * @param {Iterable<{bit:number,level:number}>} targets
 * @param {{level?:number}} [options]
 * @returns {number[]} A detached byte array with the original length.
 */
export function applyDmcTargets(value, targets, {level = 64} = {}) {
  if (!Number.isInteger(level) || level < 0 || level > 127) throw new RangeError('DMC initial level must be an integer 0–127');
  const data = copyBytes(value), total = data.length * 8;
  if (targets === null || targets === undefined || typeof targets[Symbol.iterator] !== 'function') throw new TypeError('DMC draw targets must be iterable');
  const desired = new Float64Array(total).fill(NaN);
  let count = 0;
  for (const target of targets) {
    if (++count > MAX_TARGETS) throw new RangeError(`DMC drawing exceeds ${MAX_TARGETS} target points`);
    if (!target || typeof target !== 'object' || Array.isArray(target)) throw new TypeError('DMC draw target must contain bit and level');
    if (!Number.isInteger(target.bit) || target.bit < 0 || target.bit >= total) throw new RangeError('DMC draw targets must address original bits; generated padding is read only');
    if (typeof target.level !== 'number' || !Number.isFinite(target.level) || target.level < 0 || target.level > 127) throw new RangeError('DMC target level must be finite and within 0–127');
    desired[target.bit] = target.level; // The most recent target wins on backtracking.
  }
  // Validation finishes before any edit. The byte array is always our own copy.
  for (let index = 0; index < total; index++) {
    const byte = index >> 3, mask = 1 << (index & 7), original = Boolean(data[byte] & mask);
    const up = level <= 125 ? level + 2 : level, down = level >= 2 ? level - 2 : level;
    let bit = original;
    if (!Number.isNaN(desired[index])) {
      const upError = Math.abs(desired[index] - up), downError = Math.abs(desired[index] - down);
      if (upError < downError) bit = true;
      else if (downError < upError) bit = false;
      data[byte] = bit ? data[byte] | mask : data[byte] & ~mask;
    }
    level = bit ? up : down;
  }
  return data;
}
