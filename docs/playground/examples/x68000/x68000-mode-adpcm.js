// Select Mode: X68000. Original PCM is encoded to the built-in OKIM6258's ADPCM.
setBpm(120);
await livePrepare('x68000-mode-original-kick', async () => {
  const pcmRate = 15625; // 8 MHz / 512, one of the chip's three hardware rates.
  const drumPcm = Float32Array.from({length:3125}, (_, index) => {
    const seconds = index / pcmRate;
    const phase = 2 * Math.PI * (65 * seconds + 3 * (1 - Math.exp(-seconds * 45)));
    return 0.6 * Math.sin(phase) * Math.exp(-seconds * 22);
  });
  return adpcm.loadSample({channels:[drumPcm], sampleRate:pcmRate}, {sampleRate:pcmRate});
});
adpcm.setPan(true, true);

liveLoop('x68000-adpcm-drums', async () => {
  for (let step = 0; step < 8; step++) {
    adpcm.play(); // The OKIM6258 has one sample stream, with no per-note pitch register.
    await beat(0.4);
    adpcm.stop();
    await beat(step === 7 ? 0.6 : 0.1);
  }
});
