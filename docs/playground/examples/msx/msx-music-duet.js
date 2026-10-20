// MSX / MSX Audio: one shared OPLL user patch over a PSG bass line.
setBpm(120);
opll.setUserPatch(OPLL_USER_PRESETS.bell);
opll.setVoice(0, {instrument: 0, attenuation: 5, sustain: false});
opll.setVoice(1, {instrument: 0, attenuation: 8, sustain: false});
ay.setVoice(0, {tone: true, noise: false, volume: 7, envelope: false});

liveLoop('msx-music-duet', async () => {
  for (const [bass, low, high] of [
    ['C3', 'E4', 'G4'], ['A2', 'C4', 'E4'],
    ['F2', 'A3', 'C4'], ['G2', 'B3', 'D4'],
  ]) {
    ay.noteOn(0, bass);
    opll.noteOn(0, low);
    opll.noteOn(1, high);
    await beat(0.8);
    ay.keyOff(0);
    opll.keyOff(0);
    opll.keyOff(1);
    await beat(0.2);
  }
});

// Both instrument-0 voices use the same eight user-patch registers.
// Built-in instruments 1..15 are independent of that shared custom patch.
