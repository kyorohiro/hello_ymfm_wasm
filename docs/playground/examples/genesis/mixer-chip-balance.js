// Open the Sega PSG tab and the lower Mixer panel while this plays.
// The two chips use independent output controls. Mute/Solo do not stop their clocks.
const fmChip = await useSoundChip('ym2612');
const psgChip = await useSoundChip('segapsg');
fmChip.setPreset(0, FM_PRESETS['one-op-basic']);

// Optional script control of the same Mixer settings:
// await mixer.set(fmChip.id, {volume: 0.5, pan: -0.3});
// await mixer.set(psgChip.id, {solo: true});
// await mixer.set(psgChip.id, {solo: false});
// Kept commented so Run preserves the balance you set in the UI.

setBpm(110);
liveLoop('mixer-chip-balance', async () => {
  for (const note of ['C4', 'E4', 'G4', 'B4']) {
    fmChip.setNote(0, note);
    fmChip.keyOn(0);
    psgChip.tone(0, {note, attenuation: 9});
    await beat(0.75);
    fmChip.keyOff(0);
    psgChip.off(0);
    await beat(0.25);
  }
});
