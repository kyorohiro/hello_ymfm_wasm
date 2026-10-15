// Live DX7 operator editing (tetorica-fm2612 0.2.16 / DX7 core 0.3.0).
// Level/frequency edits affect this patch's held notes and release tails.
const dx7 = await useSoundChip('dx7');
await dx7.setPreset({
  name: 'LIVE FM', algorithm: 0,
  operators: {
    1: {outputLevel: 80, envelope: {rates: [99, 99, 99, 75], levels: [99, 99, 99, 0]}},
    2: {coarse: 2, outputLevel: 20, envelope: {rates: [99, 99, 99, 75], levels: [99, 99, 99, 0]}},
  },
});
await mixer.set(dx7.id, {volume: 0.5});
setBpm(100);

liveLoop('dx7-live-parameters', async () => {
  await dx7.setOperators([[1, {outputLevel: 80}], [2, {outputLevel: 20, fine: 0}]]);
  dx7.noteOn(60, 100);
  // Two beats; follows BPM. Returning the Promise waits for each edit.
  await tween({beats: 2}, progress => dx7.setOperator(2, {
    outputLevel: Math.round(20 + 60 * progress),
    fine: Math.round(50 * progress),
  }));
  await beat(1);
  // One real second, independent of BPM. The oscillator and EG are not restarted.
  await tween(1, progress => dx7.setOperator(1, {
    outputLevel: Math.round(80 * (1 - progress)),
  }));
  dx7.noteOff(60);
  await beat(1);
});
