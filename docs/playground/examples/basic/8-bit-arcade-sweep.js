setBpm(132);

fm.reset();

// CH1 = lead voice
// OP4 = carrier
// OP2 = main modulator
fm.setOperator(CH1, OP1, { tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 });
fm.setOperator(CH1, OP2, {
  multi: 3,
  tl: 30,
  ar: 24,
  d1r: 9,
  d2r: 5,
  sl: 6,
  rr: 9,
});
fm.setOperator(CH1, OP3, { tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 });
fm.setOperator(CH1, OP4, {
  multi: 1,
  tl: 10,
  ar: 25,
  d1r: 8,
  d2r: 4,
  sl: 5,
  rr: 8,
});
fm.setAlgo(CH1, 4, 3);
fm.setPan(CH1, true, true);

// CH2 = simple bass support
fm.setPreset(CH2, FM_PRESETS["one-op-basic"]);
fm.setOperator(CH2, OP4, {
  tl: 18,
  ar: 28,
  d1r: 7,
  d2r: 3,
  sl: 4,
  rr: 8,
});

liveLoop("lead", async () => {
  const phrase = ["E5", "B4", "A4", "E5", "D6", "A5"];
  //await nextBeat();
  await play(choose(phrase), {
    channel: CH1,
    duration: 0.100,
  });
  await beat(0.001);
});

liveLoop("multi-sweep", async () => {
  const modulatorMulti = choose([2, 3, 4, 6, 8, 10]);
  fm.setOperator(CH1, OP2, {
    multi: modulatorMulti,
  });
  await beat(0.125);
});

liveLoop("bass", async () => {
  await nextBeat();
  await play("E2", {
    channel: CH2,
    duration: 0.16,
  });
  await beat(1);
});
