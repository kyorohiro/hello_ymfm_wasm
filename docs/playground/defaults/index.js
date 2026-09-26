setBpm(120);

fm.setPreset(CH1, FM_PRESETS["one-op-basic"]);

liveFx("distortion", {
  context: { gain: 60.0, drive: 0.03 },
  process(input, output, state, context) {
    for (let ch = 0; ch < input.length; ch++) {
      for (let i = 0; i < input[ch].length; i++) {
        output[ch][i] = Math.tanh(input[ch][i] * context.gain) * context.drive;
      }
    }
  },
});

liveLoop("lead", async () => {
  const notes = scale("E4", "minorPentatonic", 2);
  //await nextBeat();
  await play(choose(notes), {
    channel: CH1,
    duration: 0.08,
  });
  await beat(cycle([0.04, 0.04, 0.08]));
});
