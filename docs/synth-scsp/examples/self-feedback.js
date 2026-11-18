const scsp = await useSoundChip('scsp');
setBpm(120);

// Current PCM and envelopes, with B feeding itself and then A.
// Apply keeps your live edits. Run starts a fresh setup.
await livePrepare('self-feedback-setup', async () => {
  await scsp.setConfig({
    mode: 'fm2',
    fm: {
      algorithm: 'custom',
      custom: { inputs: [[1], [1]], outputs: [0] },
      ratios: [1, 2, 1, 1, 1, 1],
      depths: [7, 4, 9, 9, 9, 9],
    },
  });
});

// Select B above and change its Depth: 0 is Off in this Synth adapter.
// Self uses native X32/Y0: two sound-stack histories, not a JavaScript effect.
// New Auto/Code notes clear their own Self history; live edits retain it.
const notes = scale('E2', 'minorPentatonic', 2);
liveLoop('self-feedback-melody', async () => {
  await scsp.noteOn(CH1, choose(notes));
  await beat(0.5);
  await scsp.noteOff(CH1);
  await beat(0.25);
});
