setBpm(108);
setMasterVolume(1.1);

fm.reset();
fm.setPreset(CH1, FM_PRESETS["fm-bass"]);
fm.setPreset(CH2, FM_PRESETS["fm-pluck"]);

fm.setPan(CH1, true, true, 0, 3);
fm.setLfo(true, 4);

const wobbleFx = await livePrepare("wobble-bass-fx", async ({ fx }) => {
  const filter = fx.filter({
    type: "lowpass",
    cutoff: 1400,
    q: 1.4,
  });
  const delay = fx.delay({
    time: 0.2,
    feedback: 0.22,
    mix: 0.1,
  });

  return {
    filter,
    delay,
  };
});

fx.setChain([
  wobbleFx.filter,
  wobbleFx.delay,
]);

liveLoop("wub", async () => {
  const root = cycle("wub-root", ["E2", "E2", "G2", "A2"]);
  const cutoff = cycle("wub-cutoff", [900, 1300, 1800, 1100]);
  const bassDepth = cycle("wub-depth", [34, 22, 30, 18]);

  wobbleFx.filter.cutoff.rampTo(cutoff, 0.12);
  fm.setOperator(CH1, OP4, {
    tl: bassDepth,
  });

  await play(root, {
    channel: CH1,
    duration: 0.2,
  });

  await beat(1);
});

liveLoop("wub-top", async () => {
  const notes = ["B3", "D4", "E4", "G4"];
  await play(cycle("wub-top-note", notes), {
    channel: CH2,
    duration: 0.08,
  });
  await beat(0.5);
});
