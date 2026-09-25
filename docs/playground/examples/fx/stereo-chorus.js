setBpm(92);

fm.setPreset(CH1, FM_PRESETS["four-op-pad"]);
fm.setPreset(CH2, FM_PRESETS["two-op-bell"]);

const spaceFx = await livePrepare("stereo-chorus-chain", async ({ fx }) => {
  const chorus = fx.chorus({
    time: 0.018,
    depth: 0.004,
    rate: 1,
    mix: 0.45,
  });
  const reverb = fx.reverb({
    mix: 0.14,
    tone: 5200,
  });

  return {
    chorus,
    reverb,
  };
});

fx.setChain([
  spaceFx.chorus,
  spaceFx.reverb,
]);

liveLoop("pad", async () => {
  await nextBeat();
  await play(choose(["E3", "G3", "A3", "B3"]), {
    channel: CH1,
    duration: 0.55,
  });
  await beat(1.5);
});

liveLoop("lead", async () => {
  await play(choose(scale("E4", "minorPentatonic", 2)), {
    channel: CH2,
    duration: 0.09,
  });
  await beat(0.25);
});
