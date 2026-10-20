// OPL2 / YM3812: nine two-operator voices. JavaScript channels are 0..8.
// MIDI note 69 = A4 = 440 Hz. OPL uses its own API rather than play().
setBpm(120);
opl.setPreset(0, OPL_PRESETS.bell);

liveLoop('opl2-melody', async () => {
  for (const note of ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4']) {
    opl.noteOn(0, note);
    await beat(0.4);
    opl.keyOff(0);
    await beat(0.1);
  }
});

// Open YM3812 to edit operators or Keyboard to select a chip and channel.
