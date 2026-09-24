setBpm(96);

fm.setPreset(CH1, FM_PRESETS["fm-bass"]);
fm.setPreset(CH2, FM_PRESETS["two-op-bell"]);

const sceneFx = await livePrepare("radio-lofi-chain", async ({ fx }) => {
  const radio = fx.radioTone({
    highpass: 420,
    lowpass: 2600,
    presence: 5,
    mix: 0.95,
    output: 1.1,
  });
  const lofi = fx.lofi({
    cutoff: 3400,
    highshelf: -10,
    drive: 1.1,
    mix: 0.75,
    output: 1.0,
  });
  const reverb = fx.reverb({
    mix: 0.14,
    tone: 4200,
  });

  return {
    radio,
    lofi,
    reverb,
  };
});

fx.setChain([
  sceneFx.radio,
  sceneFx.lofi,
  sceneFx.reverb,
]);

liveLoop("bass", async () => {
  await nextBeat();
  await play(choose(["E2", "E2", "G2", "A2"]), {
    channel: CH1,
    duration: 0.16,
  });
  await beat(1);
});

liveLoop("lead", async () => {
  await play(choose(scale("E4", "minorPentatonic", 2)), {
    channel: CH2,
    duration: 0.10,
  });
  await beat(0.375);
});
