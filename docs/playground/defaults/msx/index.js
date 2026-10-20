// MSX: PSG bass with an MSX-MUSIC melody.
setBpm(120);
ay.setVoice(0, {tone: true, noise: false, volume: 8, envelope: false});
opll.setVoice(0, {instrument: 3, attenuation: 6, sustain: false}); // OPLL ROM Piano.

liveLoop('msx-music-duet', async () => {
  const lead = ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4'];
  for (let step = 0; step < lead.length; step++) {
    ay.noteOn(0, step < 4 ? 'C3' : 'G2');
    opll.noteOn(0, lead[step]);
    await beat(0.4);
    ay.keyOff(0);
    opll.keyOff(0);
    await beat(0.1);
  }
});

// Open YM2413 / AY-3-8910 to edit their current voices.
// Keyboard selects the chip and channel. MSX Audio adds Y8950 FM and rhythm.
