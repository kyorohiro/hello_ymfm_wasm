```
fm.setPreset(CH2, MEGADRIVE_FM_PRESETS["ritual-bell"]);

const reverb = fx.reverb({
  mix: 0.2,
});

fx.setChain([reverb]);

liveLoop("bleeps", async () => {
  const notes = scale("Eb2", "majorPentatonic", 3);

  await play(choose(notes), {
    channel: CH2,
    duration: 0.1,
  });

  await sleep(0.001);
});
```
