// Select Mode: PC Engine. Six 32-entry, five-bit wavetable voices.
setBpm(120);
pce.setWaveform(0, Array.from({length:32}, (_, index) =>
  Math.round(15.5 + 15.5 * Math.sin(index * Math.PI / 16))));
pce.setVolume(0, 26); // Hardware volume 0..31.
pce.setPan(0, 15, 15); // Independent left/right balances 0..15.

liveLoop('pce-melody', async () => {
  for (const note of ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4']) {
    // Keep the waveform running between notes; hard key cuts can click.
    pce.noteOn(0, note);
    await beat(0.5);
  }
});

// Uploading a waveform stops its channel. Channels 4/5 can also generate noise.
