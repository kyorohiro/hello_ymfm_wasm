// YM2612 mode: register PCM once, then play it by name.
// DAC replaces FM CH6 with one mono PCM voice. Both speakers receive the same sound.
// The existing global `dac.schedule()` API is for timed raw DAC values;
// `fm.dac` below accepts ordinary unsigned 8-bit mono PCM (128 = silence).
const sampleRate = 11025;
const count = Math.floor(sampleRate * 0.4);
const pcmBytes = Uint8Array.from({ length: count }, (_, i) => {
  // A short A4 tone, with 10 ms fades to avoid clicks at the ends.
  const fade = Math.min(1, i / (sampleRate * 0.01), (count - 1 - i) / (sampleRate * 0.01));
  return Math.round(128 + 80 * fade * Math.sin(2 * Math.PI * 440 * i / sampleRate));
});

// Wait for the audio backend to finish storing the PCM before starting the loop.
await fm.dac.setSample('voice', pcmBytes, { sampleRate });

liveLoop('dac-voice', async () => {
  // Only the name is sent during performance; the PCM stays in audio memory.
  // Await means accepted, not finished. Starting another PCM replaces this one.
  await fm.dac.playFromSample('voice');
  await sleep(0.75);
});

// Playground Stop cancels playback. To stop it in your code: await fm.dac.stop();
