// Each voice has independent left/right four-bit levels, from 0 to 15.
const wave = Array.from({length: 32}, (_, i) => i < 16 ? 15 : 0);
ws.setWaveform(0, wave);
ws.setWaveform(1, wave);
ws.setVolume(0, 8, 0);
ws.setVolume(1, 0, 8);
setBpm(120);
liveLoop('left-and-right', async () => {
  for (const [left, right] of [['C4', 'G4'], ['E4', 'B4'], ['G4', 'D5'], ['B4', 'F#5']]) {
    ws.noteOn(0, left);
    ws.noteOn(1, right);
    await beat(0.75);
    ws.allNotesOff();
    await beat(0.25);
  }
});
