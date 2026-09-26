// Edit drive or process, then Apply while the liveLoop keeps playing.
// Context is copied to AudioWorklet; process cannot capture outer variables.
setBpm(120);
liveFx("distortion", {
  context: { gain: 0.4, drive: 2 },
  process(input, output, state, context) {
    for (let ch = 0; ch < input.length; ch++) {
      for (let i = 0; i < input[ch].length; i++) {
        output[ch][i] = Math.tanh(input[ch][i] * context.drive) * context.gain;
      }
    }
  },
});
fm.setPreset(CH1, FM_PRESETS["two-op-organ"]);
liveLoop("phrase", async () => {
  fx.updateContext("distortion", { drive: 2 });
  await play("C4", { channel: CH1, duration: 0.4 });
  await beat(1);
  fx.updateContext("distortion", { drive: 8 });
  await play("G4", { channel: CH1, duration: 0.4 });
  await beat(1);
});
// fx.removeLiveFx("distortion"); // Remove without stopping the song.
