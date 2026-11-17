const scsp = await useSoundChip('scsp');
setBpm(120);

// Run configures the current PCM A and the Synth's shared hardware DSP.
// Apply keeps this setup, so live coefficient / GUI edits are not overwritten.
// Use Run after editing the DSP source or the setup below.
await livePrepare('dsp-iir-setup', async () => {
  // Compilation is local. useSoundChip() above prepares the audio connection.
  const program = scsp.compileDsp(`
; One-pole low-pass: y[n] = a*y[n-1] + b*x[n].
; a = COEF1/4096, b = COEF2/4096. COEF0 is unused here.
; The output shifter always uses the preceding accumulator.
000: TRA=1 XSEL=0 YSEL=1 ZERO=1 COEF=1
001: XSEL=1 YSEL=1 IRA=32 BSEL=1 COEF=2
002: TWT=1 TWA=0 EWT=1 EWA=0 ZERO=1
`);
  await scsp.applyDspProgram(program, {
    coefficients: {0: 4095, 1: 3840, 2: 256},
  });

  // Use the current PCM A, wet only. Try a Saw for an audible filter sweep.
  await scsp.setConfig({mode: 'pcm'});
  await scsp.setMix(0, {directLevel: 0});
  await scsp.setEffect({enabled: true, send: 7, returnLevel: 7});
});

// Beat-based notes follow setBpm(). Their timing is independent of DSP motion.
const notes = scale('E3', 'minorPentatonic', 2);
liveLoop('melody', async () => {
  await scsp.noteOn(CH1, choose(notes));
  await beat(0.5);
  await scsp.noteOff(CH1);
  await beat(0.25);
});

// Four-second motion. These are raw hardware coefficients, not cutoff in Hz.
// a + b = 1 approximately preserves the low-frequency gain.
// Coefficient edits retain history; Code Stop keeps the DSP setup in the Synth.
liveLoop('dsp-motion', async () => {
  await tween(4, async (p) => {
    const wave = (1 - Math.cos(p * Math.PI * 2)) / 2;
    const a = Math.round(3072 + 896 * wave);
    await scsp.setDspCoefficients({1: a, 2: 4096 - a});
  });
});
