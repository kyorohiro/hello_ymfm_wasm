setBpm(104);

fm.setPreset(CH1, FM_PRESETS["fm-bass"]);
fm.setPreset(CH2, FM_PRESETS["two-op-bell"]);

const crushFx = await livePrepare("crush-tape-chain", async ({ fx }) => {
  const bitcrusher = fx.bitcrusher({
    bitDepth: 9,
    holdFrames: 3,
    mix: 0.7,
    output: 1,
  });
  const tape = fx.tapeSaturation({
    drive: 0.9,
    mix: 0.65,
    output: 1,
  });
  const reverb = fx.reverb({
    mix: 0.08,
    tone: 4600,
  });

  return {
    bitcrusher,
    tape,
    reverb,
  };
});

fx.setChain([
  crushFx.bitcrusher,
  crushFx.tape,
  crushFx.reverb,
]);

liveLoop("bass", async () => {
  await nextBeat();
  await play(choose(["E2", "E2", "G2", "A2"]), {
    channel: CH1,
    duration: 0.15,
  });
  await beat(1);
});

liveLoop("lead", async () => {
  crushFx.bitcrusher.bitDepth.set(
    choose([7, 8, 9, 10, 12])
  );
  crushFx.bitcrusher.holdFrames.set(
    choose([1, 2, 3, 4, 6])
  );
  crushFx.tape.drive.set(
    choose([0.5, 0.8, 1.1, 1.5])
  );

  await play(choose(scale("E4", "minorPentatonic", 2)), {
    channel: CH2,
    duration: 0.08,
  });
  await beat(0.25);
});
