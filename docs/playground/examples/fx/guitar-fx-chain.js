setBpm(108);
setMasterVolume(1.2);

fm.reset();
fm.setPreset(CH1, FM_PRESETS["fm-pluck"]);
fm.setOperator(CH1, OP4, {
  tl: 10,
  ar: 26,
  d1r: 10,
  d2r: 5,
  sl: 4,
  rr: 6,
});

const guitarFx = await livePrepare("guitar-fx", async ({ fx }) => {
  const gate = fx.gate({
    threshold: 0.06,
    floor: 0.02,
    mix: 1,
  });
  const compressor = fx.compressor({
    threshold: -26,
    knee: 16,
    ratio: 10,
    attack: 0.004,
    release: 0.2,
    output: 1.1,
  });
  const distortion = fx.distortion({
    drive: 2.6,
    mix: 0.9,
    output: 0.9,
  });
  const reverb = fx.reverb({
    mix: 0.14,
    tone: 5200,
  });

  return {
    gate,
    compressor,
    distortion,
    reverb,
  };
});

fx.setChain([
  guitarFx.gate,
  guitarFx.compressor,
  guitarFx.distortion,
  guitarFx.reverb,
]);

liveLoop("riff", async () => {
  for (const note of ["E3", "G3", "A3", "B3", "A3", "G3"]) {
    await play(note, {
      channel: CH1,
      duration: 0.12,
    });
    await beat(0.25);
  }
});
