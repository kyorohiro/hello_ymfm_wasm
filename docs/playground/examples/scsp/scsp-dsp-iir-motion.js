// RAM-free hardware SCSP DSP: one-pole low-pass in the DSP's TEMP history.
// Main / Worker Web Audio. Native reports NotSupportedError for these DSP calls.
const saturn = await useSoundChip('scsp');
const channel = 0; // Zero-based physical CH1.
setBpm(120);

// Apply keeps this setup. Use Run again after editing setup or DSP source.
await livePrepare('scsp-dsp-iir-setup', async () => {
  const words = assembleScspDsp(`
; y[n] = a*y[n-1] + b*x[n], a = COEF1/4096, b = COEF2/4096.
; The output shifter uses the preceding accumulator. No sample-RAM access.
000: TRA=1 XSEL=0 YSEL=1 ZERO=1 COEF=1
001: XSEL=1 YSEL=1 IRA=32 BSEL=1 COEF=2
002: TWT=1 TWA=0 EWT=1 EWA=0 ZERO=1
`);
  await saturn.applyDspProgram(words, {
    coefficients: {0: 4095, 1: 3840, 2: 256},
  });
  // A quiet saw makes the smoothing easier to hear than a sine.
  const pcm = Int16Array.from({length: 64}, (_, i) =>
    Math.round(4096 * (2 * i / 64 - 1)));
  const sample = await saturn.loadPCM(pcm, {
    baseFrequencyHz: 44100 / 64, loopStartSamples: 0,
  });
  await saturn.setPreset(channel, {sample, envelope: {attackRate: 31, releaseRate: 24}});
  await saturn.setMix(channel, {totalLevel: 12, directLevel: 0, dspSend: 7, pan: 0});
  await saturn.setDspReturn({level: 7, pan: 0});
  log('SCSP DSP IIR: COEF1 = history, COEF2 = new input');
});

const notes = scale('E3', 'minorPentatonic', 2);
liveLoop('scsp-dsp-iir-melody', async () => {
  await saturn.noteOn(channel, choose(notes));
  await beat(0.375);
  await saturn.noteOff(channel);
  await beat(0.125);
});

// Separate four-second coefficient motion; raw codes, not cutoff in Hz.
// a + b = 1 approximately retains DC gain. Edits preserve TEMP and held notes.
liveLoop('scsp-dsp-iir-motion', async () => {
  await tween(4, async (p) => {
    const wave = (1 - Math.cos(p * Math.PI * 2)) / 2;
    const a = Math.round(3072 + 896 * wave);
    await saturn.setDspCoefficients({1: a, 2: 4096 - a});
  });
});
// Stop clears DSP history while keeping setup; explicit reset clears setup too.
