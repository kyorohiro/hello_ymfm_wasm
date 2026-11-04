// SPDX-License-Identifier: BSD-3-Clause
import {MAX_DPCM_BYTES} from './preset.js';

const CLOCK = 1789773;
const PERIODS = [428,380,340,320,286,254,226,214,190,160,142,128,106,84,72,54];
const integer = (value, max, label) => {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${label}: expected an integer 0–${max}`);
  return value;
};
function copyBytes(value) {
  if (!Array.isArray(value) && !(value instanceof Uint8Array)) throw new TypeError('DPCM: expected an array of bytes');
  if (value.length > MAX_DPCM_BYTES || Reflect.ownKeys(value).length !== value.length + (Array.isArray(value) ? 1 : 0)) throw new RangeError(`DPCM: expected 0–${MAX_DPCM_BYTES} dense bytes`);
  const data = [];
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) throw new RangeError('DPCM: expected a dense byte array');
    data.push(integer(value[index], 255, 'DPCM byte'));
  }
  return data;
}
function pass(bytes, level) {
  const levels = [level]; let clipped = 0;
  for (const byte of bytes) for (let bit = 0; bit < 8; bit++) {
    // The low DAC bit is not changed by DPCM. At the upper/lower limit the
    // requested step is held, rather than clamping an odd level to an even one.
    if (byte & (1 << bit)) {if (level <= 125) level += 2; else clipped++;}
    else if (level >= 2) level -= 2;
    else clipped++;
    levels.push(level);
  }
  return {levels, clipped};
}

/** Decode the DMC's unfiltered seven-bit DAC levels in LSB-first playback order.
 * Includes the standalone Synth's generated 0xaa hardware-length padding.
 * This is a data preview: no DMA startup/partial-byte phase, Master gain,
 * analogue output filtering, PCM encoding or audio device is involved.
 * Each levels array includes its starting level before the first bit.
 * clipped counts bit instructions held at a DAC limit, not out-of-range output.
 */
export function decodeDpcm(value, {level = 64, rate = 15, loop = false} = {}) {
  integer(level, 127, 'DMC initial level'); integer(rate, 15, 'DMC rate');
  if (typeof loop !== 'boolean') throw new TypeError('DMC Loop: expected a boolean');
  const data = copyBytes(value);
  const hardwareBytes = data.length ? Math.ceil((data.length - 1) / 16) * 16 + 1 : 0;
  const paddedData = [...data, ...Array(hardwareBytes - data.length).fill(0xaa)];
  const first = pass(paddedData, level);
  // Loop reloads the address/length, not the initial DAC value.
  const next = loop ? pass(paddedData, first.levels.at(-1)) : null;
  const bitRate = CLOCK / PERIODS[rate], bitDurationMs = 1000 / bitRate;
  return {data, paddedData, paddingBytes:hardwareBytes - data.length, hardwareBytes,
    bitRate, bitDurationMs, durationMs:hardwareBytes * 8 * bitDurationMs,
    levels:first.levels, nextLevels:next?.levels ?? null,
    clipped:first.clipped, nextClipped:next?.clipped ?? 0};
}
