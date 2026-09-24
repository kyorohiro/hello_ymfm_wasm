setBpm(72);
setMasterVolume(1.0);

const choirFx = await livePrepare("ambient-choir-sample-fx", async ({ fx, sample }) => {
  await sample.load(
    "sonic-pi/ambi-choir"
  );

  const reverb = fx.reverb({
    mix: 0.24,
    tone: 6200,
  });

  return {
    reverb,
  };
});

fx.setChain([
  choirFx.reverb,
]);

liveLoop("choir", async () => {
  const rate = choose([0.5, 1 / 3, 3 / 5]);

  await sample.play("sonic-pi/ambi-choir", {
    playbackRate: rate,
    gain: 0.75,
    pan: rrange(-1, 1),
    fadeIn: 0.02,
    fadeOut: 0.28,
  });

  await sleep(0.5);
});
