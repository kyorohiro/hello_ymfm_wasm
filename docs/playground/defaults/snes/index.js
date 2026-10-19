// Select Mode: SNES. CPU-free S-DSP; original BRR, no game files needed.
setBpm(120);
const leadSample = await livePrepare('snes-mode-lead-brr', async () => {
  const brrBytes = new Uint8Array([0xc3, 0x13, 0x57, 0x75, 0x31, 0xfd, 0xb9, 0x9b, 0xdf]);
  // One looping block = 16 samples at native 32,000 Hz: base frequency 2,000 Hz.
  return snes.loadBRR(brrBytes, {baseFrequencyHz:2000, loopStartSamples:0});
});
snes.setPreset(0, {
  sample:leadSample, adsr1:0x8e, adsr2:0xe0, gain:127, // Short hardware attack avoids an abrupt onset.
  volumeLeft:80, volumeRight:80,
});

liveLoop('snes-melody', async () => {
  for (const note of ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4']) {
    snes.noteOn(0, note);
    await beat(0.4);
    snes.noteOff(0);
    await beat(0.1);
  }
});

// Eight physical voices, numbered 0..7. Assign a BRR sample before setting pitch.
