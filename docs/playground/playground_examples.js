export const EXAMPLES = {
  single: `fm.setPreset(CH1, FM_PRESETS["one-op-basic"]);
await play("C4", { channel: CH1, duration: 0.35 });
await sleep(0.12);
await play("E4", { channel: CH1, duration: 0.35 });
await sleep(0.12);
await play("G4", { channel: CH1, duration: 0.5 });
`,
  random: `fm.setPreset(CH1, FM_PRESETS["two-op-bell"]);
const notes = scale("Eb2", "majorPentatonic", 2);

for (let step = 0; step < 16; step += 1) {
  await play(choose(notes), {
    channel: CH1,
    duration: 0.12 + rand() * 0.15,
  });
  await sleep(0.08);
}
`,
  "8-bit-arcade-sweep": `setBpm(132);

fm.reset();

// CH1 = lead voice
// OP4 = carrier
// OP2 = main modulator
fm.setOperator(CH1, OP1, { tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 });
fm.setOperator(CH1, OP2, {
  multi: 3,
  tl: 30,
  ar: 24,
  d1r: 9,
  d2r: 5,
  sl: 6,
  rr: 9,
});
fm.setOperator(CH1, OP3, { tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 });
fm.setOperator(CH1, OP4, {
  multi: 1,
  tl: 10,
  ar: 25,
  d1r: 8,
  d2r: 4,
  sl: 5,
  rr: 8,
});
fm.setAlgo(CH1, 4, 3);
fm.setPan(CH1, true, true);

// CH2 = simple bass support
fm.setPreset(CH2, FM_PRESETS["one-op-basic"]);
fm.setOperator(CH2, OP4, {
  tl: 18,
  ar: 28,
  d1r: 7,
  d2r: 3,
  sl: 4,
  rr: 8,
});

liveLoop("lead", async () => {
  const phrase = ["E5", "B4", "A4", "E5", "D6", "A5"];
  //await nextBeat();
  await play(choose(phrase), {
    channel: CH1,
    duration: 0.100,
  });
  await beat(0.001);
});

liveLoop("multi-sweep", async () => {
  const modulatorMulti = choose([2, 3, 4, 6, 8, 10]);
  fm.setOperator(CH1, OP2, {
    multi: modulatorMulti,
  });
  await beat(0.125);
});

liveLoop("bass", async () => {
  await nextBeat();
  await play("E2", {
    channel: CH2,
    duration: 0.16,
  });
  await beat(1);
});
`,
  "live-loop": `setBpm(120);

fm.setPreset(CH1, FM_PRESETS["one-op-basic"]);
fm.setPreset(CH2, FM_PRESETS["two-op-bell"]);

liveLoop("bass", async () => {
  await nextBeat();
  await play("E2", { channel: CH1, duration: 0.14 });
  await beat(1);
  await play("E2", { channel: CH1, duration: 0.14 });
  await beat(1);
  await play("G2", { channel: CH1, duration: 0.14 });
  await beat(1);
  await play("A2", { channel: CH1, duration: 0.14 });
  await beat(1);
});

liveLoop("lead", async () => {
  const notes = scale("E4", "minorPentatonic", 2);
  //await nextBeat();
  await play(choose(notes), {
    channel: CH2,
    duration: 0.08,
  });
  await beat(cycle([0.04, 0.04, 0.08]));
});
`,
  "fm-direct": `fm.reset();
fm.setPreset(CH1, FM_PRESETS["one-op-basic"]);
fm.setOperator(CH1, OP4, {
  multi: 3,
  tl: 10,
  ar: 24,
  d1r: 8,
  d2r: 5,
  sl: 5,
  rr: 8,
});
fm.setAlgo(CH1, 7, 0);
fm.setPan(CH1, true, true);

for (const note of ["C3", "G3", "Bb3", "C4"]) {
  await play(note, { channel: CH1, duration: 0.22 });
  await sleep(0.06);
}
`,
  "fm-api-beep": `fm.reset();

// CH1 = YM2612 channel 1
// OP4 is the audible carrier in this simple setup
fm.setOperator(CH1, OP1, { tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 });
fm.setOperator(CH1, OP2, { tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 });
fm.setOperator(CH1, OP3, { tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 });
fm.setOperator(CH1, OP4, {
  dt: 0,
  multi: 1,
  tl: 8,
  ar: 22,
  d1r: 6,
  d2r: 3,
  sl: 3,
  rr: 8,
});

fm.setAlgo(CH1, 7, 0);
fm.setPan(CH1, true, true);

fm.noteOn(CH1, 4, 553);
await sleep(0.4);
fm.noteOff(CH1);
await sleep(0.3);
`,
  "pg-context-init": `const state =
  /** @type {{ isInit?: boolean, hitCount?: number }} */ (pg.context);

if (!state.isInit) {
  fm.reset();
  fm.setPreset(CH1, FM_PRESETS["two-op-bell"]);
  fm.setPan(CH1, true, true);
  state.isInit = true;
  state.hitCount = 0;
  log("Initialized pg.context.");
}

state.hitCount += 1;
log("Run count:", state.hitCount);

await play("C4", { channel: CH1, duration: 0.18 });
await sleep(0.05);
await play("E4", { channel: CH1, duration: 0.18 });
await sleep(0.05);
await play("G4", { channel: CH1, duration: 0.28 });
`,
  "sonic-pi-sample-choir": `setMasterVolume(1.0);

await sample.load(
  "sonic-pi/ambi-choir"
);

await sample.play("sonic-pi/ambi-choir", {
  gain: 0.9,
  fadeIn: 0.02,
  fadeOut: 0.2,
});

await sleep(1.2);

await sample.play("sonic-pi/ambi-choir", {
  gain: 0.7,
  playbackRate: 0.8,
  offset: 0.1,
  duration: 1.6,
  fadeIn: 0.02,
  fadeOut: 0.25,
  pan: -0.2,
});

await sleep(1.8);
`,
  "fm-low-level-note": `fm.reset();

fm.setPreset(CH1, FM_PRESETS["one-op-basic"]);

const { block, fnum } = noteToBlockFnum("C4");
fm.setFrequency(CH1, block, fnum);
fm.keyOn(CH1);
await sleep(0.4);
fm.keyOff(CH1);
await sleep(0.3);
`,
  "raw-write-beep": `fm.reset();

// Port 0, channel 1, operator 4 only

// DT / MULTI
fm.writeAddress(0, 0x3c);
fm.writeData((0 << 4) | 1);

// Total Level
fm.writeAddress(0, 0x4c);
fm.writeData(8);

// Attack Rate
fm.writeAddress(0, 0x5c);
fm.writeData(22);

// First Decay Rate
fm.writeAddress(0, 0x6c);
fm.writeData(6);

// Sustain Rate
fm.writeAddress(0, 0x7c);
fm.writeData(3);

// Sustain Level / Release Rate
fm.writeAddress(0, 0x8c);
fm.writeData((3 << 4) | 8);

// Algorithm / Feedback
fm.writeAddress(0, 0xb0);
fm.writeData((0 << 3) | 7);

// Left / Right output enable
fm.writeAddress(0, 0xb4);
fm.writeData(0xc0);

// BLOCK / F-NUM high and low
fm.writeAddress(0, 0xa4);
fm.writeData((4 << 3) | ((553 >> 8) & 0x07));
fm.writeAddress(0, 0xa0);
fm.writeData(553 & 0xff);

// Key On all operators on channel 1
fm.writeAddress(0, 0x28);
fm.writeData(0xf0 | 0x00);
await sleep(0.4);

// Key Off
fm.writeAddress(0, 0x28);
fm.writeData(0x00);
await sleep(0.3);
`,
  "channel3-special-mode": `fm.reset();

// YM2612 CH3 Special Mode
fm.setChannel3SpecialMode(true);

// ALG 7:
// OP1, OP2, OP3, OP4 are all carriers.
fm.setAlgo(CH3, 7, 0);
fm.setPan(CH3, true, true);

const op = {
  multi: 1,
  tl: 24,
  ar: 31,
  d1r: 6,
  d2r: 3,
  sl: 3,
  rr: 8,
};

fm.setOperator(CH3, OP1, op);
fm.setOperator(CH3, OP2, op);
fm.setOperator(CH3, OP3, op);
fm.setOperator(CH3, OP4, op);

// CH3 Special Mode frequency registers:
//
// OP3 -> 0xA8 / 0xAC
// OP1 -> 0xA9 / 0xAD
// OP2 -> 0xAA / 0xAE
// OP4 -> normal CH3 frequency (0xA2 / 0xA6)
//
// Rough C-E-G-C chord.
//
// Same BLOCK, different FNUM values.
// These do not need to be exact equal-tempered pitches;
// the point is to make the four independent frequencies obvious.

fm.setChannel3SpecialFrequency(OP1, 4, 512); // C-ish
fm.setChannel3SpecialFrequency(OP2, 4, 645); // E-ish
fm.setChannel3SpecialFrequency(OP3, 4, 768); // G-ish

// OP4 frequency is written through the normal CH3 frequency registers.
// noteOn also performs KEY ON for all operators.
fm.noteOn(CH3, 5, 512); // upper C-ish

await sleep(1.5);

fm.noteOff(CH3);

await sleep(0.3);

fm.setChannel3SpecialMode(false);
`,
  "ambient-choir": `setBpm(72);
setMasterVolume(1.2);

fm.reset();
fm.setChannel3SpecialMode(true);
fm.setAlgo(CH3, 7, 0);
fm.setPan(CH3, true, true);
fm.setLfo(true, 3);

fm.setOperator(CH3, OP1, {
  multi: 1,
  tl: 20,
  ar: 8,
  d1r: 4,
  d2r: 2,
  sl: 4,
  rr: 6,
});
fm.setOperator(CH3, OP2, {
  multi: 1,
  tl: 26,
  ar: 7,
  d1r: 4,
  d2r: 2,
  sl: 4,
  rr: 7,
});
fm.setOperator(CH3, OP3, {
  multi: 1,
  tl: 30,
  ar: 9,
  d1r: 5,
  d2r: 2,
  sl: 5,
  rr: 6,
});
fm.setOperator(CH3, OP4, {
  multi: 1,
  tl: 22,
  ar: 8,
  d1r: 4,
  d2r: 2,
  sl: 4,
  rr: 6,
});

const choirFx = await livePrepare("ambient-choir-fx", async ({ fx }) => {
  const filter = fx.filter({
    type: "lowpass",
    cutoff: 3400,
    q: 0.8,
  });
  const delay = fx.delay({
    time: 0.16,
    feedback: 0.18,
    mix: 0.12,
  });
  const reverb = fx.reverb({
    mix: 0.34,
    tone: 4200,
  });

  return {
    filter,
    delay,
    reverb,
  };
});

fx.setChain([
  choirFx.filter,
  choirFx.delay,
  choirFx.reverb,
]);

const choirShapes = [
  {
    op1: { block: 4, fnum: 512 },
    op2: { block: 4, fnum: 645 },
    op3: { block: 4, fnum: 768 },
    op4: { block: 5, fnum: 512 },
  },
  {
    op1: { block: 4, fnum: 430 },
    op2: { block: 4, fnum: 512 },
    op3: { block: 4, fnum: 645 },
    op4: { block: 5, fnum: 430 },
  },
  {
    op1: { block: 4, fnum: 576 },
    op2: { block: 4, fnum: 704 },
    op3: { block: 4, fnum: 860 },
    op4: { block: 5, fnum: 576 },
  },
];

liveLoop("choir-pad", async () => {
  const chord = choirShapes[cycle([0, 1, 2])];

  if (!chord) {
    return;
  }

  fm.setChannel3SpecialFrequency(OP1, chord.op1.block, chord.op1.fnum);
  fm.setChannel3SpecialFrequency(OP2, chord.op2.block, chord.op2.fnum);
  fm.setChannel3SpecialFrequency(OP3, chord.op3.block, chord.op3.fnum);

  choirFx.filter.cutoff.set(choose([2800, 3200, 3600, 4200]));
  choirFx.delay.mix.set(choose([0.1, 0.12, 0.16]));

  fm.noteOn(CH3, chord.op4.block, chord.op4.fnum);
  await beat(3.5);
  fm.noteOff(CH3);
  await beat(0.5);
});
`,
  "noise-ocean": `setBpm(40);

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
`,
  "wind-noise": `setBpm(28);

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
      delay1: 0.018,
      delay2: 0.028,
      depth: 0.25,
      rate: 0.08,
      mix: 0.16,
      output: 1.0,
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
`,
  "radio-noise-bed": `setBpm(54);

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
`,
  "rain-noise": `setBpm(46);

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
`,
  "campfire-air": `setBpm(34);

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
    tape: fx.tapeSaturation({
      drive: 1.08,
      mix: 0.22,
      output: 1.0,
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
`,
  "just-intonation-chorus": `setBpm(72);
setMasterVolume(1.0);

fm.reset();

const melodyChannel = CH1;
const harmonyChannels = [CH2, CH3];
const allChannels = [melodyChannel, ...harmonyChannels];
const baseBeat = 0.35;

const op = {
  dt: 0,
  multi: 1,
  tl: 18,
  ar: 14,
  d1r: 3,
  d2r: 1,
  sl: 3,
  rr: 8,
};

for (const ch of allChannels) {
  fm.setAlgo(ch, 7, 0);
  fm.setPan(ch, true, true);
  fm.setOperator(ch, OP1, op);
  fm.setOperator(ch, OP2, { ...op, tl: 28 });
  fm.setOperator(ch, OP3, { ...op, tl: 36 });
  fm.setOperator(ch, OP4, { ...op, tl: ch === melodyChannel ? 22 : 30 });
}

const choirFx = await livePrepare("just-intonation-chorus-fx", async ({ fx }) => {
  const filter = fx.filter({
    type: "lowpass",
    cutoff: 5200,
    q: 0.3,
  });

  const reverb = fx.reverb({
    mix: 0.16,
    tone: 6000,
  });

  return {
    filter,
    reverb,
  };
});

fx.setChain([
  choirFx.filter,
  choirFx.reverb,
]);

function ratioPitch(block, fnum, ratio) {
  let value = fnum * ratio;
  let b = block;

  while (value >= 2048 && b < 7) {
    value /= 2;
    b++;
  }

  while (value < 1024 && b > 0) {
    value *= 2;
    b--;
  }

  return {
    block: b,
    fnum: Math.round(value),
  };
}

const root = noteToBlockFnum("D4");

// Just-intonation scales from D as the root.
const scales = [
  { label: "D", ratios: [1 / 1, 5 / 4, 3 / 2] },
  { label: "E", ratios: [9 / 8, 45 / 32, 27 / 16] },
  { label: "F#", ratios: [5 / 4, 3 / 2, 15 / 8] },
  { label: "G", ratios: [4 / 3, 5 / 3, 2 / 1] },
  { label: "A", ratios: [3 / 2, 15 / 8, 9 / 4] },
  { label: "B", ratios: [5 / 3, 2 / 1, 5 / 2] },
  { label: "C#", ratios: [15 / 8, 9 / 4, 45 / 16] },
  { label: "D", ratios: [2 / 1, 5 / 2, 3 / 1] },
];

liveLoop("just-intonation-chorus", async () => {
  const chord = cycle("just-intonation-chorus-scales", scales);
  const melodyPitch = ratioPitch(
    root.block,
    root.fnum,
    chord.ratios[0]
  );
  const harmonyPitch1 = ratioPitch(root.block, root.fnum, chord.ratios[1]);
  const harmonyPitch2 = ratioPitch(root.block, root.fnum, chord.ratios[2]);

  choirFx.filter.cutoff.set(choose([4200, 4800, 5200, 5600]));

  fm.setFrequency(
    melodyChannel,
    melodyPitch.block,
    melodyPitch.fnum
  );
  fm.setFrequency(
    harmonyChannels[0],
    harmonyPitch1.block,
    harmonyPitch1.fnum
  );
  fm.setFrequency(
    harmonyChannels[1],
    harmonyPitch2.block,
    harmonyPitch2.fnum
  );

  for (const ch of allChannels) {
    fm.keyOn(ch);
  }

  await beat(baseBeat);

  for (const ch of allChannels) {
    fm.keyOff(ch);
  }
  await beat(baseBeat * 0.5);
});
`,
  "ambient-choir-sample": `setBpm(72);
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
`,
  "waves-sample": `setBpm(40);
setMasterVolume(0.9);

fm.reset();

const seaChannels = [CH1, CH2, CH3];

for (const ch of seaChannels) {
  fm.setAlgo(ch, 4, 5);
  fm.setPan(ch, true, true);
}

// CH1: deep sea-bed
fm.setOperator(CH1, OP1, {
  dt: 3,
  multi: 1,
  tl: 20,
  ar: 8,
  d1r: 2,
  d2r: 1,
  sl: 4,
  rr: 4,
});
fm.setOperator(CH1, OP2, {
  dt: 2,
  multi: 2,
  tl: 28,
  ar: 7,
  d1r: 2,
  d2r: 1,
  sl: 5,
  rr: 4,
});
fm.setOperator(CH1, OP3, {
  dt: 1,
  multi: 3,
  tl: 36,
  ar: 6,
  d1r: 2,
  d2r: 1,
  sl: 6,
  rr: 4,
});
fm.setOperator(CH1, OP4, {
  dt: 0,
  multi: 1,
  tl: 10,
  ar: 10,
  d1r: 2,
  d2r: 1,
  sl: 4,
  rr: 4,
});

// CH2: main wash
fm.setOperator(CH2, OP1, {
  dt: 2,
  multi: 1,
  tl: 18,
  ar: 10,
  d1r: 3,
  d2r: 1,
  sl: 4,
  rr: 5,
});
fm.setOperator(CH2, OP2, {
  dt: 1,
  multi: 4,
  tl: 26,
  ar: 9,
  d1r: 3,
  d2r: 1,
  sl: 5,
  rr: 5,
});
fm.setOperator(CH2, OP3, {
  dt: 3,
  multi: 7,
  tl: 38,
  ar: 8,
  d1r: 3,
  d2r: 1,
  sl: 6,
  rr: 5,
});
fm.setOperator(CH2, OP4, {
  dt: 0,
  multi: 1,
  tl: 16,
  ar: 11,
  d1r: 3,
  d2r: 1,
  sl: 4,
  rr: 5,
});

// CH3: bright splash
fm.setAlgo(CH3, 7, 6);
fm.setOperator(CH3, OP1, {
  dt: 3,
  multi: 12,
  tl: 32,
  ar: 28,
  d1r: 18,
  d2r: 8,
  sl: 7,
  rr: 9,
});
fm.setOperator(CH3, OP2, {
  dt: 2,
  multi: 9,
  tl: 40,
  ar: 27,
  d1r: 16,
  d2r: 7,
  sl: 7,
  rr: 9,
});
fm.setOperator(CH3, OP3, {
  dt: 1,
  multi: 6,
  tl: 52,
  ar: 26,
  d1r: 14,
  d2r: 6,
  sl: 7,
  rr: 8,
});
fm.setOperator(CH3, OP4, {
  dt: 0,
  multi: 1,
  tl: 22,
  ar: 29,
  d1r: 12,
  d2r: 5,
  sl: 6,
  rr: 8,
});

const wavesFx = await livePrepare("waves-sample-fx", async ({ fx }) => {
  const filter = fx.filter({
    type: "lowpass",
    cutoff: 1800,
    q: 0.4,
  });
  const reverb = fx.reverb({
    mix: 0.38,
    tone: 5400,
  });

  return {
    filter,
    reverb,
  };
});

fx.setChain([
  wavesFx.filter,
  wavesFx.reverb,
]);

liveLoop("sea-bed", async () => {
  fm.setPan(CH1, true, true);
  fm.setOperator(CH1, OP4, {
    tl: randInt(10, 18),
  });
  await play(choose(["D2", "Eb2", "F2"]), {
    channel: CH1,
    duration: rrange(1.8, 2.8),
  });
  await sleep(rrange(0.8, 1.4));
});

liveLoop("wash", async () => {
  wavesFx.filter.cutoff.rampTo(
    rrange(1200, 4200),
    rrange(0.6, 1.8)
  );
  fm.setPan(CH2, rand() > 0.25, true, 0, 0);
  fm.setOperator(CH2, OP4, {
    tl: randInt(12, 24),
  });
  await play(choose(["A2", "Bb2", "C3", "D3"]), {
    channel: CH2,
    duration: rrange(1.2, 2.2),
  });
  await sleep(rrange(0.9, 1.6));
});

liveLoop("splash", async () => {
  fm.setPan(CH3, rand() > 0.5, rand() > 0.5);
  fm.setOperator(CH3, OP4, {
    tl: randInt(18, 34),
  });
  await play(choose(["D5", "F5", "A5", "C6"]), {
    channel: CH3,
    duration: rrange(0.08, 0.18),
  });
  await sleep(rrange(1.4, 3.2));
});
`,
  "wobble-bass": `setBpm(108);
setMasterVolume(1.1);

fm.reset();
fm.setPreset(CH1, FM_PRESETS["fm-bass"]);
fm.setPreset(CH2, FM_PRESETS["fm-pluck"]);

fm.setPan(CH1, true, true, 0, 3);
fm.setLfo(true, 4);

const wobbleFx = await livePrepare("wobble-bass-fx", async ({ fx }) => {
  const filter = fx.filter({
    type: "lowpass",
    cutoff: 1400,
    q: 1.4,
  });
  const delay = fx.delay({
    time: 0.2,
    feedback: 0.22,
    mix: 0.1,
  });

  return {
    filter,
    delay,
  };
});

fx.setChain([
  wobbleFx.filter,
  wobbleFx.delay,
]);

liveLoop("wub", async () => {
  const root = cycle("wub-root", ["E2", "E2", "G2", "A2"]);
  const cutoff = cycle("wub-cutoff", [900, 1300, 1800, 1100]);
  const bassDepth = cycle("wub-depth", [34, 22, 30, 18]);

  wobbleFx.filter.cutoff.rampTo(cutoff, 0.12);
  fm.setOperator(CH1, OP4, {
    tl: bassDepth,
  });

  await play(root, {
    channel: CH1,
    duration: 0.2,
  });

  await beat(1);
});

liveLoop("wub-top", async () => {
  const notes = ["B3", "D4", "E4", "G4"];
  await play(cycle("wub-top-note", notes), {
    channel: CH2,
    duration: 0.08,
  });
  await beat(0.5);
});
`,
  "wobble-kick-bass-sample": `setBpm(96);
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
  await sample.play("drum-heavy-kick", {
    gain: 0.9,
    fadeIn: 0.002,
    fadeOut: 0.05,
  });

  await sample.play("bass-hit-c", {
    playbackRate: 0.8,
    gain: 0.4,
    fadeIn: 0.002,
    fadeOut: 0.08,
  });

  await sleep(1);
});
`,
  "dac-byte-stream": `fm.reset();

// YM2612 DAC lives on channel 6.
// This is not FM synthesis.
// We feed one 8-bit value at a time into register 0x2A.
fm.setDacEnabled(true);

const waveform = [
  0x80, 0xa0, 0xc0, 0xe0,
  0xff, 0xe0, 0xc0, 0xa0,
  0x80, 0x60, 0x40, 0x20,
  0x00, 0x20, 0x40, 0x60,
];

await new Promise((resolve) => {
  let index = 0;
  let written = 0;
  const timer = setInterval(() => {
    fm.writeDac(waveform[index]);
    index = (index + 1) % waveform.length;
    written += 1;

    if (written >= 320) {
      clearInterval(timer);
      resolve();
    }
  }, 1);
});

fm.writeDac(0x80);
fm.setDacEnabled(false);
`,
  "psg-scale": `// Sega PSG (SN76489-compatible) tone on channel 0, mixed into the same
// output as fm. psg.write(...) remains available for raw register experiments.
psg.reset();

const notes = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"];

for (const note of notes) {
  psg.tone(PSG1, { note, volume: 0.8 });
  await sleep(0.15);
}

psg.off(PSG1);
`,
  "psg-noise": `// Sega PSG noise channel. "tone3" follows PSG3's frequency.
psg.reset();

/** @type {Array<{ type: "white" | "periodic", rate: "low" | "medium" | "high" | "tone3", volume: number, duration: number }>} */
const bursts = [
  { type: "white", rate: "low", volume: 0.7, duration: 0.08 },
  { type: "white", rate: "medium", volume: 0.65, duration: 0.08 },
  { type: "white", rate: "high", volume: 0.7, duration: 0.08 },
  { type: "periodic", rate: "tone3", volume: 0.8, duration: 0.14 },
];

for (const burst of bursts) {
  psg.noise(burst);
  await sleep(burst.duration);
  psg.noiseOff();
  await sleep(0.05);
}
`,
  "psg-ocean": `// A deliberately coarse, slow "ocean" using the PSG's single noise channel.
// Periodic PSG noise is a narrow pulse train, so this uses white noise only.
setBpm(24);
psg.reset();

liveCleanup(["psg-ocean"], () => {
  psg.noiseOff();
});

liveLoop("psg-ocean", async () => {
  psg.noise({ type: "white", rate: "low", volume: 0.06 });

  // ---- The wave slowly approaches. ----
  for (const volume of [0.06, 0.14, 0.2, 0.27, 0.34, 0.42]) {
    psg.noiseVolume(volume);
    await beat(0.22);
  }

  // ---- A soft crest. ----
  for (const volume of [0.34, 0.48, 0.62, 0.5, 0.38]) {
    psg.noiseVolume(volume);
    await beat(0.14);
  }

  // ---- The water recedes, with a small returning ripple. ----
  for (const volume of [0.3, 0.22, 0.15, 0.1, 0.05, 0.1]) {
    psg.noiseVolume(volume);
    await beat(0.12);
  }

  await beat(choose([0.5, 0.75, 1, 1.25]));
});
`,
  "fx-loop-minor": `setBpm(120);

fm.setPreset(CH1, FM_PRESETS["one-op-basic"]);
fm.setPreset(CH2, FM_PRESETS["two-op-bell"]);

const mainFx = await livePrepare("fx-loop-minor-chain", async ({ fx }) => {
  const filter = fx.filter({
    type: "lowpass",
    cutoff: 2200,
    q: 1.4,
  });
  const delay = fx.delay({
    time: 0.18,
    feedback: 0.32,
    mix: 0.18,
  });
  const reverb = fx.reverb({
    mix: 0.12,
    tone: 6200,
  });

  return {
    filter,
    delay,
    reverb,
  };
});

fx.setChain([
  mainFx.filter,
  mainFx.delay,
  mainFx.reverb,
]);

liveLoop("bass", async () => {
  await nextBeat();
  await play("E2", { channel: CH1, duration: 0.12 });
  await beat(1);
  await play("G2", { channel: CH1, duration: 0.12 });
  await beat(1);
  await play("A2", { channel: CH1, duration: 0.12 });
  await beat(1);
  await play("B2", { channel: CH1, duration: 0.12 });
  await beat(1);
});

liveLoop("lead", async () => {
  const notes = scale("E4", "minorPentatonic", 2);
  mainFx.filter.cutoff.set(choose([900, 1400, 2200, 3600, 5200]));
  mainFx.delay.mix.set(choose([0.1, 0.16, 0.22]));
  await play(choose(notes), {
    channel: CH2,
    duration: 0.08,
  });
  await beat(0.125);
});
`,
  "fx-loop-major": `fm.setPreset(CH2, FM_PRESETS["ritual-bell"]);

const reverb = fx.reverb({
  mix: 0.2,
});

fx.setChain([reverb]);

liveLoop("bleeps", async () => {
  const notes = scale("Eb2", "majorPentatonic", 3);
  fm.setOperator(CH2, OP1, { tl: randInt(14, 40) });
  fm.setOperator(CH2, OP2, { tl: randInt(22, 45) });
  fm.setOperator(CH2, OP3, { tl: randInt(28, 50) });
  fm.setOperator(CH2, OP4, { tl: randInt(8, 30) });

  await play(choose(notes), {
    channel: CH2,
    duration: 0.1,
  });

  await sleep(0.001);
});
`,
  "guitar-fx-chain": `setBpm(108);
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
`,
  "flanger-guitar": `setBpm(112);
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
`,
  "wobble-filter-bass": `setBpm(108);
setMasterVolume(1.15);

fm.reset();
fm.setPreset(CH1, FM_PRESETS["fm-bass"]);

const fxRack = await livePrepare("wobble-filter-bass-fx", async ({ fx }) => {
  const wobble = fx.wobble({
    cutoff: 900,
    depth: 1600,
    rate: 0.5,
    resonance: 2.4,
    mix: 1,
  });
  const compressor = fx.compressor({
    threshold: -22,
    ratio: 7,
    attack: 0.005,
    release: 0.18,
    output: 1.05,
  });

  return {
    wobble,
    compressor,
  };
});

fx.setChain([
  fxRack.wobble,
  fxRack.compressor,
]);

liveLoop("bass", async () => {
  await play(choose(["E2", "E2", "G2", "A2"]), {
    channel: CH1,
    duration: 0.18,
  });
  await beat(0.5);
});
`,
  "slicer-sweep": `setBpm(96);

fm.setPreset(CH2, FM_PRESETS["fm-strings"]);

const mainFx = await livePrepare("slicer-sweep-chain", async ({ fx }) => {
  const slicer = fx.slicer({
    phase: 0.25,
    mix: 1,
  });
  const reverb = fx.reverb({
    mix: 0.3,
    tone: 5200,
  });

  return {
    slicer,
    reverb,
  };
});

fx.setChain([
  mainFx.slicer,
  mainFx.reverb,
]);

liveLoop("bikes", async () => {
  const roots = ["B1", "B2", "E1", "E2", "B3", "E3"];
  mainFx.slicer.phase.set(choose([0.25, 0.125]));

  const startNote = choose(chord(choose(roots), "minor"));
  const finalNote = choose(chord(choose(roots), "minor"));
  const start = noteToBlockFnum(startNote);

  fm.setFrequency(CH2, start.block, start.fnum);
  fm.keyOn(CH2);

  await tween(1.5, (t) => {
    const pitch = noteLerp(startNote, finalNote, t);
    fm.setFrequency(CH2, pitch.block, pitch.fnum);
    fm.setOperator(CH2, OP4, {
      tl: Math.round(lerp(36, 12, t)),
    });
  });

  fm.keyOff(CH2);
  await beat(2);
});
`,
  "fx-motion": `setBpm(120);

fm.setPreset(CH1, FM_PRESETS["four-op-pad"]);
fm.setPreset(CH2, FM_PRESETS["two-op-bell"]);

const mainFx = await livePrepare("fx-motion-chain", async ({ fx }) => {
  const gain = fx.gain({
    gain: 0.9,
  });
  const eq = fx.eq({
    bass: 0,
    mid: 0,
    treble: 0,
  });
  const filter = fx.filter({
    type: "lowpass",
    cutoff: 1200,
    q: 1.1,
  });
  const delay = fx.delay({
    time: 0.24,
    feedback: 0.28,
    mix: 0.16,
  });
  const reverb = fx.reverb({
    mix: 0.18,
    tone: 5400,
  });

  return {
    gain,
    eq,
    filter,
    delay,
    reverb,
  };
});

fx.setChain([
  mainFx.gain,
  mainFx.eq,
  mainFx.filter,
  mainFx.delay,
  mainFx.reverb,
]);

liveLoop("pad", async () => {
  await nextBeat();
  await play("E3", { channel: CH1, duration: 0.45 });
  await beat(2);
  await play("G3", { channel: CH1, duration: 0.45 });
  await beat(2);
});

liveLoop("lead", async () => {
  const notes = scale("E4", "minorPentatonic", 2);
  await play(choose(notes), {
    channel: CH2,
    duration: 0.08,
  });
  await beat(0.25);
});

liveLoop("fx-motion", async () => {
  mainFx.eq.bass.rampTo(
    choose([-6, -3, 0, 3, 6]),
    0.18
  );
  mainFx.eq.mid.rampTo(
    choose([-5, -2, 0, 2, 5]),
    0.18
  );
  mainFx.eq.treble.rampTo(
    choose([-6, -2, 0, 3, 7]),
    0.18
  );
  mainFx.filter.cutoff.rampTo(
    choose([800, 1200, 1800, 2600, 4200, 6400]),
    0.18
  );
  mainFx.delay.mix.rampTo(
    choose([0.08, 0.12, 0.18, 0.24]),
    0.12
  );
  mainFx.reverb.mix.set(
    choose([0.1, 0.16, 0.22])
  );
  await beat(0.5);
});
`,
  "parallel-fx": `setBpm(112);

fm.setPreset(CH1, FM_PRESETS["one-op-basic"]);
fm.setPreset(CH2, FM_PRESETS["one-op-flute"]);

const layeredFx = await livePrepare("parallel-fx-chain", async ({ fx }) => {
  const dryFilter = fx.filter({
    type: "lowpass",
    cutoff: 1800,
    q: 0.9,
  });
  const distorted = fx.distortion({
    drive: 2.4,
    mix: 0.9,
    output: 0.75,
  });
  const flanger = fx.flanger({
    time: 0.005,
    depth: 0.002,
    rate: 0.5,
    feedback: 0.2,
    mix: 0.65,
  });
  const reverb = fx.reverb({
    mix: 0.22,
    tone: 4800,
  });

  return {
    dryFilter,
    distorted,
    flanger,
    reverb,
    layered: fx.parallel(
      fx.branch(dryFilter),
      fx.branch(
        distorted,
        flanger,
        reverb
      )
    ),
  };
});

fx.setChain([
  layeredFx.layered,
]);

liveLoop("bass", async () => {
  await nextBeat();
  await play(choose(["E2", "E2", "G2", "A2"]), {
    channel: CH1,
    duration: 0.14,
  });
  await beat(1);
});

liveLoop("lead", async () => {
  await play(choose(scale("E4", "minorPentatonic", 2)), {
    channel: CH2,
    duration: 0.08,
  });
  await beat(0.25);
});
`,
  "radio-lofi": `setBpm(96);

fm.setPreset(CH1, FM_PRESETS["fm-bass"]);
fm.setPreset(CH2, FM_PRESETS["two-op-bell"]);

const sceneFx = await livePrepare("radio-lofi-chain", async ({ fx }) => {
  const radio = fx.radioTone({
    highpass: 420,
    lowpass: 2600,
    presence: 5,
    mix: 0.95,
    output: 1.1,
  });
  const lofi = fx.lofi({
    cutoff: 3400,
    highshelf: -10,
    drive: 1.1,
    mix: 0.75,
    output: 1.0,
  });
  const reverb = fx.reverb({
    mix: 0.14,
    tone: 4200,
  });

  return {
    radio,
    lofi,
    reverb,
  };
});

fx.setChain([
  sceneFx.radio,
  sceneFx.lofi,
  sceneFx.reverb,
]);

liveLoop("bass", async () => {
  await nextBeat();
  await play(choose(["E2", "E2", "G2", "A2"]), {
    channel: CH1,
    duration: 0.16,
  });
  await beat(1);
});

liveLoop("lead", async () => {
  await play(choose(scale("E4", "minorPentatonic", 2)), {
    channel: CH2,
    duration: 0.10,
  });
  await beat(0.375);
});
`,
  "stereo-chorus": `setBpm(92);

fm.setPreset(CH1, FM_PRESETS["four-op-pad"]);
fm.setPreset(CH2, FM_PRESETS["two-op-bell"]);

const spaceFx = await livePrepare("stereo-chorus-chain", async ({ fx }) => {
  const stereo = fx.stereoWidth({
    width: 1.6,
    mix: 1,
    output: 1,
  });
  const chorus = fx.chorus({
    delay1: 0.018,
    delay2: 0.023,
    depth: 0.004,
    rate: 1,
    spread: 1.7,
    mix: 0.45,
    output: 1,
  });
  const reverb = fx.reverb({
    mix: 0.14,
    tone: 5200,
  });

  return {
    stereo,
    chorus,
    reverb,
  };
});

fx.setChain([
  spaceFx.stereo,
  spaceFx.chorus,
  spaceFx.reverb,
]);

liveLoop("pad", async () => {
  await nextBeat();
  await play(choose(["E3", "G3", "A3", "B3"]), {
    channel: CH1,
    duration: 0.55,
  });
  await beat(1.5);
});

liveLoop("lead", async () => {
  await play(choose(scale("E4", "minorPentatonic", 2)), {
    channel: CH2,
    duration: 0.09,
  });
  await beat(0.25);
});
`,
  "crush-tape": `setBpm(104);

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
`,
};
