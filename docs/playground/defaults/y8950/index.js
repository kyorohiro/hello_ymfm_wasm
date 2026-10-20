// MSX-AUDIO / Y8950: nine OPL FM voices and the shared rhythm section.
// This starter uses FM; no ADPCM sample or external ROM is required.
setBpm(120);
opl.setPreset(0, OPL_PRESETS.bell);

liveLoop('y8950-melody', async () => {
  for (const note of ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4']) {
    opl.noteOn(0, note);
    await beat(0.4);
    opl.keyOff(0);
    await beat(0.1);
  }
});

// Channels 0..8; MIDI note 69 = A4. Open Y8950 to edit the current voice.
