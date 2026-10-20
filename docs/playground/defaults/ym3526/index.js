// OPL / YM3526: nine two-operator voices with sine operators.
setBpm(120);
opl.setPreset(0, OPL_PRESETS.organ);

liveLoop('opl-melody', async () => {
  for (const note of ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4']) {
    opl.noteOn(0, note);
    await beat(0.4);
    opl.keyOff(0);
    await beat(0.1);
  }
});

// Channels 0..8; MIDI note 69 = A4. Open YM3526 to edit the current voice.
