// SPDX-License-Identifier: BSD-3-Clause
import {readPreset} from './preset.js';

/** Explicit software setup for comparing the two hardware depth directions.
 * Wave / Volume controls and the chosen direction remain authored values.
 */
export function prepareFdsDepthComparison(value) {
  const preset = readPreset(value);
  preset.source = 'fds';
  Object.assign(preset.fds.modulation, {
    enabled:true, table:[...Array(8).fill(1), ...Array(16).fill(7), ...Array(8).fill(1)], rate:8, bias:0,
  });
  Object.assign(preset.fds.modulation.envelope, {enabled:true, initialGain:16, period:31});
  preset.fds.envelopeClock = {masterSpeed:232, halt:false};
  return preset;
}

/** Explain the next attack's authored settings, without predicting live state. */
export function describeFdsDepthEnvelope(value) {
  const {modulation, envelopeClock} = readPreset(value).fds;
  const envelope = modulation.envelope;
  const meaning = 'Depth controls modulation amount, not upward or downward pitch.';
  if (!envelope.enabled) return {text:`Next note: Depth Envelope is off; fixed depth ${modulation.depth} is used. ${meaning}`, warning:true};
  const start = envelope.initialGain, target = envelope.increase ? Math.max(start,32) : 0;
  const direction = envelope.increase ? 'Increase' : 'Decrease';
  const paused = envelopeClock.halt || envelopeClock.masterSpeed === 0;
  const notes = [`Next note: ${direction} Depth ${start} → ${paused ? start : target}.`];
  let warning = false;
  if (paused) {
    notes.push(`Shared clock ${envelopeClock.halt ? 'Pause is on' : 'Master period is 0'}; Depth stays at ${start}.`);
    warning = true;
  } else if (start === target) {
    notes.push(envelope.increase ? `Increase cannot raise a starting depth of ${start}; no depth change.` : 'Decrease starts at 0; no depth change.');
    warning = true;
  } else {
    const seconds = Math.abs(target - start) * 8 * (envelope.period + 1) * (envelopeClock.masterSpeed + 1) / 1789773;
    const time = seconds >= .1 ? `${seconds.toFixed(2)} s` : `${(seconds * 1000).toFixed(seconds < .001 ? 3 : 1)} ms`;
    notes.push(`It reaches ${target} in about ${time} at NTSC speed.`);
  }
  if (!modulation.enabled || modulation.rate === 0) {
    notes.push('The modulation-table clock is stopped; retained counter / Bias can still affect pitch.');
    warning = true;
  }
  notes.push(meaning);
  return {text:notes.join(' '), warning};
}
