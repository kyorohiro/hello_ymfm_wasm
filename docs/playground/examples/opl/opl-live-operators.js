// Adjust OP1's total level while a note is held. No retrigger is needed.
// TL: 0 = loudest, 63 = quietest. Operator indices are 0-based.
setBpm(100);
opl.setPreset(0, OPL_PRESETS.organ);
opl.setAlgo(0, 0, 2); // OP1 modulates OP2; feedback belongs to OP1.

liveLoop('opl-timbre', async () => {
  opl.noteOn(0, 'C4');
  await tween({beats: 2}, progress => opl.setOperator(0, 0, {
    tl: Math.round(50 - 34 * progress),
  }));
  await tween({beats: 2}, progress => opl.setOperator(0, 0, {
    tl: Math.round(16 + 34 * progress),
  }));
  opl.keyOff(0);
  await beat(1);
});
