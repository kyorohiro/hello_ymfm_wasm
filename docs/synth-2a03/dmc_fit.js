// SPDX-License-Identifier: BSD-3-Clause
import {MAX_DPCM_BYTES} from './preset.js';

const MAX_TARGETS = MAX_DPCM_BYTES * 8;
const STATE_COUNT = 64;

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

function decodeLevels(data, initial) {
  const levels = new Uint8Array(data.length * 8 + 1);
  levels[0] = initial;
  for (let index = 0; index < levels.length - 1; index++) {
    const bit = (data[index >> 3] >> (index & 7)) & 1, previous = levels[index];
    levels[index + 1] = bit ? (previous <= 125 ? previous + 2 : previous) : (previous >= 2 ? previous - 2 : previous);
  }
  return levels;
}

/** Fit existing DPCM bits to manually drawn DAC targets, using nearby bits to
 * approach the cursor and then return to the original waveform. The editable
 * window includes at most 62 bits before the first target and 63 after the last.
 * Targets address the DAC level after a bit, in LSB-first playback order.
 *
 * The cursor (priorityBit, or the last target bit) permits one DAC step (±2) of
 * error: exact point matching must not cause a trip to a DAC boundary merely
 * to change time parity. Beyond that tolerance, cursor accuracy takes priority
 * over returning within one step of the original end level, following the
 * interpolated stroke, restoring the exact end level, and keeping original
 * bits. The recovery tolerance avoids the same parity problem at the tail;
 * rejoined reports whether recovery was exact. All choices obey the DAC's ±2 /
 * boundary-hold behavior. This edits existing DPCM; it does not convert or
 * import PCM audio.
 * @param {number[]|Uint8Array} value
 * @param {Iterable<{bit:number,level:number}>} targets
 * @param {{level?:number,priorityBit?:number}} [options]
 * @returns {{data:number[],range:{startBit:number,endBit:number}|null,changedBits:number,changedBefore:number,changedAfter:number,cursor:{bit:number,target:number,actual:number,error:number}|null,rejoined:boolean}}
 */
