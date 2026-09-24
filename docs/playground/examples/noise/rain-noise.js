setBpm(46);

const rainBed = noise.create({
  type: "pink",
  gain: 0.10,
});
rainBed.filter.set("highpass", 700, 0.2);

const drops = noise.create({
  type: "white",
  gain: 0.016,
  pan: -0.2,
});
drops.filter.set("bandpass", 4200, 1.6);

const roof = noise.create({
  type: "gray",
  gain: 0.022,
  pan: 0.2,
});
roof.filter.set("bandpass", 2100, 0.9);

const rainFx = await livePrepare("rain-noise-fx", async ({ fx }) => {
  return {
    reverb: fx.reverb({
      mix: 0.14,
      tone: 5600,
    }),
    filter: fx.filter({
      type: "lowpass",
      cutoff: 6800,
      q: 0.2,
    }),
  };
});

fx.setChain([rainFx.filter, rainFx.reverb]);

liveLoop("rain-bed", async () => {
  rainBed.gain.rampTo(rrange(0.08, 0.15), rrange(1.2, 3.4));
  rainBed.filter.cutoff.rampTo(rrange(1200, 2800), rrange(1.0, 2.8));
  await beat(0.5);
});

liveLoop("rain-drops", async () => {
  drops.gain.rampTo(rrange(0.004, 0.03), rrange(0.04, 0.16));
  drops.pan.rampTo(rrange(-1.0, 1.0), rrange(0.05, 0.24));
  drops.filter.cutoff.rampTo(rrange(3000, 6200), rrange(0.05, 0.18));
  await beat(cycle([0.125, 0.125, 0.25, 0.0625]));
});

liveLoop("rain-roof", async () => {
  roof.gain.rampTo(rrange(0.01, 0.05), rrange(0.2, 0.7));
  roof.pan.rampTo(rrange(-0.5, 0.5), rrange(0.18, 0.6));
  await beat(0.25);
});
