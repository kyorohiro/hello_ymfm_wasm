// OPL3: CH0 + CH3 form one four-operator voice; only CH0 receives notes.
setBpm(100);
opl.setPreset(0, OPL_PRESETS['four-op-bell']);

liveLoop('opl3-algorithms', async () => {
  for (const algorithm of [0, 1, 2, 3]) {
    opl.setAlgo(0, algorithm, 2);
    for (const note of ['C4', 'E4', 'G4']) {
      opl.noteOn(0, note);
      await beat(0.6);
      opl.keyOff(0);
      await beat(0.2);
    }
  }
});

// setFourOp(0, false) returns physical CH3 to an independent two-op voice.
