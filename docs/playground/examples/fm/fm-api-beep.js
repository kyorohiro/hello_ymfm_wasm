fm.reset();

// CH1 = YM2612 channel 1
// OP4 is the audible carrier in this simple setup
fm.setOperator(CH1, OP1, { tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 });
fm.setOperator(CH1, OP2, { tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 });
fm.setOperator(CH1, OP3, { tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 });
fm.setOperator(CH1, OP4, {
  dt: 0,
  multi: 1,
  tl: 8,
  ar: 22,
  d1r: 6,
  d2r: 3,
  sl: 3,
  rr: 8,
});

fm.setAlgo(CH1, 7, 0);
fm.setPan(CH1, true, true);

fm.noteOn(CH1, 4, 553);
await sleep(0.4);
fm.noteOff(CH1);
await sleep(0.3);
