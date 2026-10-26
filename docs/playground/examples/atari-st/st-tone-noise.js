// Atari ST YM2149: tone and noise are mixed per voice; noise period is shared.
setBpm(120);
ay.setVoice(0, {tone: true, noise: false, volume: 9, envelope: false});
ay.setVoice(1, {tone: false, noise: true, volume: 5, envelope: false});
ay.setVoice(2, {tone: true, noise: true, volume: 4, envelope: false});

liveLoop('st-tone-noise', async () => {
  for (const [note, period] of [['C4', 8], ['E4', 16], ['G4', 24], ['C5', 16]]) {
    ay.setNoisePeriod(period); // Both noise-enabled voices change together.
    ay.noteOn(0, note);
    ay.keyOn(1); // No tone; the configured noise frequency is retained.
    ay.noteOn(2, 'C3');
    await beat(0.15);
    ay.keyOff(1);
    await beat(0.25);
    ay.keyOff(0);
    ay.keyOff(2);
    await beat(0.1);
  }
});
