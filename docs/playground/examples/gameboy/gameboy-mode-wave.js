// Select Mode: Game Boy. Use the built-in 32-sample, four-bit wave channel.
setBpm(120);
gameboy.wave.stopAndSetWaveform(
  Array.from({length: 32}, (_, i) => i < 16 ? i : 31 - i),
);
gameboy.wave.setLevel(0.5);

liveLoop('wave-bass', async () => {
  for (const note of ['C3', 'C3', 'G2', 'G2', 'A2', 'A2', 'F2', 'G2']) {
    gameboy.wave.noteOn(note);
    await beat(0.4);
    gameboy.wave.keyOff();
    await beat(0.1);
  }
});
