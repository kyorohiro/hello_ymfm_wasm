setBpm(96);

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
