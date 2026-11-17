// Two hardware DSP paths. This source build adds MIXS1 / EFREG1 routing.
// Main / Worker Web Audio. npm 0.2.44 does not include this routing extension.
const saturn = await useSoundChip('scsp');
const gainChannel = 0; // Physical CH1 -> MIXS0 -> EFREG0 -> left.
const iirChannel = 1;  // Physical CH2 -> MIXS1 -> EFREG1 -> right.
setBpm(120);

await livePrepare('scsp-dsp-routing-setup', async () => {
  const words = assembleScspDsp(`
; Left: MIXS0 * COEF0. Right: y[n] = a*y[n-1] + b*MIXS1.
; EWT uses the preceding accumulator. The IIR history uses TEMP.
000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0
001: EWT=1 EWA=0 ZERO=1
002: TRA=1 XSEL=0 YSEL=1 ZERO=1 COEF=1
003: XSEL=1 YSEL=1 IRA=33 BSEL=1 COEF=2
004: TWT=1 TWA=0 EWT=1 EWA=1 ZERO=1
`);
  await saturn.applyDspProgram(words, {
    coefficients: {0: 4095, 1: 3840, 2: 256},
  });
  const pcm = Int16Array.from({length: 64}, (_, i) =>
    Math.round(4096 * (2 * i / 64 - 1)));
  const pcmHandle = await saturn.loadPCM(pcm, {
    baseFrequencyHz: 44100 / 64, loopStartSamples: 0,
  });
  for (const [channel, input] of [[gainChannel, 0], [iirChannel, 1]]) {
    await saturn.setPreset(channel, {
      sample: pcmHandle, envelope: {attackRate: 31, releaseRate: 24},
    });
    await saturn.setMix(channel, {
      totalLevel: 12, directLevel: 0, dspSend: 7, dspInput: input,
    });
  }
  await saturn.setDspReturn(0, {level: 7, pan: 31}); // Left only.
  await saturn.setDspReturn(1, {level: 7, pan: 15}); // Right only.
  const setup = await saturn.getDspProgram();
  log('SCSP DSP routing: MIXS0 → Gain → left; MIXS1 → IIR → right');
  log(disassembleScspDsp(setup.words));
  log({returns: setup.returns, coefficients: setup.coefficients});
});

const notes = scale('E3', 'minorPentatonic', 2);
liveLoop('scsp-dsp-routing-melody', async () => {
  const note = choose(notes); // Same waveform and note, different DSP paths.
  await saturn.noteOn(gainChannel, note);
  await saturn.noteOn(iirChannel, note);
  await beat(0.375);
  await saturn.noteOff(gainChannel);
  await saturn.noteOff(iirChannel);
  await beat(0.125);
});

// Signed Q12 coefficients move separately from the musical tempo.
liveLoop('scsp-dsp-routing-filter', async () => {
  await tween(4, async (p) => {
    const wave = (1 - Math.cos(p * Math.PI * 2)) / 2;
    const history = Math.round(3072 + 896 * wave);
    await saturn.setDspCoefficients({1: history, 2: 4096 - history});
  });
});
// Sends select MIXS0 / MIXS1; returns select EFREG0 / EFREG1, not physical voices.
// The managed fixed Delay keeps its existing MIXS0 -> EFREG0 path.
