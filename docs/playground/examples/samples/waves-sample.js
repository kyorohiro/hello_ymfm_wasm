setBpm(40);
setMasterVolume(0.9);

fm.reset();

const seaChannels = [CH1, CH2, CH3];

for (const ch of seaChannels) {
  fm.setAlgo(ch, 4, 5);
  fm.setPan(ch, true, true);
}

// CH1: deep sea-bed
fm.setOperator(CH1, OP1, {
  dt: 3,
  multi: 1,
  tl: 20,
  ar: 8,
  d1r: 2,
  d2r: 1,
  sl: 4,
  rr: 4,
});
fm.setOperator(CH1, OP2, {
  dt: 2,
  multi: 2,
  tl: 28,
  ar: 7,
  d1r: 2,
  d2r: 1,
  sl: 5,
  rr: 4,
});
fm.setOperator(CH1, OP3, {
  dt: 1,
  multi: 3,
  tl: 36,
  ar: 6,
  d1r: 2,
  d2r: 1,
  sl: 6,
  rr: 4,
});
fm.setOperator(CH1, OP4, {
  dt: 0,
  multi: 1,
  tl: 10,
  ar: 10,
  d1r: 2,
  d2r: 1,
  sl: 4,
  rr: 4,
});

// CH2: main wash
fm.setOperator(CH2, OP1, {
  dt: 2,
  multi: 1,
  tl: 18,
  ar: 10,
  d1r: 3,
  d2r: 1,
  sl: 4,
  rr: 5,
});
fm.setOperator(CH2, OP2, {
  dt: 1,
  multi: 4,
  tl: 26,
  ar: 9,
  d1r: 3,
  d2r: 1,
  sl: 5,
  rr: 5,
});
fm.setOperator(CH2, OP3, {
  dt: 3,
  multi: 7,
  tl: 38,
  ar: 8,
  d1r: 3,
  d2r: 1,
  sl: 6,
  rr: 5,
});
fm.setOperator(CH2, OP4, {
  dt: 0,
  multi: 1,
  tl: 16,
  ar: 11,
  d1r: 3,
  d2r: 1,
  sl: 4,
  rr: 5,
});

// CH3: bright splash
fm.setAlgo(CH3, 7, 6);
fm.setOperator(CH3, OP1, {
  dt: 3,
  multi: 12,
  tl: 32,
  ar: 28,
  d1r: 18,
  d2r: 8,
  sl: 7,
  rr: 9,
});
fm.setOperator(CH3, OP2, {
  dt: 2,
  multi: 9,
  tl: 40,
  ar: 27,
  d1r: 16,
  d2r: 7,
  sl: 7,
  rr: 9,
});
fm.setOperator(CH3, OP3, {
  dt: 1,
  multi: 6,
  tl: 52,
  ar: 26,
  d1r: 14,
  d2r: 6,
  sl: 7,
  rr: 8,
});
fm.setOperator(CH3, OP4, {
  dt: 0,
  multi: 1,
  tl: 22,
  ar: 29,
  d1r: 12,
  d2r: 5,
  sl: 6,
  rr: 8,
});

const wavesFx = await livePrepare("waves-sample-fx", async ({ fx }) => {
  const filter = fx.filter({
    type: "lowpass",
    cutoff: 1800,
    q: 0.4,
  });
  const reverb = fx.reverb({
    mix: 0.38,
    tone: 5400,
  });

  return {
    filter,
    reverb,
  };
});

fx.setChain([
  wavesFx.filter,
  wavesFx.reverb,
]);

liveLoop("sea-bed", async () => {
  fm.setPan(CH1, true, true);
  fm.setOperator(CH1, OP4, {
    tl: randInt(10, 18),
  });
  await play(choose(["D2", "Eb2", "F2"]), {
    channel: CH1,
    duration: rrange(1.8, 2.8),
  });
  await sleep(rrange(0.8, 1.4));
});

liveLoop("wash", async () => {
  wavesFx.filter.cutoff.rampTo(
    rrange(1200, 4200),
    rrange(0.6, 1.8)
  );
  fm.setPan(CH2, rand() > 0.25, true, 0, 0);
  fm.setOperator(CH2, OP4, {
    tl: randInt(12, 24),
  });
  await play(choose(["A2", "Bb2", "C3", "D3"]), {
    channel: CH2,
    duration: rrange(1.2, 2.2),
  });
  await sleep(rrange(0.9, 1.6));
});

liveLoop("splash", async () => {
  fm.setPan(CH3, rand() > 0.5, rand() > 0.5);
  fm.setOperator(CH3, OP4, {
    tl: randInt(18, 34),
  });
  await play(choose(["D5", "F5", "A5", "C6"]), {
    channel: CH3,
    duration: rrange(0.08, 0.18),
  });
  await sleep(rrange(1.4, 3.2));
});
