fm.reset();
fm.setPreset(CH1, FM_PRESETS["one-op-basic"]);
fm.setOperator(CH1, OP4, {
  multi: 3,
  tl: 10,
  ar: 24,
  d1r: 8,
  d2r: 5,
  sl: 5,
  rr: 8,
});
fm.setAlgo(CH1, 7, 0);
fm.setPan(CH1, true, true);

for (const note of ["C3", "G3", "Bb3", "C4"]) {
  await play(note, { channel: CH1, duration: 0.22 });
  await sleep(0.06);
}
