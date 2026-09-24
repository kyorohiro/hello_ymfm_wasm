setBpm(54);

const hiss = noise.create({
  type: "gray",
  gain: 0.06,
});
hiss.filter.set("bandpass", 2600, 0.7);

const crackle = noise.create({
  type: "clip",
  gain: 0.012,
  pan: 0.1,
});
crackle.filter.set("highpass", 1900, 0.5);

const rumble = noise.create({
  type: "brown",
  gain: 0.015,
});
rumble.filter.set("lowpass", 180, 0.4);

const radioFx = await livePrepare("radio-noise-bed-fx", async ({ fx }) => {
  return {
    radio: fx.radioTone({
      highpass: 380,
      lowpass: 3000,
      presence: 7,
      mix: 1.0,
      output: 1.0,
    }),
    lofi: fx.lofi({
      cutoff: 3600,
      highshelf: -12,
      drive: 1.25,
      mix: 0.7,
      output: 1.0,
    }),
  };
});

fx.setChain([radioFx.radio, radioFx.lofi]);

liveLoop("radio-hiss", async () => {
  hiss.gain.rampTo(rrange(0.03, 0.09), rrange(0.4, 1.8));
  hiss.filter.cutoff.rampTo(rrange(1800, 4200), rrange(0.3, 1.2));
  await beat(0.25);
});

liveLoop("radio-crackle", async () => {
  crackle.gain.rampTo(rrange(0.0, 0.001), rrange(0.03, 0.18));
  crackle.pan.rampTo(rrange(-0.5, 0.5), rrange(0.05, 0.2));
  await beat(0.125);
});

liveLoop("radio-rumble", async () => {
  rumble.gain.rampTo(rrange(0.0, 0.001), rrange(0.8, 2.8));
  await beat(0.5);
});
