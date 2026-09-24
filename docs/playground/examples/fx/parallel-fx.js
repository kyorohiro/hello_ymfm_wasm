setBpm(112);

fm.setPreset(CH1, FM_PRESETS["one-op-basic"]);
fm.setPreset(CH2, FM_PRESETS["one-op-flute"]);

const layeredFx = await livePrepare("parallel-fx-chain", async ({ fx }) => {
  const dryFilter = fx.filter({
    type: "lowpass",
    cutoff: 1800,
    q: 0.9,
  });
  const distorted = fx.distortion({
    drive: 2.4,
    mix: 0.9,
    output: 0.75,
  });
  const flanger = fx.flanger({
    time: 0.005,
    depth: 0.002,
    rate: 0.5,
    feedback: 0.2,
    mix: 0.65,
  });
  const reverb = fx.reverb({
    mix: 0.22,
    tone: 4800,
  });

  return {
    dryFilter,
    distorted,
    flanger,
    reverb,
    layered: fx.parallel(
      fx.branch(dryFilter),
      fx.branch(
        distorted,
        flanger,
        reverb
      )
    ),
  };
});

fx.setChain([
  layeredFx.layered,
]);

liveLoop("bass", async () => {
  await nextBeat();
  await play(choose(["E2", "E2", "G2", "A2"]), {
    channel: CH1,
    duration: 0.14,
  });
  await beat(1);
});

liveLoop("lead", async () => {
  await play(choose(scale("E4", "minorPentatonic", 2)), {
    channel: CH2,
    duration: 0.08,
  });
  await beat(0.25);
});
