setBpm(120);

fm.setPreset(CH1, FM_PRESETS["one-op-basic"]);
fm.setPreset(CH2, FM_PRESETS["two-op-bell"]);

liveFx("distortion", {
  context: { gain: 80.0, drive: 0.2 },
  process(input, output, state, context) {
    for (let ch = 0; ch < input.length; ch++) {
      for (let i = 0; i < input[ch].length; i++) {
        output[ch][i] = Math.tanh(input[ch][i] * context.gain) * context.drive;
      }
    }
  },
});

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
