// Atari ST: YM2149 PSG at 2 MHz. Three tone voices share noise and envelope.
setBpm(120);
ay.setVoice(0, {tone: true, noise: false, volume: 9, envelope: false});
ay.setVoice(1, {tone: true, noise: false, volume: 6, envelope: false});
ay.setVoice(2, {tone: true, noise: false, volume: 5, envelope: false});

liveLoop('atari-st-three-voices', async () => {
  for (const notes of [['C4', 'E3', 'C3'], ['E4', 'G3', 'C3'], ['G4', 'B3', 'G2'], ['D4', 'G3', 'G2']]) {
    notes.forEach((note, channel) => ay.noteOn(channel, note));
    await beat(0.8);
    ay.allNotesOff();
    await beat(0.2);
  }
});

// Open YM2149 to edit its three voices, shared noise and hardware envelope.
// Keyboard selects a physical channel. useSoundChip('ay8910') borrows this PSG.
