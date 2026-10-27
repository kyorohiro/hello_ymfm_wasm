// Atari 8-bit: one POKEY, four physical voices (channels 0..3).
// This mode already initializes pokey. Select POKEY 1 and a channel in Keyboard.
setBpm(120);
for (let channel = 0; channel < 4; channel++) pokey.setVolume(channel, 6);

liveLoop('pokey-four-voices', async () => {
  for (const notes of [
    ['C5', 'E4', 'C4', 'G4'], ['E5', 'G4', 'C4', 'E4'],
    ['G5', 'B4', 'G3', 'D4'], ['D5', 'G4', 'G3', 'B3'],
  ]) {
    notes.forEach((note, channel) => {pokey.setNote(channel, note); pokey.keyOn(channel);});
    await beat(0.8);
    pokey.allNotesOff();
    await beat(0.2);
  }
});
