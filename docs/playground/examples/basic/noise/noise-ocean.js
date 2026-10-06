setBpm(40);

/** @type {PlaygroundContext & {
  noiseOcean?: {
    sea: PlaygroundNoiseVoice,
    surf: PlaygroundNoiseVoice,
    deep: PlaygroundNoiseVoice,
  },
}} */
const sContext = context;

if (!sContext.noiseOcean) {
  sContext.noiseOcean = {
    sea: noise.create({
      type: "pink",
      gain: 0.22,
    }),
    surf: noise.create({
      type: "white",
      gain: 0.05,
      pan: -0.2,
    }),
    deep: noise.create({
      type: "brown",
      gain: 0.16,
      pan: 0.15,
    }),
  };
}

const sea = sContext.noiseOcean.sea;
sea.filter.set("lowpass", 1400, 0.3);

const surf = sContext.noiseOcean.surf;
surf.filter.set("bandpass", 900, 0.6);

const deep = sContext.noiseOcean.deep;
deep.filter.set("lowpass", 320, 0.4);

const washFx = await livePrepare("noise-ocean-fx", async ({ fx }) => {
  return {
    reverb: fx.reverb({
      mix: 0.22,
      tone: 5200,
    }),
  };
});

fx.setChain([washFx.reverb]);

liveCleanup(
  ["sea-pan", "sea-cutoff", "sea-gain"],
  () => {
    sContext.noiseOcean?.sea.dispose();
    sContext.noiseOcean?.surf.dispose();
    sContext.noiseOcean?.deep.dispose();
    delete sContext.noiseOcean;
  }
);

liveLoop("sea-pan", async () => {
  control(sea, {
    pan: rrange(-0.3, 0.3),
    slide: 2.4,
  });
  control(surf, {
    pan: rrange(-0.8, 0.8),
    slide: 1.4,
  });
  control(deep, {
    pan: rrange(-0.2, 0.2),
    slide: 3.6,
  });
  await beat(1);
});

liveLoop("sea-cutoff", async () => {
  control(sea, {
    cutoff: rrange(900, 2200),
    slide: 2.8,
  });
  control(surf, {
    cutoff: rrange(600, 1800),
    slide: 0.8,
  });
  control(deep, {
    cutoff: rrange(180, 420),
    slide: 4.0,
  });
  await beat(0.5);
});

liveLoop("sea-gain", async () => {
  control(sea, {
    gain: rrange(0.16, 0.32),
    slide: 2.2,
  });
  control(surf, {
    gain: rrange(0.02, 0.10),
    slide: 0.9,
  });
  control(deep, {
    gain: rrange(0.12, 0.20),
    slide: 3.0,
  });
  await beat(0.5);
});
