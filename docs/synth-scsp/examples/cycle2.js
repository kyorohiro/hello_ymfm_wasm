// SPDX-License-Identifier: BSD-3-Clause
const scsp = await useSoundChip('scsp');
setBpm(120);

// Use the current A/B PCM and envelopes. Both need full forward loops from 0.
// Apply keeps your knob edits; Run prepares this setup again.
await livePrepare('cycle2-setup', async () => {
  await scsp.setConfig({
    mode: 'fm2',
    fm: {
      algorithm: 'cycle2',
      cycle2: {outputs: [1]}, // B directly audible; A still feeds the stack.
      ratios: [1, 1.5, 1, 1, 1, 1],
      depths: [4, 6, 9, 9, 9, 9], // A receives B; B receives A.
    },
  });
  // Both can be heard when their Direct output checkbox is enabled.
  // TL also controls stack feedback; direct level only controls direct output.
  await scsp.setMix(0, {totalLevel: 24, directLevel: 5});
  await scsp.setMix(1, {totalLevel: 24, directLevel: 5});
});

// A runs before B: A -> B is current; B -> A averages two stored histories.
// New grouped attacks initialize four owned cells in Synth software.
// Live Depth/Ratio edits keep history; Depth 0 disconnects one input.
// CH1 below is one logical two-OP lane, not one physical SCSP slot.
const notes = scale('E3', 'minorPentatonic', 1);
liveLoop('cycle2-melody', async () => {
  await scsp.noteOn(CH1, choose(notes));
  await beat(0.5);
  await scsp.noteOff(CH1);
  await beat(0.25);
});
