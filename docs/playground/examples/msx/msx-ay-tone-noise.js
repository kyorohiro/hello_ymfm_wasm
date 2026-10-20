// MSX AY-3-8910: three voices mix their own tone with one shared noise source.
setBpm(120);
ay.setVoice(0, {tone: true, noise: false, volume: 9, envelope: false});
ay.setVoice(1, {tone: false, noise: true, volume: 5, envelope: false});
ay.setVoice(2, {tone: true, noise: true, volume: 4, envelope: false});

liveLoop('msx-ay-tone-noise', async () => {
  for (const [note, period] of [['C4', 8], ['E4', 16], ['G4', 24], ['C5', 16]]) {
    ay.setNoisePeriod(period); // Changes the noise on CH1 and CH2 together.
    ay.noteOn(0, note);
    ay.keyOn(1); // A noise-only voice keeps its configured noise period.
    ay.noteOn(2, 'C3');
    await beat(0.15);
    ay.keyOff(1);
    await beat(0.25);
    ay.keyOff(0);
    ay.keyOff(2);
    await beat(0.1);
  }
});
