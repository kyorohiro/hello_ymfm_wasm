// Live DX7 operator editing (tetorica-fm2612 0.2.16 / DX7 core 0.3.0).
// Level/frequency edits affect this patch's held notes and release tails.
const synth = await useSoundChip('dx7');
await synth.setPreset({
  name: 'LIVE FM', algorithm: 0,
  operators: {
    1: {outputLevel: 80, envelope: {rates: [99, 99, 99, 75], levels: [99, 99, 99, 0]}},
    2: {coarse: 2, outputLevel: 20, envelope: {rates: [99, 99, 99, 75], levels: [99, 99, 99, 0]}},
  },
});
setBpm(100);

liveLoop('dx7-live-parameters', async () => {
  await synth.setOperators([[1, {outputLevel: 80}], [2, {outputLevel: 20, fine: 0}]]);
  synth.noteOn(60, 100);
  // Two beats; follows BPM. Returning the Promise waits for each edit.
  await tween({beats: 2}, progress => synth.setOperator(2, {
    outputLevel: Math.round(20 + 60 * progress),
    fine: Math.round(50 * progress),
  }));
  await beat(1);
  // One real second, independent of BPM. The oscillator and EG are not restarted.
  await tween(1, progress => synth.setOperator(1, {
    outputLevel: Math.round(80 * (1 - progress)),
  }));
  synth.noteOff(60);
  await beat(1);
});
