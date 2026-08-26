export const EXAMPLES = {
  single: `fm.setPreset(CH1, MEGADRIVE_FM_PRESETS["one-op-basic"]);
await play("C4", { channel: CH1, duration: 0.35 });
await sleep(0.12);
await play("E4", { channel: CH1, duration: 0.35 });
await sleep(0.12);
await play("G4", { channel: CH1, duration: 0.5 });
`,
  random: `fm.setPreset(CH1, MEGADRIVE_FM_PRESETS["two-op-bell"]);
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
fm.setPreset(CH2, MEGADRIVE_FM_PRESETS["one-op-basic"]);
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

fm.setPreset(CH1, MEGADRIVE_FM_PRESETS["one-op-basic"]);
fm.setPreset(CH2, MEGADRIVE_FM_PRESETS["two-op-bell"]);

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
  await beat(0.125);
});
`,
  "fm-direct": `fm.reset();
fm.setPreset(CH1, MEGADRIVE_FM_PRESETS["one-op-basic"]);
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
  "fx-loop": `setBpm(120);

fm.setPreset(CH1, MEGADRIVE_FM_PRESETS["one-op-basic"]);
fm.setPreset(CH2, MEGADRIVE_FM_PRESETS["two-op-bell"]);

const mainFx = await livePrepare("fx-loop-chain", async ({ fx }) => {
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
  "fx-motion": `setBpm(120);

fm.setPreset(CH1, MEGADRIVE_FM_PRESETS["four-op-pad"]);
fm.setPreset(CH2, MEGADRIVE_FM_PRESETS["two-op-bell"]);

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
  mainFx.delay.mix.set(
    choose([0.08, 0.12, 0.18, 0.24])
  );
  mainFx.reverb.mix.set(
    choose([0.1, 0.16, 0.22])
  );
  await beat(0.5);
});
`,
};
