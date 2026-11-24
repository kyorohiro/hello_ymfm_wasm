// SPDX-License-Identifier: BSD-3-Clause
import { readFmPreset } from '../synth-fm2608/preset.js';
import { normalizeCapturedVoice } from '../synth/synth_performance.js';

function readLfo(value) {
  const {enabled, frequency} = value ?? {};
  if (typeof enabled !== 'boolean' || !Number.isInteger(frequency) || frequency < 0 || frequency > 7) {
    throw new RangeError('FM LFO requires an enable switch and a rate from 0 to 7.');
  }
  return {enabled, frequency};
}

export function readFm2610Patch(value) {
  const preset = readFmPreset(value);
  if (value.lfo !== undefined) preset.lfo = readLfo(value.lfo);
  if (value.specialFrequencies !== undefined) {
    const voice = normalizeCapturedVoice({
      keyMask: preset.keyMask,
      specialMode: true,
      specialFrequencies: value.specialFrequencies,
    });
    preset.specialFrequencies = voice.specialFrequencies;
  }
  return preset;
}

/** Detach the working patches from an immutable VGM or Code state. */
export function readFm2610SnapshotPatches(snapshot) {
  let channel3Notice = '';
  const csmEnabled = snapshot.csmEnabled ?? Boolean(snapshot.modeRegister & 0x80);
  const channels = snapshot.channels.map(voice => {
    let specialFrequencies;
    if (voice.physicalChannel === 2 && voice.specialMode) {
      if (voice.specialFrequencies[3]?.fnum) specialFrequencies = voice.specialFrequencies;
      if (!specialFrequencies) channel3Notice = 'CH3 uses standard tuning (OP4 pitch was zero)';
      else if (csmEnabled) channel3Notice = 'CH3 uses keyboard triggering (VGM/Code used Timer A)';
    }
    const patch = readFm2610Patch({
      ...voice.preset,
      lfo: undefined,
      keyMask: voice.keyMask || voice.lastKeyMask || 15,
      specialFrequencies,
    });
    return {physicalChannel: voice.physicalChannel, patch};
  });
  return {channels, lfo: readLfo(snapshot.lfo), channel3Notice};
}
