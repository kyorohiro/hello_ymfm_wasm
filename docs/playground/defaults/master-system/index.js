// Master System: mono Sega PSG + YM2413 OPLL (FM sound unit).
setBpm(120);
opll.setVoice(0, {instrument: 3, attenuation: 5, sustain: false}); // Built-in Piano.

liveLoop('sms-psg-opll', async () => {
  const lead = ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4'];
  for (let step = 0; step < lead.length; step++) {
    psg.tone(PSG1, {note: step < 4 ? 'C3' : 'G2', attenuation: 13});
    opll.noteOn(0, lead[step]); // Standard MIDI octave: C4 = MIDI 60.
    await beat(0.4);
    opll.keyOff(0);
    psg.off(PSG1);
    await beat(0.1);
  }
});

liveLoop('sms-rhythm', async () => {
  psg.noise({type: 'white', rate: 'high', attenuation: 14});
  await beat(0.1);
  psg.noiseOff();
  await beat(0.9);
});

// Open YM2413 to choose its 15 ROM instruments or edit the shared User patch.
// Keyboard selects Sega PSG / YM2413 and a physical voice. Game Gear is PSG-only.
