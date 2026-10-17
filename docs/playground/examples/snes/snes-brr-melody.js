// CPU-free SNES S-DSP: eight physical voices, numbered 0..7.
// This original 16-sample looping BRR needs no game files.
const snes = await useSoundChip('snes');
const tone = await livePrepare('snes-original-brr', async () => {
  const brr = new Uint8Array([0xc3, 0x13, 0x57, 0x75, 0x31, 0xfd, 0xb9, 0x9b, 0xdf]);
  // At hardware PITCH=4096, 32,000 / 16 = 2,000 Hz.
  // BRR contains no tuning information: declare it explicitly.
  return snes.loadBRR(brr, {baseFrequencyHz: 2000, loopStartSamples: 0});
});
snes.setPreset(0, {
  sample: tone,
  adsr1: 0x8f, adsr2: 0xe0, gain: 127,
  volumeLeft: 90, volumeRight: 90,
});
setBpm(110);
await mixer.set(snes.id, {volume: 0.5});

liveLoop('snes-melody', async () => {
  for (const note of ['C4', 'E4', 'G4', 'C5', 'G4', 'E4']) {
    snes.noteOn(0, note);
    await beat(0.4);
    snes.noteOff(0);
    await beat(0.1);
  }
});

// For an imported BRR, provide its actual root note and loop position:
// const sample = await snes.loadBRR(await file('/samples/bass.brr', {type:'arrayBuffer'}),
//   {rootNote:'C3', loopStartSamples:32});
// await mixer.set(snes.id, {volume:0.4, pan:-0.25});
// Raw DSP ADSR/GAIN/volume values are hardware values, not seconds or percentages.
