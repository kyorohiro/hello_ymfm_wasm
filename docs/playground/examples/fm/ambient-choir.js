setBpm(72);
setMasterVolume(1.2);

fm.reset();
fm.setChannel3SpecialMode(true);
fm.setAlgo(CH3, 7, 0);
fm.setPan(CH3, true, true);
fm.setLfo(true, 3);

fm.setOperator(CH3, OP1, {
  multi: 1,
  tl: 20,
  ar: 8,
  d1r: 4,
  d2r: 2,
  sl: 4,
  rr: 6,
});
fm.setOperator(CH3, OP2, {
  multi: 1,
  tl: 26,
  ar: 7,
  d1r: 4,
  d2r: 2,
  sl: 4,
  rr: 7,
});
fm.setOperator(CH3, OP3, {
  multi: 1,
  tl: 30,
  ar: 9,
  d1r: 5,
  d2r: 2,
  sl: 5,
  rr: 6,
});
fm.setOperator(CH3, OP4, {
  multi: 1,
  tl: 22,
  ar: 8,
  d1r: 4,
  d2r: 2,
  sl: 4,
  rr: 6,
});

const choirFx = await livePrepare("ambient-choir-fx", async ({ fx }) => {
  const filter = fx.filter({
    type: "lowpass",
    cutoff: 3400,
    q: 0.8,
  });
  const delay = fx.delay({
    time: 0.16,
    feedback: 0.18,
    mix: 0.12,
  });
  const reverb = fx.reverb({
    mix: 0.34,
    tone: 4200,
  });

  return {
    filter,
    delay,
    reverb,
  };
});

fx.setChain([
  choirFx.filter,
  choirFx.delay,
  choirFx.reverb,
]);

const choirShapes = [
  {
    op1: { block: 4, fnum: 512 },
    op2: { block: 4, fnum: 645 },
    op3: { block: 4, fnum: 768 },
    op4: { block: 5, fnum: 512 },
  },
  {
    op1: { block: 4, fnum: 430 },
    op2: { block: 4, fnum: 512 },
    op3: { block: 4, fnum: 645 },
    op4: { block: 5, fnum: 430 },
  },
  {
    op1: { block: 4, fnum: 576 },
    op2: { block: 4, fnum: 704 },
    op3: { block: 4, fnum: 860 },
    op4: { block: 5, fnum: 576 },
  },
];

liveLoop("choir-pad", async () => {
  const chord = choirShapes[cycle([0, 1, 2])];

  if (!chord) {
    return;
  }

  fm.setChannel3SpecialFrequency(OP1, chord.op1.block, chord.op1.fnum);
  fm.setChannel3SpecialFrequency(OP2, chord.op2.block, chord.op2.fnum);
  fm.setChannel3SpecialFrequency(OP3, chord.op3.block, chord.op3.fnum);

  choirFx.filter.cutoff.set(choose([2800, 3200, 3600, 4200]));
  choirFx.delay.mix.set(choose([0.1, 0.12, 0.16]));

  fm.noteOn(CH3, chord.op4.block, chord.op4.fnum);
  await beat(3.5);
  fm.noteOff(CH3);
  await beat(0.5);
});
