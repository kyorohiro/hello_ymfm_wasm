// Each POKEY has its own four channels, timer settings and noise polynomials.
// Alternate the same phrase between the chips; stopping one does not stop the other.
setBpm(120);
pokey.setVolume(0, 6);
pokey2.setVolume(0, 6);
pokey2.setDistortion(0, 7);
liveLoop('dual-pokey-alternating', async () => {
  for (const chip of [pokey, pokey2]) {
    for (const note of ['C4', 'E4', 'G4', 'C5']) {
      chip.setNote(0, note); chip.keyOn(0);
      await beat(0.35);
      chip.keyOff(0);
      await beat(0.15);
    }
  }
});
