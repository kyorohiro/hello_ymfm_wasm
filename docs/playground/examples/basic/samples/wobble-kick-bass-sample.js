setBpm(96);
setMasterVolume(1.0);

const wubFx = await livePrepare("wobble-kick-bass-sample-fx", async ({ fx, sample }) => {
  await sample.load(
    "sonic-pi/drum-heavy-kick"
  );
  await sample.load(
    "sonic-pi/bass-hit-c"
  );

  const wobble = fx.wobble({
    cutoff: 900,
    depth: 1600,
    rate: 0.5,
    resonance: 6,
    mix: 0.65,
  });
  const delay = fx.delay({
    time: 0.24,
    feedback: 0.32,
    mix: 0.18,
  });
  const reverb = fx.reverb({
    mix: 0.1,
    tone: 4200,
  });

  return {
    wobble,
    delay,
    reverb,
  };
});

fx.setChain([
  wubFx.wobble,
  wubFx.delay,
  wubFx.reverb,
]);

liveLoop("wub", async () => {
  await sample.play("sonic-pi/drum-heavy-kick", {
    gain: 0.9,
    fadeIn: 0.002,
    fadeOut: 0.05,
  });

  await sample.play("sonic-pi/bass-hit-c", {
    playbackRate: 0.8,
    gain: 0.4,
    fadeIn: 0.002,
    fadeOut: 0.08,
  });

  await sleep(1);
});
