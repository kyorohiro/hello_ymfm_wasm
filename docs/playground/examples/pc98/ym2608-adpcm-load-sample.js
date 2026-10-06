// Independent YM2608: works with any chip selected in the Playground UI.
// loadSample accepts decoded PCM here, and converts it to Yamaha ADPCM-B.
const ym2608 = await useSoundChip('ym2608');
try {
  const sampleRate = 8000;
  const frames = 4000;
  const wave = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    // Original 440 Hz tone with 10 ms fades. No external file or ROM needed.
    const fade = Math.min(1, i / 80, (frames - 1 - i) / 80);
    wave[i] = 0.6 * fade * Math.sin(i * 2 * Math.PI * 440 / sampleRate);
  }

  // Mix PCM to mono, encode ADPCM-B, upload it and set the sample range/rate.
  // address must be 32-byte aligned. Loading does not start playback.
  const sample = await ym2608.adpcm.loadSample(
    {channels: [wave], sampleRate},
    {address: 0},
  );
  ym2608.adpcm.setVolume(180);
  ym2608.adpcm.setPan(true, true);
  ym2608.adpcm.keyOn();
  await sleep(sample.duration + 0.05);
  ym2608.adpcm.keyOff();

  // Reuse the same memory at 1.5x speed: higher pitch, shorter duration.
  ym2608.adpcm.setPlaybackRate(sample.sampleRate * 1.5);
  ym2608.adpcm.keyOn();
  await sleep(sample.duration / 1.5 + 0.05);
  ym2608.adpcm.keyOff();

  // For a PCM/Float WAV imported into FILES, the loading step can instead be:
  // const wav = await file('./samples/voice.wav', {type: 'arrayBuffer'});
  // const sample = await ym2608.adpcm.loadSample(wav, {address: 0});
  // loadMemory() is for already-encoded ADPCM-B bytes, not WAV/Float32 PCM.
} finally {
  ym2608.dispose();
}
