// Atari ST YM2149: two voices use the same repeating hardware envelope.
setBpm(120);
ay.setVoice(0, {tone: true, noise: false, volume: 9, envelope: true});
ay.setVoice(1, {tone: true, noise: false, volume: 7, envelope: true});

liveLoop('st-shared-envelope', async () => {
  for (const [shape, period, notes] of [[8, 1600, ['C4', 'E4']], [10, 1200, ['G3', 'D4']], [12, 2000, ['A3', 'C4']], [14, 1500, ['G3', 'B3']]]) {
    // Writing Shape retriggers one shared envelope for both voices.
    // The period is a raw 16-bit value at this mode's 2 MHz clock.
    ay.setEnvelope({period, shape});
    ay.noteOn(0, notes[0]);
    ay.noteOn(1, notes[1]);
    await beat(2);
    ay.keyOff(0);
    ay.keyOff(1);
    await beat(0.5);
  }
});
