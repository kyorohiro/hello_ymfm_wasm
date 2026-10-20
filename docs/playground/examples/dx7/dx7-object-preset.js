// Build a DX7 voice with objects. No SysEx file is needed.
// Operators are OP1..6; algorithm 0 is the instrument's algorithm 1.
const synth = await useSoundChip('dx7');
await synth.setPreset({
  name: 'JS BELL',
  algorithm: 0,
  feedback: 0,
});
await synth.setOperators([
  [1, {
    coarse: 1, outputLevel: 90,
    envelope: {rates: [99, 70, 50, 75], levels: [99, 80, 60, 0]},
  }],
  [2, {
    coarse: 2, outputLevel: 68,
    envelope: {rates: [99, 75, 50, 80], levels: [99, 70, 0, 0]},
  }],
]);
setBpm(110);
await mixer.set(synth.id, {volume: 0.5});

liveLoop('dx7-object-melody', async () => {
  // Level edits keep other parameters and also affect this patch's release tails.
  await synth.setOperator(2, {outputLevel: choose([55, 65, 75])});
  for (const note of [60, 64, 67, 72]) {
    synth.noteOn(note, 100);
    await beat(0.4);
    synth.noteOff(note);
    await beat(0.1);
  }
});
