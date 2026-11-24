// SPDX-License-Identifier: BSD-3-Clause
import { readFmPreset } from '../synth-fm2608/preset.js';

const CH3_PHYSICAL_CHANNEL = 2;

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
  if (value.specialMode !== undefined && typeof value.specialMode !== 'boolean') {
    throw new TypeError('CH3 Special mode must be a boolean.');
  }
  if (value.specialFrequencies !== undefined) {
    if (!Array.isArray(value.specialFrequencies) || value.specialFrequencies.length !== 4) {
      throw new RangeError('CH3 Special requires pitches for four operators.');
    }
    preset.specialFrequencies = Array.from(value.specialFrequencies, (pitch, index) => {
      const {block, fnum} = pitch ?? {};
      if (!Number.isInteger(block) || block < 0 || block > 7 || !Number.isInteger(fnum) || fnum < 0 || fnum > 2047) {
        throw new RangeError(`CH3 OP${index + 1} pitch requires Block 0–7 and F-NUM 0–2047.`);
      }
      return {block, fnum};
    });
    // Legacy patches imply Special On when they carry four pitches.
    if (value.specialMode === false) preset.specialMode = false;
    else if (!preset.specialFrequencies[3].fnum) throw new RangeError('CH3 Special requires an OP4 F-NUM above zero.');
  } else if (value.specialMode === true) {
    throw new RangeError('CH3 Special requires pitches for four operators.');
  }
  return preset;
}

export function isFm2610Channel3Special(preset) {
  return Boolean(preset.specialFrequencies && preset.specialMode !== false);
}

/** Project a decoded OPN voice into an editable FM patch. */
export function readFm2610VoicePatch(voice, {lfo, retainInactiveSpecial = false} = {}) {
  const physicalChannel = voice.physicalChannel ?? voice.channel;
  const pitches = voice.specialFrequencies;
  const configured = physicalChannel === CH3_PHYSICAL_CHANNEL &&
    (voice.specialMode || (retainInactiveSpecial && pitches.slice(0, 3).some(({block, fnum}) => block || fnum)));
  const enabled = configured && voice.specialMode && Boolean(pitches[3].fnum);
  return readFm2610Patch({
    ...voice.preset,
    operators: Object.values(voice.preset.operators),
    keyMask: voice.keyMask || voice.lastKeyMask || 15,
    lfo,
    specialFrequencies: configured ? pitches : undefined,
    specialMode: configured && !enabled ? false : undefined,
  });
}

/** Detach the working patches from an immutable VGM or Code state. */
export function readFm2610SnapshotPatches(snapshot) {
  let channel3Notice = '';
  const csmEnabled = snapshot.csmEnabled ?? Boolean(snapshot.modeRegister & 0x80);
  const channels = snapshot.channels.map(voice => {
    const patch = readFm2610VoicePatch(voice, {retainInactiveSpecial: true});
    if (voice.physicalChannel === CH3_PHYSICAL_CHANNEL && voice.specialMode) {
      if (!isFm2610Channel3Special(patch)) channel3Notice = 'CH3 uses standard tuning (OP4 pitch was zero)';
      else if (csmEnabled) channel3Notice = 'CH3 uses keyboard triggering (VGM/Code used Timer A)';
    }
    return {physicalChannel: voice.physicalChannel, patch};
  });
  return {channels, lfo: readLfo(snapshot.lfo), channel3Notice};
}
