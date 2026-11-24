// SPDX-License-Identifier: BSD-3-Clause
import { readFmPreset } from '../synth-fm2608/preset.js';
import { normalizeCapturedVoice } from '../synth/synth_performance.js';

export function readFm2610Patch(value) {
  const preset = readFmPreset(value);
  if (value.lfo !== undefined) {
    const {enabled, frequency} = value.lfo ?? {};
    if (typeof enabled !== 'boolean' || !Number.isInteger(frequency) || frequency < 0 || frequency > 7) {
      throw new RangeError('FM LFO requires an enable switch and a rate from 0 to 7.');
    }
    preset.lfo = {enabled, frequency};
  }
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

export function fmCaptureReason(snapshot, voice) {
  if (voice.specialMode && snapshot.csmEnabled) return 'CH3 is being triggered by Timer A (CSM).';
  if (voice.specialMode && !voice.specialFrequencies[3]?.fnum) return 'CH3 needs an OP4 base pitch for keyboard transposition.';
  return '';
}

export function captureFm2610Patch(snapshot, voice) {
  const unsupported = fmCaptureReason(snapshot, voice);
  if (unsupported) throw new Error(unsupported);
  return readFm2610Patch({
    ...voice.preset,
    keyMask: voice.keyMask || voice.lastKeyMask || 15,
    lfo: snapshot.lfo,
    specialFrequencies: voice.specialMode ? voice.specialFrequencies : undefined,
  });
}
