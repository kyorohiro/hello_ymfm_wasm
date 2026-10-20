// OPL3 / YMF262: six optional four-operator pairs and stereo routing.
// Four-op primaries: 0..2 and 9..11. Each borrows channel primary + 3.
setBpm(120);
opl.setPreset(0, OPL_PRESETS['four-op-bell']);
opl.setPan(0, true, true);

liveLoop('opl3-melody', async () => {
  for (const note of ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4']) {
    opl.noteOn(0, note);
    await beat(0.4);
    opl.keyOff(0);
    await beat(0.1);
  }
});

// CH3 is borrowed by CH0. Keyboard excludes borrowed channels automatically.
