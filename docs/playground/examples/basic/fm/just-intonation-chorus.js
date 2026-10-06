setBpm(72);
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
