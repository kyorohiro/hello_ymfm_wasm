// SPDX-License-Identifier: BSD-3-Clause
import {gameboyCodeLiveView} from './code_live.js';
import {createDefaultPreset,readPreset} from './preset.js';

/** Re-trigger a configured song voice, not its current envelope/Sweep phase.
 * The portable preset contains no song pitch, length counter or note history.
 */
export function prepareGameboySongVoice(snapshot, channel, {name} = {}) {
  if (snapshot?.clock !== 4194304) throw new RangeError('Song voice requires the normal 4194304 Hz Game Boy clock.');
  const view = gameboyCodeLiveView(snapshot, channel, createDefaultPreset());
  const preset = view.preset, values = snapshot.voice, registers = snapshot.registers;
  const source = preset.source;
  const label = source === 'pulse' ? 'Pulse' : source === 'wave' ? 'Wave' : 'Noise';
  preset.name = name ?? `${label} · VGM CH${channel + 1}`;
  // CH2 has no NR10 Sweep even if an earlier CH1 sound used it.
  if (channel !== 0) preset.pulse.sweep.enabled = false;
  let reason = '';
  if (!(registers[22] & 128)) reason = 'The song APU is powered off at this position.';
  else if (channel === 2 && !(values[10] & 128)) reason = 'CH3 Wave DAC is off at this position.';
  else if (channel !== 2 && !(values[channel * 5 + 2] & 0xf8)) reason = 'This channel DAC is off at this position.';
  else if (!preset.pan.left && !preset.pan.right) reason = 'This channel is routed to neither left nor right output.';
  else if (channel === 2 && preset.wave.level === 0) reason = 'CH3 Wave output level is muted.';
  else if (channel !== 2) {
    const voice = source === 'noise' ? preset.noise : preset.pulse;
    if (voice.volume === 0 && !(voice.envelope.direction === 'up' && voice.envelope.period > 0))
      reason = 'This channel starts at zero volume and its configured envelope does not rise.';
  }
  const positionFrames = snapshot.positionFrames;
  if (!Number.isSafeInteger(positionFrames) || positionFrames < 0) throw new RangeError('Song voice needs an exact nonnegative observation frame.');
  const frequencyHz = view.frequency;
  return {
    preset: readPreset(preset), channel, source, positionFrames,
    period: view.period, frequencyHz,
    midi: frequencyHz === null ? null : 69 + 12 * Math.log2(frequencyHz / 440),
    playable: !reason, reason,
    description: `${label} CH${channel + 1} · configured settings; retriggered envelope${channel === 0 ? ' / Sweep' : ''}.`,
  };
}
