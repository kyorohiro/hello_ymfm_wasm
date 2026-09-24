setBpm(112);
setMasterVolume(1.1);

fm.reset();
fm.setPreset(CH1, FM_PRESETS["fm-lead"]);
fm.setOperator(CH1, OP4, {
  tl: 12,
  ar: 28,
  d1r: 10,
  d2r: 4,
  sl: 4,
  rr: 7,
});

const fxRack = await livePrepare("flanger-guitar-fx", async ({ fx }) => {
  const distortion = fx.distortion({
    drive: 2.1,
    mix: 0.75,
    output: 0.92,
  });
  const flanger = fx.flanger({
    time: 0.0035,
    depth: 0.0018,
    rate: 0.25,
    feedback: 0.28,
    mix: 0.65,
  });
  const reverb = fx.reverb({
    mix: 0.12,
    tone: 5600,
  });

  return {
    distortion,
    flanger,
    reverb,
  };
});

fx.setChain([
  fxRack.distortion,
  fxRack.flanger,
  fxRack.reverb,
]);

liveLoop("flanger-riff", async () => {
  for (const note of ["E3", "G3", "B3", "A3", "G3", "E3"]) {
    await play(note, {
      channel: CH1,
      duration: 0.11,
    });
    await beat(0.25);
  }
});
