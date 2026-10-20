// MSX Audio: AY-3-8910 PSG + YM2413 OPLL + Y8950 FM, sharing one mono output.
setBpm(120);
ay.setVoice(0, {tone: true, noise: false, volume: 8, envelope: false});
opll.setVoice(0, {instrument: 3, attenuation: 6, sustain: false}); // OPLL ROM Piano.
opl.setPreset(0, OPL_PRESETS.bell);
opl.setOperator(0, 1, {tl: 26}); // Keep the Y8950 bell behind the melody.

liveLoop('msx-audio-three-chips', async () => {
  const lead = ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4'];
  for (let step = 0; step < lead.length; step++) {
    ay.noteOn(0, step < 4 ? 'C3' : 'G2');
    opll.noteOn(0, lead[step]);
    opl.noteOn(0, step < 4 ? 'G4' : 'D4');
    await beat(0.4);
    ay.keyOff(0);
    opll.keyOff(0);
    opl.keyOff(0);
    await beat(0.1);
  }
});

// Open AY-3-8910 / YM2413 / Y8950 to edit their current voices.
// Keyboard selects the chip and channel. Y8950 uses FM and rhythm here.
