// Select Mode: NES + FDS. Original 64-entry waveform, no disk image needed.
setBpm(110);
nes.fds.setWave(Array.from({length:64}, (_, index) =>
  Math.round(31.5 + 23 * Math.sin(index * Math.PI / 32) + 8 * Math.sin(index * Math.PI / 16))));
nes.fds.setVolume(24);
nes.fds.setModulation({
  table:Array.from({length:32}, (_, index) => index < 16 ? 1 : 7),
  rate:80, depth:8, bias:0, enabled:true,
});

liveLoop('fds-melody', async () => {
  for (const note of ['C4', 'E4', 'G4', 'C5', 'B4', 'G4', 'E4', 'D4']) {
    nes.fds.noteOn(note);
    await beat(0.4);
    nes.fds.noteOff();
    await beat(0.1);
  }
});
