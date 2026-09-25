setBpm(28);

const wind = noise.create({
  type: "pink",
  gain: 0.18,
});
wind.filter.set("bandpass", 900, 0.35);

const gust = noise.create({
  type: "white",
  gain: 0.03,
  pan: -0.4,
});
gust.filter.set("highpass", 1800, 0.2);

const airFx = await livePrepare("wind-noise-fx", async ({ fx }) => {
  return {
    reverb: fx.reverb({
      mix: 0.18,
      tone: 4800,
    }),
    chorus: fx.chorus({
      time: 0.018,
      depth: 0.25,
      rate: 0.08,
      mix: 0.16,
    }),
  };
});

fx.setChain([airFx.chorus, airFx.reverb]);

liveLoop("wind-shape", async () => {
  wind.gain.rampTo(rrange(0.08, 0.28), rrange(1.5, 4.0));
  wind.filter.cutoff.rampTo(rrange(500, 1800), rrange(1.2, 3.2));
  wind.pan.rampTo(rrange(-0.6, 0.6), rrange(2.0, 4.5));
  await beat(0.5);
});

liveLoop("wind-gust", async () => {
  gust.gain.rampTo(rrange(0.01, 0.08), rrange(0.2, 0.9));
  gust.filter.cutoff.rampTo(rrange(1400, 4200), rrange(0.2, 0.8));
  gust.pan.rampTo(rrange(-1.0, 1.0), rrange(0.3, 1.1));
  await beat(cycle([0.25, 0.5, 0.75]));
});
