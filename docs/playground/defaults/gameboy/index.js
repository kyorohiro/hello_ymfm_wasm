// Select Mode: Game Boy. Main / Worker use the same built-in APU.
// pulse: channels 0/1, wave: channel 2, noise: channel 3.
setBpm(120);
gameboy.pulse.setVoice(0, {
  duty: 0.25, volume: 9, envelope: {direction: 'down', period: 0},
});

liveLoop('melody', async () => {
  for (const note of ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4']) {
    gameboy.pulse.noteOn(0, note);
    await beat(0.4);
    gameboy.pulse.keyOff(0);
    await beat(0.1);
  }
});

// Other voices: gameboy.wave.noteOn('C3'), gameboy.noise.keyOn().
// Configure them through gameboy.wave / gameboy.noise before starting.
// Global play() is an FM shortcut in OPN modes; Game Boy uses its own API.
