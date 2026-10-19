// Select Mode: SNES. Two tuned BRR voices, independently balanced left/right.
setBpm(110);
const duetSample = await livePrepare('snes-mode-duet-brr', async () =>
  snes.loadBRR(new Uint8Array([0xc3, 0x13, 0x57, 0x75, 0x31, 0xfd, 0xb9, 0x9b, 0xdf]),
    {baseFrequencyHz:2000, loopStartSamples:0}));
snes.setPreset(0, {
  sample:duetSample, adsr1:0x8e, adsr2:0xe0, gain:127,
  volumeLeft:75, volumeRight:15,
});
snes.setPreset(1, {
  sample:duetSample, adsr1:0x8e, adsr2:0xe0, gain:127,
  volumeLeft:15, volumeRight:60,
});

liveLoop('snes-stereo-duet', async () => {
  const leadLine = ['C4', 'E4', 'G4', 'C5', 'B4', 'G4', 'E4', 'D4'];
  const bassLine = ['C3', 'C3', 'C3', 'C3', 'G2', 'G2', 'G2', 'G2'];
  for (let step = 0; step < leadLine.length; step++) {
    snes.noteOn(0, leadLine[step]); snes.noteOn(1, bassLine[step]);
    await beat(0.4);
    snes.noteOff(0); snes.noteOff(1);
    await beat(0.1);
  }
});
