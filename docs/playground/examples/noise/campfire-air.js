setBpm(34);

const fireAir = noise.create({
  type: "brown",
  gain: 0.06,
});
fireAir.filter.set("bandpass", 340, 0.5);

const flame = noise.create({
  type: "pink",
  gain: 0.05,
  pan: -0.1,
});
flame.filter.set("bandpass", 1200, 0.8);

const crackle = noise.create({
  type: "clip",
  gain: 0.006,
  pan: 0.1,
});
crackle.filter.set("highpass", 2600, 0.7);

const fireFx = await livePrepare("campfire-air-fx", async ({ fx }) => {
  return {
    reverb: fx.reverb({
      mix: 0.10,
      tone: 4200,
    }),
    tape: fx.distortion({
      drive: 1.08,
      mix: 0.22,
    }),
  };
});

fx.setChain([fireFx.tape, fireFx.reverb]);

liveLoop("fire-air", async () => {
  fireAir.gain.rampTo(rrange(0.03, 0.09), rrange(2.0, 4.8));
  fireAir.filter.cutoff.rampTo(rrange(220, 520), rrange(1.8, 4.2));
  await beat(0.5);
});

liveLoop("fire-flame", async () => {
  flame.gain.rampTo(rrange(0.02, 0.08), rrange(0.4, 1.3));
  flame.filter.cutoff.rampTo(rrange(700, 2200), rrange(0.3, 1.1));
  flame.pan.rampTo(rrange(-0.4, 0.4), rrange(0.8, 2.0));
  await beat(0.25);
});

liveLoop("fire-crackle", async () => {
  crackle.gain.rampTo(rrange(0.0, 0.018), rrange(0.02, 0.12));
  crackle.pan.rampTo(rrange(-0.7, 0.7), rrange(0.03, 0.16));
  await beat(cycle([0.0625, 0.125, 0.25, 0.125]));
});
