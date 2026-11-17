// RAM-free hardware SCSP DSP: multiply MIXS0 by COEF0, then emit EFREG0.
// Main / Worker Web Audio. Native reports NotSupportedError for these DSP calls.
const saturn = await useSoundChip('scsp');
const channel = 0; // Zero-based physical CH1.
setBpm(120);

// Apply keeps this setup. Use Run again after editing setup or DSP source.
await livePrepare('scsp-dsp-gain-setup', async () => {
  const words = assembleScspDsp(`
; Output uses the preceding accumulator, so gain needs two physical steps.
000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0
001: EWT=1 EWA=0 ZERO=1
`);
  await saturn.applyDspProgram(words, {
    coefficients: {0: 2048, 1: 0, 2: 0},
  });
  const pcm = Int16Array.from({length: 64}, (_, i) =>
    Math.round(4096 * Math.sin(2 * Math.PI * i / 64)));
  const sample = await saturn.loadPCM(pcm, {
    baseFrequencyHz: 44100 / 64, loopStartSamples: 0,
  });
  await saturn.setPreset(channel, {sample, envelope: {attackRate: 31, releaseRate: 24}});
  // Wet only: setMix is live; these values also survive the next keyOn.
  await saturn.setMix(channel, {totalLevel: 12, directLevel: 0, dspSend: 7, pan: 0});
  await saturn.setDspReturn({level: 7, pan: 0});
  log('SCSP DSP gain: MIXS0 → COEF0 → EFREG0');
});

const notes = scale('E3', 'minorPentatonic', 2);
liveLoop('scsp-dsp-gain-melody', async () => {
  await saturn.noteOn(channel, choose(notes));
  await beat(0.375);
  await saturn.noteOff(channel);
  await beat(0.125);
});

// Independent four-second software motion of a hardware Q12 coefficient.
// COEF0 / 4096 moves from 0.25 to 0.75 and back; no voice retrigger is needed.
liveLoop('scsp-dsp-gain-motion', async () => {
  await tween(4, async (p) => {
    const wave = (1 - Math.cos(p * Math.PI * 2)) / 2;
    await saturn.setDspCoefficients({0: Math.round(1024 + 2048 * wave)});
  });
});
