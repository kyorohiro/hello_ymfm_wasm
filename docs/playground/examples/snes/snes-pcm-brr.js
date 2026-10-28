// Original mono PCM → BRR → eight-voice SNES S-DSP. No sample files needed.
// encodeBrr preserves sample indices; it does not resample or infer tuning.
const snes = await useSoundChip('snes');
const tone = await livePrepare('snes-pcm-brr', async () => {
  // One 128-frame cycle at the native 32,000 Hz is exactly 250 Hz.
  const pcm = Float32Array.from({length:128}, (_, i) =>
    0.75 * Math.sin(2 * Math.PI * i / 128));
  // Loop length and start must be aligned to 16 source samples.
  const loopStartSamples = 0;
  const encoded = encodeBrr(pcm, {loopStartSamples});
  log(`PCM ${encoded.sourceFrames} frames → BRR ${encoded.brr.length} bytes; ` +
    `raw reconstruction SNR ${encoded.metrics.snrDb?.toFixed(1) ?? 'exact'} dB`);
  // BRR carries no root note: declare its frequency at PITCH=4096.
  return snes.loadBRR(encoded.brr, {
    baseFrequencyHz:32000 / pcm.length,
    loopStartSamples,
  });
});
snes.setPreset(0, {
  sample:tone, adsr1:0x8f, adsr2:0xe0, gain:127,
  volumeLeft:80, volumeRight:80,
});
setBpm(120);

liveLoop('snes-pcm-melody', async () => {
  for (const note of ['C4', 'E4', 'G4', 'C5', 'G4', 'E4']) {
    snes.setNote(0, note);
    snes.keyOn(0);
    await beat(0.4);
    snes.keyOff(0);
    await beat(0.1);
  }
});
