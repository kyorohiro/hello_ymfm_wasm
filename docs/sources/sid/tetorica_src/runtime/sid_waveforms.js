// SPDX-License-Identifier: BSD-3-Clause
// Pure waveform names and masks, shared by authoring and SID-file snapshots.
// This module imports no chip core, audio endpoint or generated WASM.

/** @typedef {'triangle'|'saw'|'pulse'|'noise'} SidWaveformName */
/** @typedef {'off'|'triangle'|'saw'|'triangle+saw'|'pulse'|'triangle+pulse'|'saw+pulse'|'triangle+saw+pulse'|'noise'|'triangle+noise'|'saw+noise'|'triangle+saw+noise'|'pulse+noise'|'triangle+pulse+noise'|'saw+pulse+noise'|'triangle+saw+pulse+noise'} SidWaveform */

/** Hardware waveform flags in canonical low-to-high bit order.
 * @type {readonly SidWaveformName[]} */
export const SID_WAVEFORMS = Object.freeze(['triangle', 'saw', 'pulse', 'noise']);

/** Decode a waveform name or '+' combination into the four-bit hardware mask.
 * Order is accepted in either direction; unknown/empty/duplicate flags reject.
 * Use sidWaveformFromBits() to obtain the canonical spelling.
 * @param {string} value
 * @returns {number} Integer 0..15; off is zero. */
export function sidWaveformBits(value) {
  if (typeof value !== 'string') throw new TypeError('SID waveform must be a string');
  if (value === 'off') return 0;
  let bits = 0;
  for (const name of value.split('+')) {
    const index = SID_WAVEFORMS.findIndex(waveform => waveform === name);
    if (index < 0) throw new RangeError('SID waveform must be off or a combination of triangle, saw, pulse and noise');
    const bit = 1 << index;
    if (bits & bit) throw new RangeError('SID waveform flags must not be duplicated');
    bits |= bit;
  }
  return bits;
}

/** Canonical hardware waveform spelling, including off and all combinations.
 * @param {number} bits Integer 0..15.
 * @returns {SidWaveform} */
export function sidWaveformFromBits(bits) {
  if (!Number.isInteger(bits) || bits < 0 || bits > 15) throw new RangeError('SID waveform mask must be an integer 0..15');
  return /** @type {SidWaveform} */ (SID_WAVEFORMS.filter((name, index) => bits & (1 << index)).join('+') || 'off');
}
