// Select Mode: NES + FDS. Built-in pulse voices use physical channels 0/1.
setBpm(120);
nes.pulse.setVoice(0, {duty:0.25, volume:8});

liveLoop('nes-melody', async () => {
  for (const note of ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4']) {
    nes.pulse.noteOn(0, note);
    await beat(0.4);
    nes.pulse.noteOff(0);
    await beat(0.1);
  }
});

// Other voices: nes.triangle.noteOn('C3'), nes.noise.noteOn(), nes.fds.noteOn('C4').
