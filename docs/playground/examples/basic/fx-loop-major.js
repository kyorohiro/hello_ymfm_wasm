fm.setPreset(CH2, FM_PRESETS["ritual-bell"]);

const reverb = fx.reverb({
  mix: 0.2,
});

fx.setChain([reverb]);

liveLoop("bleeps", async () => {
  const notes = scale("Eb2", "majorPentatonic", 3);
  fm.setOperator(CH2, OP1, { tl: randInt(14, 40) });
  fm.setOperator(CH2, OP2, { tl: randInt(22, 45) });
  fm.setOperator(CH2, OP3, { tl: randInt(28, 50) });
  fm.setOperator(CH2, OP4, { tl: randInt(8, 30) });

  await play(choose(notes), {
    channel: CH2,
    duration: 0.1,
  });

  await sleep(0.001);
});
