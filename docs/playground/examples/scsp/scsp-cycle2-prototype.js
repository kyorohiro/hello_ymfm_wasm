// SPDX-License-Identifier: BSD-3-Clause
// Research: Tetorica FM2612 Playground, ?mode=scsp, Web Audio Main / Worker.
// This is NOT SCSP Synth Code: that facade does not expose physical modulation.
// Stop -> Run creates fresh history. Re-running while active retains livePrepare.
const A = 6; // Zero-based physical CH7; processed before B.
const B = 7; // Zero-based physical CH8; the only direct output.
const feedbackDepth = 8; // B -> A. Integer 0..12; adapter 0 disconnects X/Y.
const forwardDepth = 8;  // A -> B. Edit either depth and Run again to apply live.
const ratio = 1.5;
setBpm(120);

const saturn = await livePrepare('scsp-cycle2-prototype-setup', async () => {
  // Own a separate chip: useSoundChip('scsp') would borrow the shared primary.
  const chip = await createSoundChip('scsp', {id: 'scsp-cycle2-prototype'});
  try {
    const pcm = Int16Array.from({length: 64}, (_, i) =>
      Math.round(4096 * Math.sin(2 * Math.PI * i / 64)));
    const sample = await chip.loadPCM(pcm, {
      baseFrequencyHz: 44100 / 64,
      loopStartSamples: 0,
      modulationDepth: 12, // Full-loop guard padding for address modulation.
    });
    chip.setPreset(A, {
      sample, frequencyHz: 220, totalLevel: 12, directLevel: 0,
      // Current zero-slot-delay core: avg(B[n-1], B[n-2]).
      modulation: {depth: feedbackDepth, xOffset: 33, yOffset: 1},
      envelope: {attackRate: 31, releaseRate: 24},
    });
    chip.setPreset(B, {
      sample, frequencyHz: 220 * ratio, totalLevel: 16, directLevel: 5,
      // Both inputs read A[n], already written earlier in this native frame.
      modulation: {depth: forwardDepth, xOffset: 63, yOffset: 63},
      envelope: {attackRate: 31, releaseRate: 24},
    });
    // Ordered setters post commands; they are not acknowledgements or an atomic
    // two-slot trigger. Do not infer physical Saturn pipeline timing from this.
    chip.keyOn(A);
    chip.keyOn(B);
    return chip;
  } catch (error) {
    chip.dispose(); // Release this instance's Mixer ID if preparation fails.
    throw error;
  }
});

// Depth-only edits retain the tap selectors, oscillator phase and stack history.
saturn.setModulation(A, {depth: feedbackDepth});
saturn.setModulation(B, {depth: forwardDepth});
log('SCSP cycle2 prototype ready', {
  id: saturn.id, aSlot: A, bSlot: B, variant: 'current-forward-average12',
});
// Requested words, not an acknowledged renderer readback. The existing adapter
// serializes depth 0 as the completely disconnected word 0, including X/Y.
const word = (depth, x, y) => '0x' + (depth ?
  (depth << 12) | (x << 6) | y : 0).toString(16).toUpperCase().padStart(4, '0');
console.table([
  {slot: A, source: B, x: 33, y: 1, depth: feedbackDepth,
    word: word(feedbackDepth, 33, 1), input: 'avg(B[n-1], B[n-2])'},
  {slot: B, source: A, x: 63, y: 63, depth: forwardDepth,
    word: word(forwardDepth, 63, 63), input: 'A[n]'},
]);

const notes = scale('E3', 'minorPentatonic', 2);
liveLoop('scsp-cycle2-melody', async () => {
  // Legato retuning: no keyOff/keyOn per note and no claim of history clearing.
  const hz = saturn.setNote(A, choose(notes));
  saturn.setFrequency(B, hz * ratio);
  await beat(0.5);
});
liveCleanup(['scsp-cycle2-melody'], () => {
  saturn.keyOff(A);
  saturn.keyOff(B);
});
// keyOff/allNotesOff do not clear stack history. Stop disposes this dedicated
// chip; Stop -> Run repeats a fresh setup. Setup/sample edits also need that.
// Direct output 0 mutes A externally, not its stack write. TL and MDL affect
// feedback; Master/direct output do not replace feedback gain. Hardware fidelity
// is not claimed: this candidate describes the current zero-slot-delay core.
