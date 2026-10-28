// Original mono PCM → PlayStation SPU ADPCM. No sample files needed.
// Encoding preserves source indices; it does not resample, normalize or tune.
const ps1 = await useSoundChip('ps1');
const tone = await livePrepare('ps1-pcm-adpcm', async () => {
  // Four 28-frame packets make one cycle: 44100 / 112 Hz at PITCH=4096.
  const period = 112;
  const pcm = Float32Array.from({length:period}, (_, i) =>
    0.65 * Math.sin(2 * Math.PI * i / period));
  // Loop start and looping PCM length must be aligned to 28 source frames.
  const loopStartSamples = 0;
  const encoded = encodePs1Adpcm(pcm, {loopStartSamples});
  log(`PCM ${encoded.sourceFrames} frames → SPU ADPCM ${encoded.adpcm.length} bytes; ` +
    `raw reconstruction SNR ${encoded.metrics.snrDb?.toFixed(1) ?? 'exact'} dB`);
  // ADPCM stores no root note. Declare its frequency at hardware PITCH=4096.
  return ps1.loadADPCM(encoded.adpcm, {
    baseFrequencyHz:44100 / period,
    loopStartSamples,
  });
});
ps1.setPreset(0, {sample:tone, volumeLeft:0.65, volumeRight:0.55, adsr2:8});
setBpm(120);

liveLoop('ps1-pcm-melody', async () => {
  for (const note of ['C4', 'E4', 'G4', 'C5', 'G4', 'E4']) {
    ps1.noteOn(0, note);
    await beat(0.4);
    ps1.keyOff(0);
    await beat(0.1);
  }
});
