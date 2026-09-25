setBpm(108);
setMasterVolume(1.15);

fm.reset();
fm.setPreset(CH1, FM_PRESETS["fm-bass"]);

const fxRack = await livePrepare("wobble-filter-bass-fx", async ({ fx }) => {
  const wobble = fx.wobble({
    cutoff: 900,
    depth: 1600,
    rate: 0.5,
    resonance: 2.4,
    mix: 1,
  });
  const compressor = fx.compressor({
    threshold: -22,
    ratio: 7,
    attack: 0.005,
    release: 0.18,
  });

  return {
    wobble,
    compressor,
  };
});

fx.setChain([
  fxRack.wobble,
  fxRack.compressor,
]);

liveLoop("bass", async () => {
  await play(choose(["E2", "E2", "G2", "A2"]), {
    channel: CH1,
    duration: 0.18,
  });
  await beat(0.5);
});
