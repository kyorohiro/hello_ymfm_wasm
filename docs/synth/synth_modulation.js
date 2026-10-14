// The performance wheel adds pitch depth without changing the saved patch.
// YM2612 PMS has eight hardware levels; the LFO is shared by all six voices.
export function modulationSettings(patch, wheelValue) {
  const depth = Math.round(Math.max(0, Math.min(127, wheelValue)) * 7 / 127);
  return {
    pms: Math.min(7, patch.pms + depth),
    lfoEnabled: patch.lfoEnabled || depth > 0,
    lfoFrequency: patch.lfoFrequency,
  };
}

export function applyModulation(synth, patch, wheelValue, voiceCount) {
  const settings = modulationSettings(patch, wheelValue);
  synth.setLfo(settings.lfoEnabled, settings.lfoFrequency);
  for (let channel = 0; channel < voiceCount; channel++) {
    synth.setPan(channel, true, true, patch.ams, settings.pms);
  }
}
