const scsp = await useSoundChip('scsp');
setBpm(120);

// Current PCM / envelopes. F feeds itself and branches through D/B and E/C.
// A averages B and C. Only A goes directly to the output.
// Apply keeps live edits; Run prepares this setup again.
await livePrepare('self-feedback-6op-setup', async () => {
  await scsp.setConfig({
    mode: 'fm6',
    fm: {
      algorithm: 'custom',
      custom: {
        inputs: [[1, 2], [3], [4], [5], [5], [5]],
        outputs: [0],
      },
      ratios: [1, 1, 2, 1, 1.5, 2],
      depths: [7, 5, 5, 4, 4, 3],
    },
  });
});

// Select F and change its Depth to explore Self; 0 is Off in this adapter.
// Self uses X32/Y0, two native stack histories, not a JavaScript audio effect.
// New Auto/Code notes clear only their own Self history as Synth software.
const notes = scale('E2', 'minorPentatonic', 2);
liveLoop('self-feedback-6op-melody', async () => {
  await scsp.noteOn(CH1, choose(notes));
  await beat(0.5);
  await scsp.noteOff(CH1);
  await beat(0.25);
});
