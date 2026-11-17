// Hardware SCSP DSP Delay. The current source build manages its own 64 KiB ring.
// Main / Worker Web Audio. Native reports NotSupportedError for DSP controls.
const saturn = await useSoundChip('scsp');
const channel = 0; // Zero-based physical CH1.
setBpm(120);

// Apply retains this setup; Run prepares it again. No external sample is needed.
await livePrepare('scsp-dsp-delay-setup', async () => {
  const pcm = Int16Array.from({length: 64}, (_, i) =>
    Math.round(4096 * Math.sin(2 * Math.PI * i / 64)));
  const sample = await saturn.loadPCM(pcm, {
    baseFrequencyHz: 44100 / 64, loopStartSamples: 0,
  });
  await saturn.setPreset(channel, {
    sample, envelope: {attackRate: 31, releaseRate: 24},
  });
  await saturn.setDspDelay({enabled: true, timeMs: 240, feedback: 0.35});
  await saturn.setMix(channel, {totalLevel: 12, directLevel: 5, dspSend: 7, pan: 0});
  await saturn.setDspReturn({level: 7, pan: 0});
  const setup = await saturn.getDspProgram();
  log('SCSP DSP Delay: MIXS0 → managed RAM ring → EFREG0');
  log(disassembleScspDsp(setup.words));
  log({delay: setup.delay, ram: setup.ram});
});

const notes = scale('E3', 'minorPentatonic', 2);
liveLoop('scsp-dsp-delay-melody', async () => {
  await saturn.noteOn(channel, choose(notes));
  await beat(0.2);
  await saturn.noteOff(channel); // Release this voice; its echoes continue.
  await beat(1.8);
});

// Feedback changes keep the ring history. Time / Enable changes clear it.
liveLoop('scsp-dsp-delay-feedback', async () => {
  await tween(4, async (p) => {
    const wave = (1 - Math.cos(p * Math.PI * 2)) / 2;
    const feedback = 0.15 + 0.45 * wave;
    // COEF1 is feedback. Its small transport delta also updates delay.feedback.
    await saturn.setDspCoefficients({1: Math.floor(feedback * 4096)});
  });
});
// Stop silences voices and clears the tail while retaining setup / ring space.
// reset() clears DSP setup but keeps the reserved ring; clearRam:true frees it.
