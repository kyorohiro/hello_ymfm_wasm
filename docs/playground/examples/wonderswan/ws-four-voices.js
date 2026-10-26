// WonderSwan: four voices with independent 32-sample, 4-bit waveforms.
// Open the WonderSwan tab to draw waves, then audition any channel with Keyboard.
const wave = Array.from({length: 32}, (_, i) => Math.round(7.5 + 7.5 * Math.sin(2 * Math.PI * i / 32)));
for (let channel = 0; channel < 4; channel++) {
  ws.setWaveform(channel, wave);
  ws.setVolume(channel, 10, 10);
}
setBpm(120);
liveLoop('wonderswan-four-voices', async () => {
  for (const notes of [
    ['C5', 'E4', 'C3', 'G3'], ['E5', 'G4', 'C3', 'E3'],
    ['G5', 'B4', 'G2', 'D3'], ['D5', 'G4', 'G2', 'B2'],
  ]) {
    notes.forEach((note, channel) => ws.noteOn(channel, note));
    await beat(0.8);
    ws.allNotesOff();
    await beat(0.2);
  }
});
