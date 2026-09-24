setBpm(120);

fm.setPreset(CH1, FM_PRESETS["one-op-basic"]);
fm.setPreset(CH2, FM_PRESETS["two-op-bell"]);

const mainFx = await livePrepare("fx-loop-minor-chain", async ({ fx }) => {
  const filter = fx.filter({
    type: "lowpass",
    cutoff: 2200,
    q: 1.4,
  });
  const delay = fx.delay({
    time: 0.18,
    feedback: 0.32,
    mix: 0.18,
  });
  const reverb = fx.reverb({
    mix: 0.12,
    tone: 6200,
  });

  return {
    filter,
    delay,
    reverb,
  };
});

fx.setChain([
  mainFx.filter,
  mainFx.delay,
  mainFx.reverb,
]);

liveLoop("bass", async () => {
  await nextBeat();
  await play("E2", { channel: CH1, duration: 0.12 });
  await beat(1);
  await play("G2", { channel: CH1, duration: 0.12 });
  await beat(1);
  await play("A2", { channel: CH1, duration: 0.12 });
  await beat(1);
  await play("B2", { channel: CH1, duration: 0.12 });
  await beat(1);
});

liveLoop("lead", async () => {
  const notes = scale("E4", "minorPentatonic", 2);
  mainFx.filter.cutoff.set(choose([900, 1400, 2200, 3600, 5200]));
  mainFx.delay.mix.set(choose([0.1, 0.16, 0.22]));
  await play(choose(notes), {
    channel: CH2,
    duration: 0.08,
  });
  await beat(0.125);
});
