// Select Mode: Neo Geo (YM2610B). This uses all six FM channels.
setBpm(120);
const channels = /** @type {const} */ ([CH1, CH2, CH3, CH4, CH5, CH6]);
for (const channel of channels) {
  fm.setPreset(channel, FM_PRESETS['one-op-basic']);
}

liveLoop('six-channel-chords', async () => {
  for (const chord of [
    ['C3', 'G3', 'C4', 'E4', 'G4', 'B4'],
    ['A2', 'E3', 'A3', 'C4', 'E4', 'G4'],
    ['F2', 'C3', 'F3', 'A3', 'C4', 'E4'],
    ['G2', 'D3', 'G3', 'B3', 'D4', 'F4'],
  ]) {
    for (let i = 0; i < channels.length; i++) {
      fm.noteOn(channels[i], chord[i]);
    }
    await beat(0.75);
    for (const channel of channels) fm.keyOff(channel);
    await beat(0.25);
  }
});