export function fitDmcTargets(value, targets, {level = 64, priorityBit} = {}) {
  if (!Number.isInteger(level) || level < 0 || level > 127) throw new RangeError('DMC initial level must be an integer 0–127');
  const data = copyBytes(value), total = data.length * 8;
  if (targets === null || targets === undefined || typeof targets[Symbol.iterator] !== 'function') throw new TypeError('DMC fit targets must be iterable');
  const desired = new Float64Array(total).fill(NaN);
  let count = 0, minTarget = total, maxTarget = -1;
  for (const target of targets) {
    if (++count > MAX_TARGETS) throw new RangeError(`DMC fitting exceeds ${MAX_TARGETS} target points`);
    if (!target || typeof target !== 'object' || Array.isArray(target)) throw new TypeError('DMC fit target must contain bit and level');
    if (!Number.isInteger(target.bit) || target.bit < 0 || target.bit >= total) throw new RangeError('DMC fit targets must address original bits; generated padding is read only');
    if (typeof target.level !== 'number' || !Number.isFinite(target.level) || target.level < 0 || target.level > 127) throw new RangeError('DMC target level must be finite and within 0–127');
    desired[target.bit] = target.level; // The latest target wins when a stroke doubles back.
    minTarget = Math.min(minTarget,target.bit);
    maxTarget = Math.max(maxTarget,target.bit);
  }
  if (priorityBit !== undefined && (!Number.isInteger(priorityBit) || priorityBit < 0 || priorityBit >= total || Number.isNaN(desired[priorityBit]))) throw new RangeError('DMC priority bit must address a supplied target');
  if (maxTarget < 0) return {data,range:null,changedBits:0,changedBefore:0,changedAfter:0,cursor:null,rejoined:true};
  priorityBit ??= maxTarget;

  // All validation is complete. The source, its length, and its initial DAC are
  // never changed; generated hardware padding is outside this problem.
  const original = [...data], originalLevels = decodeLevels(original,level), parity = level & 1;
  const startBit = Math.max(0,minTarget - 62), endBit = Math.min(total - 1,maxTarget + 63), span = endBit - startBit + 1;
  // Cover the approach and recovery as well as the actual stroke. Otherwise an
  // equally accurate cursor can be reached by an arbitrary excursion nearby.
  // A target at the final bit remains the reference endpoint; it is not replaced
  // by the original level used separately for the recovery objective.
  const reference = new Float64Array(span);
  let previousBit = startBit - 1, previousLevel = originalLevels[startBit];
  function interpolate(nextBit, nextLevel) {
    for (let index = previousBit + 1; index <= nextBit; index++) reference[index - startBit] = previousLevel + (nextLevel - previousLevel) * (index - previousBit) / (nextBit - previousBit);
    previousBit = nextBit; previousLevel = nextLevel;
  }
  for (let index = startBit; index <= endBit; index++) if (!Number.isNaN(desired[index])) interpolate(index,desired[index]);
  if (previousBit < endBit) interpolate(endBit,originalLevels[endBit + 1]);
  // A byte records the previous state (six bits) and the chosen DPCM bit.
  // Even the full 4081-byte sample uses only 2,089,472 backpointer bytes.
  const trace = new Uint8Array(span * STATE_COUNT).fill(255);
  let cursorCosts = new Float64Array(STATE_COUNT).fill(Infinity), targetCosts = new Float64Array(STATE_COUNT).fill(Infinity), flips = new Uint32Array(STATE_COUNT);
  let nextCursor = new Float64Array(STATE_COUNT), nextTargets = new Float64Array(STATE_COUNT), nextFlips = new Uint32Array(STATE_COUNT);
  const initialState = (originalLevels[startBit] - parity) >> 1;
  cursorCosts[initialState] = targetCosts[initialState] = 0;

  for (let index = startBit; index <= endBit; index++) {
    nextCursor.fill(Infinity); nextTargets.fill(Infinity); nextFlips.fill(0xffffffff);
    const originalBit = (original[index >> 3] >> (index & 7)) & 1, target = desired[index], referenceLevel = reference[index - startBit], traceOffset = (index - startBit) * STATE_COUNT;
    for (let state = 0; state < STATE_COUNT; state++) {
      if (!Number.isFinite(cursorCosts[state])) continue;
      // Keeping the original bit first gives deterministic, conservative ties.
      for (let choice = 0; choice < 2; choice++) {
        const bit = originalBit ^ choice, next = bit ? Math.min(63,state + 1) : Math.max(0,state - 1);
        const actual = parity + 2 * next, error = (actual - referenceLevel) ** 2;
        const cursorCost = cursorCosts[state] + (index === priorityBit ? Math.max(0,Math.abs(actual - target) - 2) ** 2 : 0), targetCost = targetCosts[state] + error, flipCount = flips[state] + choice;
        if (cursorCost < nextCursor[next] || (cursorCost === nextCursor[next] && (targetCost < nextTargets[next] || (targetCost === nextTargets[next] && flipCount < nextFlips[next])))) {
          nextCursor[next] = cursorCost; nextTargets[next] = targetCost; nextFlips[next] = flipCount;
          trace[traceOffset + next] = state | (bit << 6);
        }
      }
    }
    [cursorCosts,nextCursor] = [nextCursor,cursorCosts];
    [targetCosts,nextTargets] = [nextTargets,targetCosts];
    [flips,nextFlips] = [nextFlips,flips];
  }

  let best = -1, bestReturn = Infinity, bestExactReturn = Infinity;
  for (let state = 0; state < STATE_COUNT; state++) {
    if (!Number.isFinite(cursorCosts[state])) continue;
    const returnDistance = Math.abs(parity + 2 * state - originalLevels[endBit + 1]), returnError = Math.max(0,returnDistance - 2) ** 2, exactReturnError = returnDistance ** 2;
    if (best < 0 || cursorCosts[state] < cursorCosts[best] || (cursorCosts[state] === cursorCosts[best] && (returnError < bestReturn || (returnError === bestReturn && (targetCosts[state] < targetCosts[best] || (targetCosts[state] === targetCosts[best] && (exactReturnError < bestExactReturn || (exactReturnError === bestExactReturn && flips[state] < flips[best])))))))) {
      best = state; bestReturn = returnError; bestExactReturn = exactReturnError;
    }
  }
  const rejoined = bestExactReturn === 0;
  for (let index = endBit, state = best; index >= startBit; index--) {
    const code = trace[(index - startBit) * STATE_COUNT + state], bit = code >> 6, mask = 1 << (index & 7), byte = index >> 3;
    data[byte] = bit ? data[byte] | mask : data[byte] & ~mask;
    state = code & 63;
  }
  let changedBits = 0, changedBefore = 0, changedAfter = 0;
  for (let index = startBit; index <= endBit; index++) {
    if (!((data[index >> 3] ^ original[index >> 3]) & (1 << (index & 7)))) continue;
    changedBits++;
    if (index < minTarget) changedBefore++;
    else if (index > maxTarget) changedAfter++;
  }
  const actual = decodeLevels(data,level)[priorityBit + 1], target = desired[priorityBit];
  return {data,range:{startBit,endBit},changedBits,changedBefore,changedAfter,cursor:{bit:priorityBit,target,actual,error:Math.abs(actual - target)},rejoined};
}
