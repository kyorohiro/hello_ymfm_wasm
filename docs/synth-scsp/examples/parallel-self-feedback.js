const scsp = await useSoundChip('scsp');
setBpm(120);

// B and C each feed themselves. A averages their two independent outputs.
// Use the current PCM / envelopes. D stays disconnected with direct output off.
// Apply keeps live edits; Run prepares this setup again.
await livePrepare('parallel-self-feedback-setup', async () => {
  await scsp.setConfig({
    mode: 'fm4',
    fm: {
      algorithm: 'custom',
      custom: { inputs: [[1, 2], [1], [2], []], outputs: [0] },
      ratios: [1, 1.5, 2, 1, 1, 1],
      depths: [7, 4, 5, 9, 9, 9],
    },
  });
});

// Select B or C above and edit its Depth independently; 0 is Off.
// Each Self uses its own native X32/Y0 histories, not a JavaScript effect.
// New Auto/Code attacks clear only their owned Self cells as Synth software;
// live depth changes preserve those histories and keep the melody running.
const notes = scale('E2', 'minorPentatonic', 2);
liveLoop('parallel-self-feedback-melody', async () => {
  await scsp.noteOn(CH1, choose(notes));
  await beat(0.5);
  await scsp.noteOff(CH1);
  await beat(0.25);
});
